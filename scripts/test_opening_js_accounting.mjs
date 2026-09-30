#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

const sourcePath=process.env.OPENING_JS_PATH||path.resolve("functions/api/_opening.js");
const source=fs.readFileSync(sourcePath,"utf8");
const tmp=path.join(os.tmpdir(),"jkq-opening-"+process.pid+"-"+Date.now()+".mjs");
fs.writeFileSync(tmp,source);
try{
  const m=await import(pathToFileURL(tmp).href+"?v="+Date.now());
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const base=m.OPENING_BASE_PARAMS;
  assert(base.stop===1,"baseline stop must remain 1%");
  assert(base.takeProfit===1.5,"baseline take profit must remain 1.5%");
  assert(base.finalExit===930,"baseline final exit must remain 09:30");

  const f=m.openingFriction(15000,"KOSPI",{completeMatches:0,avgRoundTripSlippageCostPct:null});
  const expected=.23+2*2.5*10/15000*100;
  assert(Math.abs(f.pct-expected)<1e-12,"tick fallback value");
  assert(f.source==="tick_fallback_2.5_each_side","tick fallback source");

  const pre=m.openingFriction(15000,"KOSPI",{completeMatches:29,avgRoundTripSlippageCostPct:.31});
  assert(Math.abs(pre.pct-expected)<1e-12,"29 matches must still use fallback");
  const missing=m.openingFriction(15000,"KOSPI",{completeMatches:30,avgRoundTripSlippageCostPct:null});
  assert(missing.source==="tick_fallback_2.5_each_side","null observed slippage must stay on fallback");
  const obs=m.openingFriction(15000,"KOSPI",{completeMatches:30,avgRoundTripSlippageCostPct:.31});
  assert(Math.abs(obs.pct-.54)<1e-12,"30 matches must use observed VTS slippage");
  assert(obs.source==="vts_observed_round_trip","observed source");

  const combo=m.SHADOW_VARIANTS.find(x=>x.name==="today_combo_v1");
  assert(combo&&Array.isArray(combo.designedFrom)&&combo.designedFrom[0]==="2026-09-22","designedFrom metadata");
  console.log("opening JS accounting values: PASS");
}finally{
  try{fs.unlinkSync(tmp);}catch{}
}
