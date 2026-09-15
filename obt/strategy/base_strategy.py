"""전략 베이스 + 컨텍스트/시그널 자료구조.

룩어헤드 방지의 핵심: StrategyContext 는 엔진이 '그 시점에 이미 확정된' 값만
채워 넣는다(과거 일봉 + 당일 첫 window개 완료봉). 전략은 미래 봉을 직접 만지지
않고, 돌파 스캔은 엔진이 window 이후 봉부터 수행한다.
"""
from __future__ import annotations
from dataclasses import dataclass
from strategy import filters as F


@dataclass
class StrategyContext:
    ticker: str
    date: str
    name: str
    prev_close: float
    prev_volume: float
    prev_value: float
    open: float                 # 당일 첫 1분봉 시가 (09:00 시점 확정)
    first_bar_volume: float     # 첫 1분봉 거래량 (09:00봉 '완료' 후 = 09:01 이용가능)
    first_bar_value: float
    window_high: float          # 첫 window개 봉의 최고가 (완료봉만)
    window_end_idx: int         # 이 인덱스 '이후' 봉부터 진입 스캔 가능 (0-based)
    gap_rate: float             # (open/prev_close-1)*100
    first_bar_vol_avg: float | None   # 과거 lookback일 첫봉 거래량 평균(과거만), 없으면 None
    n_bars: int


@dataclass
class EntryPlan:
    trigger: float              # 돌파 기준가 (이 위로 뚫으면 진입)
    start_idx: int             # 이 인덱스부터 스캔 (window_end_idx + 1)


class BaseStrategy:
    name = "BASE"

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.f = cfg["filters"]
        self.e = cfg["entry"]

    # ---- 후보 선정: 과거 + 완료된 첫봉 데이터만 사용 ----
    def passes_filters(self, ctx: StrategyContext) -> bool:
        f = self.f
        if not F.pass_prev_value(ctx.prev_value, f["prev_value"]):
            return False
        if not F.pass_prev_volume(ctx.prev_volume, f["prev_volume"]):
            return False
        if not F.pass_gap(ctx.gap_rate, f["gap"]):
            return False
        if not F.pass_first_bar_volume(ctx.first_bar_volume, f["first_bar_volume"]):
            return False
        if not F.pass_first_bar_value(ctx.first_bar_value, f["first_bar_value"]):
            return False
        if self._volume_surge_required():
            if not F.pass_volume_surge(ctx.first_bar_volume, ctx.first_bar_vol_avg, self.e["volume_multiplier"]):
                return False
        return True

    def _volume_surge_required(self) -> bool:
        return bool(self.e.get("require_volume_surge"))

    def entry_plan(self, ctx: StrategyContext) -> EntryPlan:
        raise NotImplementedError
