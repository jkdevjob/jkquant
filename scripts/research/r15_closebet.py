"""R15 (2026-10-22 사전 등록) — 개별 종목 종가 베팅: 그날 종가(종가 동시호가)에 사서 다음 거래일 시가(장전 동시호가)에 판다.

계기: 사용자 "개별 종목 '종가 베팅'(종가 매수 → 다음 날 시가 매도)을 이것도 추가해"(10/22).
주 가설 H1(강세 마감 이어가기): 그날 강하게 오르고 고가 근처에서 끝난 종목은 밤사이 매수세가 이어져 다음 날 시가가 종가보다 높다.
  조건(그날 d 의 마감 값 — 종가 동시호가 직전(15:20)에 거의 알 수 있는 값): 보통주(우선주 · 스팩 · 리츠 제외 · ETF 없음) ·
  관리/투자주의환기/정리매매 아님 · 최근 20거래일 거래정지 없음 · 최근 10거래일 ±30.5% 넘는 날 없음(가격제한 밖 = 분할 · 신규상장) ·
  종가 ≥ 1,000원 · 거래대금 ≥ 50억 · 등락률 +5% ~ +20% · 종가 위치 IBS = (종가 − 저가) / (고가 − 저가) ≥ 0.8
  → 거래대금 큰 순 3종목, 균등.
보조 H2(투매 되돌림): 같은 필터 · 등락률 −20% ~ −8% · IBS ≤ 0.2 → 거래대금 큰 순 3종목.
대조군: 같은 날 같은 필터를 통과한 종목 전체의 밤사이 평균(시장 전체 밤사이 흐름) — 선별 실력 = 신호 − 대조군.
비용: ① 과 같은 식(cost_pct) — 0.23%(거래세 · 수수료) + 1.5틱 × 2(동시호가 두 번).
  종가에 산다는 가정은 15:20 예상 종가와 실제 종가의 차이를 무시한다(종가 동시호가 시장가는 종가에 체결 — 이 차이는 체결 가격이 아니라 '고르는 값'의 차이).
판정(결과 보기 전 고정 · 변수는 위 값 하나로만):
  설계 2018-01-02 ~ 2022-12-31 / 검증 2023-01-02 ~ 마지막 확정일.
  (a) 검증 구간 매매일 평균 순수익 > 0 이고 t ≥ 2
  (b) 검증 구간 해마다(2023 · 2024 · 2025 · 2026) 3개 이상 양수
  (c) 전체 MDD ≥ −25% · 최악일 ≥ −15% (매매일 자금 전액 · 종목 균등)
  (d) 검증 구간 평균이 같은 날 대조군보다 높다
  모두 만족해야 통과. 통과해도 주문 경로(새 탭)는 사용자 승인 범위(10/22 '해') 안에서 실험으로 붙이고, 실패면 붙이지 않고 보고한다.
  변수를 바꿔 본 결과(등락률 범위 · IBS · 거래대금 · 종목 수)는 '그림자 후보'로만 적는다 — 판정에 쓰지 않는다.
자료: FinanceData marcap 연도 파일(확정 종가 · 시가 · 고가 · 저가 · 거래대금) — backtest_opening_gapdown.load_rows 그대로.
사용: JKQ_GAPDOWN_CACHE=<캐시> JKQ_GAPDOWN_FROM_YEAR=2018 python3 r15_closebet.py --app <저장소> --out r15.json
"""
import argparse
import json
import math
import os
import statistics
import sys
from pathlib import Path

H1 = dict(name="H1 강세 마감", chgMin=5.0, chgMax=20.0, ibsMin=0.8, ibsMax=1.01, minAmount=5e9, picks=3)
H2 = dict(name="H2 투매 되돌림", chgMin=-20.0, chgMax=-8.0, ibsMin=-0.01, ibsMax=0.2, minAmount=5e9, picks=3)
DESIGN_END = "2022-12-31"
TEST_START = "2023-01-02"
SLIP_TICKS = 1.5
GRID = [  # 그림자 후보(판정에 쓰지 않음)
    dict(chgMin=3.0, chgMax=20.0, ibsMin=0.8), dict(chgMin=5.0, chgMax=15.0, ibsMin=0.8), dict(chgMin=10.0, chgMax=25.0, ibsMin=0.8),
    dict(chgMin=5.0, chgMax=20.0, ibsMin=0.9), dict(chgMin=5.0, chgMax=20.0, ibsMin=0.6), dict(chgMin=5.0, chgMax=20.0, ibsMin=0.8, minAmount=2e9),
    dict(chgMin=5.0, chgMax=20.0, ibsMin=0.8, minAmount=2e10), dict(chgMin=5.0, chgMax=20.0, ibsMin=0.8, picks=1), dict(chgMin=5.0, chgMax=20.0, ibsMin=0.8, picks=5),
    dict(chgMin=0.0, chgMax=5.0, ibsMin=0.9),
]


def candidates(by, g):
    """date -> [dict(code, name, chg, ibs, amount, close, nextOpen, gross, nextDate)] — 같은 필터를 통과한 모든 종목(대조군 모집단)."""
    out = {}
    for code, rows in by.items():
        if len(rows) < 3:
            continue
        name = rows[-1][8]
        if not g.is_common(code, name):
            continue
        ret = [0.0]
        for i in range(1, len(rows)):
            c, chg = rows[i][4], rows[i][5]
            base = c - chg
            ret.append(chg / base if base > 0 else 0.0)
        for i in range(1, len(rows) - 1):
            dt, o, h, l, c, chg, amt, vol, nm, mk, dept = rows[i]
            nx = rows[i + 1]
            if g.risky_dept(dept) or vol <= 0 or c < 1000 or amt <= 0:
                continue
            if any(rows[j][7] <= 0 for j in range(max(0, i - 19), i + 1)):
                continue
            if any(abs(ret[j]) > 0.305 for j in range(max(1, i - 9), i + 1)):
                continue
            if nx[1] <= 0 or nx[7] <= 0:                 # 다음 날 시가 없음(거래정지) — 팔 수 없었다
                continue
            base = c - chg
            if base <= 0 or h <= 0 or l <= 0:
                continue
            ibs = (c - l) / (h - l) if h > l else 0.5
            nchg = nx[5]
            nbase = nx[4] - nchg                        # 다음 날 기준가(권리락 등 조정 반영)
            adj = nbase / c if nbase > 0 else 1.0       # 종가 → 다음 날 기준가 비율(배당락 · 분할 보정)
            if abs(adj - 1) > 0.05:                     # 분할 · 큰 권리락은 뺀다(밤사이 가격 비교가 안 됨)
                continue
            gross = (nx[1] / (c * adj) - 1) * 100
            out.setdefault(dt, []).append(dict(code=code, name=nm, market=mk, chg=(chg / base) * 100, ibs=ibs, amount=amt, close=c,
                                               nextOpen=nx[1], nextDate=nx[0], gross=gross, net=gross - g.cost_pct(c, SLIP_TICKS)))
    return out


def picks_of(day, p):
    s = [x for x in day if p["chgMin"] <= x["chg"] <= p["chgMax"] and p["ibsMin"] <= x["ibs"] <= p["ibsMax"] and x["amount"] >= p["minAmount"]]
    s.sort(key=lambda x: -x["amount"])
    return s[:p["picks"]]


def run(cands, p):
    """일별 순수익(매매일만) · 거래 목록. 하루 결과 = 고른 종목 순수익 평균(자금 전액 균등)."""
    daily, trades = {}, []
    for d in sorted(cands):
        s = picks_of(cands[d], p)
        if s:
            daily[d] = statistics.fmean(x["net"] for x in s)
            trades += [dict(date=d, **{k: x[k] for k in ("code", "name", "chg", "ibs", "amount", "close", "nextOpen", "nextDate", "gross", "net")}) for x in s]
    return daily, trades


def summary(daily, lo="0000", hi="9999"):
    v = [daily[d] for d in sorted(daily) if lo <= d <= hi]
    if not v:
        return dict(days=0)
    eq, peak, mdd = 1.0, 1.0, 0.0
    for x in v:
        eq *= 1 + x / 100
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    sd = statistics.stdev(v) if len(v) > 1 else 0.0
    return dict(days=len(v), meanPct=statistics.fmean(v), t=(statistics.fmean(v) / (sd / math.sqrt(len(v))) if sd > 0 else None),
                winRate=sum(1 for x in v if x > 0) / len(v) * 100, totalPct=(eq - 1) * 100, mddPct=mdd * 100, worstPct=min(v), bestPct=max(v),
                plus1Days=sum(1 for x in v if x >= 1))


def years(daily):
    out = {}
    for d, x in daily.items():
        out.setdefault(d[:4], []).append(x)
    return {y: dict(days=len(v), meanPct=statistics.fmean(v), totalPct=(math.prod(1 + a / 100 for a in v) - 1) * 100) for y, v in sorted(out.items())}


def control(cands, daily):
    """같은 날 같은 필터 통과 종목 전체의 밤사이 순수익 평균(그 매매일만)."""
    return {d: statistics.fmean(x["net"] for x in cands[d]) for d in daily if cands.get(d)}


def verdict(daily, ctl):
    t = summary(daily, TEST_START)
    full = summary(daily)
    ys = {y: v for y, v in years({d: x for d, x in daily.items() if d >= TEST_START}).items()}
    ctl_t = summary(ctl, TEST_START)
    a = bool(t.get("days")) and t["meanPct"] > 0 and (t["t"] or 0) >= 2
    b = sum(1 for v in ys.values() if v["meanPct"] > 0) >= 3
    c = bool(full.get("days")) and full["mddPct"] >= -25 and full["worstPct"] >= -15
    d = bool(t.get("days")) and bool(ctl_t.get("days")) and t["meanPct"] > ctl_t["meanPct"]
    return dict(a_testMeanT=a, b_yearsPositive=b, c_risk=c, d_beatsControl=d, passed=a and b and c and d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", default=".")
    ap.add_argument("--out", default="r15.json")
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.app) / "scripts"))
    import backtest_opening_gapdown as g
    import pickle
    pk = Path(os.environ.get("JKQ_GAPDOWN_CACHE", ".")) / "by.pickle"
    if pk.exists():
        by, final_last = pickle.loads(pk.read_bytes())
    else:
        by, sources, final_last = g.load_rows()
        by = {k: [r for r in v if r[0] <= final_last] for k, v in by.items()}  # 확정일까지만(잠정 일별 파일 제외)
        pk.write_bytes(pickle.dumps((by, final_last)))
    cands = candidates(by, g)
    res = dict(registered="2026-10-22", finalLast=final_last, designEnd=DESIGN_END, testStart=TEST_START, slipTicks=SLIP_TICKS, hyp={})
    for H in (H1, H2):
        daily, trades = run(cands, H)
        ctl = control(cands, daily)
        res["hyp"][H["name"]] = dict(params=H, design=summary(daily, "0000", DESIGN_END), test=summary(daily, TEST_START), full=summary(daily),
                                     years=years(daily), control=dict(design=summary(ctl, "0000", DESIGN_END), test=summary(ctl, TEST_START)),
                                     verdict=verdict(daily, ctl), trades=len(trades),
                                     grossMean=statistics.fmean(x["gross"] for x in trades) if trades else None,
                                     costMean=statistics.fmean(x["gross"] - x["net"] for x in trades) if trades else None)
    shadows = []
    for gp in GRID:
        p = dict(H1, **gp)
        daily, trades = run(cands, p)
        shadows.append(dict(params=gp, design=summary(daily, "0000", DESIGN_END), test=summary(daily, TEST_START), full=summary(daily)))
    res["shadows"] = shadows
    allnet = {d: statistics.fmean(x["net"] for x in v) for d, v in cands.items() if v}
    res["marketOvernight"] = dict(design=summary(allnet, "0000", DESIGN_END), test=summary(allnet, TEST_START))
    Path(args.out).write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: (v if k != "shadows" else len(v)) for k, v in res.items() if k != "hyp"}, ensure_ascii=False, default=str)[:600])
    for k, v in res["hyp"].items():
        print(k, json.dumps(dict(design=v["design"], test=v["test"], full=v["full"], verdict=v["verdict"], grossMean=v["grossMean"], costMean=v["costMean"],
                                 controlTest=v["control"]["test"]), ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
