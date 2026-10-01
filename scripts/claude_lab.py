#!/usr/bin/env python3
"""단타(클로드) — 탭별 클로드 전략 vs GPT 기준전략 비교 (연구 전용, 주문 없음).

탭 = GPT 단타 화면과 같은 4개. 탭마다 클로드 전략 하나:
  opening    ① D-1 v2 갭하락 과매도 (시장 투매일)         — opening_gapdown_v1 결과 사용
  daytrading ② 코스닥150 레버리지 하락일 야간             — etf_dip_overnight_v1 결과 사용
  crypto     ③ BTC+ETH 20일 추세 + 하루 손절 −4% · 반반 · 투입 60% — crypto_trend20_v2 (이 파일)
             (v1 BTC 단독 50% 는 비교용으로 같이 계산한다)
전체 계좌안: 국내 ①+② 50% + 코인 50%(코인 칸은 BTC+ETH 반반 전액) — 같은 원금 기준 일 손익.
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
CRYPTO = dict(version="crypto_trend20_v2", markets=["KRW-BTC", "KRW-ETH"], ma=20, stopPct=4.0, size=1.0, tabSize=0.6,
              costRoundTripPct=0.14, stopSlipPct=0.1,
              note="업비트 BTC·ETH 일봉(09시 기준) 각각: 전일 종가 > 20일 평균이면 그날 보유, 09시 시가 대비 −4% 닿으면 손절 후 그날 쉼. 두 코인 반반, 자금 60%.")
ACCOUNT = dict(krWeight=0.5, cryptoWeight=0.5, cryptoSize=1.0,
               note="같은 원금: 국내 칸 50%(① D-1 v2 + ② ETF 야간, 같은 날이면 반반) + 코인 칸 50%(BTC+ETH 반반 추세, 칸 안에서 전액).")
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
def fetch_btc_daily(market="KRW-BTC"):
    out, to = [], None
    for _ in range(25):
        u = "https://api.upbit.com/v1/candles/days?market=" + market + "&count=200" + ("&to=" + urllib.parse.quote(to) if to else "")
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


def basket(per, cal):
    """코인마다 같은 몫(1/N). 그날 기록이 있는 코인만 평균하지 않고 고정 몫으로 더한다(쉬는 코인 몫은 현금)."""
    n = len(per)
    out = {}
    for d in cal:
        v = [per[m][0][d] for m in per if d in per[m][0]]
        if v:
            out[d] = sum(v) / n
    return out


def combine_same_capital(a, b):
    """같은 원금: 같은 날 둘 다면 반씩."""
    out = {}
    for d in set(a) | set(b):
        out[d] = (a[d] + b[d]) / 2 if d in a and d in b else a.get(d, b.get(d))
    return out


def last_two(cal, upto=None):
    c = [d for d in sorted(set(cal)) if not upto or d <= upto]
    return c[-2:] if len(c) >= 2 else ([None] + c)[-2:]


def d1_live_status(d):
    """확정 일봉 전 날의 ①: 실시간 원본(VTS ledger)으로 매매 여부만 안다. v2 는 통과 5종목 이상일 때만 매매."""
    j = read_json(DATA / "opening-gapdown-live" / f"{d}.json")
    if not j:
        return "pending"
    pre = next((e.get("payload") or {} for e in ((j.get("ledger") or {}).get("events") or []) if e and e.get("stage") == "preopen"), None)
    if pre is None:
        return "pending"
    q = (pre.get("breadth") or {}).get("qualified")
    if not pre.get("picks") or (q is not None and q < 5):
        return "no_trade"
    return "pending"


def cell(series, d, final_through=None, live=None):
    """그날 결과: 숫자(순손익 %) · "no_trade"(신호 없음) · "pending"(확정 일봉 전) · None(날짜 없음)."""
    if d is None:
        return None
    if final_through and d > final_through:
        return live(d) if live else "pending"
    return series[d] if d in series else "no_trade"


def daily_board(report, d1, krx_cal, crypto_full, cal_c):
    """📅 오늘 탭: 모든 전략의 전일·당일 결과 + 오늘 신호. 시장마다 자기 달력의 마지막 두 거래일."""
    today = datetime.now(KST).strftime("%Y-%m-%d")
    try:
        import FinanceDataReader as fdr
        kr_cal = sorted(set(krx_cal) | {str(i)[:10] for i in fdr.DataReader("233740", "2026-01-01").index if str(i)[:10] < today
                                         or int(datetime.now(KST).strftime("%H%M")) >= 1600})
    except Exception:  # noqa: BLE001
        kr_cal = sorted(krx_cal)
    final_kr = max(krx_cal) if krx_cal else None
    kp, kl = last_two(kr_cal)
    cp, cl = last_two(cal_c)
    rows = []

    def add(group, side, name, version, series, prev, last, final_through=None, plan=None, live=None):
        rows.append(dict(group=group, side=side, name=name, version=version, prevDate=prev, lastDate=last,
                         prev=cell(series, prev, final_through, live), last=cell(series, last, final_through, live), plan=plan))

    tabs = report["tabs"]
    wl = read_json(DATA / "opening-gapdown-research/watchlist.json") or {}
    add("시초가", "claude", "① D-1 갭하락 과매도 v2", "opening_gapdown_v1", d1, kp, kl, final_kr,
        plan=f"명단 {len(wl.get('names') or [])}종목 · 08:56 예상갭 확인 (통과 5종목 이상일 때 v2 매매)", live=d1_live_status)
    g, gv, _ = gpt_daily("opening")
    add("시초가", "gpt", "시초가 돌파", ", ".join(gv), g, kp, kl)
    add("데이트레이딩", "claude", "② 코스닥150 레버리지 하락일 야간", "etf_dip_overnight_v1", etf_daily(), kp, kl,
        plan="15:21 예상 종가 −3% 이하면 종가 매수 → 다음 날 시가 매도")
    g, gv, _ = gpt_daily("daytrading")
    add("데이트레이딩", "gpt", "데이트레이딩", ", ".join(gv), g, kp, kl)
    c = tabs.get("crypto") or {}
    nx = c.get("nextSignals") or {}
    add("비트코인", "claude", "③ BTC+ETH 20일 추세", CRYPTO["version"], {d: v * CRYPTO["tabSize"] for d, v in crypto_full.items()}, cp, cl,
        plan=" · ".join(f"{m.split('-')[1]} {'보유' if n.get('holdNext') else '쉼'}" for m, n in nx.items()))
    g, gv, _ = gpt_daily("crypto")
    add("비트코인", "gpt", "비트코인", ", ".join(gv), g, cp, cl)
    sx = tabs.get("soxl") or {}
    sdv = {r["date"]: float(r["pnlPct"]) for r in read_csv(OUT / "soxl-decisions.csv") if r.get("pnlPct") not in (None, "", "None")}
    scal = [r["date"] for r in read_csv(OUT / "soxl-decisions.csv")]
    sp, sl = last_two(scal)
    add("SOXL", "claude", "④ SOXX 50일 추세 SOXL", SOXL["version"], sdv, sp, sl,
        plan=("보유" if (sx.get("nextSignal") or {}).get("holdNext") else "쉼") + " (미국장)")
    g, gv, _ = gpt_daily("soxl")
    add("SOXL", "gpt", "SOXL", ", ".join(gv), g, sp, sl)
    acct = {r["date"]: r["pnlPct"] for r in (report.get("account") or {}).get("recent", [])}
    ap, al = last_two(sorted(set(cal_c) | set(kr_cal)), upto=max(acct) if acct else None)
    add("전체", "claude", "🏦 전체 계좌 (국내 50% + 코인 50%)", "account", acct, ap, al)
    return dict(generatedAt=datetime.now(KST).isoformat(), today=today, finalKrDaily=final_kr, rows=rows,
                note="시장마다 자기 거래일 기준. ① 은 확정 일봉으로만 계산해 하루 늦게 채워질 수 있음(pending). 숫자는 순손익 %.")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


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
    crypto_full = {}
    try:
        per, nexts, cal_c = {}, {}, set()
        for m in CRYPTO["markets"]:
            rows = fetch_btc_daily(m)
            p = dict(CRYPTO, version=CRYPTO["version"] + ":" + m)
            dv_m, dec_m, nxt_m = trend_daily(rows, p)
            per[m], nexts[m] = (dv_m, {r[0] for r in rows}), nxt_m
            cal_c |= {r[0] for r in rows}
            write_csv(OUT / f"{m.split('-')[1].lower()}-decisions.csv", dec_m)
        cal_c = sorted(cal_c)
        crypto_full = basket(per, cal_c)                     # 코인 칸 안에서 전액(두 코인 반반)
        tab_dv = {d: v * CRYPTO["tabSize"] for d, v in crypto_full.items()}
        btc_only = {d: v * 0.5 for d, v in per["KRW-BTC"][0].items()}
        report["tabs"]["crypto"] = tab_report("crypto", "③ BTC+ETH 20일 추세 + 손절", CRYPTO["version"], CRYPTO["note"], tab_dv, cal_c, 365,
                                              extra=dict(nextSignals=nexts, params=CRYPTO,
                                                         variants={"btc_trend20_v1 (BTC 단독 50%)": goal_metrics({d: v for d, v in btc_only.items() if d <= DESIGN_END}, [d for d in cal_c if d <= DESIGN_END], 365)}))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["crypto"] = dict(error=str(e))
    if crypto_full:
        kr = combine_same_capital(d1, etf_daily())
        acct = {d: ACCOUNT["krWeight"] * kr.get(d, 0.0) + ACCOUNT["cryptoWeight"] * crypto_full.get(d, 0.0) * ACCOUNT["cryptoSize"]
                for d in cal_c if d in kr or d in crypto_full}
        acal = [d for d in cal_c if d >= min(kr)] if kr else cal_c
        report["account"] = dict(plan=ACCOUNT,
                                 design=goal_metrics({d: v for d, v in acct.items() if d <= DESIGN_END}, [d for d in acal if d <= DESIGN_END], 365),
                                 outOfSample=goal_metrics({d: v for d, v in acct.items() if d > DESIGN_END}, [d for d in acal if d > DESIGN_END], 365),
                                 lastYear=goal_metrics({d: v for d, v in acct.items() if d >= "2025-10-01" and d <= DESIGN_END}, [d for d in acal if "2025-10-01" <= d <= DESIGN_END], 365),
                                 recent=[dict(date=d, pnlPct=acct[d]) for d in sorted(acct)[-20:]])
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
    report["daily"] = daily_board(report, d1, krx_cal, crypto_full, locals().get("cal_c") or [])
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
