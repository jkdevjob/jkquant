#!/usr/bin/env python3
"""Focused value tests for SCALPING_IMPROVEMENTS_v2 A-1~A-4."""
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import backtest_opening_rebreak as eng

from backtest_opening_rebreak import (
    Params,
    MULTIPLE_TESTING_K,
    VARIANT_META,
    compute_exit_models,
    evaluation_trades,
    exact_sign_test_p_ge,
    opening_diagnostics,
    opening_friction_pct,
    opening_path_metrics,
    tick_size,
    walk_forward,
)


def bar(hm, c=100.0, h=None, l=None):
    return {
        "hm":hm,"o":c,"c":c,"h":c if h is None else h,"l":c if l is None else l,
        "v":100.0,"signal_h":c,
    }


def test_a1_complete_path():
    rows=[]
    for m in range(5,36):
        hm=900+m
        rows.append(bar(hm,100.0))
    # Entry 09:05, 30-minute endpoint 09:35 must exist.
    rows[5].update(h=101.0,c=100.5)   # 09:10
    rows[10].update(l=99.0,c=99.5)   # 09:15
    z=opening_path_metrics(rows,0,100.0)
    assert z["outcomeWindowComplete"] is True,z
    assert z["outcomeObservedMin"]==30,z
    assert isinstance(z["maePct"],float),z
    assert z["fwd30mPct"] is not None,z
    d=opening_diagnostics([{"date":"2026-09-30","entryTime":905,"code":"T","pnl":0.1,**z}])
    assert d["pathCompleteTrades"]==1,d
    assert isinstance(d["avgMae"],float),d

    collector=Path(__file__).with_name("collect_scalping_data.py").read_text(encoding="utf-8")
    backfill=Path(__file__).with_name("backfill_opening_paths.py").read_text(encoding="utf-8")
    assert '"hour": "100000"' in collector
    assert '<= "100000"' in collector
    assert '"toHm": 1000' in collector
    assert 'outcomeWindowComplete' in backfill and 'minute_history' in backfill


def test_a2_lowhigh_parallel_and_stop_first():
    rows=[bar(905)]
    # Same 09:06 minute touches both -1% and +1.5%, close touches neither.
    rows.append(bar(906,c=100.0,h=102.0,l=98.5))
    for m in range(7,31):
        rows.append(bar(900+m,c=100.0))
    p=Params("baseline")
    models=compute_exit_models(rows,0,100.0,p,0.5)
    assert models["close"]["exitModel"]=="close"
    assert models["close"]["reason"]=="time_exit",models
    assert models["lowhigh"]["exitModel"]=="lowhigh"
    assert models["lowhigh"]["reason"]=="stop",models
    assert abs(models["lowhigh"]["exitPrice"]-99.0)<1e-12,models
    assert abs(models["lowhigh"]["pnl"]-(-1.5))<1e-9,models
    # Production thresholds remain unchanged.
    assert p.stop==1.0 and p.take_profit==1.5 and p.final_exit==930,p


def test_a3_friction_values():
    fallback={"source":"tick_fallback_2.5_each_side","completeMatches":0,"avgRoundTripSlippageCostPct":None}
    assert tick_size(15000,"KOSPI")==10
    expected=0.23+2*2.5*10/15000*100
    assert abs(opening_friction_pct(15000,"KOSPI",fallback)-expected)<1e-12
    pre30={"source":"tick_fallback_2.5_each_side","completeMatches":29,"avgRoundTripSlippageCostPct":0.31}
    assert abs(opening_friction_pct(15000,"KOSPI",pre30)-expected)<1e-12
    observed={"source":"vts_observed_round_trip","completeMatches":30,"avgRoundTripSlippageCostPct":0.31}
    assert abs(opening_friction_pct(15000,"KOSPI",observed)-0.54)<1e-12

    # Calibration source itself must not switch before 30 complete VTS matches.
    old_vts=eng.VTS
    with TemporaryDirectory() as td:
        p=Path(td)/"latest.json"; eng.VTS=p
        p.write_text(json.dumps({"strategies":[{"strategy":"opening","completeMatches":29,"avgRoundTripSlippageCostPct":0.31}]}),encoding="utf-8")
        c=eng.load_friction_calibration()
        assert c["source"]=="tick_fallback_2.5_each_side",c
        p.write_text(json.dumps({"strategies":[{"strategy":"opening","completeMatches":30,"avgRoundTripSlippageCostPct":0.31}]}),encoding="utf-8")
        c=eng.load_friction_calibration()
        assert c["source"]=="vts_observed_round_trip",c
    eng.VTS=old_vts


def test_a4_design_exclusion_and_k13():
    assert VARIANT_META["today_combo_v1"]["designedFrom"]==["2026-09-22"]
    rows=[
        {"date":"2026-09-22","pnl":9.9},
        {"date":"2026-09-23","pnl":0.1},
    ]
    ev=evaluation_trades("today_combo_v1",rows)
    assert [x["date"] for x in ev]==["2026-09-23"],ev
    assert MULTIPLE_TESTING_K==13
    assert abs(exact_sign_test_p_ge(10,10)-(1/1024))<1e-12

    # 70 dates => ten 20d->5d OOS folds. Variant wins all 10 folds.
    start=date(2026,1,1)
    days=[{"date":str(start+timedelta(days=i))} for i in range(70)]
    def trades(pnl):
        return [{"date":d["date"],"entryTime":905,"code":"T","pnl":pnl,"gapEstimated":False} for d in days]
    wf=walk_forward(days,{"baseline":trades(0.1),"today_combo_v1":trades(0.2)})
    check=next(x for x in wf["adoptionChecks"] if x["name"]=="today_combo_v1")
    assert wf["multipleTesting"]["K"]==13,wf
    assert check["eligibleFolds"]==10,check
    assert check["beatsBaselineFolds"]==10,check
    assert check["oosAvgEdgePct"]>0,check
    assert check["bonferroniP"]<0.05,check
    assert check["adoptionEligible"] is True,check
    assert wf["adoptionRule"]["autoPromotion"] is False,wf


if __name__=="__main__":
    test_a1_complete_path()
    test_a2_lowhigh_parallel_and_stop_first()
    test_a3_friction_values()
    test_a4_design_exclusion_and_k13()
    print("SCALPING_IMPROVEMENTS_v2 focused values: PASS")
