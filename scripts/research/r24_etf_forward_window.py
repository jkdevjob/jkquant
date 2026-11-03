"""R24 ② 지금 규칙(−4.75%)의 10월 이후 실측이 설계 표본 안인가 — 실전 결정 전 점검 (2026-11-03 아침).

계기: 사용자가 실전 시작을 지시했다("해", 11/03). ② 는 시간순 검증(R18)에서 연 16% 로 근거가 있는 전략이지만,
지금 규칙으로 10/1 이후 8매매가 −9.1% 다(R23 참고값). 나쁜 운인지, 설계에 없던 일인지 먼저 잰다(R16 과 같은 방법).

사전 등록(결과 보기 전):
- 설계 표본 = 실험실 etf_trades(233740, −4.75%) 중 매도일 ≤ 2026-09-30(실험실 designEnd) 매매.
- 같은 길이(n = 10/1 이후 매매 수) 연속 구간의 복리 누적 분포에서 실측 누적의 위치(백분위)를 잰다.
- 실측이 하위 5% 보다 나쁘면 '설계와 다름 — 실전 보류 권고', 그 안이면 '설계 안의 나쁜 구간'.
- 같은 분포로 '앞으로 n매매 동안 −10% 이하일 확률'도 같이 적는다(실전 금액을 정할 때 쓰는 값).

재현: python3 scripts/research/r24_etf_forward_window.py   (실험실과 같은 etf_bars · etf_trades)
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

DESIGN_END, FWD_FROM = "2026-09-30", "2026-10-01"
tr, _ = L.etf_trades("233740", -4.75)
des = [t["pnl"] for t in tr if t["sellDate"] <= DESIGN_END]
fwd = [(t["buyDate"], t["sellDate"], t["pnl"]) for t in tr if t["sellDate"] >= FWD_FROM]
n = len(fwd)
fcum = (math.prod(1 + x / 100 for _, _, x in fwd) - 1) * 100
win = sorted((math.prod(1 + x / 100 for x in des[k:k + n]) - 1) * 100 for k in range(len(des) - n + 1))
pct = sum(1 for w in win if w <= fcum) / len(win) * 100
print(f"설계 매매 {len(des)}건 · 실측 {n}매매 누적 {fcum:+.2f}%")
print("실측:", [(b, s, round(x, 2)) for b, s, x in fwd])
print(f"{n}매매 구간 {len(win)}개: 하위 5% {win[int(0.05 * len(win))]:+.2f}% · 하위 10% {win[int(0.10 * len(win))]:+.2f}% · 중앙값 {win[len(win) // 2]:+.2f}% · "
      f"최악 {win[0]:+.2f}% · 실측 백분위 {pct:.1f}")
print(f"{n}매매 동안 −10% 이하 비율 {sum(1 for w in win if w <= -10) / len(win) * 100:.1f}% · 손실 비율 {sum(1 for w in win if w < 0) / len(win) * 100:.1f}%")
for yr in ("2023", "2024", "2025", "2026"):
    sub = [t["pnl"] for t in tr if t["sellDate"][:4] == yr and t["sellDate"] <= DESIGN_END]
    if sub:
        print(f"  {yr}: {len(sub)}매매 · 누적 {(math.prod(1 + x / 100 for x in sub) - 1) * 100:+.1f}%")
print("판정:", "설계와 다름 — 실전 보류 권고" if pct < 5 else "설계 안의 나쁜 구간")
