"""백테스트 엔진 — 하루씩 전진하며 시초가 돌파를 시뮬레이션한다.

════════ 룩어헤드(미래참조) 방지 규약 ════════
1) 후보 선정(09:00~첫봉 완료 직후 = 09:01 시점 의사결정):
   - 전일 일봉(prev_close/거래량/거래대금)  → 과거 데이터 (OK)
   - 당일 첫 window개 '완료된' 봉의 고가/거래량   → 이미 확정 (OK)
   - 거래량 급증 평균 = '과거' 거래일들의 첫봉 거래량 평균 (당일·미래 제외)
2) 진입 스캔은 window '이후' 봉부터. 각 봉은 그 봉이 끝났을 때의 OHLC만 본다.
   돌파 감지는 해당 봉의 high 로만 하고, 체결가는 trigger 또는 해당 봉 open.
3) 청산 스캔은 '진입한 봉 다음 봉'부터. 진입 봉의 잔여 구간을 미리 보지 않는다.
4) 한 봉 안에서 손절·익절이 동시 터지면 손절 우선(보수적). 갭으로 기준가를
   지나치면 더 불리한 쪽(손절은 시가, 익절은 목표가 상한)으로 체결.
"""
from __future__ import annotations
from dataclasses import dataclass

from strategy.opening_breakout import build_strategy, window_for
from strategy.base_strategy import StrategyContext
from strategy.filters import gap_rate
from backtest.execution import build_trade, position_shares, buy_fill
from backtest.portfolio import Portfolio


@dataclass
class BacktestResult:
    trades: list
    daily: list
    metrics: dict
    label: str = ""


def _parse_hhmm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


class BacktestEngine:
    def __init__(self, cfg: dict, market):
        self.cfg = cfg
        self.market = market
        self.strategy = build_strategy(cfg)
        self.window = window_for(cfg)
        self.costs = cfg["costs"]
        self.exit_cfg = cfg["exit"]
        self.lookback = int(cfg["entry"]["volume_lookback_days"])

    # ---------- 컨텍스트(그 시점 확정값만) ----------
    def _context(self, ticker, date, bars):
        prev = self.market.prev_daily_row(ticker, date)
        if prev is None:
            return None                       # 전일 정보 없음(상장 첫날 등) → 제외
        window = self.window
        if len(bars) < window + 2:            # 진입 스캔할 봉이 남지 않으면 제외
            return None
        first = bars.iloc[0]
        wbars = bars.iloc[:window]            # 완료된 첫 window개 봉만
        open_px = float(first["open"])
        vol_avg_list = self.market.prev_first_bar_volumes(ticker, date, self.lookback)
        vol_avg = (sum(vol_avg_list) / len(vol_avg_list)) if vol_avg_list else None
        return StrategyContext(
            ticker=ticker, date=date, name=self.market.names.get(ticker, ticker),
            prev_close=float(prev["close"]), prev_volume=float(prev["volume"]),
            prev_value=float(prev["value"]), open=open_px,
            first_bar_volume=float(first["volume"]), first_bar_value=float(first["value"]),
            window_high=float(wbars["high"].max()), window_end_idx=window - 1,
            gap_rate=gap_rate(open_px, float(prev["close"])),
            first_bar_vol_avg=vol_avg, n_bars=len(bars),
        )

    # ---------- 한 포지션 시뮬 ----------
    def _simulate(self, ctx, bars, plan, day_start_equity):
        alloc = day_start_equity * self.cfg["capital"]["position_pct"]
        n = len(bars)
        sl = self.costs["slippage"]

        # 1) 진입: start_idx 이후 봉에서 첫 돌파
        entry_idx = None
        entry_ref = None
        for i in range(plan.start_idx, n):
            bar = bars.iloc[i]
            if float(bar["high"]) > plan.trigger:          # 돌파 감지(그 봉 high 로만)
                entry_ref = max(plan.trigger, float(bar["open"]))  # 갭통과면 시가체결
                entry_idx = i
                break
        if entry_idx is None:
            return None                                    # 종일 미돌파 → 미체결

        entry_fill = buy_fill(entry_ref, sl)
        shares = position_shares(alloc, entry_fill)
        if shares < 1:
            return None                                    # 배분금 부족 → 미체결

        stop_price = entry_fill * (1 + self.exit_cfg["stop_loss_pct"] / 100.0)
        take_price = entry_fill * (1 + self.exit_cfg["take_profit_pct"] / 100.0)
        tr = self.exit_cfg["trailing"]
        tr_on = bool(tr["enabled"])
        activate_price = entry_fill * (1 + tr["activate_pct"] / 100.0)
        te_h, te_m = _parse_hhmm(self.exit_cfg["time_exit"])

        high_watermark = entry_fill
        trailing_active = False

        # 2) 청산: 진입 봉 '다음' 봉부터
        for j in range(entry_idx + 1, n):
            bar = bars.iloc[j]
            ts = bars.index[j]
            hi, lo, cl, op = float(bar["high"]), float(bar["low"]), float(bar["close"]), float(bar["open"])
            is_time_exit_bar = (ts.hour, ts.minute) >= (te_h, te_m)

            # (a) 손절 — 동시봉이면 손절 우선
            if lo <= stop_price:
                exit_ref = min(op, stop_price)             # 갭하락이면 더 불리한 시가
                return build_trade(ctx=ctx, entry_time=str(bars.index[entry_idx].time())[:5],
                                   entry_ref=entry_ref, exit_time=str(ts.time())[:5],
                                   exit_ref=exit_ref, shares=shares,
                                   exit_reason="STOP_LOSS", costs_cfg=self.costs)
            # (b) 익절
            if hi >= take_price:
                exit_ref = take_price                      # 목표가 상한(윈드폴 배제, 보수적)
                return build_trade(ctx=ctx, entry_time=str(bars.index[entry_idx].time())[:5],
                                   entry_ref=entry_ref, exit_time=str(ts.time())[:5],
                                   exit_ref=exit_ref, shares=shares,
                                   exit_reason="TAKE_PROFIT", costs_cfg=self.costs)
            # (c) 트레일링 스탑
            if tr_on:
                if hi >= activate_price:
                    trailing_active = True
                high_watermark = max(high_watermark, hi)
                if trailing_active:
                    trail_stop = high_watermark * (1 - tr["trail_pct"] / 100.0)
                    if lo <= trail_stop:
                        exit_ref = min(op, trail_stop)
                        return build_trade(ctx=ctx, entry_time=str(bars.index[entry_idx].time())[:5],
                                           entry_ref=entry_ref, exit_time=str(ts.time())[:5],
                                           exit_ref=exit_ref, shares=shares,
                                           exit_reason="TRAILING_STOP", costs_cfg=self.costs)
            # (d) 시간 청산
            if is_time_exit_bar:
                return build_trade(ctx=ctx, entry_time=str(bars.index[entry_idx].time())[:5],
                                   entry_ref=entry_ref, exit_time=str(ts.time())[:5],
                                   exit_ref=cl, shares=shares,
                                   exit_reason="TIME_EXIT", costs_cfg=self.costs)

        # 데이터가 time_exit 이전에 끝나면 마지막 봉 종가로 청산
        last_ts = bars.index[-1]
        return build_trade(ctx=ctx, entry_time=str(bars.index[entry_idx].time())[:5],
                           entry_ref=entry_ref, exit_time=str(last_ts.time())[:5],
                           exit_ref=float(bars.iloc[-1]["close"]), shares=shares,
                           exit_reason="TIME_EXIT", costs_cfg=self.costs)

    # ---------- 전체 실행 ----------
    def run(self, start: str | None = None, end: str | None = None, label: str = "") -> BacktestResult:
        from backtest import metrics as M
        pf = Portfolio(self.cfg["capital"]["initial_capital"],
                       self.cfg["capital"]["position_pct"],
                       self.cfg["capital"]["max_positions"])
        dates = [d for d in self.market.all_dates()
                 if (start is None or d >= start) and (end is None or d <= end)]
        trades, daily = [], []

        for date in dates:
            day_start = pf.equity
            # 후보 수집
            cands = []
            for ticker in self.market.tickers():
                bars = self.market.day_minutes(ticker, date)
                if bars is None or not len(bars):
                    continue
                ctx = self._context(ticker, date, bars)
                if ctx is None:
                    continue
                if self.strategy.passes_filters(ctx):
                    cands.append((ctx, bars))
            # 우선순위: 첫봉 거래대금 큰 순(유동성). 미래 무관·결정론적.
            cands.sort(key=lambda cb: cb[0].first_bar_value, reverse=True)
            taken = cands[: pf.max_positions]

            day_pnl = 0.0
            n_tr = win = lose = 0
            for ctx, bars in taken:
                plan = self.strategy.entry_plan(ctx)
                trade = self._simulate(ctx, bars, plan, day_start)
                if trade is None:
                    continue
                trades.append(trade)
                day_pnl += trade.profit_loss
                n_tr += 1
                if trade.profit_loss > 0:
                    win += 1
                elif trade.profit_loss < 0:
                    lose += 1

            pf.apply_day(day_pnl)
            daily.append({
                "date": date, "starting_capital": round(day_start, 2),
                "daily_pnl": round(day_pnl, 2),
                "daily_return": round(day_pnl / day_start, 6) if day_start else 0.0,
                "ending_capital": round(pf.equity, 2),
                "number_of_trades": n_tr, "winning_trades": win, "losing_trades": lose,
            })

        met = M.compute(trades, daily, pf.initial_capital)
        return BacktestResult(trades=trades, daily=daily, metrics=met, label=label)
