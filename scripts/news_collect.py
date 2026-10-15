"""헤드라인 · 분봉 앞으로 쌓기 — 연구 R11 (사용자 요청 2026-10-15: 속보를 투자에 쓰면 어떨까 → '바로 매매하지 않고 먼저 쌓고 재기').

매매 · 알림에 쓰지 않는다. 2~3개월 쌓은 뒤, 헤드라인 발행 시각 뒤 5 · 10 · 30분 가격 경로로 효과가 있는지 잰다.
- 헤드라인: 공식 RSS(연합뉴스 경제 · 마켓 · 산업 · 국제, Yahoo Finance 미국 종목 헤드라인). 제목 · 링크 · 발행 시각만 저장한다(본문 저장 안 함).
  data/news/YYYY-MM-DD.jsonl (처음 본 시각의 한국 날짜) — {id, source, title, link, publishedAt, firstSeenAt, v}. 같은 id 는 한 번만.
- 분봉: 끝난 하루만 저장한다(진행 중인 하루는 쓰지 않음 — 나중 자료로 덮어쓰지 않게 한 번 쓰면 그대로).
  업비트 KRW-BTC · KRW-ETH 1분봉(한국 날짜 0~24시) · 미국 SOXL · NVDA · QQQ 1분봉(뉴욕 날짜 정규장 앞뒤 포함) ·
  국내 233740(코스닥150 레버리지) · 122630(코스피200 레버리지) 1분 종가 · 거래량(네이버 — 시가 · 고가 · 저가는 원천에 없음).
  data/minute/{종목}/{YYYY-MM-DD}.json — {symbol, date, tz, schema, rows}.
실시간 원본(이 수집)과 나중에 다시 만든 자료는 섞지 않는다(CLAUDE.md 단타 데이터 누적 원칙).
"""
import argparse, hashlib, json, os, re, time, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

V = "news-collect-1.0.0"
KST, NY = ZoneInfo("Asia/Seoul"), ZoneInfo("America/New_York")
FEEDS = [
    ("yna_economy", "https://www.yna.co.kr/rss/economy.xml"),
    ("yna_market", "https://www.yna.co.kr/rss/market.xml"),
    ("yna_industry", "https://www.yna.co.kr/rss/industry.xml"),
    ("yna_international", "https://www.yna.co.kr/rss/international.xml"),
    ("yahoo_us", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SOXL,NVDA,SMH,QQQ,BTC-USD&region=US&lang=en-US"),
]
UPBIT = ["KRW-BTC", "KRW-ETH"]
US = ["SOXL", "NVDA", "QQQ"]
KR = ["233740", "122630"]
UA = {"User-Agent": "Mozilla/5.0 (jkquant research collector)"}


def http(url, tries=3):
    err = None
    for a in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 — 원천 하나가 실패해도 다른 원천은 계속
            err = e
            time.sleep(1 + a)
    raise err


# ── 헤드라인 ──
def item_id(source, key):
    return hashlib.sha1((source + "|" + key).encode("utf-8")).hexdigest()[:16]


def parse_rss(text, source):
    """RSS 2.0 → [{id, source, title, link, publishedAt(UTC ISO)}]. 발행 시각을 못 읽으면 None(버리지 않음)."""
    root = ET.fromstring(text.encode("utf-8"))
    out = []
    for it in root.findall("./channel/item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        guid = (it.findtext("guid") or "").strip()
        if not title or not (link or guid):
            continue
        pub = None
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            pub = None
        out.append(dict(id=item_id(source, guid or link), source=source, title=title, link=link, publishedAt=pub))
    return out


def seen_ids(news_dir, today, days=3):
    ids = set()
    for k in range(days):
        p = Path(news_dir) / ((today - timedelta(days=k)).isoformat() + ".jsonl")
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                try:
                    ids.add(json.loads(line)["id"])
                except Exception:  # noqa: BLE001
                    pass
    return ids


def new_items(items, ids, now):
    """처음 보는 것만 — 같은 수집 안의 중복도 하나로. firstSeenAt = 이번 수집 시각(UTC)."""
    out, seen = [], set(ids)
    for x in items:
        if x["id"] in seen:
            continue
        seen.add(x["id"])
        out.append(dict(x, firstSeenAt=now.astimezone(timezone.utc).isoformat(), v=V))
    return out


def collect_news(data, now):
    today = now.astimezone(KST).date()
    news_dir = Path(data) / "news"
    news_dir.mkdir(parents=True, exist_ok=True)
    items, errors = [], []
    for src, url in FEEDS:
        try:
            items += parse_rss(http(url), src)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{src}: {type(e).__name__}")
    fresh = new_items(items, seen_ids(news_dir, today), now)
    if fresh:
        with open(news_dir / (today.isoformat() + ".jsonl"), "a", encoding="utf-8") as f:
            for x in fresh:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")
    return dict(fetched=len(items), new=len(fresh), errors=errors)


# ── 분봉(끝난 하루만) ──
def upbit_rows(candles, day):
    """업비트 1분봉(최신순 · candle_date_time_kst) → 그 한국 날짜의 [HH:MM, 시, 고, 저, 종, 거래량] 오래된 순."""
    rows = {}
    for c in candles:
        t = str(c.get("candle_date_time_kst", ""))
        if t[:10] == day:
            rows[t[11:16]] = [t[11:16], c["opening_price"], c["high_price"], c["low_price"], c["trade_price"], c["candle_acc_trade_volume"]]
    return [rows[k] for k in sorted(rows)]


def yahoo_sessions(chart):
    """Yahoo 1분봉 → {뉴욕 날짜: [[HH:MM, 시, 고, 저, 종, 거래량], ...]} (값이 빈 분은 버림)."""
    r = ((chart or {}).get("chart") or {}).get("result") or []
    if not r:
        return {}
    r = r[0]
    q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    out = {}
    for i, ts in enumerate(r.get("timestamp") or []):
        o, h, l, c, v = (q.get(k, [None])[i] if i < len(q.get(k) or []) else None for k in ("open", "high", "low", "close", "volume"))
        if c is None:
            continue
        t = datetime.fromtimestamp(ts, timezone.utc).astimezone(NY)
        out.setdefault(t.date().isoformat(), []).append([t.strftime("%H:%M"), o, h, l, c, v])
    return out


def naver_sessions(text):
    """네이버 분봉(siseJson) → {날짜: [[HH:MM, 종가, 거래량], ...]} — 원천은 1분 종가 · 거래량만 준다."""
    out = {}
    for d, c, v in re.findall(r'\["(\d{12})",\s*[^,]*,\s*[^,]*,\s*[^,]*,\s*([\d.]+),\s*([\d.]+)', text):
        day = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        out.setdefault(day, []).append([f"{d[8:10]}:{d[10:12]}", float(c), float(v)])
    return out


def done_days(days, now, tz, close_hm):
    """끝난 날만: 그 시장 날짜가 오늘보다 앞이거나, 오늘이면 장 마감(close_hm) 뒤."""
    loc = now.astimezone(tz)
    today, hm = loc.date().isoformat(), loc.strftime("%H:%M")
    return [d for d in days if d < today or (d == today and hm >= close_hm)]


def save_day(data, sym, day, tz, schema, rows):
    p = Path(data) / "minute" / sym / (day + ".json")
    if p.exists() or not rows:                                       # 한 번 쓰면 그대로(덮어쓰지 않음)
        return False
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(dict(symbol=sym, date=day, tz=tz, schema=schema, rows=rows, v=V), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True


def archive_minutes(data, now):
    saved, errors = [], []
    yday = (now.astimezone(KST).date() - timedelta(days=1)).isoformat()
    for m in UPBIT:                                                    # 어제(한국 날짜) 하루 1440분 — 200개씩 거꾸로
        if (Path(data) / "minute" / m / (yday + ".json")).exists():
            continue
        try:
            to, got = f"{(now.astimezone(KST).date()).isoformat()}T00:00:00+09:00", []
            for _ in range(8):
                batch = json.loads(http(f"https://api.upbit.com/v1/candles/minutes/1?market={m}&count=200&to={urllib.request.quote(to)}"))
                if not batch:
                    break
                got += batch
                to = batch[-1]["candle_date_time_utc"] + "Z"
                time.sleep(0.2)
            if save_day(data, m, yday, "Asia/Seoul", "time,open,high,low,close,volume", upbit_rows(got, yday)):
                saved.append(f"{m} {yday}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{m}: {type(e).__name__}")
    for s in US:
        try:
            ses = yahoo_sessions(json.loads(http(f"https://query1.finance.yahoo.com/v8/finance/chart/{s}?range=5d&interval=1m&includePrePost=true")))
            for d in done_days(sorted(ses), now, NY, "20:05"):
                if save_day(data, s, d, "America/New_York", "time,open,high,low,close,volume", ses[d]):
                    saved.append(f"{s} {d}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{s}: {type(e).__name__}")
    for c in KR:
        try:
            ses = naver_sessions(http(f"https://fchart.stock.naver.com/siseJson.nhn?symbol={c}&requestType=0&count=2400&timeframe=minute"))
            for d in done_days(sorted(ses), now, KST, "15:45"):
                if save_day(data, c, d, "Asia/Seoul", "time,close,volume", ses[d]):
                    saved.append(f"{c} {d}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{c}: {type(e).__name__}")
    return dict(saved=saved, errors=errors)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--no-news", action="store_true")
    ap.add_argument("--no-minute", action="store_true")
    a = ap.parse_args()
    now = datetime.now(timezone.utc)
    res = {}
    if not a.no_news:
        res["news"] = collect_news(a.data, now)
    if not a.no_minute:
        res["minute"] = archive_minutes(a.data, now)
    print(json.dumps(res, ensure_ascii=False))
