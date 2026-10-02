#!/usr/bin/env python3
"""단타(클로드) — 탭별 클로드 전략 vs GPT 기준전략 비교 (연구 전용, 주문 없음).

탭 = GPT 단타 화면과 같은 4개. 탭마다 클로드 전략 하나:
  opening    ① D-1 v2 갭하락 과매도 (시장 투매일)         — opening_gapdown_v1 결과 사용
  daytrading ② 코스닥150 레버리지 하락일 야간             — etf_dip_overnight_v1 결과 사용
  crypto     ③ BTC·ETH 어제 고가 돌파 하루 단타(보유 24시간 미만) · 손절 −5% · 반반 · 탭 80% — coin_breakout_v1 (이 파일)
  soxl       ④ SOXL RSI(2) 과매도 반등 · 다음 날 시가 매수 → 오른 날 다음 시가 매도 · 최대 5거래일 · 탭 50% — soxl_rsi2_meanrev_v1
보유 기간 규칙(사용자 2026-10-02): 모든 탭은 하루를 넘기지 않는다. 정말 좋은 전략만 최대 5일, 그 이상은 절대 안 된다.
  (옛 ③ crypto_trend20_v2 · ④ tqqq_trend200_v1 은 여러 날 보유라 중단 — 장부 기록은 그대로 둔다)
전체 계좌안: 국내 30% + 코인 30% + 미국 40% (각 칸 안에서 전액) — 같은 원금 기준 일 손익(미국은 한국 다음 날로).

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
               note="같은 원금: 국내 30%(① D-1 v2 + ② ETF 야간, 같은 날이면 반반) + 코인 30%(BTC·ETH 고가 돌파 하루 단타, 칸 안 전액) + 미국 40%(SOXL 과매도 반등 ≤5일, 칸 안 전액).")
US = dict(version="tqqq_trend200_v1", trade="TQQQ", signal="QQQ", ma=200, stopPct=10.0, size=1.0, tabSize=0.5,
          costRoundTripPct=0.20, stopSlipPct=0.1,
          note="QQQ 종가 > 200일 평균이면 TQQQ 보유(종가 기준), 전일 종가(진입일은 시가) 대비 −10% 닿으면 손절. 탭 표시는 자금 50%. SOXL 은 변동성이 너무 커 TQQQ 로 바꿨다(SOXL 안은 참고로 같이 계산).")
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


COIN_BO = dict(version="coin_breakout_v1", markets=["KRW-BTC", "KRW-ETH"], ma=20, stopPct=5.0, level="prevhigh", k=0.5,
               size=1.0, tabSize=0.8, costRoundTripPct=0.14, entrySlipPct=0.05, stopSlipPct=0.1,
               note="업비트 BTC·ETH 각각(하루 = 09:00~다음날 09:00): 어제 종가 > 20일 평균인 날만, 오늘 가격이 어제 고가를 넘는 순간 매수 → "
                    "다음 날 09:00 에 무조건 매도(보유 24시간 미만). 매수가 대비 −5% 닿으면 손절. 두 코인 반반, 탭 표시 자금 80%.")
HOURLY = DATA / "claude-lab" / "hourly"


def fetch_hourly(market, start="2018-01-01"):
    """업비트 60분봉 — 월별 캐시(data/claude-lab/hourly/{market}/{YYYY-MM}.json)에 없는 뒷부분만 받는다. 진행 중인 봉은 저장하지 않는다."""
    folder = HOURLY / market
    H = {}
    for f in sorted(folder.glob("*.json")) if folder.exists() else []:
        H.update(read_json(f) or {})
    have = max(H) if H else None
    now_kst = datetime.now(KST).replace(tzinfo=None)
    to, new = None, {}
    for _ in range(600):
        u = "https://api.upbit.com/v1/candles/minutes/60?market=" + market + "&count=200" + ("&to=" + to + "Z" if to else "")
        j = None
        for a in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json"}), timeout=30) as r:
                    j = json.load(r)
                break
            except Exception:  # noqa: BLE001
                time.sleep(1 + a)
        if not j:
            break
        for c in j:
            k = c["candle_date_time_kst"]
            if datetime.fromisoformat(k) + timedelta(hours=1) <= now_kst:       # 끝난 봉만
                new[k] = [c["opening_price"], c["high_price"], c["low_price"], c["trade_price"]]
        last = j[-1]["candle_date_time_utc"]
        if (have and j[-1]["candle_date_time_kst"] <= have) or last < start or last == to:
            break
        to = last
        time.sleep(0.12)
    if new:
        H.update(new)
        for y in sorted({k[:7] for k in new}):
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{y}.json").write_text(json.dumps({k: v for k, v in sorted(H.items()) if k[:7] == y}, separators=(",", ":")), encoding="utf-8")
    return H


def upbit_days(H):
    """60분봉 → 업비트 하루(09:00~다음날 09:00) 봉. 24개가 다 있는 날만."""
    out = {}
    starts = sorted({(datetime.fromisoformat(k) - timedelta(hours=9)).date() for k in H})
    for d in starts:
        s0 = datetime(d.year, d.month, d.day, 9)
        hs = [H.get((s0 + timedelta(hours=k)).isoformat()) for k in range(24)]
        if any(x is None for x in hs):
            continue
        out[d.isoformat()] = (hs[0][0], max(x[1] for x in hs), min(x[2] for x in hs), hs[-1][3])
    return out


def coin_breakout(H, p):
    """하루 단타: 어제 확정 종가 > n일 평균(어제까지)인 날, 오늘 60분봉 고가가 기준선(어제 고가 또는 시가+k×어제 폭)을 넘는
    첫 봉에서 max(봉 시가, 기준선)+미끄러짐에 매수 → 다음 날 09:00(오늘 마지막 봉 종가)에 매도. 손절: 매수 봉부터 저가가
    매수가 × (1−stop) 이하면 손절(같은 봉 안 순서는 모르니 보수적으로 손절로 본다). 보유는 24시간을 넘지 않는다."""
    Dd = upbit_days(H)
    days = sorted(Dd)
    C = [Dd[d][3] for d in days]
    n, half, sz = p["ma"], p["costRoundTripPct"] / 2, p["size"]
    dv, decisions = {}, []
    for i in range(n, len(days)):
        d, pd = days[i], days[i - 1]
        ma = sum(C[i - n:i]) / n
        trend = C[i - 1] > ma
        o = Dd[d][0]
        level = Dd[pd][1] if p["level"] == "prevhigh" else o + p["k"] * (Dd[pd][1] - Dd[pd][2])
        rec = dict(date=d, strategyVersion=p["version"], trend=int(trend), prevClose=C[i - 1], ma=ma, level=level,
                   action="flat" if not trend else "no_break", entryHour="", entryPrice=None, exitPrice=None, pnlPct=None)
        if trend:
            s0 = datetime.fromisoformat(d + "T09:00:00")
            bars = [H[(s0 + timedelta(hours=k)).isoformat()] for k in range(24)]
            for k, b in enumerate(bars):
                if b[1] > level:
                    e = max(b[0], level) * (1 + p["entrySlipPct"] / 100)
                    stop = e * (1 - p["stopPct"] / 100)
                    if any(x[2] <= stop for x in bars[k:]):
                        r = -p["stopPct"] - p["stopSlipPct"] - 2 * half
                        rec.update(action="stop", exitPrice=stop)
                    else:
                        r = (bars[-1][3] / e - 1) * 100 - 2 * half
                        rec.update(action="trade", exitPrice=bars[-1][3])
                    rec.update(entryHour=(s0 + timedelta(hours=k)).strftime("%H:00"), entryPrice=e, pnlPct=r * sz)
                    dv[d] = r * sz
                    break
        decisions.append(rec)
    nxt = None
    if len(days) > n:
        ma = sum(C[-n:]) / n
        last = days[-1]
        nxt = dict(basedOn=last, prevClose=C[-1], ma=ma, trendNext=C[-1] > ma, levelNext=Dd[last][1] if p["level"] == "prevhigh" else None,
                   holdNext=C[-1] > ma)
    return dv, decisions, nxt, days


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


SOXL_MR = dict(version="soxl_rsi2_meanrev_v1", trade="SOXL", rsiMax=20.0, ma=200, maxHoldDays=5, size=1.0, tabSize=0.5,
               costRoundTripPct=0.20,
               note="SOXL 단기 과매도 반등(최대 5거래일). 장 마감 확정 종가로 RSI(2)<20 이고 종가 > 200일 평균이면 다음 날 시가 매수 → "
                    "종가가 전날보다 오른 날이 나오면 그다음 날 시가 매도, 늦어도 5거래일째 종가 뒤 다음 시가 매도. 탭 표시 자금 50%.")


def rsi2_at(C, i, n=2):
    g = l = 0.0
    for k in range(i - n + 1, i + 1):
        ch = C[k] - C[k - 1]
        g += max(ch, 0.0)
        l += max(-ch, 0.0)
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def soxl_meanrev(rows, p):
    """rows: (date, open, high, low, close). 판단은 i 일 확정 종가 → 실행은 i+1 일 시가(룩어헤드 없음).
    보유 중 일 손익: 매수일 = 종가/시가, 이후 = 종가/전일 종가, 매도일 = 시가/전일 종가. 비용은 매수·매도 때 반씩."""
    D = [r[0] for r in rows]
    O, C = [r[1] for r in rows], [r[4] for r in rows]
    n, half, sz = p["ma"], p["costRoundTripPct"] / 2, p["size"]
    dv, decisions = {}, []
    pos = None                                     # dict(entry=i, days=n) — 보유 중이면
    pending = None                                 # "buy" | "sell" — 전날 종가에 정한 오늘 시가 주문
    for i in range(n, len(rows)):
        rec = dict(date=D[i], strategyVersion=p["version"], action="flat", pnlPct=None, heldDays=None, entryPrice=None, exitPrice=None,
                   close=None, rsi2=None, ma=None, next="")
        if pending == "sell" and pos:
            v = ((O[i] / C[i - 1] - 1) * 100 - half) * sz
            dv[D[i]] = v
            rec.update(action="exit", pnlPct=v, heldDays=pos["days"], exitPrice=O[i], entryPrice=O[pos["entry"]])
            pos = None
        elif pending == "buy" and not pos:
            v = ((C[i] / O[i] - 1) * 100 - half) * sz
            dv[D[i]] = v
            pos = dict(entry=i, days=1)
            rec.update(action="enter", pnlPct=v, entryPrice=O[i])
        elif pos:
            pos["days"] += 1
            v = (C[i] / C[i - 1] - 1) * 100 * sz
            dv[D[i]] = v
            rec.update(action="hold", pnlPct=v)
        pending = None
        ma = sum(C[i - n + 1:i + 1]) / n
        r2 = rsi2_at(C, i)
        rec.update(rsi2=r2, ma=ma, close=C[i])
        if pos:
            if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"]:
                pending = "sell"
                rec["next"] = "sell_open" + ("_maxhold" if not C[i] > C[i - 1] else "")
        elif r2 < p["rsiMax"] and C[i] > ma:
            pending = "buy"
            rec["next"] = "buy_open"
        decisions.append(rec)
    nxt = dict(basedOn=D[-1], rsi2=decisions[-1]["rsi2"] if decisions else None, ma=decisions[-1]["ma"] if decisions else None,
               close=C[-1], holding=bool(pos), heldDays=pos["days"] if pos else 0, action=pending or "none",
               holdNext=pending == "buy" or (bool(pos) and pending != "sell")) if rows else None
    return dv, decisions, nxt


def drop_open_session(bars, now_utc=None):
    """미국장이 아직 안 끝난 오늘 봉(장중 일봉)은 버린다 — 확정 종가로만 판단·장부를 쓴다. 뉴욕 16:15 이후면 그날 봉을 쓴다."""
    from zoneinfo import ZoneInfo
    ny = (now_utc or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    today = ny.strftime("%Y-%m-%d")
    closed = (ny.hour, ny.minute) >= (16, 15)
    return {d: v for d, v in bars.items() if d < today or (d == today and closed)}


def fetch_us(ticker):
    import FinanceDataReader as fdr
    d = fdr.DataReader(ticker, "2010-01-01")
    return drop_open_session({str(i)[:10]: (float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])) for i, r in d.iterrows() if float(r["Open"]) > 0})


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
    return ([None, None] + c)[-2:]


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


def d1_live_reason(d):
    j = read_json(DATA / "opening-gapdown-live" / f"{d}.json") or {}
    pre = next((e.get("payload") or {} for e in ((j.get("ledger") or {}).get("events") or []) if e and e.get("stage") == "preopen"), {})
    q = (pre.get("breadth") or {}).get("qualified")
    return pre.get("decisionReason") or (f"통과 {q}종목 < 5 (v2 매매일 아님)" if q is not None else "")


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
    add("비트코인", "claude", "③ BTC·ETH 어제 고가 돌파 하루 단타", COIN_BO["version"], {d: v * COIN_BO["tabSize"] for d, v in crypto_full.items()}, cp, cl,
        plan=" · ".join(f"{m.split('-')[1]} {'돌파 감시' if n.get('trendNext') else '쉼'}" for m, n in nx.items()))
    g, gv, _ = gpt_daily("crypto")
    add("비트코인", "gpt", "비트코인", ", ".join(gv), g, cp, cl)
    sx = tabs.get("soxl") or {}
    udec = DECISIONS.get("SOXL") or []
    sdv = {r["date"]: float(r["pnlPct"]) * SOXL_MR["tabSize"] for r in udec if r.get("pnlPct") not in (None, "", "None")}
    sp, sl = last_two([r["date"] for r in udec])
    nx = sx.get("nextSignal") or {}
    plan = {"buy": "다음 미국장 시가 매수", "sell": "다음 미국장 시가 매도"}.get(nx.get("action"), "보유 중" if nx.get("holding") else "쉼 (과매도 신호 없음)")
    add("SOXL", "claude", "④ SOXL 단기 과매도 반등 (최대 5일)", SOXL_MR["version"], sdv, sp, sl, plan=plan + " · 자금 50%")
    g, gv, _ = gpt_daily("soxl")
    add("SOXL", "gpt", "SOXL", ", ".join(gv), g, sp, sl)
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


DECISIONS = {}
ROWS = {}
PAPER = DATA / "claude-paper"
PAPER_START = "2026-10-01"          # 모의투자 장부 시작일 = 판정용 표본 시작일
START = {"us_soxl": "2026-10-02", "coin_bo_btc": "2026-10-02", "coin_bo_eth": "2026-10-02", "account": "2026-10-02"}   # 전략을 채택한 날부터만 장부에 쓴다(그 전 날짜를 재구성해 채우지 않는다)


def write_once(path, obj):
    """모의투자 장부는 날짜별로 한 번만 쓴다. 이미 있으면 절대 덮어쓰지 않는다(규칙을 바꿔도 과거 기록은 그대로)."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return True


CAL = {}                            # 시장별 확정 달력: etf(233740 일봉 날짜) · coin(끝난 업비트 하루) · us(SOXL 세션)


def kr_settled_through(d1_final, etf_to, kr_days, start):
    """국내 ①② 가 둘 다 확정된 마지막 '달력' 날짜. ① = 확정 일봉 또는 VTS 원본이 '매매 없음'으로 끝낸 날, ② = ETF 일봉 확정일.
    첫 미확정 거래일 전날까지(주말 포함). 전부 확정이면 마지막 거래일."""
    days = [d for d in kr_days if d >= start]
    for d in days:
        ok1 = d <= d1_final or d1_live_status(d) == "no_trade"
        if not (ok1 and d <= etf_to):
            return (date.fromisoformat(d) - timedelta(days=1)).isoformat()
    return days[-1] if days else (date.fromisoformat(start) - timedelta(days=1)).isoformat()


def paper_entries(report, d1, krx_cal, crypto_full, us_full, cal_c, start=None):
    """{전략키: [(날짜, 기록)]} — 결과가 확정된 날만. 기록 = 그날 판단 근거 + 순손익(매매 없으면 0, action=no_trade).
    start 를 주면 채택일(START)을 무시하고 그날부터 같은 규칙으로 재구성한다(주간 재구성용 — 장부에는 쓰지 않는다)."""
    st = (lambda k: start) if start else (lambda k: max(PAPER_START, START.get(k, PAPER_START)))
    now = datetime.now(KST).isoformat()
    out = {}
    final_kr = max(krx_cal) if krx_cal else ""
    gd = read_json(DATA / "opening-gapdown-research/latest.json") or {}
    live_d1 = {}
    for t in gd.get("liveTrades") or []:
        live_d1.setdefault(t.get("date"), []).append(t)
    etf_meta = read_json(DATA / "etf-overnight-research/latest.json") or {}
    etf_to = etf_meta.get("to") or final_kr
    kr_days = sorted(set(CAL.get("etf") or []) | set(krx_cal))
    o1 = [(d, dict(date=d, strategy="① D-1 갭하락 과매도 v2", strategyVersion="opening_gapdown_v1+v2filter",
                   action="trade" if d in d1 else "no_trade", pnlPct=d1.get(d, 0.0), source="kis-vts+final-daily-bars",
                   liveFills=live_d1.get(d, []), recordedAt=now))
          for d in krx_cal if st("opening_d1v2") <= d <= final_kr]
    # 확정 일봉 전이라도 VTS 원본이 '매매 없음'으로 끝낸 날은 바로 기록한다(매매가 없었으니 가격을 기다릴 이유가 없다)
    o1 += [(d, dict(date=d, strategy="① D-1 갭하락 과매도 v2", strategyVersion="opening_gapdown_v1+v2filter", action="no_trade", pnlPct=0.0,
                    source="kis-vts-ledger", decisionReason=d1_live_reason(d), recordedAt=now))
           for d in kr_days if d > final_kr and d >= st("opening_d1v2") and d1_live_status(d) == "no_trade"]
    out["opening_d1v2"] = sorted(o1)
    etf = etf_daily()
    etf_live = {r.get("exitDate"): r for r in (etf_meta.get("live") or {}).get("rows", [])}
    out["daytrading_etf"] = [(d, dict(date=d, strategy="② 코스닥150 레버리지 하락일 야간", strategyVersion="etf_dip_overnight_v1",
                                      action="trade" if d in etf else "no_trade", pnlPct=etf.get(d, 0.0), source="kis-vts+daily-bars",
                                      live=etf_live.get(d), recordedAt=now))
                             for d in kr_days if st("daytrading_etf") <= d <= etf_to]
    for key, m in (("coin_bo_btc", "KRW-BTC"), ("coin_bo_eth", "KRW-ETH")):
        out[key] = [(r["date"], dict(r, strategy="③ " + m.split("-")[1] + " 어제 고가 돌파 하루 단타 (칸 안 전액)", source="paper-upbit-hourly", recordedAt=now,
                                      pnlPct=r.get("pnlPct") or 0.0, action=r["action"] if r["action"] in ("trade", "stop") else "no_trade"))
                    for r in DECISIONS.get(m, []) if r["date"] >= st(key)]
    out["us_soxl"] = [(r["date"], dict(r, strategy="④ SOXL 단기 과매도 반등 (칸 안 전액)", source="paper-us-daily", recordedAt=now,
                                       pnlPct=r.get("pnlPct") or 0.0))
                      for r in DECISIONS.get("SOXL", []) if r["date"] >= st("us_soxl")]
    kr = combine_same_capital({d: v for d, v in d1.items() if d <= final_kr}, {d: v for d, v in etf.items() if d <= etf_to})
    acct = account_daily(kr, crypto_full, us_to_kst(us_full), cal_c)
    # 계좌는 세 시장이 다 확정된 날까지만 — 각 시장의 '달력' 끝(매매한 마지막 날이 아니라)으로 잰다
    ends = [kr_settled_through(final_kr, etf_to, kr_days, st("account")),
            (CAL.get("coin") or [""])[-1],
            (date.fromisoformat(CAL["us"][-1]) + timedelta(days=1)).isoformat() if CAL.get("us") else ""]
    last_all = min(ends) if all(ends) else ""
    out["account"] = [(d, dict(date=d, strategy="🏦 전체 계좌", plan=ACCOUNT, pnlPct=acct.get(d, 0.0),
                               action="trade" if d in acct else "no_trade", recordedAt=now))
                      for d in cal_c if st("account") <= d <= last_all]
    return out


def week_recon(report, d1, krx_cal, crypto_full, us_full, cal_c, today):
    """이번 주(월~) 규칙대로 재구성 — 장부(채택일부터)가 비어 있는 동안 보여 주는 참고값. 장부에는 쓰지 않는다."""
    t = date.fromisoformat(today)
    mon = (t - timedelta(days=t.weekday())).isoformat()
    ent = paper_entries(report, d1, krx_cal, crypto_full, us_full, cal_c, start=(date.fromisoformat(mon) - timedelta(days=1)).isoformat())
    pseudo = {k: {"rows": [dict(date=d, action=r.get("action"), pnlPct=(r.get("pnlPct") or 0.0) if r.get("action") not in ("no_trade", "flat") else 0.0)
                           for d, r in rows]} for k, rows in ent.items()}
    w = week_summary(pseudo, today)
    w.update(source="reconstructed", note="규칙대로 다시 계산한 값(모의 장부 아님). 새 전략 채택일(10/2) 전 날짜도 같은 규칙으로 계산했다. 확정된 날만.")
    return w


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
        summary[key] = dict(rows=rows_out[-60:], currentDrawdownPct=dd * 100, lossStreak=streak, start=max(PAPER_START, START.get(key, PAPER_START)),
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
    tab = {"opening_d1v2": "opening", "daytrading_etf": "daytrading"}.get(key)
    src = None
    if tab:
        src = ((report.get("tabs") or {}).get(tab) or {}).get("claude", {}).get("design")
    elif key == "account":
        src = (report.get("account") or {}).get("design")
    dec_key = {"coin_bo_btc": "KRW-BTC", "coin_bo_eth": "KRW-ETH", "us_soxl": "SOXL"}.get(key)
    if dec_key and DECISIONS.get(dec_key):
        rows = [r for r in DECISIONS[dec_key] if r["date"] <= DESIGN_END and r.get("pnlPct") not in (None, "") and r.get("action") not in ("flat", "no_break")]
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
    dict(date="2026-10-01", tab="soxl", version="tqqq_trend200_v1", text="④ SOXL 대신 TQQQ 200일 추세(SOXL 은 손실 기준 지키면 연 +7%)."),
    dict(date="2026-10-01", tab="all", version="account 30/30/40", text="전체 계좌 국내 30%·코인 30%·미국 40% — +1% 달성일 69일/년, MDD −22%."),
    dict(date="2026-10-02", tab="crypto", version="coin_breakout_v1", text="③ 20일 추세 보유(여러 날) 중단 → 어제 고가 돌파 하루 단타(24시간 미만, 손절 −5%). 사용자 규칙: 보유 하루, 최대 5일."),
    dict(date="2026-10-02", tab="soxl", version="soxl_rsi2_meanrev_v1", text="④ TQQQ 추세(여러 날) 중단 → SOXL RSI(2) 과매도 반등, 다음 날 시가 매수 · 최대 5거래일. 하루 한정안은 0 근처라 그림자로."),
    dict(date="2026-10-02", tab="all", version="account 30/30/40", text="전체 계좌 새 구성 — 설계 +1% 달성일 33일/년 · MDD −16%, 최근 1년 44일 · +85%."),
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


def shadows(per_rows, soxl_rows):
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
        res = []
        for name, ver, kw, rule in (("평균 10일", "coin_bo_ma10", dict(ma=10), "추세 기준 10일 평균"),
                                    ("평균 50일", "coin_bo_ma50", dict(ma=50), "추세 기준 50일 평균"),
                                    ("손절 없음", "coin_bo_nostop", dict(stopPct=99.0), "손절 없이 다음 날 09:00 매도"),
                                    ("변동성 돌파 k=0.7", "coin_vb_k07", dict(level="vb", k=0.7), "기준선 = 오늘 시가 + 0.7 × 어제 (고가−저가)")):
            per, cal = {}, set()
            for m, H in per_rows.items():
                dv, _, _, days = coin_breakout(H, dict(COIN_BO, **kw))
                per[m] = (dv, None)
                cal |= set(days)
            cal = sorted(cal)
            b = {d: v * COIN_BO["tabSize"] for d, v in basket(per, cal).items()}
            res.append(dict(name=name, version=ver, rule=rule + " · BTC+ETH 반반 · 자금 80%", **split_metrics(b, cal, 365)))
        out["crypto"] = res
    except Exception as e:  # noqa: BLE001
        out["crypto"] = [dict(name="error", error=str(e))]
    try:
        days = [r[0] for r in soxl_rows]
        res = []
        for name, ver, kw, rule in (("하루 한정 (다음 날 시가 매도)", "soxl_rsi2_1d", dict(maxHoldDays=1), "같은 신호 · 다음 날 시가에 무조건 매도(보유 하루)"),
                                    ("RSI(2) < 10", "soxl_rsi2_th10", dict(rsiMax=10.0), "더 깊은 과매도만"),
                                    ("RSI(2) < 30", "soxl_rsi2_th30", dict(rsiMax=30.0), "더 얕은 과매도까지"),
                                    ("최대 3일", "soxl_rsi2_max3", dict(maxHoldDays=3), "3거래일 뒤 다음 시가 매도")):
            dv, _, _ = soxl_meanrev(soxl_rows, dict(SOXL_MR, **kw))
            res.append(dict(name=name, version=ver, rule=rule + " · 자금 50%",
                            **split_metrics({d: v * SOXL_MR["tabSize"] for d, v in dv.items()}, days, 252)))
        out["soxl"] = res
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
              "coin_bo_btc": lambda d: a["cryptoWeight"] * a["cryptoSize"] * 0.5,
              "coin_bo_eth": lambda d: a["cryptoWeight"] * a["cryptoSize"] * 0.5,
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


# ── GPT 와 같은 조건 비교: 같은 날짜(청산일) · 같은 시장 데이터 · 같은 비용표 ──
FAIR_COST = {"opening": 0.25, "daytrading_stock": 0.25, "daytrading_etf": 0.15, "crypto": 0.14, "soxl": 0.20}
FAIR_NOTE = ("두 전략 모두 매매마다 (청산가 ÷ 진입가 − 1) 총수익에서 같은 시장 같은 비용(왕복)을 뺀다. 하루 손익은 그날 청산한 매매의 "
             "자금 배분대로(여러 종목이면 균등, 코인은 클로드 두 코인 반반 · GPT 한 종목 전액), 칸 자금 100% 기준. 매매 없는 날 0%.")
REASON_KO = {"stop": "손절", "take_profit": "익절", "time_exit": "시간 청산", "trade": "다음 09시 청산", "exit": "반등 청산",
             "close": "종가 청산", "overnight": "다음 시가 청산"}


def _gross(e, x):
    try:
        e, x = float(e), float(x)
        return (x / e - 1) * 100 if e > 0 and x > 0 else None
    except (TypeError, ValueError):
        return None


def claude_trades(tab):
    """클로드 기준전략 매매 목록: {청산일: [dict(name, entry, exit, reason, gross)]} + 후보 수 {날짜: (후보, 통과)}."""
    by, cands = {}, {}
    if tab == "opening":
        q = {}
        for r in read_csv(DATA / "opening-gapdown-research/decisions.csv"):
            q[r["date"]] = int(r.get("rsiPassed") or 0)
            cands[r["date"]] = (int(r.get("gapDownCandidates") or 0), int(r.get("rsiPassed") or 0))
        for r in read_csv(DATA / "opening-gapdown-research/signals.csv"):
            if q.get(r["date"], 0) >= 5 and r.get("grossPnl") not in (None, ""):
                by.setdefault(r["date"], []).append(dict(name=r.get("name"), entry=float(r["entryPrice"]), exit=float(r["exitPrice"]),
                                                         reason="종가 청산", gross=float(r["grossPnl"])))
    elif tab == "daytrading":
        for r in read_csv(DATA / "etf-overnight-research/signals.csv"):
            by.setdefault(r["exitDate"], []).append(dict(name="KODEX 코스닥150레버리지", entry=float(r["entryPrice"]), exit=float(r["exitPrice"]),
                                                         reason="다음 시가 청산", gross=float(r["grossPnl"])))
    elif tab == "crypto":
        for m in COIN_BO["markets"]:
            for r in DECISIONS.get(m, []):
                d = r["date"]
                c = cands.get(d, (0, 0))
                cands[d] = (c[0] + 1, c[1] + (1 if str(r.get("trend")) in ("1", "True") else 0))
                if r.get("action") in ("trade", "stop") and r.get("entryPrice"):
                    x = r["exitPrice"] * (1 - COIN_BO["stopSlipPct"] / 100) if r["action"] == "stop" else r["exitPrice"]
                    exit_day = (date.fromisoformat(d) + timedelta(days=1)).isoformat()      # 다음 날 09:00 청산(손절은 그날 안이지만 같은 업비트 하루)
                    by.setdefault(exit_day if r["action"] == "trade" else d, []).append(
                        dict(name=m.replace("KRW-", ""), entry=r["entryPrice"], exit=x, reason="손절" if r["action"] == "stop" else "다음 09시 청산",
                             gross=_gross(r["entryPrice"], x), slot=0.5))
    elif tab == "soxl":
        for r in DECISIONS.get("SOXL", []):
            cands[r["date"]] = (1, 1 if r.get("next") == "buy_open" else 0)
            if r.get("action") == "exit" and r.get("exitPrice"):
                by.setdefault(r["date"], []).append(dict(name="SOXL", entry=r["entryPrice"], exit=r["exitPrice"],
                                                         reason=f"반등 청산 ({r.get('heldDays')}일)", gross=_gross(r["entryPrice"], r["exitPrice"])))
    return by, cands


def gpt_trades(tab):
    path = {"opening": "opening-history/baseline-trades.csv", "daytrading": "daytrading-research/baseline-trades.csv",
            "crypto": "crypto-research/baseline-trades.csv", "soxl": "soxl-research/baseline-trades.csv"}[tab]
    by, ver = {}, set()
    for r in read_csv(DATA / path):
        g = _gross(r.get("entryPrice"), r.get("exitPrice"))
        if g is None:
            continue
        by.setdefault(r["date"], []).append(dict(name=r.get("name") or ("BTC" if tab == "crypto" else r.get("code") or ""),
                                                 entry=float(r["entryPrice"]), exit=float(r["exitPrice"]),
                                                 reason=REASON_KO.get(r.get("reason"), r.get("reason") or ""), gross=g))
        ver.add(r.get("strategyVersion") or "")
    cands = {}
    if tab == "crypto":
        for r in read_csv(DATA / "crypto-research/baseline-decisions.csv"):
            cands[r["date"]] = (1, 1 if r.get("action") == "trade" else 0)
    return by, cands, sorted(v for v in ver if v)


def _side_day(trades, cost, slots=None):
    """그날 손익(칸 자금 100%): slot 이 있으면 그 몫(코인 반반), 없으면 균등 평균."""
    if not trades:
        return 0.0
    nets = [(t["gross"] - cost, t.get("slot")) for t in trades]
    if all(s is not None for _, s in nets):
        return sum(v * s for v, s in nets)
    return statistics.fmean(v for v, _ in nets)


def _side_summary(days, by, cost):
    trades = [t for d in days for t in by.get(d, [])]
    nets = [t["gross"] - cost for t in trades]
    dv = {d: _side_day(by[d], cost) for d in days if by.get(d)}
    g = goal_metrics(dv, days, 252) if days else {}
    return dict(tradeDays=len(dv), trades=len(trades), wins=sum(1 for v in nets if v > 0), losses=sum(1 for v in nets if v <= 0),
                winRate=(sum(1 for v in nets if v > 0) / len(nets) * 100) if nets else None,
                avgTradePct=statistics.fmean(nets) if nets else None, totalPct=g.get("totalPct"), plus1Days=g.get("plus1Days"),
                worstDayPct=g.get("worstDayPct") if dv else None, mddPct=g.get("mddPct"), avgDayPct=statistics.fmean(dv.values()) if dv else None)


def fair_compare(tab, calendar):
    """같은 날짜(GPT 기록이 있는 구간 ∩ 클로드 확정 구간) · 같은 비용표로 두 기준전략을 매매 단위부터 다시 계산한다."""
    cost = FAIR_COST["opening" if tab == "opening" else "crypto" if tab == "crypto" else "soxl" if tab == "soxl" else "daytrading_stock"]
    cby, ccand = claude_trades(tab)
    if tab == "daytrading":
        cost_c = FAIR_COST["daytrading_etf"]                 # ② 은 ETF(거래세 없음) — 같은 시장의 같은 상품 비용표
    else:
        cost_c = cost
    gby, gcand, gver = gpt_trades(tab)
    if not gby:
        return dict(available=False, note="GPT 기준전략 기록이 아직 없습니다.")
    cal = sorted(set(calendar))
    start, end = min(gby), max(gby)
    c_last = max([d for d in cal if d <= end] or [end])
    days = [d for d in cal if start <= d <= min(end, c_last)]
    rows = []
    for d in reversed(days[-20:]):
        rows.append(dict(date=d,
                         claude=dict(cands=ccand.get(d), entries=len(cby.get(d, [])), pnlPct=_side_day(cby.get(d, []), cost_c) if cby.get(d) else 0.0,
                                     trades=[dict(t, net=t["gross"] - cost_c) for t in cby.get(d, [])]),
                         gpt=dict(cands=gcand.get(d), entries=len(gby.get(d, [])), pnlPct=_side_day(gby.get(d, []), cost) if gby.get(d) else 0.0,
                                  trades=[dict(t, net=t["gross"] - cost) for t in gby.get(d, [])])))
    return dict(available=True, window=[days[0], days[-1]] if days else None, costPct=dict(claude=cost_c, gpt=cost), gptVersions=gver,
                note=FAIR_NOTE, claude=_side_summary(days, cby, cost_c), gpt=_side_summary(days, gby, cost), days=rows)


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
        for m in COIN_BO["markets"]:
            H = fetch_hourly(m)
            dv_m, dec_m, nxt_m, days_m = coin_breakout(H, dict(COIN_BO, version=COIN_BO["version"] + ":" + m))
            per[m], nexts[m] = (dv_m, set(days_m)), nxt_m
            cal_c |= set(days_m)
            write_csv(OUT / f"{m.split('-')[1].lower()}-bo-decisions.csv", dec_m)
            DECISIONS[m] = dec_m
            ROWS[m] = H
        cal_c = sorted(cal_c)
        CAL["coin"] = cal_c
        crypto_full = basket(per, cal_c)                     # 코인 칸 안에서 전액(두 코인 반반)
        tab_dv = {d: v * COIN_BO["tabSize"] for d, v in crypto_full.items()}
        report["tabs"]["crypto"] = tab_report("crypto", "③ BTC·ETH 어제 고가 돌파 하루 단타", COIN_BO["version"], COIN_BO["note"], tab_dv, cal_c, 365,
                                              extra=dict(nextSignals=nexts, params=COIN_BO))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["crypto"] = dict(error=str(e))
    us_full = {}
    try:
        sx = fetch_us(SOXL_MR["trade"])
        sdays = sorted(sx)
        CAL["us"] = sdays
        srows = [(d, *sx[d]) for d in sdays]
        dv_s, dec_s, nxt_s = soxl_meanrev(srows, SOXL_MR)
        us_full = dv_s
        write_csv(OUT / "soxl-mr-decisions.csv", dec_s)
        DECISIONS["SOXL"] = dec_s
        ROWS["SOXL"] = srows
        report["tabs"]["soxl"] = tab_report("soxl", "④ SOXL 단기 과매도 반등 (최대 5일)", SOXL_MR["version"], SOXL_MR["note"],
                                            {d: v * SOXL_MR["tabSize"] for d, v in dv_s.items()}, sdays, 252,
                                            extra=dict(nextSignal=nxt_s, params=SOXL_MR))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["soxl"] = dict(error=str(e))
    try:                                           # 옛 ④ TQQQ 추세(여러 날 보유 — 단타 규칙 위반으로 2026-10-02 중단). 기록만 남긴다.
        tq, qq = fetch_us(US["trade"]), fetch_us(US["signal"])
        udays = sorted(d for d in tq if d in qq)
        dv_u, dec_u, nxt_u = trend_daily([(d, *tq[d]) for d in udays], US, signal_close=[qq[d][3] for d in udays])
        write_csv(OUT / "tqqq-decisions.csv", dec_u)
        DECISIONS["TQQQ"] = dec_u
        ROWS["TQQQ"] = ([(d, *tq[d]) for d in udays], [qq[d][3] for d in udays])
        report["retired"] = dict(tqqq_trend200_v1=dict(reason="여러 날 보유 — 단타 규칙(하루, 최대 5일) 위반으로 2026-10-02 중단",
                                                     design=goal_metrics({d: v * US["tabSize"] for d, v in dv_u.items() if d <= DESIGN_END}, [d for d in udays if d <= DESIGN_END], 252)))
    except Exception as e:  # noqa: BLE001
        report["retired"] = dict(error=str(e))
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
    try:
        CAL["etf"] = etf_variant("233740", -3.0)[1]          # 국내 거래일 달력(ETF 일봉은 당일 저녁 확정)
    except Exception:  # noqa: BLE001
        CAL["etf"] = []
    report["daily"] = daily_board(report, d1, krx_cal, crypto_full, locals().get("cal_c") or [])
    try:
        report["paper"] = write_paper(report, d1, krx_cal, crypto_full, locals().get("us_full") or {}, locals().get("cal_c") or [])
    except Exception as e:  # noqa: BLE001
        report["paper"] = dict(error=str(e))
    try:
        report["shadows"] = shadows({m: ROWS[m] for m in COIN_BO["markets"] if m in ROWS}, ROWS.get("SOXL") or [])
    except Exception as e:  # noqa: BLE001
        report["shadows"] = dict(error=str(e))
    try:
        attach_promotions(report)
    except Exception as e:  # noqa: BLE001
        report["promotionError"] = str(e)
    try:
        report["week"] = week_summary(((report.get("paper") or {}).get("summary") or {}), datetime.now(KST).strftime("%Y-%m-%d"))
        report["weekRecon"] = week_recon(report, d1, krx_cal, crypto_full, locals().get("us_full") or {}, locals().get("cal_c") or [],
                                         datetime.now(KST).strftime("%Y-%m-%d"))
    except Exception as e:  # noqa: BLE001
        report["week"] = dict(error=str(e))
    report["fair"] = {}
    for tab, cal in (("opening", CAL.get("etf") or krx_cal), ("daytrading", CAL.get("etf") or krx_cal),
                     ("crypto", [(date.fromisoformat(d) + timedelta(days=1)).isoformat() for d in (CAL.get("coin") or [])]), ("soxl", CAL.get("us") or [])):
        try:
            report["fair"][tab] = fair_compare(tab, cal)
        except Exception as e:  # noqa: BLE001
            report["fair"][tab] = dict(available=False, error=str(e))
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
