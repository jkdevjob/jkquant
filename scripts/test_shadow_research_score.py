#!/usr/bin/env python3
import importlib.util
from pathlib import Path\nimport json\nimport tempfile

p=Path("scripts/nightly_scalping_research.py")
spec=importlib.util.spec_from_file_location("nightly_scalping_research",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

print("[shadow score] 표본 보정·방향·무표본 후순위 검사")
good=m.shadow_score(.20,.20,.50,True,50,50)
bad=m.shadow_score(-.20,-.20,-.50,False,50,50)
low=m.shadow_score(.20,.20,.50,True,5,50)
assert good["score"]>50>bad["score"]
assert abs(low["score"]-50)<abs(good["score"]-50)
assert good["sampleReady"] is True and low["sampleReady"] is False

rows=[
    {"name":"zero","researchScore":50,"sampleFactor":0,"scoreParts":{"trades":0}},
    {"name":"good","researchScore":70,"sampleFactor":1,"scoreParts":{"trades":50}},
    {"name":"bad","researchScore":30,"sampleFactor":1,"scoreParts":{"trades":50}},
]
ranked=m.rank_candidates(rows)
assert [x["name"] for x in ranked]==["good","bad","zero"]
assert [x["rank"] for x in ranked]==[1,2,3]
assert m.ranking_rule()["minShadowStrategies"]>=10
with tempfile.TemporaryDirectory() as td:
    old_out=m.OUT
    m.OUT=Path(td)
    for i in range(6):
        d=f"2026-09-{24+i:02d}"
        (m.OUT/f"{d}.json").write_text(json.dumps({
            "date":d,
            "crypto":{"lifecycle":{"leader":"vol_1.0"}}
        }),encoding="utf-8")
    report={"candidates":[
        {"name":"vol_1.0","rank":1,"status":"review","sampleReady":True,"researchScore":70,
         "mddOk":True,"profitFactorOk":True},
        *[{"name":f"candidate_{i}","rank":i+2,"status":"collecting","sampleReady":False,
           "researchScore":50-i} for i in range(13)]
    ]}
    got=m.apply_shadow_lifecycle("crypto",report)
    life=got["lifecycle"]
    assert len(life["active"])==10
    assert len(life["reserve"])==4
    assert life["leader"]=="vol_1.0"
    assert life["leaderDays"]==7
    assert life["autoPromotion"]["eligible"] is True
    m.OUT=old_out

print("ALL PASS — shadow research score + lifecycle")
