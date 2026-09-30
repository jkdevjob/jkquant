"""성과 지표 계산 — 임의 값 생성 금지. 오직 거래·자산 기록에서 계산한다."""
from __future__ import annotations
import numpy as np
import pandas as pd


def max_drawdown(equity: pd.Series) -> float:
    """MDD(%) — 자산곡선의 최대 낙폭. 음수(%)로 반환."""
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    dd = equity / peak - 1.0
    return float(dd.min() * 100.0)


def cagr(equity: pd.Series, dates: pd.DatetimeIndex) -> float:
    """연복리수익률(%). 기간은 실제 달력일 기준."""
    if len(equity) < 2:
        return 0.0
    days = (dates[-1] - dates[0]).days
    if days <= 0:
        return 0.0
    years = days / 365.25
    growth = equity.iloc[-1] / equity.iloc[0]
    if growth <= 0:
        return -100.0
    return float((growth ** (1 / years) - 1.0) * 100.0)


def _streaks(wins: list[bool]):
    max_w = max_l = cur_w = cur_l = 0
    for w in wins:
        if w:
            cur_w += 1; cur_l = 0
        else:
            cur_l += 1; cur_w = 0
        max_w = max(max_w, cur_w); max_l = max(max_l, cur_l)
    return max_w, max_l


def compute(trades: list, daily: list, initial_capital: float) -> dict:
    """trades: Trade 목록, daily: [{date,ending_capital,...}] → 지표 dict."""
    n = len(trades)
    pnl = np.array([t.profit_loss for t in trades], dtype=float) if n else np.array([])
    rets = np.array([t.net_return for t in trades], dtype=float) if n else np.array([])
    wins_mask = pnl > 0
    win = int(wins_mask.sum())
    loss = int((pnl < 0).sum())
    gross_profit = float(pnl[pnl > 0].sum()) if n else 0.0
    gross_loss = float(-pnl[pnl < 0].sum()) if n else 0.0

    if daily:
        ddf = pd.DataFrame(daily)
        ddf["date"] = pd.to_datetime(ddf["date"])
        ddf = ddf.sort_values("date")
        equity = ddf["ending_capital"].reset_index(drop=True)
        eq_dates = pd.DatetimeIndex(ddf["date"].values)
        final_equity = float(equity.iloc[-1])
        mdd = max_drawdown(equity)
        cagr_v = cagr(equity, eq_dates)
    else:
        final_equity = initial_capital
        mdd = 0.0
        cagr_v = 0.0

    avg_win = float(pnl[pnl > 0].mean()) if win else 0.0
    avg_loss = float(pnl[pnl < 0].mean()) if loss else 0.0
    payoff = (avg_win / abs(avg_loss)) if avg_loss != 0 else float("inf") if avg_win > 0 else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)
    max_w, max_l = _streaks(list(wins_mask))
    total_pnl = float(pnl.sum()) if n else 0.0

    return {
        "total_trades": n,
        "winning_trades": win,
        "losing_trades": loss,
        "win_rate": round(win / n * 100, 2) if n else 0.0,
        "avg_return_pct": round(float(rets.mean()) * 100, 4) if n else 0.0,
        "avg_win_krw": round(avg_win, 2),
        "avg_loss_krw": round(avg_loss, 2),
        "payoff_ratio": round(payoff, 4) if payoff != float("inf") else float("inf"),
        "profit_factor": round(profit_factor, 4) if profit_factor != float("inf") else float("inf"),
        "cagr_pct": round(cagr_v, 4),
        "mdd_pct": round(mdd, 4),
        "cagr_over_mdd": round(cagr_v / abs(mdd), 4) if mdd != 0 else 0.0,
        "final_equity": round(final_equity, 2),
        "initial_capital": round(initial_capital, 2),
        "total_pnl": round(total_pnl, 2),
        "total_return_pct": round((final_equity / initial_capital - 1) * 100, 4) if initial_capital else 0.0,
        "max_consecutive_wins": max_w,
        "max_consecutive_losses": max_l,
    }


def format_report(m: dict) -> str:
    def f(x):
        return "inf" if x == float("inf") else x
    lines = [
        "─" * 46,
        "백테스트 성과 요약",
        "─" * 46,
        f"  총 거래 횟수      : {m['total_trades']}",
        f"  승리 / 패배       : {m['winning_trades']} / {m['losing_trades']}",
        f"  승률              : {m['win_rate']} %",
        f"  평균 수익률       : {m['avg_return_pct']} %",
        f"  평균 이익 / 손실  : {m['avg_win_krw']:,} / {m['avg_loss_krw']:,} 원",
        f"  손익비(payoff)    : {f(m['payoff_ratio'])}",
        f"  Profit Factor     : {f(m['profit_factor'])}",
        f"  CAGR              : {m['cagr_pct']} %",
        f"  MDD               : {m['mdd_pct']} %",
        f"  CAGR / MDD        : {m['cagr_over_mdd']}",
        f"  최대 연속 승/패   : {m['max_consecutive_wins']} / {m['max_consecutive_losses']}",
        f"  초기 투자금       : {m['initial_capital']:,} 원",
        f"  최종 자산         : {m['final_equity']:,} 원",
        f"  총 손익           : {m['total_pnl']:,} 원",
        f"  총 수익률         : {m['total_return_pct']} %",
        "─" * 46,
    ]
    return "\n".join(lines)
