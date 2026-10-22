import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../functions/api/_opening.js',import.meta.url),'utf8');
const load=async text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const prices=[103,103,103,104,103.6,104.2,102,101,100];
const rows=prices.map((close,i)=>({t:`2026-09-25 09:${String(i).padStart(2,'0')}`,close,high:close,vol:i===5?500:100}));
rows.push({t:'2026-09-25 09:30',close:100,high:100,vol:100});
function probe(m){
  const base=m.rebreakTrade(rows,{open:103,prevClose:100},930);
  const v=m.SHADOW_VARIANTS.find(x=>x.name==='hold_to_next_open');
  assert(v);
  const hold=m.rebreakTrade(rows,{open:103,prevClose:100},930,v.params);
  assert(base.pnl<0);
  assert.equal(hold.entryTime,base.entryTime);
  assert.equal(hold.entryPrice,base.entryPrice);
  assert.equal(hold.exitPrice,null);
  assert.equal(hold.pnl,null);
  assert.equal(hold.outcomeStatus,'pending_next_open');
  assert.equal(hold.strategyVersion,'opening_hold_to_next_open_v1');
}
probe(await load(source));
const mutant=source.replace('if(p.exitPolicy==="next_session_open")','if(false)');
assert.notEqual(mutant,source);
const changed=await load(mutant);
assert.throws(()=>probe(changed));
console.log('Opening hold live parity and intraday-exit mutant: ALL PASS');


const delayedCloseRows=Array.from({length:30},(_,i)=>{
  const close=i<3?103:i===3?104:i===4?103.6:i===5?104.2:104.1;
  return {t:`2026-10-21 09:${String(i).padStart(2,'0')}`,close,high:close,vol:i===5?500:100};
});
const delayedExit=(await load(source)).rebreakTrade(delayedCloseRows,{open:103,prevClose:100},930);
assert(delayedExit,'late 09:30 minute must still compute the already entered signal');
assert.equal(delayedExit.entryTime,905);
assert.equal(delayedExit.exitTime,930);
assert.equal(delayedExit.evidence.finalExitPriceProxyHm,929);
assert.equal(delayedExit.evidence.finalExitPriceUnconfirmed,true);
const workerSource=fs.readFileSync(new URL('../worker/opening-scheduler/src/index.js',import.meta.url),'utf8');
const exitFn=workerSource.slice(workerSource.indexOf('export function openingUnmatchedExits('),workerSource.search(/\n(?:export )?async function forceOpeningSessionClose\(/));
assert(exitFn.includes('openingUnmatchedExits('),'worker closing fallback exists');
const unmatched=new Function(exitFn.replace('export function','function')+';return openingUnmatchedExits;')();
const orderEvent=(stage,code,variant='baseline',hm=905)=>({stage,variant,code,name:code,signal:{code,name:code,entryTime:hm}});
const recovered=unmatched({events:[
  orderEvent('buy','A'),
  orderEvent('buy','B'),orderEvent('sell','B'),
  orderEvent('buy','C','shadow'),
  orderEvent('buy','D','baseline',930),
]},'baseline');
assert.deepEqual(recovered.map(x=>x.code),['A'],'only truly unmatched main entry may create an exit order');
assert.equal(recovered[0].exitTime,930);
assert.equal(recovered[0].exitPrice,null);
assert.equal(recovered[0].pnl,null);
assert.equal(recovered[0].finalExitUnverified,true);
assert.deepEqual(unmatched({events:[orderEvent('buy','A'),orderEvent('sell','A')]},'baseline'),[],'already closed must never sell twice');
