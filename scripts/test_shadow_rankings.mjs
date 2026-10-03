import fs from "node:fs";
import assert from "node:assert/strict";
import {CATALOG,normalize,fallbackScore} from "../functions/api/scalping-shadow-ranking.js";

console.log("[shadow ranking] 최소 10개 + 순위/표본 보정 검사");

for(const [kind,names] of Object.entries(CATALOG)){
  assert.ok(names.length>=15,kind+" shadow catalog must be >=15");
  assert.equal(new Set(names).size,names.length,kind+" shadow names must be unique");
}

const opening=fs.readFileSync("functions/api/_opening.js","utf8");
const openingBlock=(opening.match(/SHADOW_VARIANTS=Object\.freeze\(\[([\s\S]*?)\]\);/)||[])[1]||"";
assert.ok((openingBlock.match(/name:"/g)||[]).length>=10,"opening live shadows <10");

for(const [path,kind] of [
  ["scripts/backtest_daytrading.py","daytrading"],
  ["scripts/backtest_crypto_orb.py","crypto"],
  ["scripts/backtest_soxl_intraday.py","soxl"],
]){
  const s=fs.readFileSync(path,"utf8");
  const block=(s.match(/VARIANTS\s*=\s*\[([\s\S]*?)\]\n/)||[])[1]||"";
  const names=[...block.matchAll(/Params\("([^"]+)"/g)].map(m=>m[1]);
  assert.ok(names.includes("baseline"),kind+" baseline missing");
  assert.ok(names.filter(x=>x!=="baseline").length>=10,kind+" shadows <10");
}

const good={name:"vol_1.0",allAvgEdgePct:.20,holdoutAvgEdgePct:.20,recentEdgePct:.5,trades:50,mddOk:true};
const bad={name:"vol_1.5",allAvgEdgePct:-.20,holdoutAvgEdgePct:-.20,recentEdgePct:-.5,trades:50,mddOk:false};
const gs=fallbackScore("crypto",good),bs=fallbackScore("crypto",bad);
assert.ok(gs.score>50 && bs.score<50 && gs.score>bs.score,"score direction broken");

const low=fallbackScore("crypto",{...good,trades:5});
assert.ok(Math.abs(low.score-50)<Math.abs(gs.score-50),"low sample must shrink toward 50");

const rep={status:"reviewable",from:"2026-01-01",to:"2026-10-01",candidates:[
  {...good,researchScore:70,sampleFactor:1,status:"review"},
  {...bad,researchScore:30,sampleFactor:1,status:"collecting"}
]};
const n=normalize("crypto",rep);
assert.equal(n.rows.length,10);
assert.ok(n.totalCandidatePool>=15,"candidate pool should be at least 15");
assert.ok(n.reserveRows.length>=5,"at least 5 reserve candidates should be available");
assert.equal(n.rows[0].name,"vol_1.0");
assert.ok(n.rows.findIndex(x=>x.trades===0)>0,"zero evidence rows should not lead");
assert.deepEqual(n.rows.map(x=>x.rank),[1,2,3,4,5,6,7,8,9,10]);

console.log("ALL PASS — shadow strategy minimum/ranking");
