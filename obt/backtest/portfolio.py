"""포지션·자본 관리. 종목당 배분 = (당일 시작 자산) × position_pct.

당일 시작 자산 기준으로 배분하므로 같은 날 여러 종목이 서로의 배분을
바꾸지 않는다(결정론적). 손익은 당일 종료 시 자산에 반영(복리)."""
from __future__ import annotations


class Portfolio:
    def __init__(self, initial_capital: float, position_pct: float, max_positions: int):
        self.initial_capital = float(initial_capital)
        self.equity = float(initial_capital)
        self.position_pct = float(position_pct)
        self.max_positions = int(max_positions)

    def alloc_per_position(self, day_start_equity: float) -> float:
        return day_start_equity * self.position_pct

    def apply_day(self, day_pnl: float) -> None:
        self.equity += day_pnl
