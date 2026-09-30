"""후보 종목 선정 필터 — 순수 함수 모음(테스트 용이).

모든 함수는 '그 시점에 확정된 값'만 인자로 받는다. 미래 데이터는 애초에
전달되지 않는다(engine 이 과거+완료봉만 넣어 준다).
"""
from __future__ import annotations


def gap_rate(open_px: float, prev_close: float) -> float:
    """시가 갭률(%) = (시가/전일종가 - 1) * 100."""
    if prev_close <= 0:
        return 0.0
    return (open_px / prev_close - 1.0) * 100.0


def pass_prev_value(prev_value, cfg) -> bool:
    return (not cfg["enabled"]) or (prev_value >= cfg["min_krw"])


def pass_prev_volume(prev_volume, cfg) -> bool:
    return (not cfg["enabled"]) or (prev_volume >= cfg["min_shares"])


def pass_gap(gap_pct, cfg) -> bool:
    return (not cfg["enabled"]) or (cfg["min_pct"] <= gap_pct <= cfg["max_pct"])


def pass_first_bar_volume(vol, cfg) -> bool:
    return (not cfg["enabled"]) or (vol >= cfg["min_shares"])


def pass_first_bar_value(val, cfg) -> bool:
    return (not cfg["enabled"]) or (val >= cfg["min_krw"])


def pass_volume_surge(first_bar_volume, first_bar_vol_avg, multiplier) -> bool:
    """첫봉 거래량이 과거 평균 × 배수 이상인가. 평균 표본이 없으면 False(보수적)."""
    if first_bar_vol_avg is None:
        return False
    return first_bar_volume >= first_bar_vol_avg * multiplier
