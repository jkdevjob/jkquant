"""단위 테스트 — 계산이 '예상값'과 정확히 일치하는지 검증.
가상 OHLC 로 진입/손절/익절/트레일링/시간청산/비용/사이징/MDD/룩어헤드를 확인.
"""
import os
import sys
import pandas as pd
import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from config_loader import load_config, with_overrides
from strategy import filters as F
from strategy.base_strategy import StrategyContext, EntryPlan
from backtest.execution import position_shares, build_trade, buy_fill, sell_fill
from backtest import metrics as M
from backtest.engine import BacktestEngine
from data_io.loader import MarketData


# ---------- 공용 헬퍼 ----------
def bars_from(date, rows):
    """rows: list of (hhmm, o,h,l,c,vol). value=c*vol."""
    idx = [pd.Timestamp(f"{date} {hm}:00") for hm, *_ in rows]
    data = {"open": [], "high": [], "low": [], "close": [], "volume": [], "value": []}
    for _, o, h, l, c, v in rows:
        data["open"].append(o); data["high"].append(h); data["low"].append(l)
        data["close"].append(c); data["volume"].append(v); data["value"].append(c * v)
    return pd.DataFrame(data, index=pd.DatetimeIndex(idx))


def make_ctx(date="2023-01-02", open_px=10000, prev_close=9800, window_high=10000,
             window_end_idx=0, first_vol=50000, vol_avg=10000):
    return StrategyContext(
        ticker="000001", date=date, name="TEST", prev_close=prev_close,
        prev_volume=1e6, prev_value=1e10, open=open_px,
        first_bar_volume=first_vol, first_bar_value=first_vol * open_px,
        window_high=window_high, window_end_idx=window_end_idx,
        gap_rate=F.gap_rate(open_px, prev_close), first_bar_vol_avg=vol_avg, n_bars=10)


def engine_with(**exit_overrides):
    cfg = load_config(os.path.join(BASE, "config/strategy.yaml"))
    ov = {f"exit.{k}": v for k, v in exit_overrides.items() if not k.startswith("trailing")}
    cfg = with_overrides(cfg, ov)
    # 트레일링은 중첩이라 직접 세팅
    for k, v in exit_overrides.items():
        if k.startswith("trailing."):
            cfg["exit"]["trailing"][k.split(".", 1)[1]] = v
    cfg["capital"]["position_pct"] = 1.0   # 테스트: 전액 배분 → 주수 계산 단순
    market = MarketData(minute={"000001": {}}, daily={}, names={})
    return BacktestEngine(cfg, market), cfg


# ---------- 1. 갭률 ----------
def test_gap_rate():
    assert F.gap_rate(11000, 10000) == pytest.approx(10.0)
    assert F.gap_rate(9800, 10000) == pytest.approx(-2.0)
    assert F.gap_rate(10000, 0) == 0.0


# ---------- 2. 포지션 사이징 ----------
def test_position_shares():
    assert position_shares(1_000_000, 10000) == 100
    assert position_shares(1_050_000, 10000) == 105
    assert position_shares(9_999, 10000) == 0      # 한 주도 못 사면 0


# ---------- 3. 수수료·세금·순손익 ----------
def test_costs_and_pnl():
    costs = {"buy_commission": 0.001, "sell_commission": 0.001, "tax": 0.002, "slippage": 0.0}
    ctx = make_ctx()
    tr = build_trade(ctx=ctx, entry_time="09:01", entry_ref=10000, exit_time="09:05",
                     exit_ref=11000, shares=100, exit_reason="TAKE_PROFIT", costs_cfg=costs)
    # 슬리피지 0 → 체결가 = 기준가
    assert tr.entry_price == 10000 and tr.exit_price == 11000
    # 매수수수료 100*10000*0.001=1000, 매도수수료 100*11000*0.001=1100 → 2100
    assert tr.commission == pytest.approx(2100.0)
    # 거래세 100*11000*0.002 = 2200
    assert tr.tax == pytest.approx(2200.0)
    # 총손익 = (100*11000 - 100*10000) - 2100 - 2200 = 100000-4300 = 95700
    assert tr.profit_loss == pytest.approx(95700.0)


def test_slippage_applied():
    costs = {"buy_commission": 0, "sell_commission": 0, "tax": 0, "slippage": 0.001}
    ctx = make_ctx()
    tr = build_trade(ctx=ctx, entry_time="09:01", entry_ref=10000, exit_time="09:05",
                     exit_ref=10000, shares=10, exit_reason="TIME_EXIT", costs_cfg=costs)
    assert tr.entry_price == pytest.approx(10010.0)   # 매수 +0.1%
    assert tr.exit_price == pytest.approx(9990.0)    # 매도 -0.1%
    assert tr.profit_loss < 0                          # 왕복 슬리피지로 손실


# ---------- 4. MDD ----------
def test_mdd():
    eq = pd.Series([100, 120, 90, 110])
    assert M.max_drawdown(eq) == pytest.approx(-25.0)   # 120→90
    assert M.max_drawdown(pd.Series([100, 101, 102])) == pytest.approx(0.0)


# ---------- 5. 진입: 첫봉 고가 돌파 ----------
def test_entry_breakout():
    eng, cfg = engine_with(stop_loss_pct=-50, take_profit_pct=50, time_exit="15:20")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),   # 참조봉(window)
        ("09:01", 9960, 9980, 9950, 9970, 3000),      # 미돌파
        ("09:02", 9990, 10050, 9985, 10040, 8000),    # 10000 돌파!
        ("15:20", 10040, 10060, 10030, 10050, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr is not None
    assert tr.entry_time == "09:02"
    # 체결 기준 = max(trigger, open)=max(10000,9990)=10000, 슬리피지 반영
    assert tr.entry_price == pytest.approx(10000 * (1 + cfg["costs"]["slippage"]))


# ---------- 6. 룩어헤드 방지: window 이전/이내 봉으로는 진입하지 않는다 ----------
def test_no_entry_within_window():
    eng, cfg = engine_with(stop_loss_pct=-50, take_profit_pct=50, time_exit="15:20")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    # 참조봉(09:00) 자체의 고가가 최고 — 이후 봉은 절대 10000 초과 못함 → 미체결
    bars = bars_from("2023-01-02", [
        ("09:00", 9900, 10000, 9900, 9950, 50000),
        ("09:01", 9950, 9990, 9940, 9960, 3000),
        ("15:20", 9960, 9999, 9950, 9980, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    assert eng._simulate(ctx, bars, plan, 1_000_000) is None


# ---------- 7. 손절 ----------
def test_stop_loss():
    eng, cfg = engine_with(stop_loss_pct=-2.0, take_profit_pct=50, time_exit="15:20")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),
        ("09:01", 10000, 10010, 9990, 10000, 3000),   # 진입(트리거 10000 초과)
        ("09:02", 9990, 9995, 9700, 9750, 8000),      # -2% = 9800 이하로 하락 → 손절
        ("15:20", 9750, 9760, 9740, 9755, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr.exit_reason == "STOP_LOSS"
    entry_fill = 10000 * (1 + cfg["costs"]["slippage"])
    stop_price = entry_fill * 0.98
    # 09:02 시가 9990 > stop_price 이므로 stop_price 에 체결(=min(open,stop))
    assert tr.exit_price == pytest.approx(stop_price * (1 - cfg["costs"]["slippage"]))


# ---------- 8. 익절 ----------
def test_take_profit():
    eng, cfg = engine_with(stop_loss_pct=-50, take_profit_pct=3.0, time_exit="15:20")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),
        ("09:01", 10000, 10010, 9990, 10005, 3000),   # 진입
        ("09:02", 10010, 10400, 10000, 10350, 8000),  # +3%=10300 돌파 → 익절
        ("15:20", 10350, 10360, 10340, 10355, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr.exit_reason == "TAKE_PROFIT"


# ---------- 9. 손절·익절 동시봉 → 손절 우선(보수적) ----------
def test_stop_priority_when_both():
    eng, cfg = engine_with(stop_loss_pct=-2.0, take_profit_pct=3.0, time_exit="15:20")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),
        ("09:01", 10000, 10010, 9990, 10000, 3000),   # 진입 fill≈10010
        ("09:02", 10005, 10400, 9700, 10000, 8000),   # 고가 +3%↑ & 저가 -2%↓ 둘 다
        ("15:20", 10000, 10010, 9990, 10000, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr.exit_reason == "STOP_LOSS"


# ---------- 10. 시간 청산 ----------
def test_time_exit():
    eng, cfg = engine_with(stop_loss_pct=-50, take_profit_pct=50, time_exit="09:03")
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),
        ("09:01", 10000, 10010, 9990, 10000, 3000),   # 진입
        ("09:02", 10000, 10020, 9990, 10010, 8000),
        ("09:03", 10010, 10020, 9990, 10015, 2000),   # 시간청산 봉 → 종가청산
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr.exit_reason == "TIME_EXIT"
    assert tr.exit_time == "09:03"
    assert tr.exit_price == pytest.approx(10015 * (1 - cfg["costs"]["slippage"]))


# ---------- 11. 트레일링 스탑 ----------
def test_trailing_stop():
    eng, cfg = engine_with(stop_loss_pct=-50, take_profit_pct=50, time_exit="15:20",
                           **{"trailing.enabled": True, "trailing.activate_pct": 3.0,
                              "trailing.trail_pct": 1.5})
    ctx = make_ctx(window_high=10000, window_end_idx=0)
    bars = bars_from("2023-01-02", [
        ("09:00", 10000, 10000, 9900, 9950, 50000),
        ("09:01", 10000, 10010, 9990, 10000, 3000),   # 진입 fill≈10010
        ("09:02", 10010, 10500, 10010, 10450, 8000),  # +3% 넘겨 활성화, 고점 10500
        ("09:03", 10450, 10460, 10200, 10250, 5000),  # 10500*(1-1.5%)=10342.5 이하로 하락 → 청산
        ("15:20", 10250, 10260, 10240, 10255, 2000),
    ])
    plan = EntryPlan(trigger=10000, start_idx=1)
    tr = eng._simulate(ctx, bars, plan, 1_000_000)
    assert tr.exit_reason == "TRAILING_STOP"


# ---------- 12. 룩어헤드 방지: 거래량 평균은 과거 거래일만 ----------
def test_prev_first_bar_volumes_past_only():
    d1 = bars_from("2023-01-02", [("09:00", 100, 100, 100, 100, 111)])
    d2 = bars_from("2023-01-03", [("09:00", 100, 100, 100, 100, 222)])
    d3 = bars_from("2023-01-04", [("09:00", 100, 100, 100, 100, 333)])
    mkt = MarketData(minute={"A": {"2023-01-02": d1, "2023-01-03": d2, "2023-01-04": d3}},
                     daily={}, names={})
    # 2023-01-04 시점에서 과거는 111,222 만 (당일 333 제외)
    vols = mkt.prev_first_bar_volumes("A", "2023-01-04", lookback=20)
    assert vols == [111.0, 222.0]
    # 첫날은 과거 없음
    assert mkt.prev_first_bar_volumes("A", "2023-01-02", lookback=20) == []


def test_prev_daily_row_strictly_past():
    daily = pd.DataFrame(
        {"close": [100, 110, 120], "volume": [1, 2, 3], "value": [10, 20, 30]},
        index=["2023-01-02", "2023-01-03", "2023-01-04"])
    mkt = MarketData(minute={"A": {}}, daily={"A": daily}, names={})
    row = mkt.prev_daily_row("A", "2023-01-04")
    assert row["close"] == 110          # 직전일(01-03), 당일 아님
    assert mkt.prev_daily_row("A", "2023-01-02") is None
