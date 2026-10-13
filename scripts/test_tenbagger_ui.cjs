'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('tenbagger-gpt.js','utf8');
const doc={readyState:'loading',addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;}};
const context={window:{},document:doc,URL,console,setTimeout,clearTimeout};
vm.runInNewContext(source,context);
const api=context.window.TenbaggerResearch;
assert.equal(api.esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
assert.equal(api.safeUrl('javascript:alert(1)'), '#');
assert.equal(api.safeUrl('https://example.com/?x=1&y=2'),'https://example.com/?x=1&amp;y=2');
const input=[{code:'1',name:'한글',sector:'전자',market:'KOSPI',multiple:11,endpointMultiple:2,sellDate:'2020-01-01'},{code:'2',name:'다른종목',sector:'전자',market:'KOSDAQ',multiple:20,endpointMultiple:1,sellDate:'2021-01-01'}];
assert.equal(api.filters(input,'KOSPI','전자','multiple').length,1);
assert.equal(api.filters(input,'ALL','2','multiple')[0].code,'2');
assert.equal(api.filters(input,'ALL','','retained')[0].code,'1');
const summary=JSON.parse(fs.readFileSync('data/tenbagger/gpt/summary.json','utf8'));
const cases=JSON.parse(fs.readFileSync('data/tenbagger/gpt/cases.json','utf8'));
const universe=JSON.parse(fs.readFileSync('data/tenbagger/gpt/universe.json','utf8'));
const evidence=JSON.parse(fs.readFileSync('data/tenbagger/gpt/evidence.json','utf8'));
assert.equal(summary.version,'1.0.0');assert.equal(summary.analysisEnd,'2025-12-31');
assert.equal(summary.strategies.length,24);assert.equal(summary.tenbaggerStocks,cases.length);
assert.equal(summary.collection.requested,universe.stocks.length);
assert.equal(new Set(universe.stocks.map(s=>s.code)).size,universe.stocks.length,'one historical identity per code');
assert.equal(new Set(cases.map(s=>s.code)).size,cases.length,'one case per code');
assert.equal(summary.collection.usable,universe.stocks.filter(x=>!x.flags.length).length);
assert(summary.collection.listedUsable>200);assert(summary.collection.delistedRequested>500);
// Transport failures must not silently turn a partly collected market into a finished report.
const networkFailures=universe.stocks.filter(x=>x.error&&/Tunnel|timed out|timeout|403 Forbidden/.test(x.error));
assert(networkFailures.length<=universe.stocks.length*.02,'network collection incomplete: '+networkFailures.length);
assert(new Set(cases.map(x=>x.market)).size===2,'both markets represented');
assert(cases.every(x=>x.multiple>=10&&x.buyDate<x.sellDate&&x.buyDate>='2000-01-01'&&x.sellDate<='2025-12-31'));
for(const c of cases){
  const fast=c.fastFiveYear;
  const limit=new Date(fast.buyDate);limit.setUTCFullYear(limit.getUTCFullYear()+5);
  assert(new Date(fast.sellDate)<=limit,'five-year oracle horizon '+c.code);
  assert(c.multiple>=fast.multiple,'lifetime oracle '+c.code);
  assert(c.chart.every(x=>x[1]>0));
  for(const t of c.executions||[]){assert(t.signalDate<t.buyDate);assert(t.buyDate<=t.sellDate);assert(t.terminalStress||t.sellPrice>0);}
}
const choices=summary.strategies.filter(r=>r.train.n>=100).sort((a,b)=>b.train.meanLogGrowth-a.train.meanLogGrowth);
assert.equal(summary.selectedRule,choices[0]?.id||null,'rule selection uses training only');
assert.equal(summary.strategies.filter(r=>r.selectedOnTrain).length,summary.selectedRule?1:0);
Object.assign(api.state,{summary,cases,evidence});
api.state.caseCode=cases[1].code;api.state.query=cases[0].code;api.casesView();assert.equal(api.state.caseCode,cases[0].code,'search and detail must describe the same stock');
api.state.query='__missing_stock__';assert(!api.casesView().includes('id="tb-case-detail"'));api.state.query='';
for(const method of ['overview','patterns','rules','method']){
  const html=api[method]();assert(html.length>100);assert(!html.includes('NaN'));assert(!html.includes('undefined'));
}
const malicious={...cases[0],name:'<img src=x onerror=alert(1)>',sector:'<script>x</script>'};
const escaped=api.caseDetail(malicious);
assert(!escaped.includes('<img src=x'));assert(escaped.includes('&lt;img'));
assert(!escaped.includes('<script>x'));
assert(escaped.includes('사후'));assert(escaped.includes('로그'));
assert(api.rules().includes('포트폴리오 수익은 아닙니다'));
assert(api.method().includes('미확인'));
const page=fs.readFileSync('tenbagger.html','utf8'),access=fs.readFileSync('jk-access.js','utf8');
assert(page.includes('data-guard="1"'));assert(page.includes('JKAccess.guard('));
assert(access.includes("{path:'/tenbagger',label:'텐배거',mode:'public',order:65,after:'/paper'}"));
assert(page.includes('id="tbVer">v1.1.0'));
assert(page.includes('id="pane-gpt"'));assert(page.includes('id="tbg-root"'));
assert(page.includes('/tenbagger-claude.js?v=1.0.0'),'Claude renderer version preserved');
assert(page.includes("if(location.hash==='#gpt')tbTab('gpt')"));
for(const f of fs.readdirSync('.').filter(x=>x.endsWith('.html'))){assert(fs.readFileSync(f,'utf8').includes('href="/tenbagger"'),'menu '+f);}
console.log('ALL PASS tenbagger dataset, train-only selection, date/price units, search, escaping, and all-page navigation');

function scopeValues(src){
  const gpt={dataset:{view:'overview'},classList:{toggle(){}},setAttribute(){},onclick:null};
  const claude={dataset:{view:'claude'},calls:0,classList:{toggle(){claude.calls++;}},setAttribute(){claude.calls++;},onclick:null};
  const content={innerHTML:'',querySelectorAll(){return [];}};
  const scopedDoc={readyState:'loading',addEventListener(){},querySelectorAll(q){return q.startsWith('#tbg-root ')?[gpt]:[gpt,claude];},getElementById(id){return id==='tb-content'?content:null;}};
  const ctx={window:{},document:scopedDoc,URL,console,setTimeout,clearTimeout};
  vm.runInNewContext(src,ctx);
  assert.equal(claude.onclick,null,'GPT must not bind Claude buttons');
  Object.assign(ctx.window.TenbaggerResearch.state,{summary,cases,evidence});ctx.window.TenbaggerResearch.render();
  assert.equal(claude.calls,0,'GPT render must not toggle Claude state');
  let requests=0,modelClick;
  const lazyDoc={readyState:'complete',querySelectorAll(){return [];},getElementById(id){return id==='tabs'?{addEventListener(_,f){modelClick=f;}}:id==='pane-gpt'?{hidden:true}:id==='tb-status'?{textContent:'',appendChild(){}}:null;}};
  const lazy={window:{},document:lazyDoc,URL,console,AbortController,setTimeout(){return 0;},clearTimeout(){},fetch(){requests++;return new Promise(()=>{});}};
  vm.runInNewContext(src,lazy);
  assert.equal(requests,0,'hidden GPT pane must not fetch or slow Claude');
  modelClick({target:{closest(){return {};}}});assert.equal(requests,3,'opening GPT fetches its three files');
  modelClick({target:{closest(){return {};}}});assert.equal(requests,3,'repeated clicks cannot duplicate pending fetches');
}
scopeValues(source);
for(const [name,from,to] of [
  ['global button/render scope',"document.querySelectorAll('#tbg-root [data-view]')","document.querySelectorAll('[data-view]')"],
  ['hidden pane eager fetch',"if(!document.getElementById('pane-gpt')?.hidden)boot();","boot();"],
  ['duplicate pending fetch','if(state.summary||state.loading)return;','if(state.summary)return;']
]){assert(source.includes(from));assert.throws(()=>scopeValues(source.split(from).join(to)),assert.AssertionError,name);console.log('PASS isolation mutation '+name);}
const css=fs.readFileSync('tenbagger-gpt.css','utf8');
for(const m of css.matchAll(/([^{}]+)\{/g)){
  if(m[1].trim().startsWith('@'))continue;
  for(const q of m[1].split(','))assert(/^#(?:tbg-root|pane-gpt)(?:\s|$)/.test(q.trim()),'unscoped GPT CSS: '+q);
}
console.log('ALL PASS GPT DOM/CSS isolation and lazy loading, 3 value mutations');
