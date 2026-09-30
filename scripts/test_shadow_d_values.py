#!/usr/bin/env python3
import gzip
import json
import math
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import scripts.backtest_crypto_orb as btc
import scripts.backtest_soxl_intraday as sx


def hour_bar(dt, o=100.0, c=100.0):
    return {
        "tKst": dt.isoformat(timespec="seconds"),
        "tUtc": (dt-timedelta(hours=9)).isoformat(timespec="seconds"),
        "o": o, "h": max(o,c), "l": min(o,c), "c": c, "v": 1.0
    }


def btc_fixture(drop_close=94.0, entry_open=95.0, exit_close=99.75):
    start=datetime(2026,1,1,0,0,0)
    bars=[]
    for i in range(50):
        o=c=100.0
        if i==24: o=c=drop_close
        elif i==25: o=c=entry_open
        elif 25<i<48: o=c=entry_open
        elif i==48: o=c=exit_close
        bars.append(hour_bar(start+timedelta(hours=i),o,c))
    return [{"sessionDateUtc":"fixture","bars":bars}]


def test_btc():
    cfg=btc.SHADOW_STRATEGIES[0]
    r=btc.btc_24h_drop_shadow(btc_fixture(),cfg)
    assert cfg["evaluationScope"]=="all_available"
    assert cfg["ordersAllowed"] is False
    assert len(r["trades"])==1,r
    t=r["trades"][0]
    assert math.isclose(t["drop24hPct"],-6.0,abs_tol=1e-9),t
    assert math.isclose(t["grossPnlPct"],5.0,abs_tol=1e-9),t
    assert math.isclose(t["pnlPct"],4.88,abs_tol=1e-9),t
    assert t["reason"]=="24h_time_exit"
    no=btc.btc_24h_drop_shadow(btc_fixture(drop_close=96.0),cfg)
    assert len(no["trades"])==0,no
    print("✓ D-3 values: drop<=-5%, 24h hold, 0.12% friction, all stored dates")


def write_gz(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(path,"wt",encoding="utf-8") as f:
        json.dump({"rows":rows},f)


def test_soxl():
    cfg=sx.SHADOW_STRATEGIES[0]
    with tempfile.TemporaryDirectory() as td:
        p=Path(td)/"soxl.json.gz"
        write_gz(p,[
            {"date":"2026-01-02","open":100.0,"high":105.0,"low":98.0,"close":104.0,"adjClose":104.0},
            {"date":"2026-01-03","open":104.0,"high":106.0,"low":103.0,"close":105.0,"adjClose":105.0},
        ])
        old=sx.SOXL_DAILY
        try:
            sx.SOXL_DAILY=p
            r=sx.soxl_oversold_shadow(cfg,["2026-01-01","2026-01-02"],{"2026-01-01":20.0,"2026-01-02":37.0})
        finally:
            sx.SOXL_DAILY=old
    assert cfg["evaluationScope"]=="all_available"
    assert cfg["ordersAllowed"] is False
    assert r["evaluationDays"]==2,r
    assert len(r["trades"])==1,r
    t=r["trades"][0]
    assert t["date"]=="2026-01-02",t
    assert math.isclose(t["soxxPrevRsi14"],20.0,abs_tol=1e-12),t
    assert math.isclose(t["grossPnlPct"],4.0,abs_tol=1e-12),t
    assert math.isclose(t["pnlPct"],3.8,abs_tol=1e-12),t
    assert t["reason"]=="same_day_close"
    assert t["evidence"]["overnightHold"] is False
    print("✓ D-4 values: prior SOXX RSI<35, SOXL open→same-day close, 0.20% friction")


if __name__=="__main__":
    test_btc()
    test_soxl()
