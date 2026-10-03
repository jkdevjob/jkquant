import fs from "node:fs";
import assert from "node:assert/strict";
import {CATALOG,normalize,fallbackScore} from "../functions/api/scalping-shadow-ranking.js";

console.log("[shadow ranking] 최소 10개 + 순위/표본 보정 검사");

for(const [kind,names] of Object.entries(CATALOG)){
  assert.ok(names.length>=10,kind+" shadow catalog must be >=10");
  assert.equal(new Set(names).size,names.length,kind+" shadow names must be unique");
}

const opening=fs.readFileSync("functions/api/_opening.js","utf8");
assert.ok(opening.includes("STATIC_OPENING_SHADOW_VARIANTS"),"opening static pool missing");
assert.ok(opening.includes("openingFactoryVariants"),"opening recurring candidate factory missing");
assert.ok(opening.includes("parseGeneratedOpeningVariant"),"opening generated variant parser missing");

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
rep.candidates.push({name:"gen_c_r2_v13_e1955_sl06_tp12_h18",status:"review",researchScore:75,sampleFactor:1,
  sampleReady:true,trades:60,allAvgEdgePct:.25,holdoutAvgEdgePct:.22,recentEdgePct:.6,mddOk:true,
  factory:true,factoryReady:true});
const n=normalize("crypto",rep);
assert.equal(n.rows.length,CATALOG.crypto.length+1);
assert.ok(n.rows.some(x=>x.name.startsWith("gen_c_")&&x.liveCompatible),"generated crypto candidate must be ranked/live-compatible");
assert.equal(n.rows[0].name,"gen_c_r2_v13_e1955_sl06_tp12_h18","higher-scoring generated candidate should lead");
assert.ok(n.rows.find(x=>x.name==="vol_1.0").rank>1,"static candidate remains ranked behind stronger generated candidate");
assert.ok(n.rows.findIndex(x=>x.trades===0)>0,"zero evidence rows should not lead");
assert.deepEqual(n.rows.map(x=>x.rank),Array.from({length:CATALOG.crypto.length+1},(_,i)=>i+1));

assert.ok(CATALOG.opening.length>10&&CATALOG.daytrading.length>10&&CATALOG.crypto.length>10&&CATALOG.soxl.length>10,"reserve candidate pools required");
for(const path of ["functions/api/_daytrading.js","scripts/backtest_daytrading.py","scripts/backtest_crypto_orb.py","scripts/backtest_soxl_intraday.py"]){
  const s=fs.readFileSync(path,"utf8");
  assert.ok(/factory/i.test(s)&&/gen_[dcso]_/.test(s),path+" recurring factory missing");
}
console.log("ALL PASS — shadow strategy pool/ranking");
