#!/usr/bin/env python3
"""Collect completed Upbit KRW-BTC 5-minute candles into the scalping-data branch.

The archive is grouped by Upbit's UTC trading day. UTC 00:00 is 09:00 KST,
so each file maps exactly to the 09:00 KST session boundary used by the
bitcoin intraday research tab.

Research/data only. This script never places orders.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

MARKET = os.environ.get("JKQ_CRYPTO_MARKET", "KRW-BTC").upper()
UNIT = int(os.environ.get("JKQ_CRYPTO_UNIT", "5"))
BACKFILL_DAYS = int(os.environ.get("JKQ_CRYPTO_BACKFILL_DAYS", "365"))
API = "https://api.upbit.com"
UTC = timezone.utc
KST = ZoneInfo("Asia/Seoul")
ROOT = Path("data") / "crypto" / MARKET / f"{UNIT}m"
ALLOWED_UNITS = {1, 3, 5, 10, 15, 30, 60, 240}

if UNIT not in ALLOWED_UNITS:
    raise SystemExit(f"unsupported minute unit: {UNIT}")


def request_json(path: str, params: dict, timeout: int = 30):
    qs = urllib.parse.urlencode(params)
    url = API + path + ("?" + qs if qs else "")
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "jkquant-crypto-collector/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:
            last = e
        time.sleep(min(8.0, 0.8 * (2 ** attempt)))
    raise RuntimeError(f"Upbit request failed: {last}")


def parse_utc(text: str) -> datetime:
    return datetime.fromisoformat(str(text).replace("Z", "+00:00")).replace(tzinfo=UTC)


def existing_dates():
    out = []
    if not ROOT.exists():
        return out
    for p in ROOT.glob("*.json.gz"):
        try:
            out.append(date.fromisoformat(p.name[:10]))
        except Exception:
            pass
    return sorted(set(out))


def fetch_range(start_dt: datetime, end_dt: datetime):
    """Fetch [start_dt, end_dt) in ascending order."""
    cursor = end_dt
    rows_by_ts = {}
    calls = 0
    while cursor > start_dt:
        rows = request_json(
            f"/v1/candles/minutes/{UNIT}",
            {
                "market": MARKET,
                "to": cursor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "count": 200,
            },
        )
        calls += 1
        if not rows:
            break

        oldest = None
        for r in rows:
            t = parse_utc(r.get("candle_date_time_utc", ""))
            if oldest is None or t < oldest:
                oldest = t
            if start_dt <= t < end_dt:
                rows_by_ts[t] = {
                    "tUtc": r.get("candle_date_time_utc"),
                    "tKst": r.get("candle_date_time_kst"),
                    "o": float(r.get("opening_price") or 0),
                    "h": float(r.get("high_price") or 0),
                    "l": float(r.get("low_price") or 0),
                    "c": float(r.get("trade_price") or 0),
                    "v": float(r.get("candle_acc_trade_volume") or 0),
                    "amount": float(r.get("candle_acc_trade_price") or 0),
                }

        if oldest is None or oldest <= start_dt:
            break
        cursor = oldest
        time.sleep(0.14)

    out = [rows_by_ts[k] for k in sorted(rows_by_ts)]
    return out, calls


def write_days(bars):
    grouped = {}
    for b in bars:
        d = str(b["tUtc"])[:10]
        grouped.setdefault(d, []).append(b)

    expected = (24 * 60) // UNIT
    min_bars = int(expected * 0.95)
    written = []
    incomplete = []

    ROOT.mkdir(parents=True, exist_ok=True)
    for d, rows in sorted(grouped.items()):
        rows.sort(key=lambda x: x["tUtc"])
        if len(rows) < min_bars:
            incomplete.append((d, len(rows)))
            continue

        payload = {
            "schema": 1,
            "source": "upbit",
            "market": MARKET,
            "unitMinutes": UNIT,
            "sessionDateUtc": d,
            "sessionStartKst": f"{d}T09:00:00+09:00",
            "collectedAt": datetime.now(KST).isoformat(),
            "barCount": len(rows),
            "expectedBars": expected,
            "bars": rows,
        }
        out = ROOT / f"{d}.json.gz"
        with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as gz:
            json.dump(payload, gz, ensure_ascii=False, separators=(",", ":"))
        written.append((d, len(rows), out.stat().st_size))

    return written, incomplete


def main():
    now = datetime.now(UTC)
    today = now.date()
    end_dt = datetime.combine(today, dtime.min, tzinfo=UTC)  # current UTC day is not complete

    have = existing_dates()
    if have:
        # Re-fetch a small overlap so late data corrections never create holes.
        start_day = max(have[-1] - timedelta(days=2), today - timedelta(days=BACKFILL_DAYS))
        mode = "incremental"
    else:
        start_day = today - timedelta(days=BACKFILL_DAYS)
        mode = "initial-backfill"

    start_dt = datetime.combine(start_day, dtime.min, tzinfo=UTC)
    if start_dt >= end_dt:
        print("No completed UTC session to collect.")
        return 0

    bars, calls = fetch_range(start_dt, end_dt)
    written, incomplete = write_days(bars)

    print(json.dumps({
        "mode": mode,
        "market": MARKET,
        "unitMinutes": UNIT,
        "from": start_day.isoformat(),
        "toExclusive": today.isoformat(),
        "apiCalls": calls,
        "barsFetched": len(bars),
        "daysWritten": len(written),
        "lastWritten": written[-1][0] if written else None,
        "incompleteDays": incomplete[:10],
    }, ensure_ascii=False, indent=2))

    if not written and not have:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
