"""시초가 돌파 전략 A~E.

A: 첫 1분봉 고가 돌파      (window=1) — 기본 거래량 급증 요건 사용
B: 첫 3분봉 고가 돌파      (window=3)
C: 첫 5분봉 고가 돌파      (window=5)
D: 시초가 대비 +x% 돌파    (window=1, trigger=open*(1+x/100))
E: 첫 1분봉 고가 돌파 + 거래량 증가 (A와 같되 거래량 급증 강제)

각 전략은 trigger(돌파기준)와 start_idx(스캔 시작 봉)만 정하고,
실제 돌파 탐지·체결은 엔진이 미래봉을 한 봉씩 전진하며 수행한다(룩어헤드 방지).
"""
from __future__ import annotations
from strategy.base_strategy import BaseStrategy, StrategyContext, EntryPlan


class BreakoutHigh(BaseStrategy):
    """A/B/C/E 공통: 첫 window개 봉 고가 돌파."""
    def __init__(self, cfg, name, force_volume_surge=False):
        super().__init__(cfg)
        self.name = name
        self._force_vs = force_volume_surge

    def _volume_surge_required(self) -> bool:
        return True if self._force_vs else super()._volume_surge_required()

    def entry_plan(self, ctx: StrategyContext) -> EntryPlan:
        return EntryPlan(trigger=ctx.window_high, start_idx=ctx.window_end_idx + 1)


class OpenPctBreakout(BaseStrategy):
    """D: 시초가 대비 +open_breakout_pct% 돌파."""
    name = "D"

    def entry_plan(self, ctx: StrategyContext) -> EntryPlan:
        pct = self.e["open_breakout_pct"] / 100.0
        return EntryPlan(trigger=ctx.open * (1 + pct), start_idx=ctx.window_end_idx + 1)


def window_for(cfg: dict) -> int:
    """전략별 참조 window(봉 수). 엔진이 컨텍스트를 만들 때 쓴다."""
    strat = cfg["entry"]["strategy"].upper()
    if strat == "B":
        return 3
    if strat == "C":
        return 5
    if strat in ("A", "E", "D"):
        # A/E/D 는 window_min 설정을 따르되 최소 1
        return max(1, int(cfg["entry"].get("entry_window_min", 1))) if strat != "D" else 1
    return max(1, int(cfg["entry"].get("entry_window_min", 1)))


def build_strategy(cfg: dict) -> BaseStrategy:
    strat = cfg["entry"]["strategy"].upper()
    if strat == "D":
        return OpenPctBreakout(cfg)
    if strat == "E":
        return BreakoutHigh(cfg, "E", force_volume_surge=True)
    if strat in ("A", "B", "C"):
        return BreakoutHigh(cfg, strat, force_volume_surge=False)
    raise ValueError(f"알 수 없는 전략: {strat}")
