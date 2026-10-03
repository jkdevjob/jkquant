import assert from "node:assert/strict";
import {autoPromotionDecision,effectiveFrom} from "../functions/api/scalping-auto-promotion.js";

console.log("[auto promotion] 7개 연구세션 연속 1위 + 기존 승격게이트 검사");

function section(streak=7,score=70,status="review",sampleReady=true,mddOk=true){
  const name="vol_1.0";
  return {
    status:"reviewable",
    lifecycle:{
      activeCandidates:["vol_1.0","vol_1.5","range_15m","range_30m","no_vwap","hold_30m","hold_120m","entry_by_1800","range_10m","vol_1.3"],
      leader:{name,consecutiveResearchSessions:streak,requiredResearchSessions:7,dates:Array.from({length:streak},(_,i)=>"2026-10-"+String(i+1).padStart(2,"0"))},
      autoPromotionCandidate:streak>=7?name:null,
      autoPromotionReason:streak>=7?"ready":"waiting"
    },
    candidates:[
      {name,status,researchScore:score,sampleFactor:1,sampleReady,
       trades:60,allAvgEdgePct:.2,holdoutAvgEdgePct:.2,recentEdgePct:.4,mddOk}
    ]
  };
}

assert.equal(autoPromotionDecision("crypto",section(6)).ok,false,"6 sessions must not promote");
assert.equal(autoPromotionDecision("crypto",section(7)).ok,true,"7 sessions plus gates should promote");
assert.equal(autoPromotionDecision("crypto",section(7,59.9)).ok,false,"score gate must still apply");
assert.equal(autoPromotionDecision("crypto",section(7,70,"collecting")).ok,false,"review gate must still apply");
assert.equal(autoPromotionDecision("crypto",section(7,70,"review",false)).ok,false,"sample gate must still apply");
assert.equal(autoPromotionDecision("crypto",section(7,70,"review",true,false)).ok,false,"risk gate must still apply");

const sat=Date.parse("2026-10-02T23:36:00Z");
assert.equal(effectiveFrom("opening",sat),"2026-10-05");
assert.equal(effectiveFrom("daytrading",sat),"2026-10-05");
assert.equal(effectiveFrom("crypto",sat),"2026-10-04");
assert.equal(effectiveFrom("soxl",sat),"2026-10-05");

console.log("ALL PASS — guarded auto promotion");
