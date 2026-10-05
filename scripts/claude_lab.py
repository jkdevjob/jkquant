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
import re
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
                if p.get("lastEntryHour") is not None and (s0 + timedelta(hours=k)).hour >= p["lastEntryHour"] and k < 15:
                    break                                          # 그림자: 밤(lastEntryHour 시 이후) 돌파는 사지 않는다
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


def soxl_meanrev(rows, p, entry_from=None, no_entry_from=None):
    """rows: (date, open, high, low, close). 판단은 i 일 확정 종가 → 실행은 i+1 일 시가(룩어헤드 없음).
    보유 중 일 손익: 매수일 = 종가/시가, 이후 = 종가/전일 종가, 매도일 = 시가/전일 종가. 비용은 매수·매도 때 반씩.
    p: rsiMax · rsiN(기본 2) · ma(0 이면 평균 조건 없음) · maxHoldDays. 메인 교체 구간: entry_from 전 / no_entry_from 부터는
    새로 사지 않는다(시가 매수 날짜 기준). 이미 든 포지션은 자기 규칙대로 판다."""
    D = [r[0] for r in rows]
    O, C = [r[1] for r in rows], [r[4] for r in rows]
    n, half, sz, rn = p["ma"], p["costRoundTripPct"] / 2, p["size"], int(p.get("rsiN") or 2)
    dv, decisions = {}, []
    pos = None                                     # dict(entry=i, days=n) — 보유 중이면
    pending = None                                 # "buy" | "sell" — 전날 종가에 정한 오늘 시가 주문

    def exec_date(i):                              # i 일 종가 판단이 실행되는 시가 날짜(마지막 날은 다음 달력일로 본다)
        return D[i + 1] if i + 1 < len(D) else (date.fromisoformat(D[i]) + timedelta(days=1)).isoformat()
    for i in range(max(n, rn + 1), len(rows)):
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
        ma = sum(C[i - n + 1:i + 1]) / n if n else None
        r2 = rsi2_at(C, i, rn)
        rec.update(rsi2=r2, ma=ma, close=C[i])
        if pos:
            if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"]:
                pending = "sell"
                rec["next"] = "sell_open" + ("_maxhold" if not C[i] > C[i - 1] else "")
        elif r2 < p["rsiMax"] and (ma is None or C[i] > ma):
            ed = exec_date(i)
            if (entry_from and ed < entry_from) or (no_entry_from and ed >= no_entry_from):
                rec["next"] = "blocked_main_switch"          # 메인 교체 구간 — 이 규칙으로는 새로 사지 않는다
            else:
                pending = "buy"
                rec["next"] = "buy_open"
        decisions.append(rec)
    nxt = dict(basedOn=D[-1], rsi2=decisions[-1]["rsi2"] if decisions else None, ma=decisions[-1]["ma"] if decisions else None,
               close=C[-1], holding=bool(pos), heldDays=pos["days"] if pos else 0, action=pending or "none",
               holdNext=pending == "buy" or (bool(pos) and pending != "sell"),
               rsiMax=p["rsiMax"], rsiN=rn, maDays=n, maxHoldDays=p["maxHoldDays"], version=p.get("version")) if rows else None
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
    if not pre.get("picks") or (q is not None and q < main_for("opening", d)["params"]["minQ"]):
        return "no_trade"
    return "pending"


def d1_live_reason(d):
    j = read_json(DATA / "opening-gapdown-live" / f"{d}.json") or {}
    pre = next((e.get("payload") or {} for e in ((j.get("ledger") or {}).get("events") or []) if e and e.get("stage") == "preopen"), {})
    q = (pre.get("breadth") or {}).get("qualified")
    mq = main_for("opening", d)["params"]["minQ"]
    if q is not None and q < mq and pre.get("picks"):
        return f"통과 {q}종목 < {mq} (메인 기준 매매일 아님)"
    return pre.get("decisionReason") or (f"통과 {q}종목 < {mq} (메인 기준 매매일 아님)" if q is not None else "")


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
    mo, md, mc, ms = (main_for(t) for t in TABS4)
    add("시초가", "claude", mo["name"], mo["version"], d1, kp, kl, final_kr,
        plan=f"명단 {len(wl.get('names') or [])}종목 · 08:56 예상갭 확인 (통과 {mo['params']['minQ']}종목 이상일 때 매매)", live=d1_live_status)
    g, gv, _ = gpt_daily("opening")
    add("시초가", "gpt", "시초가 돌파", ", ".join(gv), g, kp, kl)
    add("데이트레이딩", "claude", md["name"], md["version"], ETF_PW, kp, kl,
        plan=f"15:21 예상 종가 {md['params']['th']:g}% 이하면 종가 매수 → 다음 날 시가 매도".replace("-", "−"))
    g, gv, _ = gpt_daily("daytrading")
    add("데이트레이딩", "gpt", "데이트레이딩", ", ".join(gv), g, kp, kl)
    c = tabs.get("crypto") or {}
    nx = c.get("nextSignals") or {}
    add("비트코인", "claude", mc["name"], mc["version"], {d: v * mc["params"]["tabSize"] for d, v in crypto_full.items()}, cp, cl,
        plan=" · ".join(f"{m.split('-')[1]} {'돌파 감시' if n.get('trendNext') else '쉼'}" for m, n in nx.items()))
    g, gv, _ = gpt_daily("crypto")
    add("비트코인", "gpt", "비트코인", ", ".join(gv), g, cp, cl)
    sx = tabs.get("soxl") or {}
    udec = DECISIONS.get("SOXL") or []
    sdv = {r["date"]: float(r["pnlPct"]) * ms["params"]["tabSize"] for r in udec if r.get("pnlPct") not in (None, "", "None")}
    sp, sl = last_two([r["date"] for r in udec])
    nx = sx.get("nextSignal") or {}
    plan = {"buy": "다음 미국장 시가 매수", "sell": "다음 미국장 시가 매도"}.get(nx.get("action"), "보유 중" if nx.get("holding") else "쉼 (과매도 신호 없음)")
    add("SOXL", "claude", ms["name"], ms["version"], sdv, sp, sl, plan=plan + f" · 자금 {ms['params']['tabSize'] * 100:.0f}%")
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
    mk = lambda tab, d: (lambda e: dict(strategy=e["name"], strategyVersion=e["version"], params=e["params"]))(main_for(tab, d))   # 그날 메인 · 당시 변수
    o1 = [(d, dict(date=d, **mk("opening", d),
                   action="trade" if d in d1 else "no_trade", pnlPct=d1.get(d, 0.0), source="kis-vts+final-daily-bars",
                   liveFills=live_d1.get(d, []), recordedAt=now))
          for d in krx_cal if st("opening_d1v2") <= d <= final_kr]
    # 확정 일봉 전이라도 VTS 원본이 '매매 없음'으로 끝낸 날은 바로 기록한다(매매가 없었으니 가격을 기다릴 이유가 없다)
    o1 += [(d, dict(date=d, **mk("opening", d), action="no_trade", pnlPct=0.0,
                    source="kis-vts-ledger", decisionReason=d1_live_reason(d), recordedAt=now))
           for d in kr_days if d > final_kr and d >= st("opening_d1v2") and d1_live_status(d) == "no_trade"]
    out["opening_d1v2"] = sorted(o1)
    etf = ETF_PW
    etf_live = {r.get("exitDate"): r for r in (etf_meta.get("live") or {}).get("rows", [])}
    out["daytrading_etf"] = [(d, dict(date=d, **mk("daytrading", d),
                                      action="trade" if d in etf else "no_trade", pnlPct=etf.get(d, 0.0), source="kis-vts+daily-bars",
                                      live=etf_live.get(d), recordedAt=now))
                             for d in kr_days if st("daytrading_etf") <= d <= etf_to]
    for key, m in (("coin_bo_btc", "KRW-BTC"), ("coin_bo_eth", "KRW-ETH")):
        out[key] = [(r["date"], dict(r, strategy="③ " + m.split("-")[1] + " · " + main_for("crypto", r["date"])["name"] + " (칸 안 몫)",
                                      params=main_for("crypto", r["date"])["params"], source="paper-upbit-hourly", recordedAt=now,
                                      pnlPct=r.get("pnlPct") or 0.0, action=r["action"] if r["action"] in ("trade", "stop") else "no_trade"))
                    for r in DECISIONS.get(m, []) if r["date"] >= st(key)]
    out["us_soxl"] = [(r["date"], dict(r, strategy=main_for("soxl", r["date"])["name"] + " (칸 안 전액)", params=main_for("soxl", r["date"])["params"],
                                       source="paper-us-daily", recordedAt=now,
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


def kr_calendar(now=None, fetch=None):
    """국내 거래일 달력(233740 일봉 날짜). 오늘은 장이 끝난 16:00 뒤, 오늘 봉이 있을 때만 넣는다(장중 봉은 거래일 확정이 아니다)."""
    now = now or datetime.now(KST)
    if fetch is None:
        import FinanceDataReader as fdr
        fetch = lambda: [str(i)[:10] for i, r in fdr.DataReader("233740", "2016-01-01").iterrows() if float(r["Open"]) > 0]
    today = now.strftime("%Y-%m-%d")
    days = fetch()
    return [d for d in days if d < today or (d == today and now.hour >= 16)]


def etf_variant(code, th):
    import FinanceDataReader as fdr
    now = datetime.now(KST)
    today, closed = now.strftime("%Y-%m-%d"), now.hour >= 16           # 연구(backtest_etf_overnight)와 같게: 오늘 봉은 장 끝난 16:00 뒤에만
    d = fdr.DataReader(code, "2016-01-01")
    b = [(str(i)[:10], float(r["Open"]), float(r["Close"])) for i, r in d.iterrows()
         if float(r["Open"]) > 0 and float(r["Close"]) > 0 and (str(i)[:10] < today or (str(i)[:10] == today and closed))]
    out = {}
    for i in range(1, len(b) - 1):
        chg = (b[i][2] / b[i - 1][2] - 1) * 100
        if abs(chg) <= 35 and chg <= th:                              # 연구와 같은 경계(35% 넘는 값은 액면분할 등 자료 오류로 본다)
            tick = 5 if b[i][2] >= 2000 else 1
            out[b[i + 1][0]] = (b[i + 1][1] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100)
    return out, [x[0] for x in b]


# ── 메인 전략 · 그림자 후보 ─────────────────────────────────────────────────────────────
# 탭마다 메인(실제로 모의매매·장부·텔레그램에 쓰는 규칙) 하나 + 그림자 10개 이상. 모두 같은 함수·같은 비용으로 계산해 순위를 매긴다.
# 메인 교체 = 사용자가 화면의 승격 버튼을 누른 기록(Worker claude-config, 덮어쓰지 않고 쌓기만). 다음 날부터 적용 —
# 이 밤 계산 · 실시간 화면 · 하루 마감 장부 · ② VTS 주문이 모두 같은 기록을 읽는다. 지난 장부는 그때 규칙 그대로 둔다.
TABS4 = ("opening", "daytrading", "crypto", "soxl")
D1_DEFAULT = dict(minQ=5, topK=3, gapMax=None)
ETF_DEFAULT = dict(code="233740", th=-3.0)
COIN_KEYS = ("ma", "stopPct", "level", "k", "lastEntryHour", "tabSize", "markets")
SOXL_KEYS = ("rsiMax", "rsiN", "ma", "maxHoldDays", "tabSize")
MAIN_DEFAULT = {
    "opening": dict(version="opening_gapdown_v1+v2filter", name="① D-1 갭하락 과매도 v2", params=dict(D1_DEFAULT),
                    rule="전일 RSI<30 + 시가 갭 −2~−29% 종목이 5개 이상인 날, 가장 깊은 3종목 시가 매수 → 종가 매도"),
    "daytrading": dict(version="etf_dip_overnight_v1", name="② 코스닥150 레버리지 하락일 야간", params=dict(ETF_DEFAULT),
                       rule="KODEX 코스닥150레버리지가 −3% 이하로 마감한 날 종가 매수 → 다음 날 시가 매도 (거래세 없음)"),
    "crypto": dict(version="coin_breakout_v1", name="③ BTC·ETH 어제 고가 돌파 하루 단타", params=dict({k: COIN_BO.get(k) for k in COIN_KEYS}),
                   rule=COIN_BO["note"]),
    "soxl": dict(version="soxl_rsi2_meanrev_v1", name="④ SOXL 단기 과매도 반등 (최대 5일)", params={k: dict(SOXL_MR, rsiN=2)[k] for k in SOXL_KEYS},
                 rule=SOXL_MR["note"]),
}
_PARAM_KEYS = {"opening": tuple(D1_DEFAULT), "daytrading": tuple(ETF_DEFAULT), "crypto": COIN_KEYS, "soxl": SOXL_KEYS}

# (버전, 이름, 규칙 설명, 기본값에서 바꾸는 값, 승격 가능 여부 · 불가 사유)
_OPEN_ONLY = "주문 경로가 같은 규칙만 승격 가능"
CATALOG = {
    "opening": [
        ("opening_d1_min1", "통과 1개 이상 (매일)", "v2 필터 없이 조건 맞는 날 매일 깊은 3종목", dict(minQ=1), None),
        ("opening_d1_min2", "통과 2개 이상", "조건 통과 종목 2개 이상인 날만", dict(minQ=2), None),
        ("opening_d1_min3", "통과 3개 이상", "조건 통과 종목 3개 이상인 날만", dict(minQ=3), None),
        ("opening_d1_min4", "통과 4개 이상", "조건 통과 종목 4개 이상인 날만", dict(minQ=4), None),
        ("opening_d1_min6", "통과 6개 이상", "더 강한 투매일만", dict(minQ=6), None),
        ("opening_d1_min7", "통과 7개 이상", "더 강한 투매일만", dict(minQ=7), None),
        ("opening_d1_min8", "통과 8개 이상", "아주 강한 투매일만", dict(minQ=8), None),
        ("opening_d1_min5_top1", "통과 5개↑ · 가장 깊은 1종목", "v2 날 가장 깊은 갭 1종목에 자금 전부", dict(topK=1), None),
        ("opening_d1_min5_top2", "통과 5개↑ · 깊은 2종목", "v2 날 가장 깊은 갭 2종목에 반씩", dict(topK=2), None),
        ("opening_d1_min5_gap3", "통과 5개↑ · 갭 −3% 이하만", "v2 날 3종목 중 갭이 −3% 이하인 종목만", dict(gapMax=-3.0), None),
        ("opening_d1_min3_top1", "통과 3개↑ · 가장 깊은 1종목", "통과 3개 이상인 날 가장 깊은 1종목", dict(minQ=3, topK=1), None),
    ],
    "daytrading": [
        ("etf_dip_th15", "−1.5% 이하 마감", "코스닥150 레버리지 −1.5% 이하 마감이면 종가 매수", dict(th=-1.5), None),
        ("etf_dip_overnight_th2", "−2% 이하 마감", "−2% 이하 마감이면 종가 매수", dict(th=-2.0), None),
        ("etf_dip_th25", "−2.5% 이하 마감", "−2.5% 이하 마감이면 종가 매수", dict(th=-2.5), None),
        ("etf_dip_th35", "−3.5% 이하 마감", "−3.5% 이하 마감이면 종가 매수", dict(th=-3.5), None),
        ("etf_dip_overnight_th4", "−4% 이하 마감", "−4% 이하 마감이면 종가 매수", dict(th=-4.0), None),
        ("etf_dip_th45", "−4.5% 이하 마감", "−4.5% 이하 마감이면 종가 매수", dict(th=-4.5), None),
        ("etf_dip_th5", "−5% 이하 마감", "−5% 이하 마감이면 종가 매수", dict(th=-5.0), None),
        ("etf_dip_overnight_k200", "코스피200 레버리지 −3%", "KODEX 레버리지(122630) −3% 이하 마감이면 매수", dict(code="122630", th=-3.0),
         "다른 종목(122630) — 매수·매도 주문 경로가 233740 전용이라 승격하려면 주문 경로 작업이 먼저"),
        ("etf_dip_k200_th2", "코스피200 레버리지 −2%", "KODEX 레버리지(122630) −2% 이하 마감이면 매수", dict(code="122630", th=-2.0),
         "다른 종목(122630) — 매수·매도 주문 경로가 233740 전용이라 승격하려면 주문 경로 작업이 먼저"),
        ("etf_dip_kq150_th15", "코스닥150 (1배) −1.5%", "KODEX 코스닥150(229200) −1.5% 이하 마감이면 매수", dict(code="229200", th=-1.5),
         "다른 종목(229200) — 매수·매도 주문 경로가 233740 전용이라 승격하려면 주문 경로 작업이 먼저"),
    ],
    "crypto": [
        ("coin_bo_ma10", "평균 10일", "추세 기준 10일 평균", dict(ma=10), None),
        ("coin_bo_ma30", "평균 30일", "추세 기준 30일 평균", dict(ma=30), None),
        ("coin_bo_ma50", "평균 50일", "추세 기준 50일 평균", dict(ma=50), None),
        ("coin_bo_stop3", "손절 −3%", "매수가 −3% 손절", dict(stopPct=3.0), None),
        ("coin_bo_stop8", "손절 −8%", "매수가 −8% 손절", dict(stopPct=8.0), None),
        ("coin_bo_nostop", "손절 없음", "손절 없이 다음 날 09:00 매도", dict(stopPct=99.0), None),
        ("coin_vb_k05", "변동성 돌파 k=0.5", "기준선 = 오늘 시가 + 0.5 × 어제 (고가−저가)", dict(level="vb", k=0.5), None),
        ("coin_vb_k07", "변동성 돌파 k=0.7", "기준선 = 오늘 시가 + 0.7 × 어제 (고가−저가)", dict(level="vb", k=0.7), None),
        ("coin_bo_before21", "21시 전 돌파만", "밤 9시 이후 돌파는 사지 않음", dict(lastEntryHour=21), None),
        ("coin_bo_btc_only", "BTC 만", "BTC 한 코인에 칸 전액", dict(markets=["KRW-BTC"]), None),
        ("coin_bo_eth_only", "ETH 만", "ETH 한 코인에 칸 전액", dict(markets=["KRW-ETH"]), None),
        ("coin_vb_k05_before21", "변동성 돌파 k=0.5 · 21시 전", "변동성 돌파 + 밤 9시 이후 돌파는 사지 않음", dict(level="vb", k=0.5, lastEntryHour=21), None),
    ],
    "soxl": [
        ("soxl_rsi2_th10", "RSI(2) < 10", "더 깊은 과매도만", dict(rsiMax=10.0), None),
        ("soxl_rsi2_th25", "RSI(2) < 25", "조금 얕은 과매도까지", dict(rsiMax=25.0), None),
        ("soxl_rsi2_th30", "RSI(2) < 30", "더 얕은 과매도까지", dict(rsiMax=30.0), None),
        ("soxl_rsi2_ma100", "100일 평균 위", "추세 조건을 100일 평균으로", dict(ma=100), None),
        ("soxl_rsi2_ma150", "150일 평균 위", "추세 조건을 150일 평균으로", dict(ma=150), None),
        ("soxl_rsi2_noma", "평균 조건 없음", "200일 평균 조건 없이 과매도면 매수", dict(ma=0), None),
        ("soxl_rsi2_1d", "하루 한정", "같은 신호 · 다음 날 시가에 무조건 매도(보유 하루)", dict(maxHoldDays=1), None),
        ("soxl_rsi2_max2", "최대 2일", "2거래일 뒤 다음 시가 매도", dict(maxHoldDays=2), None),
        ("soxl_rsi2_max3", "최대 3일", "3거래일 뒤 다음 시가 매도", dict(maxHoldDays=3), None),
        ("soxl_rsi3_th20", "RSI(3) < 20", "RSI 기간 3일", dict(rsiN=3), None),
        ("soxl_rsi2_th25_max3", "RSI(2) < 25 · 최대 3일", "조금 얕은 과매도 + 3거래일 한도", dict(rsiMax=25.0, maxHoldDays=3), None),
    ],
}
MAIN_EVENTS = []          # 승격 기록(효력일 순) — main() 이 data/claude-lab/main-config.json 사본에서 읽는다


def _clean_params(tab, params):
    return {k: params[k] for k in _PARAM_KEYS[tab] if k in (params or {})}


def _valid_params(tab, p):
    """_claude_main.js validateParams 와 같은 범위 — 주문 경로가 그대로 실행할 수 있는 변수만(보유 최대 5일 · ② 233740 전용)."""
    def num(v, lo, hi, integer=False):
        x = float(v)
        if not (lo <= x <= hi) or (integer and x != int(x)):
            raise ValueError(f"범위 밖 {v}")
        return int(x) if integer else x
    if tab == "opening":
        return dict(minQ=num(p["minQ"], 1, 30, True), topK=num(p["topK"], 1, 3, True), gapMax=None if p.get("gapMax") is None else num(p["gapMax"], -29, -2))
    if tab == "daytrading":
        if str(p["code"]) != "233740":
            raise ValueError("② 233740 전용")
        return dict(code="233740", th=num(p["th"], -10, -0.5))
    if tab == "crypto":
        mk = [str(m) for m in p.get("markets") or []]
        if not mk or any(m not in ("KRW-BTC", "KRW-ETH") for m in mk) or len(set(mk)) != len(mk) or p.get("level") not in ("prevhigh", "vb"):
            raise ValueError("코인 변수 오류")
        return dict(ma=num(p["ma"], 2, 200, True), stopPct=num(p["stopPct"], 0.5, 99), level=p["level"], k=num(p["k"], 0, 2),
                    lastEntryHour=None if p.get("lastEntryHour") is None else num(p["lastEntryHour"], 10, 23, True), tabSize=num(p["tabSize"], 0.1, 1), markets=mk)
    if tab == "soxl":
        return dict(rsiMax=num(p["rsiMax"], 1, 50), rsiN=num(p["rsiN"], 2, 5, True), ma=num(p["ma"], 0, 250, True),
                    maxHoldDays=num(p["maxHoldDays"], 1, 5, True), tabSize=num(p["tabSize"], 0.1, 1))
    raise ValueError("탭 오류")


def load_main_events(path=None):
    """Worker claude-config 사본 → 유효한 승격 기록만(탭·버전·효력일·변수). 알 수 없는 변수는 버린다."""
    j = read_json(path or (OUT / "main-config.json")) or {}
    out = []
    for e in j.get("events") or []:
        e = (e or {}).get("payload") or e or {}
        if e.get("tab") in TABS4 and e.get("version") and re.match(r"^\d{4}-\d{2}-\d{2}$", str(e.get("effectiveFrom") or "")):
            try:
                params = _valid_params(e["tab"], dict(MAIN_DEFAULT[e["tab"]]["params"], **_clean_params(e["tab"], e.get("params"))))
            except (ValueError, KeyError, TypeError):
                continue                                    # 검사에 떨어진 기록은 쓰지 않는다(JS 와 같게)
            out.append(dict(tab=e["tab"], version=str(e["version"]), name=str(e.get("name") or e["version"]), rule=str(e.get("rule") or ""),
                            effectiveFrom=e["effectiveFrom"], promotedAt=str(e.get("promotedAt") or ""), params=params))
    return sorted(out, key=lambda e: (e["effectiveFrom"], e["promotedAt"]))


def main_for(tab, d=None):
    """d(그 시장의 날짜)에 유효한 메인. d=None 이면 가장 최근 승격(내일부터 적용분 포함) = 다음에 매매할 규칙."""
    best = None
    for e in MAIN_EVENTS:
        if e["tab"] == tab and (d is None or e["effectiveFrom"] <= d):
            best = e
    if best:
        return dict(best)
    m = MAIN_DEFAULT[tab]
    return dict(tab=tab, version=m["version"], name=m["name"], rule=m["rule"], effectiveFrom=None, params=dict(m["params"]))


def catalog(tab):
    """기본 메인 + 그림자 목록(모두 전체 변수). 지금 메인이 그림자 중 하나여도 같은 목록에서 고른다."""
    m = MAIN_DEFAULT[tab]
    rows = [dict(version=m["version"], name="기본 · " + m["name"], rule=m["rule"], params=dict(m["params"]), promotable=True, blocked=None)]
    for ver, name, rule, kw, blocked in CATALOG[tab]:
        rows.append(dict(version=ver, name=name, rule=rule, params=dict(m["params"], **kw), promotable=blocked is None, blocked=blocked))
    return rows


# ── 변수로 계산하는 전략 시계열 (메인·그림자 모두 이 함수들만 쓴다) ──
def d1_series(p):
    """① 연구 신호(하루 최대 3종목, 갭 깊은 순)에서: 통과 종목 수 ≥ minQ 인 날, 갭 ≤ gapMax 인 것 중 깊은 topK 종목 평균."""
    q = {r["date"]: int(r.get("rsiPassed") or 0) for r in read_csv(DATA / "opening-gapdown-research/decisions.csv")}
    by = {}
    for r in read_csv(DATA / "opening-gapdown-research/signals.csv"):
        by.setdefault(r["date"], []).append((float(r.get("gapPct") or 0.0), float(r["pnl"])))
    out = {}
    for d, sig in by.items():
        if q.get(d, 0) < p["minQ"]:
            continue
        s = sorted(sig)
        if p.get("gapMax") is not None:
            s = [x for x in s if x[0] <= p["gapMax"]]
        s = s[:int(p["topK"])]
        if s:
            out[d] = statistics.fmean(v for _, v in s)
    return out, sorted(q)


ETF_CACHE = {}


def etf_series(p):
    """② 종가 하락 기준 th 이하 마감 → 종가 매수 → 다음 거래일 시가 매도. 기본값이면 연구 결과(같은 식·같은 비용)를 그대로 쓴다."""
    if p["code"] == ETF_DEFAULT["code"] and float(p["th"]) == ETF_DEFAULT["th"]:
        return etf_daily()
    key = (p["code"], float(p["th"]))
    if key not in ETF_CACHE:
        ETF_CACHE[key] = etf_variant(p["code"], float(p["th"]))[0]
    return ETF_CACHE[key]


def coin_series(p, rows_by_market):
    """③ 시장별 coin_breakout → 칸 안 고정 몫(1/코인 수) 합 → 탭 자금(tabSize) 반영. (탭값, 칸값, 시장별 기록, 다음 판단, 달력)"""
    per, decs, nexts, cal = {}, {}, {}, set()
    for m in p["markets"]:
        if m not in rows_by_market:
            continue
        dv, dec, nx, days = coin_breakout(rows_by_market[m], dict(COIN_BO, **{k: v for k, v in p.items() if k != "version"},
                                                                  version=p.get("version", COIN_BO["version"]) + ":" + m))
        per[m], decs[m], nexts[m] = (dv, set(days)), dec, nx
        cal |= set(days)
    cal = sorted(cal)
    full = basket(per, cal)
    return {d: v * p["tabSize"] for d, v in full.items()}, full, decs, nexts, cal


def soxl_series(p, srows, entry_from=None, no_entry_from=None):
    dv, dec, nx = soxl_meanrev(srows, dict(SOXL_MR, **p), entry_from, no_entry_from)
    return {d: v * p["tabSize"] for d, v in dv.items()}, dv, dec, nx


def piecewise(tab, series_of):
    """날짜마다 그날 유효한 메인의 값 — 지난 날은 그때 메인, 효력일부터 새 메인. series_of(params) → {날짜: 값}.
    승격 기록이 없으면 기본 메인 하나 그대로."""
    vers = [main_for(tab, "0000-00-00")] + [e for e in MAIN_EVENTS if e["tab"] == tab]
    if len(vers) == 1:
        return dict(series_of(vers[0]["params"]))
    cache = {}
    for v in vers:
        if v["version"] not in cache:
            cache[v["version"]] = series_of(v["params"])
    out = {}
    for d in sorted(set().union(*cache.values())):
        val = cache[main_for(tab, d)["version"]].get(d)
        if val is not None:
            out[d] = val
    return out


def soxl_piecewise(srows):
    """④ 메인 교체는 앞 규칙이 포지션을 다 판 뒤에 시작한다(최대 5일 보유라 겹치지 않게).
    앞 규칙: 효력일부터 새로 사지 않음 → 처음으로 '그날 시작에 보유 없음'인 거래일이 교체일 → 새 규칙은 교체일부터 산다."""
    evs = [e for e in MAIN_EVENTS if e["tab"] == "soxl"]
    m0 = main_for("soxl", "0000-00-00")
    cur = dict(m0["params"], version=m0["version"])                      # 기록마다 그때 메인 버전이 찍히게
    start, dv_all, full_all, dec_all, nx, switches = None, {}, {}, [], None, []
    for e in evs:
        dv, full, dec, nx_old = soxl_series(cur, srows, start, e["effectiveFrom"])
        held = {r["date"] for r in dec if r["action"] in ("hold", "exit")}
        sw = next((r[0] for r in srows if r[0] >= e["effectiveFrom"] and r[0] not in held), None)
        keep = (lambda d: d < sw) if sw else (lambda d: True)
        dv_all.update({d: v for d, v in dv.items() if keep(d)})
        full_all.update({d: v for d, v in full.items() if keep(d)})
        dec_all += [r for r in dec if keep(r["date"])]
        switches.append(dict(version=e["version"], effectiveFrom=e["effectiveFrom"], switchDate=sw))
        if not sw:                                   # 앞 규칙이 아직 들고 있다 — 새 규칙은 판 다음 날부터
            return dv_all, full_all, dec_all, dict(nx_old, pendingSwitch=e["version"]), switches
        start, cur = sw, dict(e["params"], version=e["version"])
    dv, full, dec, nx = soxl_series(cur, srows, start)
    dv_all.update({d: v for d, v in dv.items() if not start or d >= start})
    full_all.update({d: v for d, v in full.items() if not start or d >= start})
    dec_all += [r for r in dec if not start or r["date"] >= start]
    return dv_all, full_all, sorted(dec_all, key=lambda r: r["date"]), nx, switches


# ── 전략 경쟁(아레나) — 자동 퇴출 · 신규 투입 · 7일 1위 자동 승격 ──────────────────────────
# 밤 계산마다: 탭별 경쟁군(메인 + 그림자 10개 이상)을 같은 함수·같은 비용으로 계산 → 점수 순위 → 날짜별 1위 기록.
#  · 퇴출: 손실 기준(MDD ≥ −25% · 최악일 ≥ −15% · 기대값 > 0) 미달, 또는 7일 연속 하위 3위. 경쟁군은 10개 밑으로 줄이지 않는다.
#  · 신규 투입: 상위 3개 전략의 변수를 한 칸씩 바꾼 이웃(없으면 정해 둔 변수 격자 순서)에서, 아직 안 써 본 것만. 손실 기준 통과해야 들어온다.
#  · 자동 승격: 같은 그림자가 7일(달력) 동안 매일 1위면 Worker 메인 기록에 쌓는다 → 다음 날부터 메인(주문·장부·텔레그램 모두).
#  모든 변수는 주문 경로가 그대로 실행할 수 있는 범위(_valid_params)만 쓴다. 상태·이력은 data/claude-lab/arena.json(밤 계산이 커밋).
ARENA_PATH = OUT / "arena.json"
POOL_TARGET, POOL_MIN, PROMOTE_DAYS, BOTTOM_N, GEN_ATTEMPTS = 12, 10, 7, 3, 40
ARENA_RULE = ("점수 = 주 평균 수익(복리)을 전체 기간 · 최근 1년 · 최근 90일 세 구간에서 낸 평균(최근 흐름이 반영된다). "
              "손실 기준(전체 기간 MDD ≥ −25% · 최악일 ≥ −15% · 기대값 > 0)을 못 지키면 순위 맨 뒤 · 그림자는 퇴출. "
              "7일 연속 하위 3위도 퇴출. 빈자리는 상위 전략의 변수를 한 칸씩 바꾼 새 전략으로 채워 그림자 10~12개를 유지. "
              "같은 그림자가 7일 동안 매일 1위면 다음 날부터 메인으로 자동 승격(주문·장부·텔레그램이 모두 따라간다).")
GRID = {
    "opening": dict(minQ=list(range(1, 13)), topK=[1, 2, 3], gapMax=[None, -3.0, -4.0, -5.0, -6.0]),
    "daytrading": dict(th=[round(-1.0 - 0.25 * i, 2) for i in range(29)]),
    "crypto": dict(ma=[5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100], stopPct=[2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 99.0], level=["prevhigh", "vb"],
                   k=[0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0], lastEntryHour=[None, 12, 15, 18, 21],
                   markets=[["KRW-BTC", "KRW-ETH"], ["KRW-BTC"], ["KRW-ETH"]]),
    "soxl": dict(rsiMax=[5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0], rsiN=[2, 3, 4], ma=[0, 50, 100, 150, 200], maxHoldDays=[1, 2, 3, 4, 5]),
}


def _canon(tab, p):
    """같은 변수면 같은 전략 — 버전 이름을 변수로 만든다(이름이 같으면 다시 만들지 않는다)."""
    p = _valid_params(tab, dict(MAIN_DEFAULT[tab]["params"], **p))
    if tab == "crypto" and p["level"] == "prevhigh":
        p["k"] = 0.5                                             # 어제 고가 기준이면 k 는 쓰지 않는다
    return p


def gen_version(tab, p):
    if tab == "opening":
        return f"g_open_q{p['minQ']}_k{p['topK']}" + (f"_gap{abs(p['gapMax']):g}" if p.get("gapMax") is not None else "")
    if tab == "daytrading":
        return f"g_etf_th{abs(p['th']):g}"
    if tab == "crypto":
        mk = "both" if len(p["markets"]) == 2 else p["markets"][0].split("-")[1].lower()
        return (f"g_coin_ma{p['ma']}_s{p['stopPct']:g}_" + ("hi" if p["level"] == "prevhigh" else f"vb{p['k']:g}")
                + (f"_h{p['lastEntryHour']}" if p.get("lastEntryHour") is not None else "") + f"_{mk}")
    return f"g_soxl_r{p['rsiN']}lt{p['rsiMax']:g}_ma{p['ma']}_d{p['maxHoldDays']}"


def describe(tab, p):
    """사람이 읽는 이름 · 규칙(변수에서 그대로 만든다)."""
    if tab == "opening":
        g = f" · 갭 {p['gapMax']:g}% 이하만" if p.get("gapMax") is not None else ""
        return (f"통과 {p['minQ']}개↑ · 깊은 {p['topK']}종목{g}",
                f"전일 RSI<30 명단 중 시가 갭 −2~−29% 종목이 {p['minQ']}개 이상인 날, 갭 깊은 {p['topK']}종목{g} 시가 매수 → 종가 매도")
    if tab == "daytrading":
        return (f"{p['th']:g}% 이하 마감".replace("-", "−"),
                f"KODEX 코스닥150레버리지가 {p['th']:g}% 이하로 마감한 날 종가 매수 → 다음 날 시가 매도".replace("-", "−"))
    if tab == "crypto":
        lv = "어제 고가" if p["level"] == "prevhigh" else f"시가+{p['k']:g}×어제 폭"
        mk = "BTC·ETH 반반" if len(p["markets"]) == 2 else p["markets"][0].split("-")[1] + " 만"
        h = f" · {p['lastEntryHour']}시 전 돌파만" if p.get("lastEntryHour") is not None else ""
        st = "손절 없음" if p["stopPct"] >= 99 else f"손절 −{p['stopPct']:g}%"
        return (f"평균 {p['ma']}일 · {lv} 돌파 · {st}{h} · {mk}",
                f"어제 종가 > {p['ma']}일 평균인 날, {lv}를 넘는 순간 매수 → 다음 날 09:00 매도 · {st}{h} · {mk} · 탭 자금 {p['tabSize'] * 100:.0f}%")
    ma = f" · {p['ma']}일 평균 위" if p["ma"] else ""
    return (f"RSI({p['rsiN']}) < {p['rsiMax']:g}{ma} · 최대 {p['maxHoldDays']}일",
            f"확정 종가 RSI({p['rsiN']}) < {p['rsiMax']:g}{ma}면 다음 시가 매수 → 오른 날 다음 시가 매도, 최대 {p['maxHoldDays']}거래일 · 탭 자금 {p['tabSize'] * 100:.0f}%")


def score_metrics(dv, cal, per):
    """전체 · 최근 1년 · 최근 90일(마지막 날 기준) 목표 지표와 점수(세 구간 주 평균의 평균)."""
    cal = sorted(set(cal))
    if not cal:
        return dict(full={}, year={}, d90={}, oos={}, score=None)
    end = date.fromisoformat(cal[-1])
    win = lambda days: [d for d in cal if d > (end - timedelta(days=days)).isoformat()]
    sub = lambda c: goal_metrics({d: v for d, v in dv.items() if d in set(c)}, c, per)
    full, year, d90 = goal_metrics(dv, cal, per), sub(win(365)), sub(win(90))
    oos = sub([d for d in cal if d > DESIGN_END])
    ws = [m.get("weeklyAvgPct") for m in (full, year, d90)]
    return dict(full=full, year=year, d90=d90, oos=oos, score=statistics.fmean(w or 0.0 for w in ws))


def gate_ok(m):
    return bool((m.get("full") or {}).get("gate"))


def arena_eval(tab, entry, ctx):
    """한 전략 계산(같은 함수·같은 비용) — ctx: 시장 자료."""
    p = dict(entry["params"], version=entry["version"])
    if tab == "opening":
        dv, cal = d1_series(p)
        per = 250
    elif tab == "daytrading":
        dv, cal, per = etf_series(p), ctx["kr_cal"], 250
    elif tab == "crypto":
        r = coin_series(p, ctx["coin"])
        dv, cal, per = r[0], r[4], 365
    else:
        dv, cal, per = soxl_series(p, ctx["soxl"])[0], [x[0] for x in ctx["soxl"]], 252
    return score_metrics(dv, cal, per)


def neighbors(tab, parent):
    """부모 변수를 한 칸씩 바꾼 이웃(변수 순서 · +/− 순서 고정)."""
    out = []
    for key, vals in GRID[tab].items():
        cur = parent.get(key)
        if cur not in vals:
            continue
        i = vals.index(cur)
        for j in (i + 1, i - 1):
            if 0 <= j < len(vals):
                out.append(dict(parent, **{key: vals[j]}))
    return out


def grid_order(tab):
    """격자 전체를 정해진 순서로(결과를 보기 전에 정한 순서 — 탭 이름으로 고정한 섞기)."""
    import itertools
    import random
    keys = list(GRID[tab])
    combos = [dict(zip(keys, v)) for v in itertools.product(*(GRID[tab][k] for k in keys))]
    random.Random("arena:" + tab).shuffle(combos)
    return combos


def _span_days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def streak(snaps, key, test):
    """끝에서부터 test(스냅샷)가 이어진 구간의 (시작일, 끝일, 횟수)."""
    run = []
    for sn in reversed(snaps):
        if not test(sn):
            break
        run.append(sn)
    return (run[-1]["date"], run[0]["date"], len(run)) if run else (None, None, 0)


def post_json(url, body, key, timeout=30):
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"content-type": "application/json", "x-monitor-key": key, "User-Agent": "jkquant-claude-lab/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def auto_promote(tab, row, main_row, today, state):
    """7일 1위 → Worker 메인 기록에 쌓는다(다음 날부터). 감시키가 없으면(로컬) 'due'만 남긴다."""
    eff = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
    ev = dict(tab=tab, version=row["version"], name=row["name"], rule=row["rule"], params=row["params"], effectiveFrom=eff,
              promotedAt=datetime.now(timezone.utc).isoformat(), prevVersion=main_row["version"], by="auto:arena-7d-top1",
              basis=dict(labGeneratedAt=datetime.now(KST).isoformat(), rank=1,
                         promotion=f"7일 연속 1위 · 점수 {row['score']:+.3f} vs 메인 {main_row['score'] or 0:+.3f}"))
    key = os.environ.get("JKQ_MONITOR_KEY", "").strip()
    if not key:
        return dict(ok=False, due=True, event=ev, error="감시키 없음(로컬 계산) — 기록하지 않음")
    try:
        r = post_json(os.environ.get("JKQ_WORKER", "https://jkquant-opening-scheduler.mumae4.workers.dev") + "/claude-config", ev, key)
        if not r.get("ok"):
            return dict(ok=False, event=ev, error=str(r.get("error") or r))
    except Exception as e:  # noqa: BLE001
        return dict(ok=False, event=ev, error=str(e))
    try:                                                         # 알림 — 실패해도 승격 기록에는 영향 없음
        post_json(os.environ.get("JKQ_PAGES", "https://jkquant.pages.dev") + "/api/claude-telegram",
                  dict(kind="promote", date=today, tab=tab, event=ev), key)
    except Exception:  # noqa: BLE001
        pass
    MAIN_EVENTS.append(dict(ev, params=_valid_params(tab, ev["params"])))
    MAIN_EVENTS.sort(key=lambda e: (e["effectiveFrom"], e["promotedAt"]))
    return dict(ok=True, event=ev)


def arena(ctx, today=None, state=None, tabs=TABS4):
    """경쟁군 갱신 → 순위 → 1위 기록 → 퇴출·신규 투입 → 7일 1위 자동 승격. 결과(화면용)와 새 상태를 돌려준다."""
    today = today or datetime.now(KST).strftime("%Y-%m-%d")
    state = state if state is not None else (read_json(ARENA_PATH) or {})
    state.setdefault("schema", 1)
    tabs_state, log = state.setdefault("tabs", {}), state.setdefault("log", [])
    now = datetime.now(KST).isoformat(timespec="minutes")
    out = {}

    def note(tab, kind, row, reason):
        log.append(dict(date=today, at=now, tab=tab, kind=kind, version=row["version"], name=row.get("name"), reason=reason))

    for tab in tabs:
        st = tabs_state.setdefault(tab, {})
        cur = main_for(tab)
        if "pool" not in st:                                      # 처음: 기본 목록(주문 경로로 실행 가능한 것만)
            st["pool"] = [dict(version=c["version"], name=c["name"], rule=c["rule"], params=c["params"], source="seed", addedAt=today)
                          for c in catalog(tab) if c["promotable"]]
            st["retired"], st["tried"], st["snapshots"] = [], [], []
            for c in catalog(tab):
                if not c["promotable"]:
                    st["retired"].append(dict(version=c["version"], name=c["name"], retiredAt=today, reason="주문 경로 없음(다른 종목) — 자동 승격 불가라 경쟁군에서 뺌"))
        pool = st["pool"]
        if cur["version"] not in {x["version"] for x in pool}:   # 지금 메인은 늘 경쟁군에 있다
            pool.insert(0, dict(version=cur["version"], name=cur["name"], rule=cur["rule"], params=cur["params"], source="main", addedAt=today))
        seen = {x["version"] for x in pool} | {x["version"] for x in st["retired"]} | set(st["tried"])
        rows, errors = [], []
        for x in pool:
            try:
                rows.append(dict(x, **arena_eval(tab, x, ctx)))
            except Exception as e:  # noqa: BLE001
                errors.append(dict(version=x["version"], error=str(e)))
        main_row = next((r for r in rows if r["version"] == cur["version"]), None)
        snaps = st["snapshots"]

        def ranked(rs):
            return sorted(rs, key=lambda r: (not gate_ok(r), -(r["score"] if r["score"] is not None else -1e9)))
        # 1) 오늘 순위 · 1위 기록 — 어제까지 경쟁군으로(오늘 새로 들어오는 전략은 내일부터 순위 기록에 들어간다)
        rows = ranked(rows)
        top = rows[0] if rows else None
        snap = dict(date=today, top=top["version"] if top else None, main=cur["version"],
                    bottom=[r["version"] for r in rows if r["version"] != cur["version"]][-BOTTOM_N:], ranks=[r["version"] for r in rows])
        snaps[:] = [x for x in snaps if x["date"] != today] + [snap]
        snaps.sort(key=lambda x: x["date"])
        del snaps[:-120]
        # 2) 7일 1위 → 자동 승격(다음 날부터)
        promo = dict(code="none", text="")
        if top and top["version"] != cur["version"]:
            s0, _, n = streak(snaps, top["version"], lambda sn: sn.get("top") == top["version"])
            days = _span_days(s0, today) + 1 if s0 else 0
            if days >= PROMOTE_DAYS and gate_ok(top) and main_row:
                r = auto_promote(tab, top, main_row, today, state)
                if r.get("ok"):
                    note(tab, "promote", top, f"7일 연속 1위 → {r['event']['effectiveFrom']} 부터 메인 (이전 메인 {cur['version']})")
                    promo = dict(code="promoted", text=f"자동 승격 — {r['event']['effectiveFrom']} 부터 메인", event=r["event"])
                else:
                    promo = dict(code="due" if r.get("due") else "failed", days=days, since=s0,
                                 text=("승격 조건 충족 · " if r.get("due") else "승격 기록 실패 — 다음 계산에서 다시: ") + r.get("error", ""))
                    if not r.get("due"):
                        note(tab, "promote_failed", top, r.get("error", ""))
            else:
                promo = dict(code="streak", text=f"1위 {days}일째 (첫 1위 {s0}) — {PROMOTE_DAYS}일이면 다음 날부터 자동 승격", days=days, since=s0)
        elif top:
            promo = dict(code="main_top", text="지금 메인이 1위 — 바꿀 전략 없음")
        promoted_v = promo.get("event", {}).get("version") if promo["code"] == "promoted" else None
        # 3) 퇴출 후보: 손실 기준 미달 · 7일 연속 하위 3위 (메인 · 방금 승격한 전략은 제외)
        bad = []
        for r in rows:
            if r["version"] in (cur["version"], promoted_v):
                continue
            f = r.get("full") or {}
            if not gate_ok(r):
                bad.append((r, f"손실 기준 미달 — MDD {f.get('mddPct') or 0:.1f}% · 최악일 {f.get('worstDayPct') or 0:.1f}% · 거래당 {f.get('expectancyPct') or 0:+.2f}%"))
                continue
            s0, s1, n = streak(snaps, r["version"], lambda sn: r["version"] in (sn.get("bottom") or []))
            if n and _span_days(s0, today) >= PROMOTE_DAYS - 1:
                bad.append((r, f"{_span_days(s0, today) + 1}일 연속 하위 {BOTTOM_N}위 (점수 {r['score']:+.3f})"))
        nonmain = [r for r in rows if r["version"] != cur["version"]]
        # 4) 신규 투입 — 빈자리 + 퇴출될 자리만큼(상위 이웃 → 격자 순서). 손실 기준 통과해야 들어온다.
        need = POOL_TARGET - (len(nonmain) - len(bad))
        added, rejected, attempts = [], 0, 0
        if need > 0:
            parents = [r for r in rows if gate_ok(r)][:3]
            cands = [c for par in parents for c in neighbors(tab, par["params"])] + grid_order(tab)
            for c in cands:
                if len(added) >= need or attempts >= GEN_ATTEMPTS:
                    break
                try:
                    p = _canon(tab, c)
                except (ValueError, KeyError, TypeError):
                    continue
                ver = gen_version(tab, p)
                if ver in seen:
                    continue
                seen.add(ver)
                attempts += 1
                name, rule = describe(tab, p)
                e = dict(version=ver, name=name, rule=rule, params=p, source="generated", addedAt=today)
                try:
                    m = arena_eval(tab, e, ctx)
                except Exception:  # noqa: BLE001
                    st["tried"].append(ver)
                    continue
                if not gate_ok(m):
                    st["tried"].append(ver)
                    rejected += 1
                    continue
                pool.append(e)
                rows.append(dict(e, **m))
                parent = parents[0]["version"] if parents else "격자"
                note(tab, "new", e, f"신규 투입 — 점수 {m['score']:+.3f} · 최근 1년 {(m['year'] or {}).get('totalPct') or 0:+.1f}% (상위 {parent} 주변/격자에서)")
                added.append(ver)
            if rejected:
                log.append(dict(date=today, at=now, tab=tab, kind="reject", version="", name="",
                                reason=f"새 후보 {rejected}개는 손실 기준 미달로 투입 전 탈락"))
        # 5) 퇴출 — 그림자를 10개 밑으로 줄이지 않는다(나쁜 것부터)
        nonmain = [r for r in rows if r["version"] != cur["version"]]
        room = len(nonmain) - POOL_MIN
        for r, why in sorted(bad, key=lambda b: (gate_ok(b[0]), b[0]["score"] if b[0]["score"] is not None else -1e9))[:max(0, room)]:
            pool[:] = [x for x in pool if x["version"] != r["version"]]
            rows = [x for x in rows if x["version"] != r["version"]]
            st["retired"].append(dict(version=r["version"], name=r["name"], params=r["params"], retiredAt=today, reason=why))
            note(tab, "retire", r, why)
        st["retired"] = st["retired"][-200:]
        st["tried"] = st["tried"][-2000:]
        rows = ranked(rows)                                       # 화면용 최종 순위(새로 들어온 전략 포함 — '신규' 표시)
        for i, r in enumerate(rows, 1):
            r["rank"], r["isMain"], r["isNew"] = i, r["version"] == cur["version"], r["version"] in added
        for r in rows:
            r["promotion"] = (dict(promo, code="candidate") if (top and r["version"] == top["version"] and not r["isMain"] and promo["code"] in ("streak", "due", "failed"))
                              else dict(code="main", text="지금 메인") if r["isMain"] else dict(code="keep", text=""))
        out[tab] = dict(main=cur["version"], mainName=cur["name"], effectiveFrom=cur.get("effectiveFrom"), rows=rows, errors=errors,
                        top=top["version"] if top else None, status=promo, added=added, retiredToday=[x for x in st["retired"] if x.get("retiredAt") == today],
                        poolSize=len([r for r in rows if not r["isMain"]]), triedCount=len(st["tried"]), rule=ARENA_RULE,
                        log=[x for x in log if x["tab"] == tab][-30:])
    state["log"] = log[-600:]
    state["updatedAt"] = now
    return out, state


def shadows_from(rank):
    """옛 화면·주간 카드 호환: 탭별 메인이 아닌 줄(그림자)만."""
    return {tab: [r for r in (z.get("rows") or []) if not r.get("isMain")] for tab, z in rank.items()}


def attach_promotions(report):
    """경쟁 계산이 이미 판정했다 — 호환용(그림자 줄에 promotion 이 없으면 채움)."""
    for tab, rows in (report.get("shadows") or {}).items():
        for x in rows if isinstance(rows, list) else []:
            x.setdefault("promotion", dict(code="keep", text=""))


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


# ── 🆚 GPT 대결: 실시간 모의매매 기록끼리만(재구성·백테스트 없음) · 같은 시작일 · 같은 비용표 · 칸 자금 100% · 합계는 4탭 균등 ──
DUEL_START = "2026-10-05"
DUEL_TABS = ("opening", "daytrading", "crypto", "soxl")
DUEL_RULES = ("두 쪽 모두 그날 실시간으로 남긴 모의매매 기록만 쓴다(클로드 = Worker 하루 마감 장부, GPT = 자기 기준전략 기록). "
              "같은 시작일(2026-10-05)부터 두 쪽 기록이 다 있는 날만 비교한다. 매매마다 (청산가 ÷ 진입가 − 1)에서 같은 시장 비용표를 뺀다. "
              "하루 손익은 그날 청산된 매매(실현) 기준, 칸 자금 100%. 매매 없는 날 0%. 합계는 4개 탭을 25%씩 같은 원금으로. "
              "하루 승패는 0.01%p 넘게 앞선 쪽이 이김.")


def claude_closed_records(tab):
    """data/claude-live/{날짜}.json(Worker 마감 장부 사본)에서 close:{tab} 기록 — {거래일: 기록}."""
    out = {}
    folder = DATA / "claude-live"
    for f in sorted(folder.glob("*.json")) if folder.exists() else []:
        j = read_json(f) or {}
        for e in ((j.get("ledger") or {}).get("events") or []):
            if e and e.get("id") == "close:" + tab and e.get("payload"):
                out[e["payload"].get("date") or j.get("date")] = e["payload"]
    return out


def gpt_coverage(tab):
    """GPT 기록이 '그날을 처리했다'고 볼 수 있는 날짜 — 매매 없는 날도 0% 로 셀 수 있게."""
    if tab == "opening":
        folder = DATA / "opening-history"
        return {f.stem for f in folder.glob("20??-??-??.json")} if folder.exists() else set()
    if tab == "daytrading":
        j = read_json(DATA / "daytrading-research/latest.json") or {}
        end = j.get("latestObservedDay") or j.get("to")
        days = set(CAL.get("etf") or [])
        return {d for d in days if end and d <= str(end)[:10]}
    path = {"crypto": "crypto-research/baseline-decisions.csv", "soxl": "soxl-research/baseline-decisions.csv"}[tab]
    return {r["date"] for r in read_csv(DATA / path) if r.get("date")}


def duel_tab(tab, start=DUEL_START):
    cost_g = FAIR_COST["opening" if tab == "opening" else "crypto" if tab == "crypto" else "soxl" if tab == "soxl" else "daytrading_stock"]
    cost_c = FAIR_COST["daytrading_etf"] if tab == "daytrading" else cost_g
    recs = claude_closed_records(tab)
    cby, mine = {}, set()
    for d, r in recs.items():
        if r.get("status") != "closed" or d < start:
            continue
        mine.add(d)
        for t in r.get("trades") or []:
            g = _gross(t.get("entryPrice"), t.get("exitPrice"))
            if g is not None:
                cby.setdefault(d, []).append(dict(name=t.get("name"), entry=t.get("entryPrice"), exit=t.get("exitPrice"), reason=t.get("reason"),
                                                  gross=g, slot=0.5 if tab == "crypto" else None))
    gby, _, gver = gpt_trades(tab)
    theirs = {d for d in gpt_coverage(tab) if d >= start} | {d for d in gby if d >= start}
    days = sorted(mine & theirs)
    rows, cc, cg, wins, losses, draws = [], 1.0, 1.0, 0, 0, 0
    for d in days:
        c = _side_day(cby.get(d, []), cost_c) if cby.get(d) else 0.0
        g = _side_day(gby.get(d, []), cost_g) if gby.get(d) else 0.0
        cc *= 1 + c / 100
        cg *= 1 + g / 100
        w = "claude" if c - g > 0.01 else "gpt" if g - c > 0.01 else "draw"
        wins, losses, draws = wins + (w == "claude"), losses + (w == "gpt"), draws + (w == "draw")
        rows.append(dict(date=d, winner=w, cumClaudePct=(cc - 1) * 100, cumGptPct=(cg - 1) * 100,
                         claude=dict(pnlPct=c, entries=len(cby.get(d, [])), trades=[dict(t, net=t["gross"] - cost_c) for t in cby.get(d, [])]),
                         gpt=dict(pnlPct=g, entries=len(gby.get(d, [])), trades=[dict(t, net=t["gross"] - cost_g) for t in gby.get(d, [])])))
    pending = sorted((mine ^ theirs))
    return dict(days=rows, claude=_side_summary(days, cby, cost_c), gpt=_side_summary(days, {d: v for d, v in gby.items() if d in set(days)}, cost_g),
                record=dict(claude=wins, gpt=losses, draw=draws), costPct=dict(claude=cost_c, gpt=cost_g), gptVersions=gver,
                pending=[dict(date=d, missing="GPT" if d in mine else "클로드") for d in pending[-10:]])


def duel(start=DUEL_START):
    tabs = {t: duel_tab(t, start) for t in DUEL_TABS}
    dates = sorted({r["date"] for t in tabs.values() for r in t["days"]})
    by = {t: {r["date"]: r for r in tabs[t]["days"]} for t in DUEL_TABS}
    rows, cc, cg, w, l, dr = [], 1.0, 1.0, 0, 0, 0
    for d in dates:
        c = sum(0.25 * by[t][d]["claude"]["pnlPct"] for t in DUEL_TABS if d in by[t])
        g = sum(0.25 * by[t][d]["gpt"]["pnlPct"] for t in DUEL_TABS if d in by[t])
        cc *= 1 + c / 100
        cg *= 1 + g / 100
        win = "claude" if c - g > 0.01 else "gpt" if g - c > 0.01 else "draw"
        w, l, dr = w + (win == "claude"), l + (win == "gpt"), dr + (win == "draw")
        rows.append(dict(date=d, claudePct=c, gptPct=g, winner=win, cumClaudePct=(cc - 1) * 100, cumGptPct=(cg - 1) * 100))
    dv_c = {r["date"]: r["claudePct"] for r in rows}
    dv_g = {r["date"]: r["gptPct"] for r in rows}
    total = dict(days=rows, record=dict(claude=w, gpt=l, draw=dr),
                 claude=goal_metrics(dv_c, dates, 365) if dates else {}, gpt=goal_metrics(dv_g, dates, 365) if dates else {})
    return dict(start=start, rules=DUEL_RULES, costs=FAIR_COST, tabs=tabs, total=total, latest=dates[-1] if dates else None)


def recent_curves(series, today, days=60):
    """📅 오늘 탭 추이 그래프(참고): 최근 days 일 동안 규칙대로 다시 계산한 누적 수익률 — 칸 자금 100%, 계좌는 비중대로.
    모의 장부(실제 기록)와 섞지 않는다. series: {키: (일손익 dict, 그 시장 달력)}"""
    start = (date.fromisoformat(today) - timedelta(days=days)).isoformat()
    out, trades = {}, {}
    for k, (dv, cal) in series.items():
        eq, pts, n = 1.0, [], 0
        for d in sorted(set(cal)):
            if d < start or d > today:
                continue
            eq *= 1 + dv.get(d, 0.0) / 100
            n += d in dv
            pts.append(dict(date=d, cumPct=(eq - 1) * 100))
        out[k], trades[k] = pts, n
    return dict(start=start, source="reconstructed", note="규칙대로 다시 계산한 값(모의 장부 아님) · 칸 자금 100% · 계좌는 국내 30·코인 30·미국 40",
                series=out, tradeDays=trades)


def krx_holidays():
    """KRX 휴장일 — 실시간 주문 경로와 같은 목록(functions/api/_krx_calendar.js)을 그대로 읽는다(두 군데서 따로 세지 않음)."""
    for base in (Path(__file__).resolve().parent.parent, Path(__file__).resolve().parent):
        f = base / "functions" / "api" / "_krx_calendar.js"
        if f.exists():
            return set(re.findall(r'"(\d{4}-\d{2}-\d{2})"', f.read_text(encoding="utf-8")))
    return set()


KRX_HOLIDAYS = krx_holidays()


def krx_closed(d):
    return date.fromisoformat(d).weekday() >= 5 or d in KRX_HOLIDAYS


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
    if datetime.now(KST).weekday() < 5 and not led and not krx_closed(today):     # 휴장일엔 원본이 없어도 정상(주문 실패는 휴장일이라도 그대로 점검)
        issues.append("오늘 ①② 원본 기록 없음 — 개장일인데 08:56 기록이 없음(점검)")
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
            v = float(r[col])                      # 먼저 숫자로 — 빈 값(미청산 등)이면 그 날짜를 만들지 않는다(빈 평균으로 밤 계산이 죽던 문제)
        except (KeyError, ValueError, TypeError):
            continue
        if not math.isfinite(v):
            continue
        by.setdefault(r["date"], []).append(v)
        ver.add(r.get("strategyVersion") or "")
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


ETF_PW = {}                # ② 날짜별 그날 메인 값(장부·계좌·전일당일용) — main() 이 채운다


def main():
    global ETF_PW
    OUT.mkdir(parents=True, exist_ok=True)
    MAIN_EVENTS[:] = load_main_events()
    report = dict(schema=1, generatedAt=datetime.now(KST).isoformat(), designEnd=DESIGN_END, gate=GATE, tabs={},
                  note="모든 수익률은 각 전략 자체 기록의 순수익(수수료·슬리피지 포함). 매매 없는 날 0%. 클로드 ③④ 는 주문 없는 연구 그림자.")
    today = datetime.now(KST).strftime("%Y-%m-%d")
    report["main"] = {t: dict(current=main_for(t), today=main_for(t, today), history=[e for e in MAIN_EVENTS if e["tab"] == t]) for t in TABS4}
    # 탭 카드(설계·판정 지표)는 지금 메인 규칙으로 전체 기간, 장부·계좌·전일당일은 날짜마다 그날 메인(piecewise)
    m1 = main_for("opening")
    d1_cur, krx_cal = d1_series(m1["params"])
    d1 = piecewise("opening", lambda p: d1_series(p)[0])
    report["tabs"]["opening"] = tab_report("opening", m1["name"], m1["version"], m1["rule"], d1_cur, krx_cal, 250, extra=dict(params=m1["params"]))
    m2 = main_for("daytrading")
    ETF_PW = piecewise("daytrading", etf_series)
    report["tabs"]["daytrading"] = tab_report("daytrading", m2["name"], m2["version"], m2["rule"], etf_series(m2["params"]), krx_cal, 250,
                                              extra=dict(params=m2["params"]))
    crypto_full = {}
    try:
        m3 = main_for("crypto")
        H_by = {}
        for m in sorted({mk for v in [main_for("crypto", "0000-00-00")] + MAIN_EVENTS + [dict(params=COIN_BO)] for mk in (v.get("params") or {}).get("markets") or []}):
            H_by[m] = fetch_hourly(m)
            ROWS[m] = H_by[m]
        runs = {}
        for v in [main_for("crypto", "0000-00-00")] + [e for e in MAIN_EVENTS if e["tab"] == "crypto"] + [m3]:
            if v["version"] not in runs:
                runs[v["version"]] = coin_series(dict(v["params"], version=v["version"]), H_by)
        tab_cur, _, _, nexts, cal_cur = runs[m3["version"]]
        cal_c = sorted(set().union(*[set(r[4]) for r in runs.values()]))
        CAL["coin"] = cal_c
        crypto_full = piecewise("crypto", lambda p: coin_series(p, H_by)[1]) if len(runs) > 1 else dict(runs[m3["version"]][1])
        for m in COIN_BO["markets"]:                       # 시장별 기록도 날짜마다 그날 메인 것(메인에 없는 시장이면 그날 기록 없음)
            dec_m = [r for d in cal_c for r in (runs[main_for("crypto", d)["version"]][2].get(m) or []) if r["date"] == d]
            write_csv(OUT / f"{m.split('-')[1].lower()}-bo-decisions.csv", dec_m)
            DECISIONS[m] = dec_m
        report["tabs"]["crypto"] = tab_report("crypto", m3["name"], m3["version"], m3["rule"], tab_cur, cal_cur, 365,
                                              extra=dict(nextSignals=nexts, params=dict(COIN_BO, **m3["params"], version=m3["version"])))
    except Exception as e:  # noqa: BLE001
        report["tabs"]["crypto"] = dict(error=str(e))
    us_full = {}
    try:
        m4 = main_for("soxl")
        sx = fetch_us(SOXL_MR["trade"])
        sdays = sorted(sx)
        CAL["us"] = sdays
        srows = [(d, *sx[d]) for d in sdays]
        _, us_full, dec_s, nxt_s, switches = soxl_piecewise(srows)
        write_csv(OUT / "soxl-mr-decisions.csv", dec_s)
        DECISIONS["SOXL"] = dec_s
        ROWS["SOXL"] = srows
        tab_s = soxl_series(dict(m4["params"], version=m4["version"]), srows)[0]
        report["tabs"]["soxl"] = tab_report("soxl", m4["name"], m4["version"], m4["rule"], tab_s, sdays, 252,
                                            extra=dict(nextSignal=nxt_s, params=dict(SOXL_MR, **m4["params"], version=m4["version"]), switches=switches))
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
        kr = combine_same_capital(d1, ETF_PW)
        us_k = us_to_kst(us_full)
        acct = account_daily(kr, crypto_full, us_k, cal_c)
        acal = [d for d in cal_c if d >= min(kr)] if kr else cal_c
        report["account"] = dict(plan=ACCOUNT,
                                 design=goal_metrics({d: v for d, v in acct.items() if d <= DESIGN_END}, [d for d in acal if d <= DESIGN_END], 365),
                                 outOfSample=goal_metrics({d: v for d, v in acct.items() if d > DESIGN_END}, [d for d in acal if d > DESIGN_END], 365),
                                 lastYear=goal_metrics({d: v for d, v in acct.items() if d >= "2025-10-01" and d <= DESIGN_END}, [d for d in acal if "2025-10-01" <= d <= DESIGN_END], 365),
                                 recent=[dict(date=d, pnlPct=acct[d]) for d in sorted(acct)[-20:]])
    try:
        CAL["etf"] = kr_calendar()
    except Exception:  # noqa: BLE001
        CAL["etf"] = []
    report["daily"] = daily_board(report, d1, krx_cal, crypto_full, locals().get("cal_c") or [])
    try:
        kr_cal = sorted(set(CAL.get("etf") or []) | set(krx_cal))
        acct_s = account_daily(combine_same_capital(d1, ETF_PW), crypto_full, us_to_kst(locals().get("us_full") or {}), locals().get("cal_c") or [])
        report["curves"] = recent_curves({"opening_d1v2": (d1, [d for d in kr_cal if d <= max(krx_cal or [""])]),
                                          "daytrading_etf": (ETF_PW, kr_cal),
                                          "coin_bo": (crypto_full, locals().get("cal_c") or []),
                                          "us_soxl": (locals().get("us_full") or {}, CAL.get("us") or []),
                                          "account": (acct_s, [d for d in (locals().get("cal_c") or []) if acct_s and d <= max(acct_s)])},
                                         datetime.now(KST).strftime("%Y-%m-%d"))
    except Exception as e:  # noqa: BLE001
        report["curves"] = dict(error=str(e))
    try:
        report["paper"] = write_paper(report, d1, krx_cal, crypto_full, locals().get("us_full") or {}, locals().get("cal_c") or [])
    except Exception as e:  # noqa: BLE001
        report["paper"] = dict(error=str(e))
    try:
        ctx = dict(coin={m: ROWS[m] for m in ROWS if str(m).startswith("KRW-")}, soxl=ROWS.get("SOXL") or [],
                   kr_cal=[d for d in krx_cal if d >= "2018-04-01"])
        report["arena"], astate = arena(ctx)
        ARENA_PATH.write_text(json.dumps(astate, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        report["ranking"] = report["arena"]
        report["shadows"] = shadows_from(report["arena"])
        report["main"] = {t: dict(current=main_for(t), today=main_for(t, today), history=[e for e in MAIN_EVENTS if e["tab"] == t]) for t in TABS4}
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
    try:
        report["duel"] = duel()
    except Exception as e:  # noqa: BLE001
        report["duel"] = dict(error=str(e))
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


def duel_payload(latest, today):
    """매일 대결 요약 알림 본문 — 밤 계산의 대결 결과(같은 장부)만 옮긴다."""
    d = latest.get("duel") or {}
    tot = (d.get("total") or {})
    last = (tot.get("days") or [None])[-1]
    tabs = {}
    for k, t in (d.get("tabs") or {}).items():
        lr = (t.get("days") or [None])[-1]
        tabs[k] = dict(record=t.get("record"), cumClaude=(t.get("claude") or {}).get("totalPct"), cumGpt=(t.get("gpt") or {}).get("totalPct"),
                       last=dict(date=lr["date"], claude=lr["claude"]["pnlPct"], gpt=lr["gpt"]["pnlPct"], winner=lr["winner"]) if lr else None)
    return dict(kind="duel", date=today, duel=dict(start=d.get("start"), last=last, record=tot.get("record"),
                                                   cumClaude=(tot.get("claude") or {}).get("totalPct"), cumGpt=(tot.get("gpt") or {}).get("totalPct"), tabs=tabs))


if __name__ == "__main__":
    import sys
    if "--duel-payload" in sys.argv:                   # workflow: 매일 대결 요약 알림 본문만 출력
        print(json.dumps(duel_payload(read_json(OUT / "latest.json") or {}, datetime.now(KST).strftime("%Y-%m-%d")), ensure_ascii=False, default=str))
        raise SystemExit(0)
    raise SystemExit(main())
