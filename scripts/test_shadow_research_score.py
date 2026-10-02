#!/usr/bin/env python3
import importlib.util
from pathlib import Path

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
print("ALL PASS — shadow research score")
