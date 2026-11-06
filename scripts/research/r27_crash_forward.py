"""R27 급락장에서 ② 를 쉬었다면 — R17-A(20일 고점 대비 −25% 이하면 쉼)를 10/1 이후 실측 매매에 다시 대 본다 (2026-11-06).

계기: 코스닥150레버리지가 20일 고점 대비 −48% 까지 빠지는 동안 ② 가 거의 매일 샀고, 11/05 매수분이 11/06 시가 −12.5% 갭으로 −12.8% 가 됐다.
R17(10/28)은 같은 거름을 과거 검증(2023-01~2026-09)에서 기각했다(누적 +126% → +33%). 판정은 바꾸지 않고, 앞으로의 실측과 계속 대조한다.

방법: 실험실 etf_trades(233740, −4.75%)의 10/1 이후 매매(매수일 기준)마다, 매수일 종가가 그날까지 20거래일 최고 종가 × 0.75 이하인지 본다.
마지막 매매(오늘 아침 매도)가 실험실 일봉에 아직 없으면 인자로 준 매도 시가로 더한다.

재현: python3 scripts/research/r27_crash_forward.py [마지막 매수일 매도시가 ...]   예) 2026-11-05 3600
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

b = L.etf_bars("233740")
idx = {d: i for i, (d, _, _) in enumerate(b)}
tr, _ = L.etf_trades("233740", -4.75)
rows = [(t["buyDate"], t["pnl"]) for t in tr if t["buyDate"] >= "2026-10-01"]
extra = sys.argv[1:]
for k in range(0, len(extra) - 1, 2):                              # 실험실 일봉에 아직 없는 매도(오늘 시가) — 같은 비용식
    bd, sp = extra[k], float(extra[k + 1])
    if bd not in {r[0] for r in rows}:
        c = b[idx[bd]][2]
        rows.append((bd, (sp / c - 1) * 100 - (0.03 + 2 * (5 if c >= 2000 else 1) / c * 100)))
keep, skip = [], []
for bd, p in rows:
    i = idx[bd]
    hi = max(x[2] for x in b[max(0, i - 19):i + 1])
    dd = (b[i][2] / hi - 1) * 100
    (skip if dd <= -25 else keep).append((bd, round(p, 2), round(dd, 1)))
cum = lambda xs: (math.prod(1 + p / 100 for _, p, _ in xs) - 1) * 100
print("쉬었을 매매", skip)
print("남는 매매", keep)
print(f"전체 {len(rows)}매매 {cum(keep + skip):+.2f}% · 거름 뒤 {cum(keep):+.2f}% · 쉰 매매 {cum(skip):+.2f}%")
