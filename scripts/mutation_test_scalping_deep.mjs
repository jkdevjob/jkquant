import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const base={global:read('worker/global-intraday-scheduler/src/index.js'),opening:read('worker/opening-scheduler/src/index.js'),
  ui:read('scalping.html'),daily:read('functions/api/scalping-daily-results.js'),alert:read('functions/api/scalping-alert.js'),history:read('functions/api/scalping-history.js')};
const dataModule=(source,folder='functions/api/')=>'data:text/javascript;base64,'+Buffer.from(source.replace(/from\s+["'](\.\.?\/[^"'\n]+)["']/g,(_all,ref)=>'from "'+new URL('../'+folder+ref,import.meta.url).href+'"')).toString('base64');
function runDeep(key,source){
  const env={...process.env,SCALPING_DEEP_MUTATION:'1'};
  const input={};
  if(['global','opening','ui'].includes(key))input[key]=source;
  else if(key)env['SCALPING_'+key.toUpperCase()+'_MODULE']=dataModule(source);
  return spawnSync(process.execPath,['scripts/test_scalping_deep_audit.mjs'],{env,input:JSON.stringify(input),encoding:'utf8',maxBuffer:2*1024*1024});
}
const control=runDeep();assert.equal(control.status,0,control.stdout+control.stderr);
const mutants=[
  ['global','delayed tail','if(b.ms+FIVE===deadline)','if(true)','delayed tail'],
  ['global','completed candle','tMs+FIVE<=now-1500','tMs<=now','unfinished candle'],
  ['global','missing next candle','entry.ms!==x.ms+FIVE||','','missing next candle'],
  ['global','stop wins same candle','price:ls?stop:target','price:hs?target:stop','unfinished candle'],
  ['global','session end cap','Math.min(entry.ms+params.maxHoldBars*FIVE,entry.ms+(sessionEndMinute-minute)*60_000)','entry.ms+params.maxHoldBars*FIVE','maximum holding'],
  ['opening','full-universe original only','||!full.has(e.targetHm)','','opening retry'],
  ['daily','live no-trade priority','return {...x,sourceConflict:','return {...fb,sourceConflict:','actual zero-trade'],
  ['daily','missing PnL','if(v==null||v==="")return null;','','missing closed PnL'],
  ['daily','research provenance','?"historical-research-import":source','?source:source','imported research'],
  ['daily','fallback warning','if(r.status==="rejected")warnings.push','if(false)warnings.push','today source failure'],
  ['ui','null percent','if(v==null||v===\'\')return \'—\';','/* missing guard */','pending result'],
  ['ui','cockpit pending state','todayRet=todayState.returnPct','todayRet=Number(cur?.returnPct||0)','pending result'],
  ['ui','fixed capital slots','tradeSumPct/Math.max(1,Number(slots)||3)','tradeSumPct/vals.length','1-of-3 daytrading'],
  ['ui','auth generation guard','if(!current())return;','','logout during owner'],
  ['ui','private read guard','if(epoch!==SCALPING_AUTH_EPOCH||me?.uid!==user.uid)return false;','','Firestore read'],
  ['history','promoted slot count','capitalSlots:strategy==="daytrading"?Math.max(1,Number(ledger.maxTrades)||3):1','capitalSlots:3','promoted one-slot'],
  ['alert','failed Telegram receipt','const definite=r.status>=400&&r.status<500&&j?.ok===false;','const definite=false;','failed Telegram'],
  ['alert','channel failure status','telegram:receipt},ok?200:502)','telegram:receipt},200)','Telegram success'],
];
for(const [key,label,from,to,expected] of mutants){
  assert.ok(base[key].includes(from),'missing mutation anchor: '+label);
  const source=base[key].replaceAll(from,to),r=runDeep(key,source),output=r.stdout+r.stderr;
  assert.notEqual(r.status,0,'survived: '+label);
  assert.ok(output.includes('FAIL ')&&output.includes(expected),'mutation must fail a value assertion, not an import/syntax error: '+label+'\n'+output.slice(-2000));
  console.log('KILLED '+label);
}
const push=read('worker/presale-alert/src/index.js');
function runPush(source){return spawnSync(process.execPath,['--test','tests/scalping-push.test.mjs'],{env:{...process.env,SCALPING_PUSH_MODULE:dataModule(source,'worker/presale-alert/src/')},encoding:'utf8',maxBuffer:2*1024*1024});}
const pushControl=runPush(push);assert.equal(pushControl.status,0,pushControl.stdout+pushControl.stderr);
for(const [label,from,to] of [
  ['per-device retry','if(delivered.has(key))continue;',''],
  ['partial failure retry','delivery.failed>delivery.removed?"delivery_failed":','false?"delivery_failed":'],
  ['lease expiry','Date.now()-Date.parse(prev.at)<120_000','true'],
  ['fresh event guard','age>20*60_000||age< -90_000','false'],
  ['midnight session boundary','date!==marketDate&&!boundarySell','date!==marketDate'],
]){
  assert.ok(push.includes(from),label);
  const r=runPush(push.replaceAll(from,to));assert.notEqual(r.status,0,'survived: '+label);
  assert.ok((r.stdout+r.stderr).includes('AssertionError'),label+' must fail a value assertion');
  console.log('KILLED '+label);
}
console.log('Mutation audit: 23/23 killed; unmodified controls PASS');
