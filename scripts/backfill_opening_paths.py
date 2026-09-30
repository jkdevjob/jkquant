#!/usr/bin/env python3
"""Backfill missing 30-minute post-signal KIS OHLC into immutable scalping archives.

Only rows that produce at least one opening baseline/shadow signal and do not yet
have a complete 30-minute outcome window are fetched. Existing bars are merged by
timestamp; signal rules and historical strategy metadata are not rewritten.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from backtest_opening_rebreak import VARIANTS, hm, one_trade

DATA = Path("data/scalping")
BASE = os.environ.get("JKQ_BASE_URL", "https://jkquant.pages.dev").rstrip("/")
KST = ZoneInfo("Asia/Seoul")


def get_json(path: str, timeout: int = 90):
    req = urllib.request.Request(
        BASE + path,
        headers={"Accept": "application/json", "User-Agent": "jkquant-opening-path-backfill/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def minute_history(code: str, date_yyyymmdd: str):
    qs = urllib.parse.urlencode(
        {"op": "minhist", "code": code, "date": date_yyyymmdd, "hour": "100000"}
    )
    last = None
    for attempt in range(4):
        try:
            j = get_json("/api/kis?" + qs)
            if j.get("error"):
                raise RuntimeError(str(j.get("error")))
            rows = []
            for b in j.get("bars") or []:
                t = str(b.get("t") or "")
                hhmmss = t[-6:] if len(t) >= 6 else ""
                if "090000" <= hhmmss <= "100000":
                    rows.append(
                        {
                            "t": t,
                            "o": float(b.get("o") or 0),
                            "h": float(b.get("h") or 0),
                            "l": float(b.get("l") or 0),
                            "c": float(b.get("c") or 0),
                            "v": float(b.get("v") or 0),
                        }
                    )
            return rows
        except Exception as e:
            last = e
            time.sleep(1.5 + attempt * 1.5)
    raise RuntimeError(str(last or "KIS minute history failed"))


def merge_bars(old_rows, new_rows):
    by_t = {str(x.get("t") or ""): dict(x) for x in old_rows or [] if x.get("t")}
    for x in new_rows or []:
        if x.get("t"):
            by_t[str(x["t"])] = dict(x)
    return [by_t[k] for k in sorted(by_t)]


def row_needs_backfill(day, row):
    """Return True only when at least one configured variant has an incomplete path."""
    for p in VARIANTS:
        t = one_trade(day, row, p)
        if t and not t.get("outcomeWindowComplete"):
            return True
    return False


def main():
    changed_files = 0
    changed_rows = 0
    failed = []
    now = datetime.now(KST).isoformat()

    for path in sorted(DATA.glob("*/*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            day = json.load(f)
        date = str(day.get("date") or "")
        if not date:
            continue

        targets = [row for row in day.get("universe") or [] if row_needs_backfill(day, row)]
        if not targets:
            continue

        file_changed = False
        for row in targets:
            code = str(row.get("code") or "")
            if not code:
                continue
            try:
                fresh = minute_history(code, date.replace("-", ""))
                merged = merge_bars(row.get("bars") or [], fresh)
                before = len(row.get("bars") or [])
                if len(merged) > before or merged != (row.get("bars") or []):
                    row["bars"] = merged
                    row["outcomeBarsSource"] = "KIS 1m 09:00~10:00"
                    row["outcomeBarsBackfilledAt"] = now
                    changed_rows += 1
                    file_changed = True
                time.sleep(0.70)
            except Exception as e:
                failed.append({"date": date, "code": code, "error": str(e)[:180]})

        if file_changed:
            day["schema"] = max(4, int(day.get("schema") or 0))
            day["openingOutcomeBackfilledAt"] = now
            with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as gz:
                json.dump(day, gz, ensure_ascii=False, separators=(",", ":"))
            changed_files += 1
            print(f"backfilled {path}: {len(targets)} signal rows")

    print(
        json.dumps(
            {
                "changedFiles": changed_files,
                "changedRows": changed_rows,
                "failed": len(failed),
                "failures": failed[:20],
            },
            ensure_ascii=False,
        )
    )
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
