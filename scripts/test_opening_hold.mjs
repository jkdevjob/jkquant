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
