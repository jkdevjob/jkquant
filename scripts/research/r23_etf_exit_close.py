"""R23 ② 매도 시점 — 다음 날 시가 대신 다음 날 종가에 팔면 나아지나 (2026-11-02 밤 점검).

계기: 10/30 −8.07% 마감에 산 KODEX 코스닥150레버리지를 11/02 시가 4,680원(−2.2%)에 팔았는데 그날 종가는 4,990원(+4.3%)이었다.
급락 다음 날 시가가 한 번 더 빠졌다가 장중에 되돌아오는 일이 잦다면 종가까지 들고 가는 쪽이 낫다. 이 한 번을 근거로 삼지 않으려고
아래 기준을 먼저 적고 과거 전체를 잰다(10월 이후는 참고만 — 판정에 쓰지 않는다).

사전 등록(결과 보기 전):
- 지금 메인(−4.75% 이하 마감 → 종가 매수 → 다음 거래일 시가 매도)과 매도만 '다음 거래일 종가(종가 동시호가)'로 바꾼 것 하나만 비교한다.
  매수 · 신호 · 비용(0.03% + 2틱)은 실험실 etf_trades 와 같다. 종가 매도도 동시호가라 같은 비용으로 본다.
- 설계 2016~2022 · 검증 2023-01 ~ 2026-09(실험실 designEnd) · 2026-10 이후는 참고.
- 통과 = 검증 누적 ≥ 메인 · 검증 MDD ≥ −25% · 최악 매매 ≥ −15% · 설계 누적 ≥ 메인의 80% · 매매한 해의 60% 이상 플러스(전 구간).
- 통과해도 매도 시각이 바뀌는 주문 경로 변경이라 사용자에게 먼저 묻는다.

재현: python3 scripts/research/r23_etf_exit_close.py   (시세는 실험실과 같은 etf_bars — FinanceDataReader 일봉 · ETF 라 KRX 종가와 같다(R22))
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

CODE, TH = "233740", -4.75
main_tr, cal = L.etf_trades(CODE, TH)
b = L.etf_bars(CODE)
idx = {d: i for i, (d, _, _) in enumerate(b)}


def close_exit(t):
    """같은 매수 · 같은 비용, 매도만 다음 거래일 종가."""
    i = idx[t["buyDate"]]
    tick = 5 if b[i][2] >= 2000 else 1
    return dict(t, sellPrice=b[i + 1][2], pnl=(b[i + 1][2] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100))


alt_tr = [close_exit(t) for t in main_tr]
SEGS = [("설계 2016~2022", "2016-01-01", "2022-12-31"), ("검증 2023-01~2026-09", "2023-01-01", "2026-09-30"),
        ("참고 2026-10~", "2026-10-01", "2099-12-31"), ("전체", "2016-01-01", "2099-12-31")]


def seg(tr, a, z):
    xs = [t["pnl"] for t in tr if a <= t["sellDate"] <= z]
    eq, peak, mdd = 1.0, 1.0, 0.0
    for x in xs:
        eq *= 1 + x / 100
        peak = max(peak, eq)
        mdd = min(mdd, (eq / peak - 1) * 100)
    yrs = {}
    for t in tr:
        if a <= t["sellDate"] <= z:
            yrs.setdefault(t["sellDate"][:4], []).append(t["pnl"])
    ypos = sum(1 for v in yrs.values() if sum(v) > 0)
    return dict(n=len(xs), cum=round((eq - 1) * 100, 1), avg=round(statistics.fmean(xs), 2) if xs else None,
                win=round(sum(1 for x in xs if x > 0) / len(xs) * 100, 1) if xs else None, mdd=round(mdd, 1),
                worst=round(min(xs), 2) if xs else None, years=f"{ypos}/{len(yrs)}")


res = {}
for name, tr in (("메인 · 다음 시가", main_tr), ("다음 종가", alt_tr)):
    res[name] = {s: seg(tr, a, z) for s, a, z in SEGS}
    for s in res[name]:
        print(name, "|", s, res[name][s])
m, x = res["메인 · 다음 시가"], res["다음 종가"]
yp = lambda r: int(r["years"].split("/")[0]) / max(1, int(r["years"].split("/")[1]))
ok = (x["검증 2023-01~2026-09"]["cum"] >= m["검증 2023-01~2026-09"]["cum"] and x["검증 2023-01~2026-09"]["mdd"] >= -25
      and (x["검증 2023-01~2026-09"]["worst"] or 0) >= -15 and x["설계 2016~2022"]["cum"] >= 0.8 * m["설계 2016~2022"]["cum"]
      and yp(x["전체"]) >= 0.6)
print("판정:", "통과" if ok else "기각")
# 같은 매수 날 두 매도의 차이(다음 날 시가 → 종가 구간) — 어떤 날 차이가 나나
d = [(t["buyDate"], a["pnl"] - t["pnl"]) for t, a in zip(main_tr, alt_tr)]
dv = [v for _, v in d]
print(f"시가→종가 구간(같은 매수 · 매도만 다름) {len(dv)}건: 평균 {statistics.fmean(dv):+.2f}%p · 플러스 {sum(1 for v in dv if v > 0)} · "
      f"중앙값 {statistics.median(dv):+.2f}%p · 최악 {min(dv):+.2f}%p · 최고 {max(dv):+.2f}%p")
for s, a, z in SEGS[:3]:
    vv = [v for (bd, v), t in zip(d, main_tr) if a <= t["sellDate"] <= z]
    if vv:
        print(f"  {s}: {len(vv)}건 평균 {statistics.fmean(vv):+.2f}%p · 플러스 {sum(1 for v in vv if v > 0)}")
print("참고(2026-10~):", [(t["buyDate"], round(t["pnl"], 2), round(a["pnl"], 2)) for t, a in zip(main_tr, alt_tr) if t["sellDate"] >= "2026-10-01"])
