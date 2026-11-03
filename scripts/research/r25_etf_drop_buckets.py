"""R25 ② 하락 폭별 다음 날 시가 성적 — 아주 크게 빠진 날(−8% 이하)도 반등하나 (2026-11-04 아침 점검).

계기: 10/30 −8.07% · 11/03 −9.62% 처럼 아주 큰 하락이 이어진다. ② 는 −4.75% 이하면 하락 폭과 상관없이 같은 금액을 산다.
R17(급락장 거름)은 기각됐지만 '그날 하락 폭' 자체로 나눠 본 적은 없다.

사전 등록(결과 보기 전):
- 실험실 etf_trades(233740, −4.75%) 매매를 그날 하락 폭으로 셋으로 나눈다: A (−6, −4.75] · B (−8, −6] · C ≤ −8.
- 구간마다 설계(2016~2022) · 검증(2023-01~2026-09) 각각 건수 · 평균 · 중앙값 · 승률 · 최악을 적는다.
- 판정: C 가 설계 · 검증 둘 다 평균 < 0 이면 'C 거르기'를 그림자 후보로 적는다(새 변수라 주문 경로는 사용자에게 먼저 묻는다).
  하나라도 평균 ≥ 0 이면 '하락 폭으로 거르지 않는다'.
- 10월 이후 매매는 참고만.

재현: python3 scripts/research/r25_etf_drop_buckets.py   (실험실과 같은 etf_bars · etf_trades)
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

tr, _ = L.etf_trades("233740", -4.75)
B = [("A (−6, −4.75]", lambda d: -6 < d <= -4.75), ("B (−8, −6]", lambda d: -8 < d <= -6), ("C ≤ −8", lambda d: d <= -8)]
P = [("설계 2016~2022", "2016-01-01", "2022-12-31"), ("검증 2023-01~2026-09", "2023-01-01", "2026-09-30"), ("참고 2026-10~", "2026-10-01", "2099-12-31")]
verdict = {}
for bn, bf in B:
    for pn, a, z in P:
        xs = [t["pnl"] for t in tr if bf(t["dropPct"]) and a <= t["sellDate"] <= z]
        if not xs:
            print(bn, "|", pn, "없음")
            continue
        m = statistics.fmean(xs)
        verdict.setdefault(bn, {})[pn] = m
        print(f"{bn} | {pn}: {len(xs)}건 · 평균 {m:+.2f}% · 중앙값 {statistics.median(xs):+.2f}% · 승률 {sum(1 for x in xs if x > 0) / len(xs) * 100:.0f}% · "
              f"최악 {min(xs):+.2f}% · 최고 {max(xs):+.2f}%")
c = verdict.get("C ≤ −8", {})
bad = c.get("설계 2016~2022", 0) < 0 and c.get("검증 2023-01~2026-09", 0) < 0
print("판정:", "C 거르기 — 그림자 후보" if bad else "하락 폭으로 거르지 않는다")
print("참고(2026-10~):", [(t["buyDate"], round(t["dropPct"], 2), round(t["pnl"], 2)) for t in tr if t["sellDate"] >= "2026-10-01"])
