import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE='http://127.0.0.1:8000';
const REMOTE='https://jkquant.pages.dev';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
await context.route(BASE+'/api/quote**', async route=>{
  const u=new URL(route.request().url());
  const remote=REMOTE+u.pathname+u.search;
  let last;
  for(let n=0;n<4;n++){
    try{
      const r=await context.request.get(remote,{timeout:120000});
      if(r.ok()){ await route.fulfill({response:r}); return; }
      last=new Error('HTTP '+r.status()+' '+remote);
    }catch(e){ last=e; }
    await new Promise(r=>setTimeout(r,1500*(n+1)));
  }
  console.error('quote proxy failed',String(last));
  await route.abort();
});
const page=await context.newPage();
const pageErrors=[];
page.on('pageerror',e=>{pageErrors.push(String(e));console.error('PAGEERROR',String(e));});
page.on('console',m=>{ if(m.type()==='error') console.error('BROWSER',m.text()); });
await page.goto(BASE+'/backtest.html',{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>typeof fetchPrices==='function'&&typeof runIM==='function'&&typeof imDeepLocRegime==='function',{timeout:120000});

const load=await page.evaluate(async()=>{
  TICKERS.splice(0,TICKERS.length,'SOXL','TQQQ','TECL');
  WARM_FROM='1993-01-01'; WARM_TO='2026-09-30';
  imCostOn=true; imReverse=false; imTgtDyn=false; imAutoTp=false; SPLIT_TRADE=true; levExt=false;
  const r=await fetchPrices(WARM_FROM,WARM_TO);
  return {loaded:r.loaded,failed:r.failed,qual:r.qual,
    ranges:Object.fromEntries(['SOXL','TQQQ','TECL'].map(t=>{const ds=Object.keys(M[t]||{}).sort();return [t,ds.length?[ds[0],ds.at(-1),ds.length]:null]}))};
});
console.log('LOAD',JSON.stringify(load));

const result=await page.evaluate(async()=>{
  const RULES=[
    ['A','항상 A'],
    ['B','항상 B'],
    ['ma150_rise10_q2','MA150 10일 상승 & q>=2'],
    ['ma150_rise10_q3','MA150 10일 상승 & q>=3'],
    ['ma150_rise10_q4','MA150 10일 상승 & q>=4'],
    ['ma150_rise20_q2','MA150 20일 상승 & q>=2'],
    ['ma150_rise20_q3','MA150 20일 상승 & q>=3'],
    ['ma150_rise20_q4','MA150 20일 상승 & q>=4'],
    ['ma150_rise40_q2','MA150 40일 상승 & q>=2'],
    ['ma150_rise40_q3','MA150 40일 상승 & q>=3'],
    ['ma150_rise40_q4','MA150 40일 상승 & q>=4'],
  ];
  imCostOn=true; imReverse=false; imTgtDyn=false; imAutoTp=false; SPLIT_TRADE=true; levExt=false;
  const iso=d=>d.toISOString().slice(0,10);
  const addYears=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+n);return iso(d);};
  const DC=new Map(), RC=new Map();
  const allDays=t=>{
    const D=M[t]||{}, c=DC.get(t);
    if(c&&c.D===D) return c.ds;
    const ds=Object.keys(D).sort(); DC.set(t,{D,ds}); return ds;
  };
  const lb=(A,x)=>{let a=0,b=A.length;while(a<b){const m=(a+b)>>1;if(A[m]<x)a=m+1;else b=m;}return a;};
  const ub=(A,x)=>{let a=0,b=A.length;while(a<b){const m=(a+b)>>1;if(A[m]<=x)a=m+1;else b=m;}return a;};
  const rangeDays=(t,a,b)=>{const A=allDays(t),i=a?lb(A,a):0,j=b?ub(A,b):A.length;return A.slice(i,j);};
  const calc=(t,cap,a,b,rule)=>{
    const key=[t,cap,a||'',b||'',rule,M[t]===((typeof EXTM!=='undefined')&&EXTM[t])?'x':'r'].join('|');
    if(RC.has(key)) return RC.get(key);
    const qmatch=rule.match(/_q([234])$/), qm=qmatch?+qmatch[1]:1;
    const baseRule=rule.replace(/_q[234]$/,'');
    imDeepLocRule=baseRule; imDeepLocQMin=qm;
    const ds=rangeDays(t,a,b); if(ds.length<2){RC.set(key,null);return null;}
    const tgt=t==='TQQQ'?15:20;
    const r=runIM(ds,t,cap,20,tgt,true,20);
    const yrs=(new Date(ds.at(-1)+'T00:00:00Z')-new Date(ds[0]+'T00:00:00Z'))/864e5/365.25;
    const cagr=(r.final>0&&yrs>0)?(Math.pow(r.final/cap,1/yrs)-1)*100:-100;
    const out={start:ds[0],end:ds.at(-1),days:ds.length,final:r.final,cagr,mdd:r.mdd,cycles:r.cycles,
      deepA:r.deepAStarts,deepB:r.deepBStarts,fees:r.fees,tax:r.tax};
    RC.set(key,out); return out;
  };
  const monthlyWindows=(t,a,b,yrs)=>{
    const ds=rangeDays(t,a,b), firstByMonth=[];
    let last='';
    for(const d of ds){const m=d.slice(0,7);if(m!==last){firstByMonth.push(d);last=m;}}
    const out=[];
    for(const st of firstByMonth){
      const target=addYears(st,yrs); if(target>b) break;
      const w=ds.filter(d=>d>=st&&d<=target); if(w.length>100) out.push([w[0],w.at(-1)]);
    }
    return out;
  };
  const roll=(t,cap,yrs,rule,a,b)=>{
    const wins=[], ratios=[], diffs=[], rows=[];
    const winspec=monthlyWindows(t,a,b,yrs);
    for(const [st,en] of winspec){
      const A=calc(t,cap,st,en,'A'), X=calc(t,cap,st,en,rule); if(!A||!X)continue;
      const ratio=X.final/A.final, diff=X.cagr-A.cagr;
      rows.push({st,en,ratio,diff,cagr:X.cagr,mdd:X.mdd});
      ratios.push(ratio);diffs.push(diff);wins.push(X.final>A.final?1:0);
    }
    const sorted=[...ratios].sort((x,y)=>x-y);
    const med=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
    const worst=rows.length?rows.reduce((a,x)=>x.ratio<a.ratio?x:a):null;
    const worstC=rows.length?rows.reduce((a,x)=>x.cagr<a.cagr?x:a):null;
    const worstM=rows.length?rows.reduce((a,x)=>x.mdd>a.mdd?x:a):null;
    return {n:rows.length,winPct:rows.length?wins.reduce((a,x)=>a+x,0)/rows.length*100:null,
      medianRatio:med,worstRatio:worst?.ratio??null,worstRatioStart:worst?.st??null,
      meanCagrDiff:diffs.length?diffs.reduce((a,x)=>a+x,0)/diffs.length:null,
      worstCagr:worstC?.cagr??null,worstCagrStart:worstC?.st??null,
      worstMdd:worstM?.mdd??null,worstMddStart:worstM?.st??null};
  };
  const sensitivity21=(cap,rule,end)=>{
    const ds=rangeDays('SOXL',null,end).slice(0,21); let win=0;const ratios=[];
    for(const st of ds){const A=calc('SOXL',cap,st,end,'A'),X=calc('SOXL',cap,st,end,rule);const q=X.final/A.final;ratios.push(q);if(q>1)win++;}
    ratios.sort((a,b)=>a-b);
    return {n:ratios.length,wins:win,medianRatio:ratios[Math.floor(ratios.length/2)],minRatio:ratios[0],maxRatio:ratios.at(-1)};
  };

  const ranges={};
  for(const t of ['SOXL','TQQQ','TECL']){const ds=allDays(t);ranges[t]={start:ds[0],end:ds.at(-1),n:ds.length};}
  const latest=ranges.SOXL.end;
  const real={};
  for(const [rule,label] of RULES){
    const o={label,full:{},since2020:{},roll3:{},roll5:{},sens21:{}};
    for(const cap of [10000,100000]){
      o.full[cap]=calc('SOXL',cap,ranges.SOXL.start,latest,rule);
      o.since2020[cap]=calc('SOXL',cap,'2020-01-01',latest,rule);
      o.roll3[cap]=roll('SOXL',cap,3,rule,ranges.SOXL.start,latest);
      o.roll5[cap]=roll('SOXL',cap,5,rule,ranges.SOXL.start,latest);
      o.sens21[cap]=sensitivity21(cap,rule,latest);
    }
    real[rule]=o;
  }
  const cross={};
  for(const t of ['TQQQ','TECL']){
    cross[t]={};
    for(const [rule,label] of RULES){
      cross[t][rule]={label};
      for(const cap of [10000,100000]){
        cross[t][rule][cap]={full:calc(t,cap,ranges[t].start,ranges[t].end,rule),
          roll5:roll(t,cap,5,rule,ranges[t].start,ranges[t].end)};
      }
    }
  }

  // Claude 결과와 동일한 고정 종료일 A 패리티 확인.
  const parity={};
  for(const cap of [10000,100000]){
    parity[cap]={full:calc('SOXL',cap,'2010-03-11','2026-09-28','A'),
      since2020:calc('SOXL',cap,'2020-01-01','2026-09-28','A')};
  }

  // 현재 페이지의 공식 레버리지 확장으로 SOXL 1994~2010 스트레스.
  levExt=true;
  const extInfo=await buildLevExt(['SOXL'],'1994-05-01'); applyLevExt();
  const synEnd='2010-03-10', synStart=Object.keys(M.SOXL||{}).filter(d=>d<=synEnd).sort()[0];
  const synthetic={info:extInfo,start:synStart,end:synEnd,rules:{}};
  const bank=(cap,rule)=>{
    const ws=monthlyWindows('SOXL',synStart,synEnd,5); let bankrupt=0;const rows=[];
    for(const [st,en] of ws){const r=calc('SOXL',cap,st,en,rule);const dead=!r||r.final<=0.01||r.cagr<=-99.999;if(dead)bankrupt++;rows.push({st,en,dead,cagr:r?.cagr,mdd:r?.mdd});}
    const valid=rows.filter(x=>!x.dead);
    const worst=valid.length?valid.reduce((a,x)=>x.cagr<a.cagr?x:a):null;
    return {n:rows.length,bankrupt,worstSurvivorCagr:worst?.cagr??null,worstSurvivorStart:worst?.st??null};
  };
  for(const [rule,label] of RULES){
    synthetic.rules[rule]={label,10000:bank(10000,rule),100000:bank(100000,rule)};
  }
  clearLevExt(); levExt=false;
  return {generatedAt:new Date().toISOString(),rules:RULES,ranges,latest,parity,real,cross,synthetic};
});

result.pageErrors=pageErrors;
fs.writeFileSync('deep-loc-regime-result.json',JSON.stringify(result,null,2));
console.log('RESULT_SUMMARY');
for(const [r,o] of Object.entries(result.real)){
  console.log(r,'SOXL 5Y $10k',JSON.stringify(o.roll5[10000]),' $100k',JSON.stringify(o.roll5[100000]));
}
console.log('SYNTHETIC');
for(const [r,o] of Object.entries(result.synthetic.rules)) console.log(r,o[10000].bankrupt,o[100000].bankrupt);
console.log('PARITY',JSON.stringify(result.parity));
await browser.close();
if(pageErrors.length) process.exitCode=2;
