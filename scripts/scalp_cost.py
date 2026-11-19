"""단타 연구 비용 — 한 곳 (2026-11-19 사용자: "단타 연구 봇에도 공통 수수료 적용해")

functions/api/_scalp_cost.js 와 같은 규칙이다(scripts/check-scalp-fee.cjs 가 같은 입력에 같은 값인지 본다).

왕복 비용(%) = 수수료(공통 율 × 2) + 수수료 아닌 몫(세금 · 미끄러짐).
공통 율은 설정 › 💸 수수료(users/{uid}.commonFee · 편도 · 기본 0.25%) — 밤 스크립트는 /api/common-fee 에서 받는다.
예전 상수의 수수료 몫(왕복): 국내 주식 · ETF 0.015% × 2 = 0.03 · 코인(업비트) 0.05% × 2 = 0.10 · 미국 0.10% × 2 = 0.20.

율을 정하는 순서:
  1) 환경변수 JKQ_COMMON_FEE (비율, 예 0.0025) — 시험 · 손 재현용
  2) 감시키(JKQ_FEE_KEY · KEY · JKQ_MONITOR_KEY · MONITOR_KEY · AUTOTRADE_KEY 중 있는 것)가 있으면 {JKQ_BASE_URL 또는 https://jkquant.pages.dev}/api/common-fee
  3) 둘 다 없거나 실패하면 기본 0.25% (source 'default')
한 번 정하면 그 실행 동안 같은 값을 쓴다. 쓴 율 · 출처는 fee_info() 로 결과 파일에 남긴다.
"""
from __future__ import annotations

import json
import os
import urllib.request

FEE_DEFAULT = 0.0025
FEE_MAX = 0.02
COST_MODEL = "common-fee-v1"
NON_FEE_PCT = {"kr": 0.20, "krDay": 0.22, "etf": 0.0, "etfFlat": 0.10, "etfFair": 0.12, "coin": 0.04, "us": 0.0}

_STATE: dict | None = None


def fee_valid(r):
    """0 이상 2% 이하 비율만 — 그 밖은 None"""
    if r is None or r == "" or isinstance(r, bool):
        return None
    try:
        x = float(r)
    except (TypeError, ValueError):
        return None
    if x != x or x < 0 or x > FEE_MAX:
        return None
    return x


def _r6(x: float) -> float:
    return round(x * 1e6) / 1e6


def _fetch(base: str, key: str, timeout: float = 10.0):
    req = urllib.request.Request(base.rstrip("/") + "/api/common-fee",
                                 headers={"x-monitor-key": key, "accept": "application/json", "user-agent": "jkquant-research"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _resolve():
    env = fee_valid(os.environ.get("JKQ_COMMON_FEE"))
    if env is not None:
        return {"rate": env, "source": "env"}
    key = next((v.strip() for v in (os.environ.get(n) for n in ("JKQ_FEE_KEY", "KEY", "JKQ_MONITOR_KEY", "MONITOR_KEY", "AUTOTRADE_KEY")) if v and v.strip()), "")
    if not key:
        return {"rate": FEE_DEFAULT, "source": "default", "note": "감시키 없음 — 기본값"}
    base = os.environ.get("JKQ_BASE_URL") or "https://jkquant.pages.dev"
    try:
        j = _fetch(base, key)
        x = fee_valid(j.get("rate")) if j.get("ok") else None
        if x is None:
            return {"rate": FEE_DEFAULT, "source": "default", "error": str(j.get("error") or "응답에 율 없음")}
        return {"rate": x, "source": str(j.get("source") or "user")}
    except Exception as e:  # 네트워크 · 인증 실패 — 연구는 기본값으로 계속한다(출처를 남긴다)
        return {"rate": FEE_DEFAULT, "source": "default", "error": str(e)[:200]}


def fee_info() -> dict:
    """이번 실행이 쓰는 율 · 출처 — 결과 파일에 그대로 남긴다"""
    global _STATE
    if _STATE is None:
        _STATE = _resolve()
    s = dict(_STATE)
    s.update(costModel=COST_MODEL, feeRatePct=_r6(s["rate"] * 100), feeRoundTripPct=fee_rt_pct(s["rate"]))
    return s


def set_fee(rate, source="set"):
    """시험 · 재현용 — 이번 실행의 율을 정한다(범위 밖이면 기본값)"""
    global _STATE
    x = fee_valid(rate)
    _STATE = {"rate": FEE_DEFAULT if x is None else x, "source": "default" if x is None else source}
    return _STATE["rate"]


def fee_rate() -> float:
    return fee_info()["rate"]


def _rate_or_default(rate) -> float:
    x = fee_valid(fee_rate() if rate is None else rate)
    return FEE_DEFAULT if x is None else x


def fee_pct(rate=None) -> float:
    """편도 수수료 %"""
    return _r6(_rate_or_default(rate) * 100)


def fee_rt_pct(rate=None) -> float:
    """수수료 왕복 % = 편도 율 × 2 × 100"""
    return _r6(2 * _rate_or_default(rate) * 100)


def cost_pct(kind: str, rate=None) -> float:
    """종류별 왕복 비용 % (틱 미끄러짐 뺀 몫)"""
    if kind not in NON_FEE_PCT:
        raise KeyError("단타 비용 종류를 모릅니다: " + kind)
    return _r6(NON_FEE_PCT[kind] + fee_rt_pct(rate))


def cost_snapshot(kind: str, rate=None) -> dict:
    info = fee_info() if rate is None else {"rate": rate, "source": "set"}
    return {"costModel": COST_MODEL, "feeRatePct": fee_pct(info["rate"]), "feeSource": info["source"],
            "feeRoundTripPct": fee_rt_pct(info["rate"]), "nonFeePct": NON_FEE_PCT[kind], "costPct": cost_pct(kind, info["rate"])}
