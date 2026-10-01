import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../functions/api/kis.js',import.meta.url),'utf8');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(s+'\nexport {dailyHistoryQuery};').toString('base64'));
const off=Date.parse('2026-10-01T07:00:00Z'); // 16:00 KST
const params=()=>new URLSearchParams({op:'dayhist',code:'0220WL',start:'20260825',end:'20260826',adjustment:'1'});
function probe(m){
  const p=params();assert.equal(m.dailyHistoryQuery(p,off).query.get('FID_ORG_ADJ_PRC'),'1');
  p.set('adjustment','0');assert.equal(m.dailyHistoryQuery(p,off).query.get('FID_ORG_ADJ_PRC'),'0');
  for(const [time,blocked] of [['2026-09-30T23:29:00Z',false],['2026-09-30T23:30:00Z',true],['2026-10-01T06:40:00Z',true],['2026-10-01T06:41:00Z',false]])
    assert.equal(m.dailyHistoryQuery(p,Date.parse(time)).status===409,blocked);
  for(const [key,value] of [['adjustment',''],['code','../bad'],['start','20260230'],['start','20250101'],['end','20261002']]){
    const x=params();x.set(key,value);assert.equal(m.dailyHistoryQuery(x,off).status,400);
  }
}
const m=await load(source);probe(m);
for(const [before,after] of [['hm>=830&&hm<=1540','false'],["FID_ORG_ADJ_PRC:adjustment","FID_ORG_ADJ_PRC:'1'"]]){
  const mutant=source.replace(before,after);assert.notEqual(mutant,source);const mm=await load(mutant);assert.throws(()=>probe(mm));
}
const realFetch=globalThis.fetch,realNow=Date.now;let calls=[];
try{
  Date.now=()=>Date.parse('2026-10-01T00:00:00Z');
  globalThis.fetch=async()=>{throw Error('No request allowed during market hours');};
  const env={KIS_ENV:'real',KIS_APPKEY:'fixture',KIS_APPSECRET:'fixture',KIS_ACCOUNT:'00000000-00'};
  const request=new Request('https://example.test/api/kis?'+params());
  assert.equal((await m.onRequestGet({request,env})).status,409);
  Date.now=()=>off;
  globalThis.fetch=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).endsWith('/oauth2/tokenP'))return Response.json({access_token:'fixture'});
    assert(String(url).includes('/quotations/inquire-daily-itemchartprice?'));
    assert.equal(init.method||'GET','GET');assert.equal(init.headers.tr_id,'FHKST03010100');
    return Response.json({rt_cd:'0',output1:{},output2:[{stck_bsop_date:'20260825',stck_oprc:'123',acml_vol:'456'}]});
  };
  const response=await m.onRequestGet({request,env});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.priceBasis,'original');assert.equal(body.output2[0].acml_vol,'456');
  assert.equal(calls.length,2);
  const boundary=await load(source+'\n// distinct token cache for boundary test');
  calls=[];Date.now=()=>Date.parse('2026-09-30T23:29:59Z');
  globalThis.fetch=async url=>{
    calls.push(String(url));assert(String(url).endsWith('/oauth2/tokenP'));
    Date.now=()=>Date.parse('2026-09-30T23:30:00Z');return Response.json({access_token:'fixture'});
  };
  assert.equal((await boundary.onRequestGet({request,env})).status,409);
  assert.equal(calls.length,1,'No quotation request after token call crosses 08:30');
}finally{globalThis.fetch=realFetch;Date.now=realNow;}
console.log('Daily basis reference: boundary/input/route/raw-volume values and mutations ALL PASS');
