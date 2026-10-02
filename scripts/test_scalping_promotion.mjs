import fs from "node:fs";
import assert from "node:assert/strict";
import {normalize,isPromotionEligible,PROMOTION_MIN_SCORE} from "../functions/api/scalping-shadow-ranking.js";
import {promotionDecision} from "../functions/api/scalping-promotion.js";

console.log("[scalping promotion] 수동 승격 가드 + 다음세션 잠금 검사");

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

const ui=fs.readFileSync("scalping.html","utf8");
assert.ok(/id="scVer">v1\.38\.0/.test(ui));
assert.ok(ui.includes("⭐ 메인전략 승격"));
assert.ok(ui.includes("원래 기준전략으로 원복"));
assert.ok(ui.includes("다음 새 세션부터"));
assert.ok(ui.includes("/api/scalping-promotion"));

const promotion=fs.readFileSync("functions/api/scalping-promotion.js","utf8");
assert.ok(promotion.includes("accounts:lookup"),"owner Firebase 재검증 필요");
assert.ok(promotion.includes("promotionDecision"),"서버측 승격 재검증 필요");
assert.ok(promotion.includes('"x-monitor-key":key'),"Worker 설정 변경은 monitor key로 보호");
assert.ok(promotion.includes('effective:"next-new-session"'));

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
assert.ok(gw.includes("n.hm<935"),"SOXL OR5 실시간 관찰이 늦으면 안 됨");

console.log("ALL PASS — manual scalping promotion");
