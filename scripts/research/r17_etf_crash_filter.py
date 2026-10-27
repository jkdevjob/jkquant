"""R17 ② 데이트레이딩 급락장 거르기 — 사전 등록 후 시간순 검증 (2026-10-28 아침).

계기: R16 — 10월 ② 실측 7매매 −18.54% 가 설계 표본의 연속 7매매 최악(−15.32%)보다 나빴다(급락장).

사전 등록(결과 보기 전 · 변수 하나씩 · 튜닝 없음):
- 기준(지금 메인): KODEX 코스닥150레버리지(233740)가 전일 대비 −4.75% 이하로 마감한 날 종가 매수 → 다음 거래일 시가 매도.
  비용 0.03% + 2틱(claude_lab.etf_trades 와 같은 식).
- F-A 급락 깊이: 오늘 종가가 최근 20거래일(오늘 포함) 최고 종가보다 25% 이상 낮으면 사지 않는다.
- F-B 변동성: 최근 20거래일 일간 등락률 표준편차가 4.0%p 이상이면 사지 않는다.
- 기간: 설계 2016~2022 · 검증 2023-01-01~2026-09-30. 2026-10 은 계기가 된 구간이라 참고만(판정에 안 씀).
- 통과(넷 다): 검증 누적 ≥ 기준 · 검증 MDD ≥ −25% · 검증 최악 매매 ≥ −15% · 설계 누적 ≥ 기준의 80%.
  룩어헤드 없음 — 거르는 값은 매수하는 날 종가까지로만 계산한다(그 종가에 산다).

재현: python3 scripts/research/r17_etf_crash_filter.py
"""
import math
import statistics

import FinanceDataReader as fdr

d = fdr.DataReader("233740", "2016-01-01")
b = [(str(i)[:10], float(r["Open"]), float(r["Close"])) for i, r in d.iterrows() if float(r["Open"]) > 0 and float(r["Close"]) > 0]
chg = [None] + [(b[i][2] / b[i - 1][2] - 1) * 100 for i in range(1, len(b))]


def trades(rule):
    out = []
    for i in range(21, len(b) - 1):
        c = chg[i]
        if abs(c) > 35 or c > -4.75:
            continue
        dd = b[i][2] / max(x[2] for x in b[i - 19:i + 1]) - 1
        vol = statistics.pstdev(chg[i - 19:i + 1])
        if rule == "A" and dd <= -0.25:
            continue
        if rule == "B" and vol >= 4.0:
            continue
        tick = 5 if b[i][2] >= 2000 else 1
        out.append((b[i][0], (b[i + 1][1] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100)))
    return out


def stats(tr):
    eq, peak, mdd = 1.0, 1.0, 0.0
    for _, x in tr:
        eq *= 1 + x / 100
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    xs = [x for _, x in tr]
    t = statistics.mean(xs) / (statistics.stdev(xs) / math.sqrt(len(xs))) if len(xs) > 2 else float("nan")
    return dict(n=len(tr), cum=(eq - 1) * 100, mdd=mdd * 100, worst=min(xs) if xs else 0.0, mean=statistics.mean(xs) if xs else 0.0, t=t)


periods = {"설계 2016~2022": ("2016-01-01", "2022-12-31"), "검증 2023~2026-09": ("2023-01-01", "2026-09-30"), "참고 2026-10~": ("2026-10-01", "2099-12-31")}
res = {}
for rule in ("base", "A", "B"):
    tr = trades(rule)
    for name, (a, z) in periods.items():
        s = stats([t for t in tr if a <= t[0] <= z])
        res[(rule, name)] = s
        print(f"{rule:4} {name:14} n {s['n']:3} · 누적 {s['cum']:7.2f}% · MDD {s['mdd']:7.2f}% · 최악 {s['worst']:6.2f}% · 평균 {s['mean']:5.2f}% · t {s['t']:5.2f}")
for rule in ("A", "B"):
    v, bv = res[(rule, "검증 2023~2026-09")], res[("base", "검증 2023~2026-09")]
    dz, bdz = res[(rule, "설계 2016~2022")], res[("base", "설계 2016~2022")]
    ok = [v["cum"] >= bv["cum"], v["mdd"] >= -25, v["worst"] >= -15, dz["cum"] >= 0.8 * bdz["cum"]]
    print(rule, "통과" if all(ok) else "탈락", ok)
