"""체결·비용 모델. 신호가와 실제 체결가를 구분한다(현실적 처리).

* 매수 체결 = 기준가 × (1 + slippage)
* 매도 체결 = 기준가 × (1 − slippage)
* 매수/매도 수수료율, 매도 거래세율은 config 에서만 온다(하드코딩 금지).
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import math


def buy_fill(ref_price: float, slippage: float) -> float:
    return ref_price * (1.0 + slippage)


def sell_fill(ref_price: float, slippage: float) -> float:
    return ref_price * (1.0 - slippage)


def position_shares(alloc_krw: float, entry_fill: float) -> int:
    """배분 금액으로 살 수 있는 정수 주식수(한국시장 = 정수주)."""
    if entry_fill <= 0:
        return 0
    return int(math.floor(alloc_krw / entry_fill))


@dataclass
class Trade:
    date: str
    ticker: str
    name: str
    prev_close: float
    open: float
    gap_rate: float
    entry_time: str
    entry_price: float          # 실제 체결가(슬리피지 포함)
    exit_time: str
    exit_price: float
    position_size: float        # 진입 금액(주수 × 진입체결가)
    shares: int
    gross_return: float         # 체결가 기준 수익률(비용 전)
    commission: float           # 매수+매도 수수료(원)
    tax: float                  # 매도 거래세(원)
    slippage: float             # 슬리피지로 인한 비용(원, 추정)
    net_return: float           # 비용 반영 순수익률
    profit_loss: float          # 순손익(원)
    exit_reason: str            # TAKE_PROFIT/STOP_LOSS/TRAILING_STOP/TIME_EXIT

    def as_row(self) -> dict:
        return asdict(self)


def build_trade(*, ctx, entry_time, entry_ref, exit_time, exit_ref, shares,
                exit_reason, costs_cfg) -> Trade:
    """기준가(ref)에 슬리피지를 입혀 실제 체결가를 만들고 비용까지 계산한 Trade 생성."""
    sl = costs_cfg["slippage"]
    entry_fill = buy_fill(entry_ref, sl)
    exit_fill = sell_fill(exit_ref, sl)
    position_size = shares * entry_fill
    proceeds = shares * exit_fill

    buy_comm = shares * entry_fill * costs_cfg["buy_commission"]
    sell_comm = shares * exit_fill * costs_cfg["sell_commission"]
    tax = shares * exit_fill * costs_cfg["tax"]
    commission = buy_comm + sell_comm
    # 슬리피지 비용(원): 무슬리피지 기준가 대비 손해분
    slippage_won = shares * (entry_fill - entry_ref) + shares * (exit_ref - exit_fill)

    gross_return = (exit_fill / entry_fill - 1.0) if entry_fill else 0.0
    profit_loss = (proceeds - position_size) - commission - tax
    net_return = profit_loss / position_size if position_size else 0.0

    return Trade(
        date=ctx.date, ticker=ctx.ticker, name=ctx.name,
        prev_close=round(ctx.prev_close, 4), open=round(ctx.open, 4),
        gap_rate=round(ctx.gap_rate, 4),
        entry_time=entry_time, entry_price=round(entry_fill, 4),
        exit_time=exit_time, exit_price=round(exit_fill, 4),
        position_size=round(position_size, 2), shares=shares,
        gross_return=round(gross_return, 6),
        commission=round(commission, 2), tax=round(tax, 2),
        slippage=round(slippage_won, 2),
        net_return=round(net_return, 6), profit_loss=round(profit_loss, 2),
        exit_reason=exit_reason,
    )
