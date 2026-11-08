// Store each prospective trade separately, avoiding one ever-growing ledger value.
// No pruning or replacement of the user's original operating ledgers.
async function records(storage,prefix){
 const all=[];let startAfter;
 for(;;){
  const page=await storage.list({prefix,limit:1000,...(startAfter?{startAfter}:{})});
  all.push(...page.values());if(page.size<1000)break;startAfter=[...page.keys()].at(-1);
 }
 return all;
}
export async function readHoldingState(storage){
 const meta=await storage.get('holdingLab');if(!meta)return null;
 // Early v1 drafts, if any, are readable without resetting evidence.
 if(!meta.partitioned)return meta;
 const st=JSON.parse(JSON.stringify(meta));
 const [trades,skipped]=await Promise.all([records(storage,'holdingTrade:'),records(storage,'holdingSkip:')]);
 for(const arm of Object.values(st.arms)){
  arm.trades=trades.filter(x=>x.arm===arm.id).map(x=>x.trade).sort((a,b)=>a.entryMs-b.entryMs||a.sourceId.localeCompare(b.sourceId));
  arm.skipped=skipped.filter(x=>x.arm===arm.id).map(x=>x.skip);
 }
 return st;
}
export async function writeHoldingState(storage,state,previous){
 const meta=JSON.parse(JSON.stringify(state));meta.partitioned=true;
 for(const arm of Object.values(state.arms)){
  const before=previous?.arms?.[arm.id],by=new Map((before?.trades||[]).map(t=>[t.sourceId,t]));
  for(const trade of arm.trades)if(JSON.stringify(by.get(trade.sourceId))!==JSON.stringify(trade))await storage.put('holdingTrade:'+arm.id+':'+trade.sourceId,{arm:arm.id,trade});
  const seen=new Set((before?.skipped||[]).map(t=>t.sourceId));
  for(const skip of arm.skipped)if(!seen.has(skip.sourceId))await storage.put('holdingSkip:'+arm.id+':'+skip.sourceId,{arm:arm.id,skip});
  meta.arms[arm.id].trades=[];meta.arms[arm.id].skipped=[];
 }
 meta.seeds={};await storage.put('holdingLab',meta);
}
