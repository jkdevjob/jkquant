"""비용·체결 모델. 모든 가정을 여기 한 곳에 둔다 (Phase 0 확정본)."""
from dataclasses import dataclass, field

# ── 증권거래세 (매도 시) ────────────────────────────────────────────────
# 2026-01-01 양도분부터 금투세 폐지 후속으로 2023년 수준 환원.
#   코스피 : 거래세 0.05% + 농어촌특별세 0.15% = 0.20%
#   코스닥 : 0.20%   |  코넥스 0.10%
# 과거 구간에도 2026년 세율을 일괄 적용한다(보수적 · 실전 조건과 일치).
TAX = {"KOSPI": 0.20, "KOSDAQ": 0.20, "KOSDAQ GLOBAL": 0.20, "KONEX": 0.10}

COMMISSION_ONEWAY = 0.015          # 편도 위탁수수료 % (무료 이벤트 가정 안 함)

# ── 호가단위 (2023-01 개편 기준, 코스피/코스닥 동일) ──────────────────
TICK_TABLE_KOSPI = [(2_000, 1), (5_000, 5), (20_000, 10), (50_000, 50),
                    (200_000, 100), (500_000, 500), (float("inf"), 1_000)]
TICK_TABLE_KOSDAQ = [(2_000, 1), (5_000, 5), (20_000, 10), (50_000, 50),
                     (float("inf"), 100)]

def tick_size(price: float, market: str) -> int:
    tbl = TICK_TABLE_KOSDAQ if "KOSDAQ" in market else TICK_TABLE_KOSPI
    for upper, t in tbl:
        if price < upper:
            return t
    return tbl[-1][1]

# ── 슬리피지 (틱 단위) ─────────────────────────────────────────────────
SLIPPAGE_TICKS = {"auction": 1.5, "market": 2.5}   # 시가 단일가 / 장중 시장가
SLIPPAGE_SCENARIOS = (1.0, 2.0, 3.0)               # 1x / 2x / 3x 전부 보고

@dataclass
class Costs:
    commission_oneway: float = COMMISSION_ONEWAY
    slippage_mult: float = 1.0
    def roundtrip_fixed_pct(self, market: str) -> float:
        """세금 + 수수료만. 슬리피지는 가격·틱에 의존하므로 별도."""
        return TAX.get(market, 0.20) + self.commission_oneway * 2

    def slippage_pct(self, price: float, market: str, kind: str) -> float:
        t = tick_size(price, market)
        return SLIPPAGE_TICKS[kind] * self.slippage_mult * t / price * 100

# 왕복 고정비용(세금+수수료) = 0.20 + 0.03 = 0.23%
# → 거래당 비용 차감 전 기대수익이 0.23% + 슬리피지를 넘지 못하면 시작부터 가망 없음.

@dataclass
class Universe:
    exclude_market: tuple = ("KONEX",)
    exclude_name_patterns: tuple = ("스팩", "리츠", "제[0-9]+호")
    exclude_preferred: bool = True          # 우선주 (이름 말미 우/우B/[0-9]우B)
    min_prev_turnover_krw: float = 5e8      # 전일 거래대금 하한 (파라미터)
    max_order_frac_of_auction: float = 0.01 # 주문금액 ≤ 시가 단일가 체결대금의 1%

@dataclass
class Portfolio:
    capital_krw: float = 20_000_000
    max_positions: int = 3                  # 2~4 파라미터
    weight_per_position: float = 1/3
    compounding: bool = False               # 통계 비교는 고정 2,000만 비복리
    mdd_limit_krw: float = 4_000_000        # 초과 시 부적합

@dataclass
class Regime:
    nxt_launch: str = "2025-03-04"          # 넥스트레이드 출범 — 전/후 반드시 분리 보고
