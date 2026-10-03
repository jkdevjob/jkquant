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


print("[shadow lifecycle] 자동 퇴출·보충·7연속 1위 검사")
pool=m.CANDIDATE_POOLS["crypto"]
cands=[]
for i,name in enumerate(pool):
    cands.append({
        "name":name,
        "status":"review" if name=="vol_1.0" else "collecting",
        "researchScore":90 if name=="vol_1.0" else 70-i,
        "sampleFactor":1,
        "sampleReady":True,
        "scoreParts":{"trades":60,"minTrades":50},
        "allAvgEdgePct":.2 if name=="vol_1.0" else -.1,
        "holdoutAvgEdgePct":.2 if name=="vol_1.0" else -.1,
        "recentEdgePct":.5 if name=="vol_1.0" else -.2,
        "mddOk":True,
    })
report={"to":"2026-10-01","candidates":cands}
state=None
for day in range(1,8):
    report["to"]=f"2026-10-{day:02d}"
    state=m.evolve_lifecycle("crypto",report,state)
assert len(state["activeCandidates"])>=10
assert state["leader"]["name"]=="vol_1.0"
assert state["leader"]["consecutiveResearchSessions"]==7
assert state["autoPromotionReady"] is True
assert state["autoPromotionCandidate"]=="vol_1.0"

bad_name=state["activeCandidates"][-1]
for day in range(8,11):
    report["to"]=f"2026-10-{day:02d}"
    for x in cands:
        if x["name"]==bad_name:
            x["researchScore"]=20
            x["holdoutAvgEdgePct"]=-.5
            x["sampleReady"]=True
    state=m.evolve_lifecycle("crypto",report,state)
assert bad_name not in state["activeCandidates"]
assert any(x["name"]==bad_name for x in state["retired"])
assert len(state["activeCandidates"])>=10
print("ALL PASS — shadow lifecycle")


print("[shadow generator] 새 연구세션마다 신규 후보 생성, 같은 세션 중복 금지")
base_candidates=[]
for i,name in enumerate(m.CANDIDATE_POOLS["crypto"]):
    base_candidates.append({
        "name":name,"status":"collecting","researchScore":60-i,
        "sampleFactor":0.5,"sampleReady":False,
        "scoreParts":{"trades":25,"minTrades":50},
        "holdoutAvgEdgePct":0.0,"mddOk":True,
    })
rep={"to":"2026-10-01","candidates":base_candidates}
s1=m.evolve_lifecycle("crypto",rep,None)
assert s1["factoryGeneration"]==1
assert len(s1["generatedCandidates"])==5
names1=[x["name"] for x in s1["generatedCandidates"]]
s1_same=m.evolve_lifecycle("crypto",rep,s1)
assert s1_same["factoryGeneration"]==1
assert [x["name"] for x in s1_same["generatedCandidates"]]==names1
rep["to"]="2026-10-02"
s2=m.evolve_lifecycle("crypto",rep,s1_same)
assert s2["factoryGeneration"]==2
assert [x["name"] for x in s2["generatedCandidates"]]!=names1
print("ALL PASS — shadow generator")
