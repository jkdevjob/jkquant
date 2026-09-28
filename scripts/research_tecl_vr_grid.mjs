import { chromium } from 'playwright';

const BASE=process.env.JKQUANT_URL||'https://jkquant.pages.dev';
const GS=[5,10,15,20];
const BANDS=[10,15,20,25,30];
const POOLS=[0.30,0.40,0.50,0.60,0.70];
const CAPS=[100000,10000];

function addYears(s,n){const d=new Date(s+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+n);return d.toISOString().slice(0,10);}
function pct(a,p){if(!a.length)return null;const x=[...a].sort((m,n)=>m-n),k=(x.length-1)*p,f=Math.floor(k),c=Math.ceil(k);return f===c?x[f]:x[f]+(x[c]-x[f])*(k-f);}
function sum(rows){
  const c=rows.map(x=>x.cagr),m=rows.map(x=>x.mdd);
  return {n:rows.length,cagrAvg:c.reduce((a,b)=>a+b,0)/c.length,cagrMedian:pct(c,.5),cagrP10:pct(c,.1),
    cagrWorst:Math.min(...c),cagrBest:Math.max(...c),mddMedian:pct(m,.5),mddWorst:Math.max(...m)};
}
function r4(v){return typeof v==='number'&&Number.isFinite(v)?Math.round(v*10000)/10000:v;}
function clean(o){if(Array.isArray(o))return o.map(clean);if(o&&typeof o==='object')return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,clean(v)]));return r4(o);}
function cmp(a,b){return b.summary.cagrMedian-a.summary.cagrMedian || b.summary.cagrP10-a.summary.cagrP10 || a.summary.mddWorst-b.summary.mddWorst;}

const browser=await chromium.launch({headless:true});
try{
  // 1) VR 원본 런타임
  const vr=await browser.newPage();
  await vr.goto(BASE+'/backtest.html',{waitUntil:'domcontentloaded',timeout:120000});
  await vr.waitForFunction(()=>typeof fetchTickerInto==='function'&&typeof runVR==='function'&&typeof commonDays==='function',{timeout:120000});
  const vrSetup=await vr.evaluate(async ()=>{
    M={};DIV={};RAW={};ADJ={};DIVMAP={};PBASIS={};
    for(const s of ['TECL','TQQQ']){const ok=await fetchTickerInto(s,'2009-01-01');if(!ok)throw new Error('시세 로드 실패 '+s);}
    costOf=(t)=>({fee:.001,slip:0,taxRate:0,krw:1,deduct:0,cur:'$'});
    capGainTax=()=>0;
    divCash=(tkr,d,shares,costOn)=>{const a=divPerShare(tkr,d);return a>0&&shares>0?shares*a:0;};
    vrFill='ladder';
    const days=commonDays('2009-01-01','2099-12-31',['TECL','TQQQ']);
    return {days,meta:Object.fromEntries(['TECL','TQQQ'].map(s=>{const d=Object.keys(M[s]||{}).sort();return [s,{first:d[0],last:d.at(-1),n:d.length,basis:PBASIS[s]}];}))};
  });

  const common=vrSetup.days;
  const first=common[0],last=common.at(-1),start2020=common.find(d=>d>='2020-01-01')||first;
  const monthStarts=[];let pm='';
  for(const d of common){const m=d.slice(0,7);if(m!==pm){pm=m;if(addYears(d,5)<=last)monthStarts.push(d);}}
  const windows=monthStarts.map(start=>{const target=addYears(start,5);let end=start;for(const d of common){if(d<start)continue;if(d<=target)end=d;else break;}return {start,end};});

  const vrGrid=await vr.evaluate(({caps,gs,bands,pools,first,last,start2020,windows})=>{
    function one(start,end,cap,G,band,pool){
      const days=commonDays(start,end,['TECL','TQQQ']);
      const r=runVR(days,'TECL',{contrib:0,G,bandPct:band,mode:pool,formula:'basic',initAmt:cap,withdraw:0,startV:0,startPool:0,cycStart:'',costOn:true,model:'ladder'});
      const cagr=(Math.pow(Math.max(r.final,1)/Math.max(r.invested,1),1/Math.max(r.yrs,.05))-1)*100;
      return {start:days[0],end:days.at(-1),final:r.final,invested:r.invested,cagr,mdd:r.mdd,trades:r.trades};
    }
    const out={};
    for(const cap of caps){
      const rows=[];
      for(const G of gs)for(const band of bands)for(const pool of pools){
        const rolling=windows.map(w=>one(w.start,w.end,cap,G,band,pool));
        const c=rolling.map(x=>x.cagr).sort((a,b)=>a-b),m=rolling.map(x=>x.mdd).sort((a,b)=>a-b);
        const qq=(a,p)=>{const k=(a.length-1)*p,f=Math.floor(k),z=Math.ceil(k);return f===z?a[f]:a[f]+(a[z]-a[f])*(k-f);};
        rows.push({G,band,pool,summary:{n:rolling.length,cagrAvg:c.reduce((a,b)=>a+b,0)/c.length,cagrMedian:qq(c,.5),cagrP10:qq(c,.1),
          cagrWorst:c[0],cagrBest:c.at(-1),mddMedian:qq(m,.5),mddWorst:m.at(-1)},
          full:one(first,last,cap,G,band,pool),post2020:one(start2020,last,cap,G,band,pool)});
      }
      out[cap]=rows;
    }
    return out;
  },{caps:CAPS,gs:GS,bands:BANDS,pools:POOLS,first,last,start2020,windows});

  // 2) 현재 5년 플랜 원본 엔진
  const plan=await browser.newPage();
  await plan.goto(BASE+'/plan.html',{waitUntil:'domcontentloaded',timeout:120000});
  await plan.waitForFunction(()=>window.JKPlanSessionEngine&&typeof window.JKPlanSessionEngine.replay==='function',{timeout:120000});
  const planBase=await plan.evaluate(async ({caps,common,first,last,start2020,windows})=>{
    async function q(sym){
      const r=await fetch('/api/quote?symbol='+encodeURIComponent(sym)+'&range=max&div=1&_ts='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error(sym+' HTTP '+r.status);const j=await r.json();
      const mk=x=>(x||[]).map(d=>({date:d.date,close:+d.close})).filter(d=>d.date&&d.close>0);
      const adj=mk(j.series),trade=!!(j.priceBasis==='trade'&&j.ohlcTrade&&j.ohlcTrade.length);
      return {rows:trade?mk(j.ohlcTrade):adj,div:j.dividends||[],basis:trade?'trade':j.priceBasis};
    }
    const [t,qv]=await Promise.all([q('TECL'),q('TQQQ')]),set=new Set(common);
    const tr=t.rows.filter(x=>set.has(x.date)),qr=qv.rows.filter(x=>set.has(x.date)),safe=common.map(date=>({date,close:100}));
    function one(start,end,cap){
      const r=window.JKPlanSessionEngine.replay({horizon:5,startDate:start,endDate:end,principal:cap,monthlyAdd:0,tecl:tr,tqqq:qr,sgov:safe,teclDiv:t.div,tqqqDiv:qv.div,sgovDiv:[]});
      if(!r.stats)throw new Error('PLAN5 실패 '+start+' '+end+' '+r.error);
      return {start:r.stats.from,end:r.stats.to,final:r.stats.total,invested:r.stats.inflow,cagr:r.stats.cagr,mdd:r.stats.mdd,trades:r.stats.nTrade};
    }
    const out={};
    for(const cap of caps){
      const rolling=windows.map(w=>one(w.start,w.end,cap));
      const c=rolling.map(x=>x.cagr).sort((a,b)=>a-b),m=rolling.map(x=>x.mdd).sort((a,b)=>a-b);
      const qq=(a,p)=>{const k=(a.length-1)*p,f=Math.floor(k),z=Math.ceil(k);return f===z?a[f]:a[f]+(a[z]-a[f])*(k-f);};
      out[cap]={summary:{n:rolling.length,cagrAvg:c.reduce((a,b)=>a+b,0)/c.length,cagrMedian:qq(c,.5),cagrP10:qq(c,.1),cagrWorst:c[0],cagrBest:c.at(-1),mddMedian:qq(m,.5),mddWorst:m.at(-1)},
        full:one(first,last,cap),post2020:one(start2020,last,cap)};
    }
    return {out,meta:{TECL:{basis:t.basis,n:tr.length,first:tr[0]?.date,last:tr.at(-1)?.date},TQQQ:{basis:qv.basis,n:qr.length,first:qr[0]?.date,last:qr.at(-1)?.date}}};
  },{caps:CAPS,common,first,last,start2020,windows});

  const report={generatedAt:new Date().toISOString(),source:{base:BASE,vr:'backtest.html runVR + vrOrderPlan',plan:'plan.html + plan-session-engine.js',
      costs:'양쪽 동일: 매매수수료 0.1%, 양도세 0, 배당 세전, 안전자산/Pool 이자 0%'},
    grid:{G:GS,bandPct:BANDS,poolLimit:POOLS.map(x=>x*100),combos:GS.length*BANDS.length*POOLS.length},
    data:{first,last,commonDays:common.length,rollingWindows:windows.length,start2020,vr:vrSetup.meta,plan:planBase.meta},capital:{}};

  for(const cap of CAPS){
    const p=planBase.out[cap],rows=vrGrid[cap].map(x=>({...x,
      delta:{median:x.summary.cagrMedian-p.summary.cagrMedian,p10:x.summary.cagrP10-p.summary.cagrP10,worstCagr:x.summary.cagrWorst-p.summary.cagrWorst,worstMdd:x.summary.mddWorst-p.summary.mddWorst},
      pass:{mdd50:x.summary.mddWorst<=50,median:x.summary.cagrMedian>p.summary.cagrMedian,p10:x.summary.cagrP10>p.summary.cagrP10,worstCagr:x.summary.cagrWorst>=p.summary.cagrWorst}}));
    const mdd50=rows.filter(x=>x.pass.mdd50).sort(cmp);
    const all=rows.filter(x=>x.pass.mdd50&&x.pass.median&&x.pass.p10&&x.pass.worstCagr).sort(cmp);
    const bestMedian=[...rows].sort(cmp).slice(0,10);
    const bestP10=[...rows].sort((a,b)=>b.summary.cagrP10-a.summary.cagrP10||b.summary.cagrMedian-a.summary.cagrMedian).slice(0,10);
    const bestWorst=[...rows].sort((a,b)=>b.summary.cagrWorst-a.summary.cagrWorst||b.summary.cagrP10-a.summary.cagrP10).slice(0,10);
    const bestMdd=[...rows].sort((a,b)=>a.summary.mddWorst-b.summary.mddWorst||b.summary.cagrMedian-a.summary.cagrMedian).slice(0,10);
    const pareto=rows.filter(a=>!rows.some(b=>b!==a && b.summary.cagrMedian>=a.summary.cagrMedian && b.summary.mddWorst<=a.summary.mddWorst
      && (b.summary.cagrMedian>a.summary.cagrMedian || b.summary.mddWorst<a.summary.mddWorst)))
      .sort((a,b)=>a.summary.mddWorst-b.summary.mddWorst);
    report.capital[cap]={plan:p,counts:{all:rows.length,mdd50:mdd50.length,beatsAllUnder50:all.length},
      bestUnder50:mdd50.slice(0,15),beatsAllUnder50:all.slice(0,15),bestMedian,bestP10,bestWorst,bestMdd,pareto,
      officialLike:rows.find(x=>x.G===10&&x.band===15&&Math.abs(x.pool-.50)<1e-9)};
  }
  console.log('===TECL_VR_GRID_JSON===');
  console.log(JSON.stringify(clean(report),null,2));
  console.log('===END_TECL_VR_GRID_JSON===');
}finally{await browser.close();}
