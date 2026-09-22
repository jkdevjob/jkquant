#!/usr/bin/env python3
"""Collect one Korean trading day's 09:00~09:30 1-minute bars for the top-100 universe.

Runs after market close from GitHub Actions.  The universe snapshot is saved with its
rank so the same data can later compare Top50 vs Top100 without survivor/ranking leakage.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = os.environ.get("JKQ_BASE_URL", "https://jkquant.pages.dev").rstrip("/")
LIMIT = int(os.environ.get("JKQ_UNIVERSE_LIMIT", "100"))
KST = ZoneInfo("Asia/Seoul")


def get_json(path: str, timeout: int = 60):
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json", "User-Agent": "jkquant-scalping-collector/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def daily_meta(code: str, date_iso: str):
    """Return exact previous close for gap backtests.

    The KIS minute archive already contains the day's actual 09:00 open. We only need
    the prior daily close here. Falling back is handled by the backtester for older
    files that predate this field.
    """
    qs = urllib.parse.urlencode({"symbol": code, "range": "5d", "intraday": "0", "div": "0"})
    last = None
    for attempt in range(3):
        try:
            j = get_json("/api/quote?" + qs, timeout=60)
            rows = j.get("ohlc") or []
            prev = [x for x in rows if str(x.get("date") or "") < date_iso and float(x.get("close") or 0) > 0]
            if prev:
                p = prev[-1]
                return {"prevClose": float(p.get("close") or 0), "prevDate": str(p.get("date") or "")}, None
            raise RuntimeError("previous close not found")
        except Exception as e:
            last = e
            time.sleep(1.0 + attempt)
    return {}, str(last)


def minute_history(code: str, date_yyyymmdd: str):
    qs = urllib.parse.urlencode({"op": "minhist", "code": code, "date": date_yyyymmdd, "hour": "093000"})
    last = None
    for attempt in range(4):
        try:
            j = get_json("/api/kis?" + qs, timeout=90)
            if j.get("error"):
                last = RuntimeError(str(j.get("error")))
                if j.get("rateLimited"):
                    time.sleep(2.0 + attempt * 1.5)
                    continue
                raise last
            bars = []
            for b in j.get("bars") or []:
                t = str(b.get("t") or "")
                hhmmss = t[-6:] if len(t) >= 6 else ""
                if "090000" <= hhmmss <= "093000":
                    bars.append({
                        "t": t,
                        "o": float(b.get("o") or 0),
                        "h": float(b.get("h") or 0),
                        "l": float(b.get("l") or 0),
                        "c": float(b.get("c") or 0),
                        "v": float(b.get("v") or 0),
                    })
            return bars, None
        except Exception as e:
            last = e
            time.sleep(1.5 + attempt * 1.5)
    return [], str(last)


def main():
    now = datetime.now(KST)
    date_iso = os.environ.get("JKQ_DATE", now.strftime("%Y-%m-%d"))
    date_compact = date_iso.replace("-", "")

    u = get_json(f"/api/universe?limit={LIMIT}", timeout=90)
    universe = u.get("universe") or []
    if not universe:
        print("Universe is empty; nothing collected.")
        return 1

    rows = []
    errors = []
    successful = 0
    for idx, item in enumerate(universe, 1):
        code = str(item.get("code") or "")
        if not code:
            continue
        bars, err = minute_history(code, date_compact)
        meta, meta_err = daily_meta(code, date_iso)
        if bars:
            successful += 1
        if err:
            errors.append({"rank": idx, "code": code, "error": err})
        if meta_err:
            errors.append({"rank": idx, "code": code, "error": "daily-meta: " + meta_err})

        day_open = float(bars[0].get("o") or bars[0].get("c") or 0) if bars else 0.0
        prev_close = float(meta.get("prevClose") or 0)
        gap = ((day_open / prev_close - 1.0) * 100.0) if day_open > 0 and prev_close > 0 else None

        rows.append({
            "rank": idx,
            "code": code,
            "name": item.get("name") or code,
            "market": item.get("market") or "",
            "amount": item.get("amount") or 0,
            "cap": item.get("cap") or 0,
            "chg": item.get("chg") or 0,
            "close": item.get("close") or 0,
            "open": day_open,
            "prevClose": prev_close,
            "prevDate": meta.get("prevDate") or "",
            "gap": gap,
            "bars": bars,
        })
        print(f"{idx:03d}/{len(universe)} {code} bars={len(bars)} gap={gap if gap is not None else 'n/a'}")
        time.sleep(0.70)

    # Holiday / no-session day: all symbols have no intraday bars. Do not create an empty dataset.
    if successful == 0:
        print(f"{date_iso}: no 09:00~09:30 bars found; treating as market holiday/no-session.")
        return 0

    min_required = max(1, int(len(universe) * 0.90))
    if successful < min_required:
        print(f"Only {successful}/{len(universe)} symbols collected; require >= {min_required}.", file=sys.stderr)
        print(json.dumps(errors[:20], ensure_ascii=False, indent=2), file=sys.stderr)
        return 2

    payload = {
        "schema": 2,
        "date": date_iso,
        "collectedAt": datetime.now(KST).isoformat(),
        "universeLimit": LIMIT,
        "universeSource": u.get("source") or "",
        "count": len(rows),
        "successful": successful,
        "errors": errors,
        "universe": rows,
    }

    out = Path("data") / "scalping" / date_iso[:4] / f"{date_iso}.json.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as gz:
        json.dump(payload, gz, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out} ({out.stat().st_size:,} bytes), success {successful}/{len(universe)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
