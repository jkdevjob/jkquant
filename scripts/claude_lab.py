#!/usr/bin/env python3
"""단타(클로드) — 탭별 클로드 전략 vs GPT 기준전략 비교 (연구 전용, 주문 없음).

탭 = GPT 단타 화면과 같은 4개. 탭마다 클로드 전략 하나:
  opening    ① D-1 v2 갭하락 과매도 (시장 투매일)         — opening_gapdown_v1 결과 사용
  daytrading ② 코스닥150 레버리지 하락일 야간             — etf_dip_overnight_v1 결과 사용
  crypto     ③ BTC+ETH 20일 추세 + 하루 손절 −4% · 반반 · 투입 60% — crypto_trend20_v2 (이 파일)
             (v1 BTC 단독 50% 는 비교용으로 같이 계산한다)
전체 계좌안: 국내 30% + 코인 30% + 미국 40% (각 칸 안에서 전액) — 같은 원금 기준 일 손익(미국은 한국 다음 날로).
  soxl       ④ SOXL 파워아워 추세 지속 · 당일 15:55 ET 강제청산 — soxl_power_hour_v1 결과 사용

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
ACCOUNT = dict(krWeight=0.3, cryptoWeight=0.3, usWeight=0.4, cryptoSize=1.0, usSize=1.0,
               note="같은 원금: 국내 30%(① D-1 v2 + ② ETF 야간, 같은 날이면 반반) + 코인 30%(BTC+ETH 반반 추세, 칸 안 전액) + 미국 40%(SOXL 파워아워 당일청산, 칸 안 전액).")
US = dict(version="soxl_power_hour_v1", trade="SOXL", tabSize=1.0, maxHoldingDays=1,
          note="SOXL만 매매. 첫30분 강세 + 파워아워 VWAP/직전3봉 고점/거래량 조건 → 다음 5분봉 시가 진입 · 손절 −1% · 익절 +2% · 15:55 ET 강제청산.")
GPT_FILES = {
    "opening": ("opening-history/baseline-trades.csv", "pnl"),
    "daytrading": ("daytrading-research/baseline-trades.csv", "pnl"),
    "crypto": ("crypto-research/baseline-trades.csv", "pnlPct"),
    "soxl": ("soxl-research/baseline-trades.csv", "pnlPct"),
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
               expectancyPct=statistics.fmean(vals) if vals else None,
               profitFactor=(sum(v for v in vals if v > 0) / -sum(loss)) if loss else None)
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


def daily_board(report, d1, krx_cal, crypto_full, cal_c, us_full):
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
    sp, sl = last_two(sorted(us_full))
    add("SOXL", "claude", "④ SOXL 파워아워 추세 지속", US["version"], us_full, sp, sl,
        plan="15:00~15:20 ET 조건 감시 → 신호 다음 5분봉 진입 → 늦어도 15:55 ET 전량 청산")
    g, gv, _ = gpt_daily("soxl")
    add("SOXL", "gpt", "SOXL ORB", ", ".join(gv), g, sp, sl)
    acct = {r["date"]: r["pnlPct"] for r in (report.get("account") or {}).get("recent", [])}
    ap, al = last_two(sorted(set(cal_c) | set(kr_cal)), upto=max(acct) if acct else None)
    add("전체", "claude", "🏦 전체 계좌 (국내 30% · 코인 30% · 미국 40%)", "account", acct, ap, al)
    return dict(generatedAt=datetime.now(KST).isoformat(), today=today, finalKrDaily=final_kr, rows=rows,
                note="시장마다 자기 거래일 기준. ① 은 확정 일봉으로만 계산해 하루 늦게 채워질 수 있음(pending). 숫자는 순손익 %.")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def soxl_power_hour_daily():
    """daily1-shadow의 SOXL 파워아워 전략을 Claude SOXL 탭의 공식 연구 series로 사용한다.

    SOXL만 매매하며 모든 포지션은 같은 미국 정규장 15:55 ET까지 청산된다.
    반환: (daily_pct, calendar, detail_by_date, strategy_meta)
    """
    j = read_json(DATA / "daily1-shadow" / "latest.json") or {}
    x = ((j.get("strategies") or {}).get("soxl") or {})
    detail = {}
    for bucket in ("design", "outOfSample"):
        for r in ((x.get(bucket) or {}).get("daily") or []):
            d = r.get("date")
            if not d:
                continue
            detail[d] = dict(date=d, returnPct=float(r.get("returnPct") or 0.0), trades=int(r.get("trades") or 0))
    daily = {d: z["returnPct"] for d, z in detail.items()}
    return daily, sorted(detail), detail, x


DECISIONS = {}
ROWS = {}
PAPER = DATA / "claude-paper"
PAPER_START = "2026-10-01"          # 모의투자 장부 시작일 = 판정용 표본 시작일


def write_once(path, obj):
    """모의투자 장부는 날짜별로 한 번만 쓴다. 이미 있으면 절대 덮어쓰지 않는다(규칙을 바꿔도 과거 기록은 그대로)."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return True


def paper_entries(report, d1, krx_cal, crypto_full, us_full, cal_c):
    """{전략키: [(날짜, 기록)]} — 결과가 확정된 날만. 기록 = 그날 판단 근거 + 순손익(매매 없으면 0, action=no_trade)."""
    now = datetime.now(KST).isoformat()
    out = {}
    final_kr = max(krx_cal) if krx_cal else ""
    gd = read_json(DATA / "opening-gapdown-research/latest.json") or {}
    live_d1 = {}
    for t in gd.get("liveTrades") or []:
        live_d1.setdefault(t.get("date"), []).append(t)
    out["opening_d1v2"] = [(d, dict(date=d, strategy="① D-1 갭하락 과매도 v2", strategyVersion="opening_gapdown_v1+v2filter",
                                    action="trade" if d in d1 else "no_trade", pnlPct=d1.get(d, 0.0), source="kis-vts+final-daily-bars",
                                    liveFills=live_d1.get(d, []), recordedAt=now))
                           for d in krx_cal if PAPER_START <= d <= final_kr]
    etf = etf_daily()
    etf_live = {r.get("exitDate"): r for r in ((read_json(DATA / "etf-overnight-research/latest.json") or {}).get("live") or {}).get("rows", [])}
    etf_cal = sorted(set(etf) | set(krx_cal))
    last_etf = max(etf) if etf else ""
    out["daytrading_etf"] = [(d, dict(date=d, strategy="② 코스닥150 레버리지 하락일 야간", strategyVersion="etf_dip_overnight_v1",
                                      action="trade" if d in etf else "no_trade", pnlPct=etf.get(d, 0.0), source="kis-vts+daily-bars",
                                      live=etf_live.get(d), recordedAt=now))
                             for d in etf_cal if PAPER_START <= d <= max(last_etf, final_kr)]
    for key, m in (("crypto_btc", "KRW-BTC"), ("crypto_eth", "KRW-ETH")):
        out[key] = [(r["date"], dict(r, strategy="③ " + m.split("-")[1] + " 20일 추세 (칸 안 전액)", source="paper-upbit-daily", recordedAt=now,
                                      pnlPct=r.get("pnlPct") or 0.0))
                    for r in DECISIONS.get(m, []) if r["date"] >= PAPER_START]
    _, _, soxl_detail, _ = soxl_power_hour_daily()
    out["us_soxl"] = [(d, dict(date=d, strategy="④ SOXL 파워아워 추세 지속", strategyVersion=US["version"],
                                      action="trade" if z.get("trades") else "no_trade", pnlPct=z.get("returnPct") or 0.0,
                                      source="daily1-shadow-soxl-5m", holdingPolicy="same_session", recordedAt=now))
                      for d, z in sorted(soxl_detail.items()) if d >= PAPER_START]
    kr = combine_same_capital({d: v for d, v in d1.items() if d <= final_kr}, etf)
    acct = account_daily(kr, crypto_full, us_to_kst(us_full), cal_c)
    last_all = min(x for x in (final_kr, max(crypto_full) if crypto_full else "", max(us_to_kst(us_full)) if us_full else "") if x)
    out["account"] = [(d, dict(date=d, strategy="🏦 전체 계좌", plan=ACCOUNT, pnlPct=acct.get(d, 0.0),
                               action="trade" if d in acct else "no_trade", recordedAt=now))
                      for d in cal_c if PAPER_START <= d <= last_all]
    return out


EXPECT = {"opening_d1v2": ("opening", 250), "daytrading_etf": ("daytrading", 250), "account": (None, 365)}


def write_paper(report, d1, krx_cal, crypto_full, us_full, cal_c):
    entries = paper_entries(report, d1, krx_cal, crypto_full, us_full, cal_c)
    written = 0
    summary = {}
    for key, rows in entries.items():
        for d, rec in rows:
            written += write_once(PAPER / key / f"{d}.json", rec)
        # 요약은 장부 파일(처음 쓴 값)만으로 계산한다 — 다시 계산한 값으로 바꾸지 않는다
        recs = []
        for f in sorted((PAPER / key).glob("*.json")) if (PAPER / key).exists() else []:
            j = read_json(f)
            if j:
                recs.append(j)
        vals = {r["date"]: float(r.get("pnlPct") or 0.0) for r in recs if r.get("action") not in ("no_trade", "flat")}
        cal = [r["date"] for r in recs]
        z = goal_metrics(vals, cal, 365 if key.startswith(("crypto", "account")) else 250) if cal else {}
        exp = expectation(report, key)
        cum, peak, dd, rows_out, streak = 1.0, 1.0, 0.0, [], 0
        for r in recs:
            v = float(r.get("pnlPct") or 0.0) if r.get("action") not in ("no_trade", "flat") else 0.0
            cum *= 1 + v / 100
            peak = max(peak, cum)
            dd = cum / peak - 1
            streak = streak + 1 if v < 0 else (0 if v > 0 else streak)
            rows_out.append(dict(date=r["date"], action=r.get("action"), pnlPct=v, cumPct=(cum - 1) * 100,
                                 note=r.get("decisionReason") or r.get("signalClose") and f"종가 {r.get('signalClose')}" or ""))
        summary[key] = dict(rows=rows_out[-60:], currentDrawdownPct=dd * 100, lossStreak=streak,
                            days=len(cal), first=cal[0] if cal else None, last=cal[-1] if cal else None,
                            tradeDays=len(vals), plus1Days=sum(1 for v in vals.values() if v >= 1),
                            winDays=sum(1 for v in vals.values() if v > 0), profitFactor=z.get("profitFactor"),
                            totalPct=z.get("totalPct"), mddPct=z.get("mddPct"), worstDayPct=z.get("worstDayPct"),
                            avgTradePct=statistics.fmean(vals.values()) if vals else None, expected=exp,
                            status=drift_status(vals, exp))
    return dict(start=PAPER_START, newFiles=written, summary=summary,
                rule="날짜별 장부 파일은 한 번만 쓰고 덮어쓰지 않는다. 요약은 장부 파일 값으로만 계산한다.")


def expectation(report, key):
    """설계 표본에서 기대하는 매매일 평균 손익과 표준편차(판정 비교용)."""
    tab = {"opening_d1v2": "opening", "daytrading_etf": "daytrading", "us_soxl": "soxl"}.get(key)
    src = None
    if tab:
        src = ((report.get("tabs") or {}).get(tab) or {}).get("claude", {}).get("design")
    elif key == "account":
        src = (report.get("account") or {}).get("design")
    dec_key = {"crypto_btc": "KRW-BTC", "crypto_eth": "KRW-ETH"}.get(key)
    if dec_key and DECISIONS.get(dec_key):
        rows = [r for r in DECISIONS[dec_key] if r["date"] <= DESIGN_END and r.get("pnlPct") is not None and r.get("action") not in ("flat",)]
        v = [float(r["pnlPct"]) for r in rows]
        if v:
            yrs = len(DECISIONS[dec_key]) / (365 if dec_key.startswith("KRW") else 252)
            return dict(expectancyPct=statistics.fmean(v), plus1DaysPerYear=sum(1 for x in v if x >= 1) / yrs, tradeDaysPerYear=len(v) / yrs)
    if not src:
        return None
    return dict(expectancyPct=src.get("expectancyPct"), plus1DaysPerYear=src.get("plus1DaysPerYear"), tradeDaysPerYear=src.get("tradeDaysPerYear"))


def drift_status(vals, exp):
    """실측이 기대에서 벗어났는지. 매매일 20일 전에는 판단하지 않는다."""
    n = len(vals)
    if n < 20 or not exp or exp.get("expectancyPct") is None:
        return dict(code="collecting", text=f"매매일 {n}/20 — 판단 전")
    v = list(vals.values())
    m, sd = statistics.fmean(v), statistics.stdev(v)
    zscore = (m - exp["expectancyPct"]) / (sd / math.sqrt(n)) if sd > 0 else 0.0
    if zscore < -2:
        return dict(code="below", text=f"기대보다 낮음 (z={zscore:.1f}) — 규칙 점검", z=zscore)
    return dict(code="ok", text=f"기대 범위 (z={zscore:.1f})", z=zscore)


CHANGELOG = [
    dict(date="2026-10-01", tab="opening", version="opening_gapdown_v1", text="① D-1 갭하락 과매도 시작 — KIS 모의투자 매일 주문(측정용)."),
    dict(date="2026-10-01", tab="opening", version="v2 필터", text="통과 5종목 이상(시장 투매일)만 v2 매매로 판정 — 8년 하루 +1.33%, 9개 연도 모두 양수."),
    dict(date="2026-10-01", tab="daytrading", version="etf_dip_overnight_v1", text="② 코스닥150 레버리지 −3% 하락일 종가 매수 → 다음날 시가 매도 시작."),
    dict(date="2026-10-01", tab="crypto", version="crypto_trend20_v2", text="③ BTC 단독 → BTC+ETH 반반(+1% 달성일 35→46일/년)."),
    dict(date="2026-10-02", tab="soxl", version="soxl_power_hour_v1", text="④ SOXL 탭을 SOXL 전용 파워아워 당일청산 전략으로 교체. TQQQ 대체 및 장기보유 제거."),
    dict(date="2026-10-01", tab="all", version="account 30/30/40", text="전체 계좌 국내 30%·코인 30%·미국 40% — +1% 달성일 69일/년, MDD −22%."),
]
REVIEW = DATA / "claude-lab" / "review"


def split_metrics(dv, cal, per):
    return dict(design=goal_metrics({d: v for d, v in dv.items() if d <= DESIGN_END}, [d for d in cal if d <= DESIGN_END], per),
                outOfSample=goal_metrics({d: v for d, v in dv.items() if d > DESIGN_END}, [d for d in cal if d > DESIGN_END], per))


def d1_variant(minq):
    q = {r["date"]: int(r.get("rsiPassed") or 0) for r in read_csv(DATA / "opening-gapdown-research/decisions.csv")}
    by = {}
    for r in read_csv(DATA / "opening-gapdown-research/signals.csv"):
        by.setdefault(r["date"], []).append(float(r["pnl"]))
    return {d: statistics.fmean(v) for d, v in by.items() if q.get(d, 0) >= minq}, sorted(q)


def etf_variant(code, th):
    import FinanceDataReader as fdr
    today = datetime.now(KST).strftime("%Y-%m-%d")
    d = fdr.DataReader(code, "2016-01-01")
    b = [(str(i)[:10], float(r["Open"]), float(r["Close"])) for i, r in d.iterrows() if float(r["Open"]) > 0 and str(i)[:10] < today]
    out = {}
    for i in range(1, len(b) - 1):
        chg = (b[i][2] / b[i - 1][2] - 1) * 100
        if abs(chg) < 35 and chg <= th:
            tick = 5 if b[i][2] >= 2000 else 1
            out[b[i + 1][0]] = (b[i + 1][1] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100)
    return out, [x[0] for x in b]


def shadows(per_rows, tq_rows, qq_close):
    """탭별 그림자 전략 — 주문 없음, 기준전략과 같은 목표 지표로 설계/판정 표본을 나란히 기록한다."""
    out = {}
    try:
        v1, cal = d1_variant(1)
        v3, _ = d1_variant(3)
        out["opening"] = [dict(name="v1 · 매일(통과 1개 이상)", version="opening_gapdown_v1", rule="v2 필터 없이 조건 맞는 날 매일 3종목", **split_metrics(v1, cal, 250)),
                          dict(name="v2 · 통과 3개 이상", version="opening_gapdown_v2_min3", rule="통과 종목 3개 이상인 날만", **split_metrics(v3, cal, 250))]
    except Exception as e:  # noqa: BLE001
        out["opening"] = [dict(name="error", error=str(e))]
    try:
        e2, c2 = etf_variant("233740", -2.0)
        e4, _ = etf_variant("233740", -4.0)
        k3, ck = etf_variant("122630", -3.0)
        out["daytrading"] = [dict(name="코스닥150 레버리지 −2% 기준", version="etf_dip_overnight_th2", rule="−2% 이하 마감이면 매수", **split_metrics(e2, [d for d in c2 if d >= "2018-04-01"], 250)),
                             dict(name="코스닥150 레버리지 −4% 기준", version="etf_dip_overnight_th4", rule="−4% 이하 마감이면 매수", **split_metrics(e4, [d for d in c2 if d >= "2018-04-01"], 250)),
                             dict(name="코스피200 레버리지 −3% 기준", version="etf_dip_overnight_k200", rule="KODEX 레버리지(122630) −3% 이하 마감이면 매수", **split_metrics(k3, [d for d in ck if d >= "2018-04-01"], 250))]
    except Exception as e:  # noqa: BLE001
        out["daytrading"] = [dict(name="error", error=str(e))]
    try:
        cal_c = sorted({r[0] for rows in per_rows.values() for r in rows})
        res = []
        for name, ver, ma, stop in (("평균 50일", "crypto_trend50", 50, 4.0), ("손절 −3%", "crypto_trend20_stop3", 20, 3.0)):
            per = {}
            for m, rows in per_rows.items():
                dv, _, _ = trend_daily(rows, dict(CRYPTO, ma=ma, stopPct=stop))
                per[m] = (dv, None)
            b = {d: v * CRYPTO["tabSize"] for d, v in basket(per, cal_c).items()}
            res.append(dict(name=name, version=ver, rule=f"BTC+ETH 반반 · {ma}일 평균 · 손절 −{stop:g}% · 자금 60%", **split_metrics(b, cal_c, 365)))
        out["crypto"] = res
    except Exception as e:  # noqa: BLE001
        out["crypto"] = [dict(name="error", error=str(e))]
    try:
        sdv, scal, _, meta = soxl_power_hour_daily()
        out["soxl"] = [dict(name=(meta.get("name") or "SOXL 파워아워"), version=(meta.get("version") or US["version"]),
                            rule=(meta.get("rule") or US["note"]), **split_metrics(sdv, scal, 252))]
    except Exception as e:  # noqa: BLE001
        out["soxl"] = [dict(name="error", error=str(e))]
    return out


PROMOTE_MIN_TRADE_DAYS = 20


def promotion(official, shadow):
    """그림자 → 교체 후보 판정. 판정용 표본(10/1~)에서만 본다. 자동으로 바꾸지 않는다 — 후보 표시만 하고 사람이 검토한다."""
    sh, off = shadow or {}, official or {}
    n = sh.get("tradeDays") or 0
    if n < PROMOTE_MIN_TRADE_DAYS:
        return dict(code="collecting", text=f"판정 표본 매매 {n}/{PROMOTE_MIN_TRADE_DAYS}일 — 판단 전")
    if not sh.get("gate"):
        return dict(code="keep", text="판정 표본 손실 기준 미달 — 기준 유지")
    s_tot, o_tot = sh.get("totalPct") or 0.0, off.get("totalPct") or 0.0
    s_p1, o_p1 = sh.get("plus1Days") or 0, off.get("plus1Days") or 0
    s_mdd, o_mdd = sh.get("mddPct") or 0.0, off.get("mddPct") or 0.0
    if s_tot > o_tot and s_p1 >= o_p1 and s_mdd >= o_mdd - 5:
        return dict(code="candidate", text=f"교체 후보 — 누적 {s_tot:+.1f}% vs 기준 {o_tot:+.1f}%, +1%일 {s_p1} vs {o_p1} (검토 후 새 버전)")
    return dict(code="keep", text=f"기준 유지 — 누적 {s_tot:+.1f}% vs 기준 {o_tot:+.1f}%")


def attach_promotions(report):
    for tab, rows in (report.get("shadows") or {}).items():
        off = (((report.get("tabs") or {}).get(tab) or {}).get("claude") or {}).get("outOfSample")
        for x in rows if isinstance(rows, list) else []:
            if not x.get("error"):
                x["promotion"] = promotion(off, x.get("outOfSample"))


def week_summary(summary, today):
    """이번 주(월~일, 한국 날짜) 모의투자 결과 — 장부 요약 행만 쓴다. 기여도 = 계좌 비중 × 그날 손익의 단순합(%p)."""
    t = date.fromisoformat(today)
    mon = (t - timedelta(days=t.weekday())).isoformat()
    sun = (t - timedelta(days=t.weekday()) + timedelta(days=6)).isoformat()
    a = ACCOUNT

    def rows(k, shift=0):
        out = []
        for r in (summary.get(k) or {}).get("rows") or []:
            d = (date.fromisoformat(r["date"]) + timedelta(days=shift)).isoformat()
            if mon <= d <= sun:
                out.append(dict(r, kst=d))
        return out

    traded = lambda r: r.get("action") not in ("no_trade", "flat")
    both = {r["kst"] for r in rows("opening_d1v2") if traded(r)} & {r["kst"] for r in rows("daytrading_etf") if traded(r)}
    weight = {"opening_d1v2": lambda d: a["krWeight"] * (0.5 if d in both else 1.0),
              "daytrading_etf": lambda d: a["krWeight"] * (0.5 if d in both else 1.0),
              "crypto_btc": lambda d: a["cryptoWeight"] * a["cryptoSize"] * 0.5,
              "crypto_eth": lambda d: a["cryptoWeight"] * a["cryptoSize"] * 0.5,
              "us_soxl": lambda d: a["usWeight"] * a["usSize"]}
    parts = {}
    for k, w in weight.items():
        rs = rows(k, 1 if k == "us_soxl" else 0)
        eq = 1.0
        for r in rs:
            eq *= 1 + (r.get("pnlPct") or 0.0) / 100
        parts[k] = dict(days=len(rs), tradeDays=sum(1 for r in rs if traded(r)), plus1Days=sum(1 for r in rs if (r.get("pnlPct") or 0) >= 1),
                        weekPct=(eq - 1) * 100, contribPct=sum(w(r["kst"]) * (r.get("pnlPct") or 0.0) for r in rs),
                        through=rs[-1]["date"] if rs else None)
    ar = rows("account")
    eq = 1.0
    for r in ar:
        eq *= 1 + (r.get("pnlPct") or 0.0) / 100
    acct = dict(days=len(ar), plus1Days=sum(1 for r in ar if (r.get("pnlPct") or 0) >= 1), weekPct=(eq - 1) * 100,
                through=ar[-1]["date"] if ar else None, daily=[dict(date=r["date"], pnlPct=r.get("pnlPct")) for r in ar])
    acct["hit5"] = acct["weekPct"] >= 5
    return dict(weekStart=mon, weekEnd=sun, asOf=today, account=acct, parts=parts,
                note="장부에 확정된 날만. 코인 하루는 09시 기준, 미국은 한국 날짜(다음 날 아침)로 센다. 기여도는 계좌 비중을 곱한 단순합.")


def review_entry(report):
    """매일 검증·분석 기록 — 날짜별 한 번만 쓴다(저녁 첫 실행 기준). 자동 점검 결과 + 판단 근거."""
    today = datetime.now(KST).strftime("%Y-%m-%d")
    paper = (report.get("paper") or {}).get("summary") or {}
    led = read_json(DATA / "opening-gapdown-live" / f"{today}.json") or {}
    ev = {e.get("stage"): e.get("payload") or {} for e in ((led.get("ledger") or {}).get("events") or []) if e}
    issues = []
    for st_name in ("preopen", "close", "etf_buy", "etf_sell"):
        for o in (ev.get(st_name) or {}).get("orders") or ([(ev.get(st_name) or {}).get("order")] if (ev.get(st_name) or {}).get("order") else []):
            if o and not ((o.get("vts") or {}).get("ok")):
                issues.append(f"{st_name} 주문 실패: {o.get('code')} {(o.get('vts') or {}).get('msg', '')}")
    if datetime.now(KST).weekday() < 5 and not led:
        issues.append("오늘 ①② 원본 기록 없음(휴장일이 아니면 점검)")
    for k, v in paper.items():
        if (v.get("status") or {}).get("code") == "below":
            issues.append(f"{k}: 실측이 기대보다 낮음 — 규칙 점검")
        if (v.get("lossStreak") or 0) >= 4:
            issues.append(f"{k}: {v['lossStreak']}일 연속 손실")
    tabs = {}
    for r in (report.get("daily") or {}).get("rows", []):
        if r.get("side") == "claude":
            tabs[r["group"]] = dict(name=r["name"], date=r.get("lastDate"), result=r.get("last"), plan=r.get("plan"))
    pre = ev.get("preopen") or {}
    return dict(date=today, writtenAt=datetime.now(KST).isoformat(), tabs=tabs,
                opening=dict(reason=pre.get("decisionReason"), picks=[p.get("name") for p in pre.get("picks") or []],
                             breadth=(pre.get("breadth") or {}).get("qualified")),
                etf=dict(buy=(ev.get("etf_buy") or {}).get("decisionReason"), drop=(ev.get("etf_buy") or {}).get("dropPct")),
                paper={k: dict(tradeDays=v.get("tradeDays"), totalPct=v.get("totalPct"), status=(v.get("status") or {}).get("text"))
                       for k, v in paper.items()},
                issues=issues, verdict="문제 없음" if not issues else f"점검 필요 {len(issues)}건")


def write_review(report):
    e = review_entry(report)
    if datetime.now(KST).hour >= 16:                     # 장 마감 뒤 첫 실행만 그날 기록으로 남긴다
        write_once(REVIEW / f"{e['date']}.json", e)
    out = []
    for f in sorted(REVIEW.glob("*.json"))[-20:] if REVIEW.exists() else []:
        j = read_json(f)
        if j:
            out.append(j)
    return dict(today=e, history=list(reversed(out)))


def us_to_kst(dv):
    """미국 거래일 d 의 손익은 한국시각 다음 날 아침에 확정된다 — 계좌 합산은 한국 날짜로."""
    return {(date.fromisoformat(d) + timedelta(days=1)).isoformat(): v for d, v in dv.items()}


def account_daily(kr, crypto_full, us_k, cal):
    a = ACCOUNT
    return {d: a["krWeight"] * kr.get(d, 0.0) + a["cryptoWeight"] * a["cryptoSize"] * crypto_full.get(d, 0.0)
            + a["usWeight"] * a["usSize"] * us_k.get(d, 0.0)
            for d in cal if d in kr or d in crypto_full or d in us_k}


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
            DECISIONS[m] = dec_m
            ROWS[m] = rows
        cal_c = sorted(cal_c)
        crypto_full = basket(per, cal_c)                     # 코인 칸 안에서 전액(두 코인 반반)
        tab_dv = {d: v * CRYPTO["tabSize"] for d, v in crypto_full.items()}
        btc_only = {d: v * 0.5 for d, v in per["KRW-BTC"][0].items()}
        report["tabs"]["crypto"] = tab_report("crypto", "③ BTC+ETH 20일 추세 + 손절", CRYPTO["version"], CRYPTO["note"], tab_dv, cal_c, 365,
                                              extra=dict(nextSignals=nexts, params=CRYPTO,
                                                         variants={"btc_trend20_v1 (BTC 단독 50%)": goal_metrics({d: v for d, v in btc_only.items() if d <= DESIGN_END}, [d for d in cal_c if d <= DESIGN_END], 365)}))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["crypto"] = dict(error=str(e))
    us_full = {}
    try:
        us_full, ucal, _, umeta = soxl_power_hour_daily()
        if not ucal:
            raise RuntimeError("SOXL intraday archive/shadow result not ready")
        report["tabs"]["soxl"] = tab_report("soxl", umeta.get("name") or "④ SOXL 파워아워 추세 지속",
                                            umeta.get("version") or US["version"], umeta.get("rule") or US["note"],
                                            us_full, ucal, 252, extra=dict(params=US, source="daily1-shadow/soxl"))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["soxl"] = dict(error=str(e))
    if crypto_full:
        kr = combine_same_capital(d1, etf_daily())
        us_k = us_to_kst(us_full)
        acct = account_daily(kr, crypto_full, us_k, cal_c)
        acal = [d for d in cal_c if d >= min(kr)] if kr else cal_c
        report["account"] = dict(plan=ACCOUNT,
                                 design=goal_metrics({d: v for d, v in acct.items() if d <= DESIGN_END}, [d for d in acal if d <= DESIGN_END], 365),
                                 outOfSample=goal_metrics({d: v for d, v in acct.items() if d > DESIGN_END}, [d for d in acal if d > DESIGN_END], 365),
                                 lastYear=goal_metrics({d: v for d, v in acct.items() if d >= "2025-10-01" and d <= DESIGN_END}, [d for d in acal if "2025-10-01" <= d <= DESIGN_END], 365),
                                 recent=[dict(date=d, pnlPct=acct[d]) for d in sorted(acct)[-20:]])
    report["daily"] = daily_board(report, d1, krx_cal, crypto_full, locals().get("cal_c") or [], locals().get("us_full") or {})
    try:
        report["paper"] = write_paper(report, d1, krx_cal, crypto_full, locals().get("us_full") or {}, locals().get("cal_c") or [])
    except Exception as e:  # noqa: BLE001
        report["paper"] = dict(error=str(e))
    try:
        report["shadows"] = shadows({m: ROWS[m] for m in CRYPTO["markets"] if m in ROWS}, [], [])
    except Exception as e:  # noqa: BLE001
        report["shadows"] = dict(error=str(e))
    try:
        attach_promotions(report)
    except Exception as e:  # noqa: BLE001
        report["promotionError"] = str(e)
    try:
        report["week"] = week_summary(((report.get("paper") or {}).get("summary") or {}), datetime.now(KST).strftime("%Y-%m-%d"))
    except Exception as e:  # noqa: BLE001
        report["week"] = dict(error=str(e))
    report["changelog"] = CHANGELOG
    try:
        report["review"] = write_review(report)
    except Exception as e:  # noqa: BLE001
        report["review"] = dict(error=str(e))
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
