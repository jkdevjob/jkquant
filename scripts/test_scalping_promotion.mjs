import fs from "node:fs";
import assert from "node:assert/strict";
import {normalize,isPromotionEligible,PROMOTION_MIN_SCORE} from "../functions/api/scalping-shadow-ranking.js";
import {promotionDecision,effectiveFrom} from "../functions/api/scalping-promotion.js";
import {autoPromotionDecision} from "../functions/api/scalping-auto-promotion.js";

console.log("[scalping promotion] 승격 가드 + 다음세션 잠금 검사");

const eligible={name:"vol_1.0",review:true,sampleReady:true,riskOk:true,researchScore:PROMOTION_MIN_SCORE+5};
assert.equal(isPromotionEligible("crypto",eligible),true);
assert.equal(isPromotionEligible("crypto",{...eligible,review:false}),false,"review 변이를 막아야 함");
assert.equal(isPromotionEligible("crypto",{...eligible,sampleReady:false}),false,"표본부족 변이를 막아야 함");
assert.equal(isPromotionEligible("crypto",{...eligible,riskOk:false}),false,"위험 실패 변이를 막아야 함");
assert.equal(isPromotionEligible("crypto",{...eligible,researchScore:PROMOTION_MIN_SCORE-.01}),false,"점수 미달 변이를 막아야 함");
assert.equal(isPromotionEligible("opening",{...eligible,name:"hold_to_next_open"}),false,"오버나이트 그림자는 운영승격 금지");

const report={status:"reviewable",from:"2026-01-01",to:"2026-10-01",candidates:[
  {name:"vol_1.0",status:"review",researchScore:70,sampleFactor:1,sampleReady:true,
   trades:60,allAvgEdgePct:.2,holdoutAvgEdgePct:.2,recentEdgePct:.5,mddOk:true}
]};
const ranking=normalize("crypto",report);
assert.equal(ranking.rows.find(x=>x.name==="vol_1.0").promotionEligible,true);
assert.equal(promotionDecision("crypto","vol_1.0",ranking).ok,true);
assert.equal(promotionDecision("crypto","baseline",null).ok,true,"baseline 원복은 항상 허용");
assert.equal(promotionDecision("crypto","not_a_variant",ranking).ok,false);

const autoSection={
  ...report,
  lifecycle:{
    activeCandidates:["vol_1.0","vol_1.5","no_vwap","range_15m","range_30m","hold_30m","hold_120m","entry_by_1800","stop_0.3_tp_0.6","stop_0.7_tp_1.4"],
    retired:[],
    leader:{name:"vol_1.0",consecutiveResearchSessions:6,requiredResearchSessions:7,dates:["d1","d2","d3","d4","d5","d6"]},
    autoPromotionCandidate:"",
    autoPromotionReady:false,
    autoPromotionReason:"1위 유지 6/7 연구세션"
  }
};
assert.equal(autoPromotionDecision("crypto",autoSection).ok,false,"6연속 1위는 자동승격 금지");
autoSection.lifecycle.leader.consecutiveResearchSessions=7;
autoSection.lifecycle.leader.dates.push("d7");
autoSection.lifecycle.autoPromotionCandidate="vol_1.0";
autoSection.lifecycle.autoPromotionReady=true;
assert.equal(autoPromotionDecision("crypto",autoSection).ok,true,"7연속 1위 + 기존 승격조건 통과 시 자동승격 허용");
assert.equal(promotionDecision("crypto","not_a_variant",ranking).ok,false);

// 2026-10-03 08:36 KST = 2026-10-02 19:36 ET.
// 이미 시작된 세션은 바꾸지 않고 다음 새 세션부터 적용한다.
const sat=Date.parse("2026-10-02T23:36:00Z");
assert.equal(effectiveFrom("opening",sat),"2026-10-05");
assert.equal(effectiveFrom("daytrading",sat),"2026-10-05");
assert.equal(effectiveFrom("crypto",sat),"2026-10-04");
assert.equal(effectiveFrom("soxl",sat),"2026-10-05");
const monBeforeKr=Date.parse("2026-10-04T23:30:00Z"); // 10/05 08:30 KST
const monAfterKr=Date.parse("2026-10-05T00:01:00Z");  // 10/05 09:01 KST
assert.equal(effectiveFrom("opening",monBeforeKr),"2026-10-05");
assert.equal(effectiveFrom("opening",monAfterKr),"2026-10-06");
const monBeforeEt=Date.parse("2026-10-05T13:00:00Z"); // 09:00 ET
const monAfterEt=Date.parse("2026-10-05T13:31:00Z");  // 09:31 ET
assert.equal(effectiveFrom("soxl",monBeforeEt),"2026-10-05");
assert.equal(effectiveFrom("soxl",monAfterEt),"2026-10-06");

const ui=fs.readFileSync("scalping.html","utf8");
assert.ok(/id="scVer">v\d+\.\d+\.\d+</.test(ui));
assert.ok(!ui.includes("⭐ 메인전략 승격"),"일반 수동승격 버튼은 제거되어야 함");
assert.ok(ui.includes("자동승격"),"자동승격 상태 표시 필요");
assert.ok(ui.includes("원래 기준전략으로 원복"));
assert.ok(ui.includes("다음 새 세션부터"));
assert.ok(ui.includes("/api/scalping-promotion"));

const promotion=fs.readFileSync("functions/api/scalping-promotion.js","utf8");
assert.ok(promotion.includes("accounts:lookup"),"owner Firebase 재검증 필요");
assert.ok(promotion.includes("promotionDecision"),"서버측 승격 재검증 필요");
assert.ok(promotion.includes('"x-monitor-key":key'),"Worker 설정 변경은 monitor key로 보호");
assert.ok(promotion.includes('effective:"next-new-session"'));
assert.ok(promotion.includes("effectiveFrom"),"적용 시작일을 서버가 계산해야 함");
assert.ok(promotion.includes("previousVariant"),"진행 중 세션의 이전 메인 보존 필요");

const opening=fs.readFileSync("functions/api/opening-monitor.js","utf8");
assert.ok(opening.includes("baselineTrades"),"원래 opening baseline은 별도 보존");
assert.ok(opening.includes("operationalTrades"),"승격 운영 이력은 baseline과 분리");

const ow=fs.readFileSync("worker/opening-scheduler/src/index.js","utf8");
assert.ok(ow.includes("__gpt_opening_strategy_config__"));
assert.ok(ow.includes("mainVariantForDate"));
assert.ok(ow.includes('u.pathname==="/config"'));

const dw=fs.readFileSync("worker/daytrading-scheduler/src/index.js","utf8");
assert.ok(dw.includes("__gpt_daytrading_strategy_config__"));
assert.ok(dw.includes("snapshotHm:now.hm"));
assert.ok(dw.includes("schema:2,date,mainVariant"),"09:55 snapshot에 메인전략 잠금");
assert.ok(dw.includes('u.pathname==="/config"'));

const gw=fs.readFileSync("worker/global-intraday-scheduler/src/index.js","utf8");
assert.ok(gw.includes("__gpt_strategy_config__"));
assert.ok(gw.includes("mainVariantForDate"));
assert.ok(gw.includes("BTC_VARIANTS"));
assert.ok(gw.includes("SOXL_VARIANTS"));
assert.ok(gw.includes('u.pathname==="/config"'));
for(const txt of [ow,dw,gw]){
  assert.ok(txt.includes("history"),"승격 이력을 Durable Object 설정에 보존해야 함");
  assert.ok(txt.includes("effectiveFrom"),"다음 세션 적용 경계가 Worker에도 있어야 함");
  assert.ok(txt.includes("previousVariant"),"이전 메인전략을 보존해야 함");
}
assert.ok(gw.includes("n.hm<935"),"SOXL OR5 실시간 관찰이 늦으면 안 됨");

console.log("ALL PASS — scalping promotion guards");