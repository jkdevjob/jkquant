#!/usr/bin/env python3
"""Focused value checks for opening-signal outcome labels."""

from backtest_opening_rebreak import Params, opening_diagnostics, opening_path_metrics, one_trade
from backfill_opening_paths import merge_bars


def bar(hm, close=100.0, high=None, low=None, volume=100.0):
    return {
        "hm": hm,
        "o": close,
        "h": close if high is None else high,
        "l": close if low is None else low,
        "c": close,
        "v": volume,
        "signal_h": close,
    }


def test_path_labels():
    rows = [bar(900 + i) for i in range(41)]
    entry_i = 10
    rows[15].update(h=101.2, c=100.5)
    rows[20].update(l=98.8, c=99.5)
    rows[30].update(h=102.2, c=101.0)
    rows[40].update(l=97.8, c=100.2)

    z = opening_path_metrics(rows, entry_i, 100.0)
    assert z["hitPlus1Time"] == 915
    assert z["hitMinus1Time"] == 920
    assert z["hitPlus2Time"] == 930
    assert z["hitMinus2Time"] == 940
    for n in (5, 10, 20, 30):
        assert z[f"fwd{n}mPct"] is not None
    assert z["outcomeWindowMin"] == 30


def test_exit_rule_still_stops_at_0930():
    bars = []
    for minute in range(61):
        hh = 9 + minute // 60
        mm = minute % 60
        hm = hh * 100 + mm
        close = 100.0
        volume = 100.0
        if hm == 903:
            close = 101.0
        elif hm == 904:
            close = 100.5
        elif 905 <= hm <= 930:
            close = 101.2
            if hm == 905:
                volume = 200.0
        elif hm == 931:
            close = 104.0
        bars.append({
            "t": f"20260930{hm:04d}00",
            "o": close, "h": close, "l": close, "c": close, "v": volume,
        })

    day = {"date": "2026-09-30"}
    row = {
        "rank": 1, "code": "000001", "name": "TEST",
        "open": 100.0, "prevClose": 97.0, "bars": bars,
    }
    p = Params("baseline", amount_mult=1.0)
    t = one_trade(day, row, p)
    assert t is not None
    assert t["exitTime"] == 930
    assert t["reason"] == "time_exit"
    assert t["exitPrice"] == 101.2
    assert t["strategyVersion"] == "opening_rebreak_v1"
    assert t["signalSchemaVersion"] == 2
    assert t["strategyParams"]["name"] == "baseline"


def test_archived_trade_has_complete_30m_path():
    bars = []
    # 09:00~10:00 archive. Signal: 09:03 first breakout, 09:04 pullback, 09:05 rebreak.
    for minute in range(61):
        hh = 9 + minute // 60
        mm = minute % 60
        hm = hh * 100 + mm
        close = 100.0
        high = close
        low = close
        volume = 100.0
        if hm == 903:
            close = high = 101.0
        elif hm == 904:
            close = 100.5
            high = 100.7
        elif hm == 905:
            close = high = 101.2
            low = 101.0
            volume = 250.0
        elif 906 <= hm <= 935:
            close = 101.15
            high = 101.45
            low = 100.85
        bars.append({
            "t": f"20260930{hm:04d}00",
            "o": close, "h": high, "l": low, "c": close, "v": volume,
        })
    day = {"date": "2026-09-30"}
    row = {
        "rank": 1, "code": "000002", "name": "PATH",
        "open": 100.0, "prevClose": 97.0, "bars": bars,
    }
    t = one_trade(day, row, Params("baseline", amount_mult=1.0))
    assert t is not None, row
    assert t["entryTime"] == 905, t
    assert t["outcomeWindowComplete"] is True, t
    d = opening_diagnostics([t])
    assert d["pathCompleteTrades"] > 0, d
    assert isinstance(d["avgMae"], (int, float)), d
    assert t["fwd30mPct"] is not None, t


def test_backfill_merge_preserves_existing_and_extends():
    old = [{"t": "20260930090000", "c": 100, "o": 100, "h": 100, "l": 100, "v": 1}]
    new = [
        {"t": "20260930090000", "c": 100, "o": 100, "h": 101, "l": 99, "v": 2},
        {"t": "20260930100000", "c": 102, "o": 102, "h": 102, "l": 102, "v": 3},
    ]
    out = merge_bars(old, new)
    assert len(out) == 2, out
    assert out[0]["h"] == 101, out
    assert out[-1]["t"].endswith("100000"), out


if __name__ == "__main__":
    test_path_labels()
    test_exit_rule_still_stops_at_0930()
    test_archived_trade_has_complete_30m_path()
    test_backfill_merge_preserves_existing_and_extends()
    print("opening signal labels: PASS")
