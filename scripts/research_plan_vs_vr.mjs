import { chromium } from 'playwright';

const BASE=process.env.JKQUANT_URL||'https://jkquant.pages.dev';
const CAPS=[10000,100000];
const SYMS=['SOXL','TQQQ','TECL'];

function isoAddYears(s,n){
  const d=new Date(s+'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear()+n); return d.toISOString().slice(0,10);
}
function percentile(a,p){
  if(!a.length)return null;
  const x=[...a].sort((m,n)=>m-n), k=(x.length-1)*p, f=Math.floor(k), c=Math.ceil(k);
  return f===c?x[f]:x[f]+(x[c]-x[f])*(k-f);
}
function summarize(rows,planRows){
  const cg=rows.map(x=>x.cagr), md=rows.map(x=>x.mdd);
  let wins=null;
  if(planRows){
    const pm=new Map(planRows.map(x=>[x.start,x.cagr]));
    wins=rows.filter(x=>pm.has(x.start)&&x.cagr>pm.get(x.start)).length;
  }
  return {
    n:rows.length,
    cagrAvg:cg.reduce((a,b)=>a+b,0)/cg.length,
    cagrMedian:percentile(cg,.5),
    cagrP10:percentile(cg,.1),
    cagrWorst:Math.min(...cg),
    cagrBest:Math.max(...cg),
    mddMedian:percentile(md,.5),
    mddWorst:Math.max(...md),
    winsVsPlan:wins
  };
}
function roundObj(o){
  if(Array.isArray(o))return o.map(roundObj);
  if(o&&typeof o==='object')return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,roundObj(v)]));
  return typeof o==='number'&&Number.isFinite(o)?Math.round(o*10000)/10000:o;
}

const browser=await chromium.launch({headless:true});
try{
  const vr=await browser.newPage();
  await vr.goto(BASE+'/backtest.html',{waitUntil:'domcontentloaded',timeout:120000});
  await vr.waitForFunction(()=>typeof fetchTickerInto==='function'&&typeof runVR==='function'&&typeof commonDays==='function',{timeout:120000});
  const vrMeta=await vr.evaluate(async syms=>{
    M={}; DIV={}; RAW={}; ADJ={}; DIVMAP={}; PBASIS={};
    for(const s of syms){
      const ok=await fetchTickerInto(s,'2009-01-01');
      if(!ok)throw new Error('load failed '+s);
    }
    /* 비교비용 통일: 5년플랜과 똑같이 매매수수료 0.1%, 양도세 0, 배당 세전.
       runVR·vrOrderPlan 자체는 backtest.html 원본 런타임을 그대로 쓴다. */
    costOf=(t)=>({fee:.001,slip:0,taxRate:0,krw:1,deduct:0,cur:'$'});
    capGainTax=()=>0;
    divCash=(tkr,d,shares,costOn)=>{const a=divPerShare(tkr,d);return a>0&&shares>0?shares*a:0;};
    vrFill='ladder';
    const ks=syms.map(s=>Object.keys(M[s]||{}).sort());
    let common=ks[0].filter(d=>ks.slice(1).every(a=>M[syms[a===ks[0]?0:ks.indexOf(a)]]));
    // 위 식은 배열 참조 비교가 불필요하게 복잡하므로 명시적으로 다시 만든다.
    common=ks[0].filter(d=>syms.every(s=>M[s]&&M[s][d]));
    return {meta:Object.fromEntries(syms.map(s=>{const d=Object.keys(M[s]||{}).sort();return [s,{first:d[0],last:d[d.length-1],n:d.length,basis:PBASIS[s]}];})),common};
  },SYMS);

  const common=vrMeta.common;
  if(common.length<1250)throw new Error('common dates too short '+common.length);
  const first=common[0], last=common[common.length-1];
  const start2020=common.find(d=>d>='2020-01-01')||first;
  const monthStarts=[];
  let prev='';
  for(const d of common){
    const m=d.slice(0,7);
    if(m!==prev){prev=m; if(isoAddYears(d,5)<=last)monthStarts.push(d);}
  }
  const windows=monthStarts.map(start=>{
    const target=isoAddYears(start,5);
    let end=start;
    for(const d of common){if(d<start)continue;if(d<=target)end=d;else break;}
    return {start,end};
  });

  const vrResults=await vr.evaluate(({caps,syms,first,last,start2020,windows})=>{
    function one(sym,start,end,cap){
      const days=commonDays(start,end,syms); // 정확히 세 종목 공통 거래일
      const r=runVR(days,sym,{contrib:0,G:10,bandPct:15,mode:.5,formula:'basic',initAmt:cap,withdraw:0,startV:0,startPool:0,cycStart:'',costOn:true,model:'ladder'});
      const cagr=(Math.pow(Math.max(r.final,1)/Math.max(r.invested,1),1/Math.max(r.yrs,.05))-1)*100;
      return {start:days[0],end:days[days.length-1],final:r.final,invested:r.invested,ret:r.ret,cagr,mdd:r.mdd,trades:r.trades,bothDays:r.bothDays};
    }
    const out={};
    for(const cap of caps){
      out[cap]={full:{},post2020:{},rolling:{}};
      for(const s of syms){
        out[cap].full[s]=one(s,first,last,cap);
        out[cap].post2020[s]=one(s,start2020,last,cap);
        out[cap].rolling[s]=windows.map(w=>one(s,w.start,w.end,cap));
      }
    }
    return out;
  },{caps:CAPS,syms:SYMS,first,last,start2020,windows});

  const plan=await browser.newPage();
  await plan.goto(BASE+'/plan.html',{waitUntil:'domcontentloaded',timeout:120000});
  await plan.waitForFunction(()=>typeof fetchPlanQuote==='function'&&window.JKPlanSessionEngine&&typeof window.JKPlanSessionEngine.replay==='function',{timeout:120000});
  const planResults=await plan.evaluate(async ({caps,common,first,last,start2020,windows})=>{
    const [t,q]=await Promise.all([fetchPlanQuote('TECL'),fetchPlanQuote('TQQQ')]);
    const set=new Set(common);
    const tr=t.rows.filter(x=>set.has(x.date)), qr=q.rows.filter(x=>set.has(x.date));
    const safe=common.map(date=>({date,close:100,open:100,high:100,low:100}));
    function one(start,end,cap){
      const r=window.JKPlanSessionEngine.replay({horizon:5,startDate:start,endDate:end,principal:cap,monthlyAdd:0,
        tecl:tr,tqqq:qr,sgov:safe,teclDiv:t.dividends,tqqqDiv:q.dividends,sgovDiv:[]});
      if(!r.stats)throw new Error('plan replay failed '+start+' '+end+' '+r.error);
      return {start:r.stats.from,end:r.stats.to,final:r.stats.total,invested:r.stats.inflow,ret:r.stats.ret,cagr:r.stats.cagr,mdd:r.stats.mdd,trades:r.stats.nTrade};
    }
    const out={};
    for(const cap of caps){
      out[cap]={full:one(first,last,cap),post2020:one(start2020,last,cap),rolling:windows.map(w=>one(w.start,w.end,cap))};
    }
    return {out,quoteMeta:{TECL:{first:tr[0]?.date,last:tr.at(-1)?.date,n:tr.length},TQQQ:{first:qr[0]?.date,last:qr.at(-1)?.date,n:qr.length}}};
  },{caps:CAPS,common,first,last,start2020,windows});

  const report={
    generatedAt:new Date().toISOString(),
    source:{base:BASE,vrRuntime:'/backtest.html runVR + vrOrderPlan',planRuntime:'/plan.html + plan-session-engine.js',
      normalizedCosts:'매매수수료 0.1%, 양도세 0, 배당 세전, 안전자산/Pool 0%'},
    data:{vr:vrMeta.meta,plan:planResults.quoteMeta,common:{first,last,n:common.length,start2020,rollingWindows:windows.length}},
    capital:{}
  };
  for(const cap of CAPS){
    const p=planResults.out[cap];
    const row={full:{PLAN5:p.full},post2020:{PLAN5:p.post2020},rollingSummary:{PLAN5:summarize(p.rolling)},rollingRaw:{PLAN5:p.rolling}};
    for(const s of SYMS){
      row.full['VR_'+s]=vrResults[cap].full[s];
      row.post2020['VR_'+s]=vrResults[cap].post2020[s];
      row.rollingSummary['VR_'+s]=summarize(vrResults[cap].rolling[s],p.rolling);
      row.rollingRaw['VR_'+s]=vrResults[cap].rolling[s];
    }
    report.capital[cap]=row;
  }
  console.log('===JKQUANT_PLAN_VR_COMPARE_JSON===');
  console.log(JSON.stringify(roundObj(report),null,2));
  console.log('===END_JKQUANT_PLAN_VR_COMPARE_JSON===');
} finally {
  await browser.close();
}
