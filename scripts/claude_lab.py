#!/usr/bin/env python3
"""단타(클로드) — 탭별 클로드 전략 vs GPT 기준전략 비교 (연구 전용, 주문 없음).

탭 = GPT 단타 화면과 같은 4개. 탭마다 클로드 전략 하나:
  opening    ① D-1 v2 갭하락 과매도 (시장 투매일)         — opening_gapdown_v1 결과 사용
  daytrading ② 코스닥150 레버리지 하락일 야간             — etf_dip_overnight_v1 결과 사용
  crypto     ③ BTC 20일 추세 + 하루 손절 −4% · 투입 50%  — btc_trend20_v1 (이 파일)
  soxl       ④ SOXX 50일 추세 SOXL + 손절 −8% · 투입 25% — soxl_trend50_v1 (이 파일)

목표 지표(사용자 기준 2026-10-01): +1% 달성일/년 · +5% 달성주/년 · 주평균 · 손실일 평균/최악 · MDD.
순수익, 매매 없는 날 0%. 거르기: 기대값>0 · MDD≥-25% · 최악일≥-15%.
GPT 비교는 GPT 기준전략 기록이 있는 기간과 같은 날짜로만 한다(기간이 다르면 비교가 안 된다).
GPT 파일은 읽기만 한다.
"""
from __future__ import annotations

import csv
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
DATA = Path(os.environ.get("JKQ_DATA", "data"))
OUT = DATA / "claude-lab"
DESIGN_END = "2026-09-30"
GATE = dict(mdd=-25.0, worstDay=-15.0)

BTC = dict(version="btc_trend20_v1", ma=20, stopPct=4.0, size=0.5, costRoundTripPct=0.14, stopSlipPct=0.1,
           note="업비트 KRW-BTC 일봉(09시 기준). 전일 종가 > 20일 평균이면 그날 보유, 09시 시가 대비 −4% 닿으면 손절 후 그날 쉼. 자금 50%.")
SOXL = dict(version="soxl_trend50_v1", ma=50, stopPct=8.0, size=0.25, costRoundTripPct=0.20, stopSlipPct=0.2,
            note="SOXX 종가 > 50일 평균이면 SOXL 보유(종가 기준), 전일 종가(진입일은 시가) 대비 −8% 닿으면 손절. 자금 25%.")
GPT_FILES = {
    "opening": ("opening-history/baseline-trades.csv", "pnl"),
    "daytrading": ("daytrading-research/baseline-trades.csv", "pnl"),
    "crypto": ("crypto-research/baseline-trades.csv", "pnlPct"),
    "soxl": ("soxl-research/baseline-trades.csv", "pnl"),
}


def goal_metrics(daily, calendar, per_year=250):
    """목표 지표 — 모든 클로드 전략이 이 함수 하나로 센다. daily: {날짜: 그날 순손익 %}, calendar: 전체 거래일."""
    cal = sorted(set(calendar))
    if not cal:
        return {}
    yrs = len(cal) / per_year
    traded = [d for d in cal if d in daily]
    vals = [daily[d] for d in traded]
    eq = pk = 1.0
    mdd = 0.0
    wk = {}
    for d in cal:
        x = daily.get(d, 0.0)
        eq *= 1 + x / 100
        pk = max(pk, eq)
        mdd = min(mdd, eq / pk - 1)
        k = date.fromisoformat(d).isocalendar()[:2]
        wk[k] = wk.get(k, 1.0) * (1 + x / 100)
    loss = [v for v in vals if v < 0]
    sd = statistics.stdev(vals) if len(vals) > 2 else 0
    out = dict(days=len(cal), tradeDays=len(traded), tradeDaysPerYear=len(traded) / yrs,
               plus1RateOfTradeDays=(sum(1 for v in vals if v >= 1) / len(vals) * 100) if vals else None,
               lossDaysPerYear=sum(1 for v in vals if v < 0) / yrs,
               tStat=(statistics.fmean(vals) / (sd / math.sqrt(len(vals)))) if sd > 0 else None,
               plus1Days=sum(1 for v in vals if v >= 1), plus1DaysPerYear=sum(1 for v in vals if v >= 1) / yrs,
               plus5Weeks=sum(1 for v in wk.values() if v >= 1.05), plus5WeeksPerYear=sum(1 for v in wk.values() if v >= 1.05) / yrs,
               weeklyAvgPct=(eq ** (1 / len(wk)) - 1) * 100 if wk else None, totalPct=(eq - 1) * 100,
               lossDays=len(loss), lossDayAvgPct=statistics.fmean(loss) if loss else 0.0,
               worstDayPct=min(vals) if vals else 0.0, mddPct=mdd * 100,
               cagrPct=(eq ** (1 / yrs) - 1) * 100 if yrs >= 0.5 else None,
               expectancyPct=statistics.fmean(vals) if vals else None)
    out["gate"] = bool(vals) and out["expectancyPct"] > 0 and out["mddPct"] >= GATE["mdd"] and out["worstDayPct"] >= GATE["worstDay"]
    return out


def read_csv(path):
    try:
        with path.open(encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except FileNotFoundError:
        return []


# ── ③ BTC ──
def fetch_btc_daily():
    out, to = [], None
    for _ in range(25):
        u = "https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=200" + ("&to=" + urllib.parse.quote(to) if to else "")
        with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json"}), timeout=30) as r:
            j = json.load(r)
        if not j:
            break
        out += j
        to = j[-1]["candle_date_time_utc"] + "Z"
        time.sleep(0.25)
    rows = sorted({x["candle_date_time_kst"][:10]: (x["opening_price"], x["high_price"], x["low_price"], x["trade_price"]) for x in out}.items())
    today = datetime.now(KST).strftime("%Y-%m-%d")
    return [(d, *v) for d, v in rows if d < today]          # 진행 중인 오늘 봉은 쓰지 않는다


def trend_daily(rows, p, signal_close=None):
    """rows: (date, open, high, low, close). 진입 판단은 전일까지 확정된 값만 쓴다.
    signal_close: 추세 판단용 종가 열(없으면 자기 종가)."""
    D = [r[0] for r in rows]
    O, H, L, C = ([r[k] for r in rows] for k in (1, 2, 3, 4))
    S = signal_close or C
    n, half = p["ma"], p["costRoundTripPct"] / 2
    dv, decisions, prev = {}, [], 0
    for i in range(n + 1, len(rows)):
        ma = sum(S[i - n:i]) / n                      # 전일까지 n일 평균
        hold = 1 if S[i - 1] > ma else 0
        rec = dict(date=D[i], strategyVersion=p["version"], signalClose=S[i - 1], ma=ma, hold=hold, action="", pnlPct=None)
        if not hold:
            if prev:
                dv[D[i]] = -half * p["size"]
                rec.update(action="exit_trend", pnlPct=dv[D[i]])
            else:
                rec["action"] = "flat"
            prev = 0
            decisions.append(rec)
            continue
        ref = C[i - 1] if prev else O[i]
        cost = 0.0 if prev else half
        if (L[i] / ref - 1) * 100 <= -p["stopPct"]:
            r = -p["stopPct"] - p["stopSlipPct"] - cost - half
            dv[D[i]] = r * p["size"]
            rec.update(action="stop", pnlPct=dv[D[i]])
            prev = 0
        else:
            dv[D[i]] = ((C[i] / ref - 1) * 100 - cost) * p["size"]
            rec.update(action="hold" if prev else "enter", pnlPct=dv[D[i]])
            prev = 1
        decisions.append(rec)
    nxt = None
    if len(rows) > n:
        ma = sum(S[-n:]) / n
        nxt = dict(basedOn=D[-1], signalClose=S[-1], ma=ma, holdNext=S[-1] > ma)
    return dv, decisions, nxt


def fetch_us(ticker):
    import FinanceDataReader as fdr
    d = fdr.DataReader(ticker, "2010-01-01")
    return {str(i)[:10]: (float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])) for i, r in d.iterrows() if float(r["Open"]) > 0}


def d1_daily():
    q = {r["date"]: int(r.get("rsiPassed") or 0) for r in read_csv(DATA / "opening-gapdown-research/decisions.csv")}
    by = {}
    for r in read_csv(DATA / "opening-gapdown-research/signals.csv"):
        by.setdefault(r["date"], []).append(float(r["pnl"]))
    return {d: statistics.fmean(v) for d, v in by.items() if q.get(d, 0) >= 5}, sorted(q)


def etf_daily():
    return {r["exitDate"]: float(r["pnl"]) for r in read_csv(DATA / "etf-overnight-research/signals.csv")}


def gpt_daily(tab):
    path, col = GPT_FILES[tab]
    rows = read_csv(DATA / path)
    by, ver = {}, set()
    for r in rows:
        try:
            by.setdefault(r["date"], []).append(float(r[col]))
            ver.add(r.get("strategyVersion") or "")
        except (KeyError, ValueError):
            continue
    return {d: statistics.fmean(v) for d, v in by.items()}, sorted(v for v in ver if v), len(rows)


def tab_report(tab, name, version, rule, mine, cal, per_year, extra=None):
    g, gver, gtrades = gpt_daily(tab)
    start = min(g) if g else None
    window = [d for d in cal if start and d >= start]
    rep = dict(
        claude=dict(name=name, strategyVersion=version, rule=rule,
                    design=goal_metrics({d: v for d, v in mine.items() if d <= DESIGN_END}, [d for d in cal if d <= DESIGN_END], per_year),
                    outOfSample=goal_metrics({d: v for d, v in mine.items() if d > DESIGN_END}, [d for d in cal if d > DESIGN_END], per_year),
                    recent=[dict(date=d, pnlPct=mine[d]) for d in sorted(mine)[-15:]]),
        gpt=dict(strategyVersions=gver, trades=gtrades, from_=start, to=max(g) if g else None),
        compare=dict(window=[window[0], window[-1]] if window else None, note="GPT 기준전략 기록이 있는 날짜 구간에서 같은 달력으로 계산",
                     claude=goal_metrics({d: v for d, v in mine.items() if d in set(window)}, window, per_year) if window else None,
                     gpt=goal_metrics({d: v for d, v in g.items() if d in set(window)}, window, per_year) if window else None),
    )
    if extra:
        rep.update(extra)
    return rep


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = dict(schema=1, generatedAt=datetime.now(KST).isoformat(), designEnd=DESIGN_END, gate=GATE, tabs={},
                  note="모든 수익률은 각 전략 자체 기록의 순수익(수수료·슬리피지 포함). 매매 없는 날 0%. 클로드 ③④ 는 주문 없는 연구 그림자.")
    d1, krx_cal = d1_daily()
    report["tabs"]["opening"] = tab_report("opening", "① D-1 갭하락 과매도 v2", "opening_gapdown_v1 (v2 필터)",
                                           "전일 RSI<30 + 시가 갭 −2~−29% 종목이 5개 이상인 날, 가장 깊은 3종목 시가 매수 → 종가 매도", d1, krx_cal, 250)
    report["tabs"]["daytrading"] = tab_report("daytrading", "② 코스닥150 레버리지 하락일 야간", "etf_dip_overnight_v1",
                                              "KODEX 코스닥150레버리지가 −3% 이하로 마감한 날 종가 매수 → 다음 날 시가 매도 (거래세 없음)", etf_daily(), krx_cal, 250)
    try:
        btc = fetch_btc_daily()
        dv, dec, nxt = trend_daily(btc, BTC)
        report["tabs"]["crypto"] = tab_report("crypto", "③ BTC 20일 추세 + 손절", BTC["version"], BTC["note"], dv, [r[0] for r in btc], 365,
                                              extra=dict(nextSignal=nxt, params=BTC))
        write_csv(OUT / "btc-decisions.csv", dec)
    except Exception as e:  # noqa: BLE001
        report["tabs"]["crypto"] = dict(error=str(e))
    try:
        sx, so = fetch_us("SOXL"), fetch_us("SOXX")
        days = sorted(d for d in sx if d in so)
        rows = [(d, *sx[d]) for d in days]
        dv, dec, nxt = trend_daily(rows, SOXL, signal_close=[so[d][3] for d in days])
        report["tabs"]["soxl"] = tab_report("soxl", "④ SOXX 50일 추세 SOXL + 손절", SOXL["version"], SOXL["note"], dv, days, 252,
                                            extra=dict(nextSignal=nxt, params=SOXL))
        write_csv(OUT / "soxl-decisions.csv", dec)
    except Exception as e:  # noqa: BLE001
        report["tabs"]["soxl"] = dict(error=str(e))
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({k: (v.get("compare") if isinstance(v, dict) else v) for k, v in report["tabs"].items()}, ensure_ascii=False, default=str)[:3000])
    return 0


def write_csv(path, rows):
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    raise SystemExit(main())
