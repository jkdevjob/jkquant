#!/usr/bin/env python3
"""Collect completed SOXL 5-minute regular-session bars from Yahoo Finance.

The public Yahoo chart endpoint exposes a rolling intraday window. The first
run backfills what the source makes available and subsequent daily runs keep
completed sessions on the scalping-data branch so the local archive can grow.

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
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SYMBOL = os.environ.get("JKQ_SOXL_SYMBOL", "SOXL").upper()
SOXX_SYMBOL = "SOXX"
ROOT = Path("data") / "soxl" / SYMBOL / "5m"
SOXX_DAILY = Path("data") / "soxl" / SOXX_SYMBOL / "1d" / "series.json.gz"
NY = ZoneInfo("America/New_York")
UTC = timezone.utc
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def request_chart():
    q = urllib.parse.urlencode({
        "interval": "5m",
        "range": "60d",
        "includePrePost": "false",
        "events": "div,splits",
    })
    last = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{urllib.parse.quote(SYMBOL)}?{q}"
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": UA,
                    "Accept": "application/json",
                    "Referer": "https://finance.yahoo.com/",
                })
                with urllib.request.urlopen(req, timeout=30) as r:
                    j = json.loads(r.read().decode("utf-8"))
                res = ((j.get("chart") or {}).get("result") or [None])[0]
                if res:
                    return res, host
                last = RuntimeError(str((j.get("chart") or {}).get("error") or "empty result"))
            except urllib.error.HTTPError as e:
                last = e
                if e.code not in (401, 429, 500, 502, 503, 504):
                    raise
            except Exception as e:
                last = e
            time.sleep(min(8.0, 0.8 * (2 ** attempt)))
    raise RuntimeError(f"Yahoo chart request failed: {last}")


def request_soxx_daily():
    q = urllib.parse.urlencode({
        "interval": "1d",
        "range": "max",
        "includePrePost": "false",
        "events": "div,splits",
        "includeAdjustedClose": "true",
    })
    last = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{SOXX_SYMBOL}?{q}"
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": UA,
                    "Accept": "application/json",
                    "Referer": "https://finance.yahoo.com/",
                })
                with urllib.request.urlopen(req, timeout=30) as r:
                    j = json.loads(r.read().decode("utf-8"))
                res = ((j.get("chart") or {}).get("result") or [None])[0]
                if not res:
                    raise RuntimeError(str((j.get("chart") or {}).get("error") or "empty result"))
                ts = res.get("timestamp") or []
                q0 = ((res.get("indicators") or {}).get("quote") or [{}])[0]
                adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
                close = q0.get("close") or []
                rows = []
                for i, t in enumerate(ts):
                    c = close[i] if i < len(close) else None
                    a = adj[i] if i < len(adj) else None
                    if c is None or a is None:
                        continue
                    rows.append({
                        "date": datetime.fromtimestamp(int(t), UTC).date().isoformat(),
                        "close": float(c),
                        "adjClose": float(a),
                    })
                if rows:
                    return {
                        "schema": 1,
                        "symbol": SOXX_SYMBOL,
                        "source": "Yahoo Finance public chart endpoint",
                        "sourceHost": host,
                        "adjusted": True,
                        "rows": rows,
                    }
                raise RuntimeError("SOXX daily rows empty")
            except Exception as e:
                last = e
            time.sleep(min(8.0, 0.8 * (2 ** attempt)))
    raise RuntimeError(f"Yahoo SOXX daily request failed: {last}")


def deterministic_gzip_json(path: Path, payload: dict) -> bool:
    raw = (json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if path.exists():
        try:
            with gzip.open(path, "rb") as f:
                if f.read() == raw:
                    return False
        except Exception:
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("wb") as fh:
        with gzip.GzipFile(filename="", mode="wb", fileobj=fh, mtime=0) as gz:
            gz.write(raw)
    tmp.replace(path)
    return True


def hm(dt: datetime) -> int:
    return dt.hour * 100 + dt.minute


def main():
    res, host = request_chart()
    soxx_written = False
    soxx_error = None
    try:
        soxx_payload = request_soxx_daily()
        soxx_written = deterministic_gzip_json(SOXX_DAILY, soxx_payload)
    except Exception as e:
        soxx_error = str(e)
        print(f"SOXX adjusted daily collection warning: {e}")
    ts = res.get("timestamp") or []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    O = q.get("open") or []
    H = q.get("high") or []
    L = q.get("low") or []
    C = q.get("close") or []
    V = q.get("volume") or []
    groups = {}

    for i, t in enumerate(ts):
        if i >= len(C) or C[i] is None:
            continue
        dt_utc = datetime.fromtimestamp(int(t), UTC)
        dt_et = dt_utc.astimezone(NY)
        minute = dt_et.hour * 60 + dt_et.minute
        if minute < 9 * 60 + 30 or minute >= 16 * 60:
            continue
        o = O[i] if i < len(O) and O[i] is not None else C[i]
        h = H[i] if i < len(H) and H[i] is not None else C[i]
        l = L[i] if i < len(L) and L[i] is not None else C[i]
        v = V[i] if i < len(V) and V[i] is not None else 0
        d = dt_et.date().isoformat()
        groups.setdefault(d, []).append({
            "tUtc": dt_utc.isoformat().replace("+00:00", "Z"),
            "tEt": dt_et.isoformat(),
            "o": float(o),
            "h": float(h),
            "l": float(l),
            "c": float(C[i]),
            "v": float(v or 0),
        })

    now_et = datetime.now(NY)
    written = []
    skipped = []
    ROOT.mkdir(parents=True, exist_ok=True)
    for d, bars in sorted(groups.items()):
        bars = sorted(bars, key=lambda x: x["tEt"])
        if not bars:
            continue
        last_dt = datetime.fromisoformat(bars[-1]["tEt"])
        if d == now_et.date().isoformat() and hm(last_dt) < 1555:
            skipped.append({"date": d, "reason": "session_not_complete", "last": hm(last_dt)})
            continue
        if len(bars) < 30:
            skipped.append({"date": d, "reason": "too_few_regular_bars", "bars": len(bars)})
            continue
        payload = {
            "schema": 1,
            "symbol": SYMBOL,
            "sessionDateEt": d,
            "timezone": "America/New_York",
            "unitMinutes": 5,
            "source": "Yahoo Finance public chart endpoint",
            "sourceHost": host,
            "regularSessionOnly": True,
            "bars": bars,
        }
        path = ROOT / f"{d}.json.gz"
        if deterministic_gzip_json(path, payload):
            written.append(d)

    print(json.dumps({
        "symbol": SYMBOL,
        "sourceHost": host,
        "sessionsSeen": len(groups),
        "written": written,
        "writtenCount": len(written),
        "skipped": skipped,
        "archiveDir": str(ROOT),
        "soxxDailyPath": str(SOXX_DAILY),
        "soxxDailyWritten": soxx_written,
        "soxxDailyError": soxx_error,
    }, ensure_ascii=False, indent=2))
    if not groups:
        raise SystemExit("no SOXL regular-session bars returned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
