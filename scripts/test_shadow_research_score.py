#!/usr/bin/env python3
import importlib.util
import sys
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


print("[shadow generator] 주 1회 생성·중복 금지·실제 경쟁군 진입 검사")
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
assert len(s1["generatedPool"])==1
assert s1["generatedPool"][0]["name"]=="cf_g0001"
assert s1["generatedPool"][0]["params"]==m.factory_params("crypto",1)

s1_same=m.evolve_lifecycle("crypto",rep,s1)
assert s1_same["factoryGeneration"]==1
assert len(s1_same["generatedPool"])==1

rep["to"]="2026-10-07"
s6=m.evolve_lifecycle("crypto",rep,s1_same)
assert s6["factoryGeneration"]==1, "7일 미만에는 신규 세대 생성 금지"

rep["to"]="2026-10-08"
s2=m.evolve_lifecycle("crypto",rep,s6)
assert s2["factoryGeneration"]==2
assert [x["name"] for x in s2["generatedPool"]]==["cf_g0001","cf_g0002"]

# 생성 후보가 충분한 전향적 표본을 얻은 뒤에는 정적 예비후보와 동일하게 경쟁한다.
generated={
    "name":"cf_g0001","status":"review","researchScore":95,
    "sampleFactor":1,"sampleReady":True,
    "scoreParts":{"trades":60,"minTrades":50},
    "allAvgEdgePct":.3,"holdoutAvgEdgePct":.3,"recentEdgePct":.5,"mddOk":True,
}
rep["candidates"]=base_candidates+[generated]
bad_name=s2["activeCandidates"][-1]
for day in (9,10,11):
    rep["to"]=f"2026-10-{day:02d}"
    for x in rep["candidates"]:
        if x["name"]==bad_name:
            x["researchScore"]=20
            x["sampleReady"]=True
            x["holdoutAvgEdgePct"]=-.5
            x["scoreParts"]={"trades":60,"minTrades":50}
    s2=m.evolve_lifecycle("crypto",rep,s2)
assert "cf_g0001" in s2["activeCandidates"], "자동생성 후보가 퇴출 빈자리를 실제로 채워야 함"
assert len(s2["activeCandidates"])>=10
print("ALL PASS — shadow generator")


print("[shadow generated parity] 야간 생성기와 Python 백테스트 파라미터 일치 검사")
def loadmod(path,name):
    spec=importlib.util.spec_from_file_location(name,Path(path))
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
    return mod

day=loadmod("scripts/backtest_daytrading.py","bt_day_generated")
btc=loadmod("scripts/backtest_crypto_orb.py","bt_btc_generated")
soxl=loadmod("scripts/backtest_soxl_intraday.py","bt_soxl_generated")
for g in (1,2,7,25,101):
    name=f"cf_g{g:04d}"
    assert m.factory_params("daytrading",g)==day.generated_params(name)
    assert m.factory_params("crypto",g)==btc.generated_params(name)
    assert m.factory_params("soxl",g)==soxl.generated_params(name)
print("ALL PASS — generated Python parameter parity")
