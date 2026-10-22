import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {CLOSE_VARIANTS,closeFeature,chooseClosingSignals,closeNetPct,snapAt} from "../functions/api/_closing30.js";
import {flatten} from "../functions/api/closing30-history.js";
const bars=Array.from({length:40},(_,i)=>({
 t:"2026-10-22 14:"+String(20+i).padStart(2,"0"),
 close:90+i/10,vol:1000+(i>=35?1000:0)
}));
bars.push({t:"2026-10-22 15:30",close:99999,vol:50000000});
test("signal cannot read later 15:30 close or future bar",()=>{
 const a=snapAt(bars,1504);
 assert.equal(a.some(x=>x.close===99999),false);
 const old=closeFeature(bars,100,1459);
 assert(old);
 const improved=closeFeature([...bars,{t:"2026-10-22 15:45",close:999}],100,1459);
 assert.deepEqual(improved,old);
});
test("10 shadow candidates plus baseline persist stable variant keys",()=>{
 assert.equal(CLOSE_VARIANTS.length,11);
 const f=closeFeature(bars,100,1459);assert(f);
 const xs=chooseClosingSignals([{code:"123456",name:"종목A",feature:f}],"day",3);
 assert(xs.some(x=>x.variant==="baseline"));
 assert(xs.every(x=>x.kind==="day"&&x.fillStatus==="signal_only"));
});
test("strict paper net PnL costs and no fabricated price",()=>{
 assert(Math.abs(closeNetPct(100,101)-.77)<1e-8);
 assert.equal(closeNetPct(null,101),null);
 assert.equal(closeNetPct(100,null),null);
});
test("closing ledger preserves all variants and overnight prices with no fill invented",()=>{
 const date="2026-10-21";
 const e=(stage,kind,variant,price,pnl)=>({id:[date,kind,variant,"A",stage].join(":"),date,kind,variant,code:"A",name:"A",stage,price,pnl,createdAt:"2026-10-22T00:00:00Z"});
 const ledger={date,events:[e("signal","day","baseline"),e("buy","day","baseline",100),e("sell","day","baseline",101,.77),
  e("signal","day","dip_2"),e("buy","day","dip_2",100),e("signal","overnight","baseline"),e("buy","overnight","baseline",100)]};
 const rows=flatten(ledger);
 assert.equal(rows.length,3);
 assert.equal(rows.find(x=>x.kind==="day"&&x.variant==="baseline").pnl,.77);
 assert.equal(rows.find(x=>x.kind==="day"&&x.variant==="dip_2").status,"open");
 assert.equal(rows.find(x=>x.kind==="overnight").status,"open");
 assert.equal(rows.find(x=>x.kind==="overnight").pnl,null);
});
test("global UI includes real closing tab, broker-free policy, historical variant selectors",()=>{
 const ui=fs.readFileSync(new URL("../scalping.html",import.meta.url),"utf8");
 for(const str of ['data-strategy="closing30"','id="strategy_closing30"',"loadClosing30History()",
  "loadScalpingVariantOptions(name)","closing30_kind","closing30_variant","종가 베팅"])
  assert(ui.includes(str),str);
 const worker=fs.readFileSync(new URL("../worker/opening-scheduler/src/index.js",import.meta.url),"utf8");
 assert(worker.includes('route==="gapdown_reconcile"'));
 assert(worker.includes('ctx.waitUntil(runClosing30("closing_settle"'));
 assert(worker.includes('ctx.waitUntil(runClosing30("closing_overnight_exit"'));
 assert(worker.includes('orderStatus:"paper_only_no_broker_order"'));
 assert(!worker.includes('executeVts(env,date,[],missing)}, "closing30"'));
});

test("private nightly relay rejects anonymous access and invalid dates before any upstream fetch",async()=>{
 const {onRequestGet}=await import("../functions/api/closing30-archive.js");
 const anon=await onRequestGet({request:new Request("https://jkquant.pages.dev/api/closing30-archive?date=2026-10-22"),env:{AUTOTRADE_KEY:"fixture"}});
 assert.equal(anon.status,401);
 const bad=await onRequestGet({request:new Request("https://jkquant.pages.dev/api/closing30-archive?date=bad",{headers:{"x-monitor-key":"fixture"}}),env:{AUTOTRADE_KEY:"fixture"}});
 assert.equal(bad.status,400);
});
