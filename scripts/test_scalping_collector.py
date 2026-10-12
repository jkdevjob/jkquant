#!/usr/bin/env python3
"""Collector date/calendar guards, without network or archive mutations."""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

c = module("collector", os.environ.get("SCALPING_COLLECTOR_PATH", HERE / "collect_scalping_data.py"))
d = module("shadow", os.environ.get("SCALPING_SHADOW_PATH", HERE / "daily1_shadow_lab.py"))

class CollectorTests(unittest.TestCase):
    def test_stale_short_and_outside_window_bars_are_rejected(self):
        stamps = ["20261008090000", "090100", "20261012085900", "20261012090000", "20261012100000", "20261012100100"]
        bars = [{"t": t, "o": 100, "h": 102, "l": 99, "c": 101, "v": 5} for t in stamps]
        with patch.object(c, "get_json", return_value={"bars": bars}):
            rows, error = c.minute_history("000001", "20261012")
        self.assertIsNone(error)
        self.assertEqual([x["t"] for x in rows], ["20261012090000", "20261012100000"])

    def test_unknown_calendar_cannot_be_called_a_holiday(self):
        for reply in [{"ok": False, "open": False}, {"ok": True, "open": "N"},
                      {"ok": True, "date": "2026-10-08", "open": False},
                      {"ok": True, "date": "2026-10-12", "open": False, "unknown": True}]:
            with self.subTest(reply=reply), patch.object(c, "get_json", return_value=reply):
                with self.assertRaises(RuntimeError): c.session_open("2026-10-12")

    def test_weekend_and_confirmed_holiday_do_not_collect(self):
        with patch.dict(os.environ, {"JKQ_DATE": "2026-10-11"}), patch.object(c, "get_json") as get:
            self.assertEqual(c.main(), 0)
            get.assert_not_called()
        with patch.dict(os.environ, {"JKQ_DATE": "2026-10-09"}), patch.object(c, "get_json", return_value={
            "ok": True, "date": "2026-10-09", "open": False
        }) as get:
            self.assertEqual(c.main(), 0)
            self.assertEqual(get.call_count, 1)
            self.assertIn("op=holiday", get.call_args.args[0])

    def test_empty_open_session_is_failure_and_preserves_archive(self):
        with tempfile.TemporaryDirectory() as td:
            old = Path.cwd()
            os.chdir(td)
            try:
                archive = Path("data/scalping/2026/2026-10-12.json.gz")
                archive.parent.mkdir(parents=True)
                archive.write_bytes(b"keep-existing-archive")
                with patch.dict(os.environ, {"JKQ_DATE": "2026-10-12"}), \
                     patch.object(c, "session_open", return_value=True), \
                     patch.object(c, "get_json", return_value={"universe": [{"code": "000001"}]}), \
                     patch.object(c, "minute_history", return_value=([], "API failed")), \
                     patch.object(c, "daily_meta", return_value=({}, None)), patch.object(c.time, "sleep"):
                    self.assertEqual(c.main(), 2)
                self.assertEqual(archive.read_bytes(), b"keep-existing-archive")
            finally: os.chdir(old)

    def test_shadow_loader_quarantines_cached_krx_holiday(self):
        with tempfile.TemporaryDirectory() as td:
            data = Path(td)
            for date in ["2026-10-08", "2026-10-09"]:
                path = data / "scalping/2026" / (date + ".json.gz")
                path.parent.mkdir(parents=True, exist_ok=True)
                with gzip.open(path, "wt") as f: json.dump({"date": date, "universe": [{"code": "000001"}]}, f)
            with patch.object(d, "DATA", data):
                rows = d.load_opening_days()
            self.assertEqual([x["date"] for x in rows], ["2026-10-08"])
            self.assertTrue((data / "scalping/2026/2026-10-09.json.gz").exists())

if __name__ == "__main__": unittest.main()
