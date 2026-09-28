import { chromium } from 'playwright';

const BASE=process.env.JKQUANT_URL||'https://jkquant.pages.dev';
const CAPS=[100000,10000];
const BUFFERS=[0,0.02,0.05];
const SCALES=[0,0.25,0.50,1.00]; // MA200 아래일 때 남기는 TECL 비중. 1=매수만 차단.
const CONT=[true,false];          // MA200 아래에서도 VR V 사이클을 계속 갱신할지 여부.
const GOAL={median:38,p10:26,worst:17,mddWorst:50};

function addYears(s,n){const d=new Date(s+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+n);return d.toISOString().slice(0,10);}
function q(a,p){if(!a.length)return null;const x=[...a].sort((m,n)=>m-n),k=(x.length-1)*p,f=Math.floor(k),c=Math.ceil(k);return f===c?x[f]:x[f]+(x[c]-x[f])*(k-f);}
function summary(rows){
  const c=rows.map(x=>x.cagr),m=rows.map(x=>x.mdd);
  return {n:rows.length,cagrAvg:c.reduce((a,b)=>a+b,0)/c.length,cagrMedian:q(c,.5),cagrP10:q(c,.1),
    cagrWorst:Math.min(...c),cagrBest:Math.max(...c),mddMedian:q(m,.5),mddWorst:Math.max(...m)};
}
function r4(v){return typeof v==='number'&&Number.isFinite(v)?Math.round(v*10000)/10000:v;}
function clean(o){if(Array.isArray(o))return o.map(clean);if(o&&typeof o==='object')return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,clean(v)]));return r4(o);}

const browser=await chromium.launch({headless:true});
try{
  const vr=await browser.newPage();
  await vr.goto(BASE+'/backtest.html',{waitUntil:'domcontentloaded',timeout:120000});
  await vr.waitForFunction(()=>typeof fetchTickerInto==='function'&&typeof runVR==='function'&&typeof commonDays==='function',{timeout:120000});

  const setup=await vr.evaluate(async ()=>{
    M={};DIV={};RAW={};ADJ={};DIVMAP={};PBASIS={};
    for(const s of ['TECL','TQQQ']){const ok=await fetchTickerInto(s,'2009-01-01');if(!ok)throw new Error('load failed '+s);}
    costOf=(t)=>({fee:.001,slip:0,taxRate:0,krw:1,deduct:0,cur:'$'});
    capGainTax=()=>0;
    divCash=(tkr,d,shares,costOn)=>{const a=divPerShare(tkr,d);return a>0&&shares>0?shares*a:0;};
    vrFill='ladder';

    function patchOnce(src,oldv,newv,label){
      const n=src.split(oldv).length-1;
      if(n!==1)throw new Error(label+' patch count '+n);
      return src.replace(oldv,newv);
    }
    let src=runVR.toString();
    src=patchOnce(src,'function runVR(days,tkr,params){','function runVRGuarded(days,tkr,params){','name');
    src=patchOnce(src,
      '  const band=bandPct/100,poolLimit=mode;',
      \`  const band=bandPct/100,poolLimit=mode;
  const __guardMap=(params&&params.guardMap)||null;
  const __guardScale=(params&&Number.isFinite(+params.guardScale))?Math.max(0,Math.min(1,+params.guardScale)):1;
  const __guardContinue=!(params&&params.guardContinue===false);
  let __guardPrev=true;\`,
      'guard-vars');

    src=patchOnce(src,
      '    const c=M[tkr][d][C];',
      \`    const c=M[tkr][d][C];
    const __guardOn=!__guardMap || __guardMap[d]!==false;\`,
      'daily-signal');

    src=patchOnce(src,
      '      inv+=s;cf.push([d,s]);pool+=s-_vbuy(s,c);V=shares*c;',
      \`      inv+=s;cf.push([d,s]);pool+=s;
      if(__guardOn){ const __spent=_vbuy(s,c); pool-=__spent; V=shares*c; if(__spent>0)buys++; }
      else { V=s; }\`,
      'initial-buy');
    src=patchOnce(src,
      '      first=false;cycPoolBase=pool;cycBuySpent=0;cycBaseShares=Math.floor(shares+1e-9);cycSellFilled=0;cycBuyFilled=0;buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;',
      \`      first=false;cycPoolBase=pool;cycBuySpent=0;cycBaseShares=Math.floor(shares+1e-9);cycSellFilled=0;cycBuyFilled=0;rebal++;snap.push([d,shares*c+pool+totalWd]);__guardPrev=__guardOn;return;\`,
      'initial-tail');

    src=patchOnce(src,
      "    // 먼저 기존 사이클 사다리를 오늘 OHLC에 체결한다.\n    if(LADDER && !first){ const row=M[tkr][d]; _ladder(row[HI]||c, row[LO]||c, c, row[O]); }",
      \`    // MA200 Guard: 전일 확정신호로 오늘 종가에 위험축소/복귀. 그 아래에서는 신규 사다리 매수를 막는다.
    if(!first){
      if(!__guardOn && __guardPrev && __guardScale<1 && shares>0){
        const __gross=Math.max(0,shares*c*(1-__guardScale));
        if(__gross>0){ pool+=_vsell(__gross,c); sells++; }
        cycPoolBase=pool;cycBuySpent=0;cycBaseShares=Math.floor(shares+1e-9);cycSellFilled=0;cycBuyFilled=0;
      }else if(__guardOn && !__guardPrev){
        const __need=Math.max(0,V-shares*c), __use=Math.min(__need,Math.max(0,pool));
        if(__use>0){ pool-=_vbuy(__use,c); buys++; }
        cycPoolBase=pool;cycBuySpent=0;cycBaseShares=Math.floor(shares+1e-9);cycSellFilled=0;cycBuyFilled=0;
      }
    }
    // 먼저 기존 사이클 사다리를 오늘 OHLC에 체결한다. Guard OFF 중에는 저가를 비활성화해 신규 매수만 막는다.
    if(LADDER && !first){ const row=M[tkr][d]; _ladder(row[HI]||c, __guardOn?(row[LO]||c):1e99, c, row[O]); }\`,
      'ladder-guard');

    src=patchOnce(src,
      '    if(isCyc && !first){',
      '    if(isCyc && !first && (__guardOn || __guardContinue)){',
      'cycle-freeze');

    src=patchOnce(src,
      '    if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);',
      '    __guardPrev=__guardOn;\n    if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);',
      'guard-prev');

    const runVRGuarded=eval('('+src+')');

    function buildGuard(buffer){
      const d=dtsOf('TECL'), map={},cl=d.map(x=>M.TECL[x][C]),ma=Array(cl.length).fill(null);
      let s=0,state=true;
      for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=200)s-=cl[i-200];if(i>=199)ma[i]=s/200;}
      for(let i=0;i<d.length;i++){
        if(i<200||!(ma[i-1]>0)){map[d[i]]=true;continue;}
        const p=cl[i-1],m=ma[i-1];
        if(p<m*(1-buffer))state=false;
        else if(p>m*(1+buffer))state=true;
        map[d[i]]=state;
      }
      return map;
    }
    const guardMaps={};
    for(const b of [0,0.02,0.05])guardMaps[String(b)]=buildGuard(b);

    // Guard를 사실상 끈 값으로 원본 runVR과 동등성 확인.
    const pd=commonDays('2015-01-02','2020-01-02',['TECL','TQQQ']);
    const p={contrib:0,G:10,bandPct:15,mode:.5,formula:'basic',initAmt:100000,withdraw:0,startV:0,startPool:0,cycStart:'',costOn:true,model:'ladder'};
    const a=runVR(pd,'TECL',p), b=runVRGuarded(pd,'TECL',{...p,guardMap:null,guardScale:1,guardContinue:true});
    const parity={finalDiff:Math.abs(a.final-b.final),mddDiff:Math.abs(a.mdd-b.mdd),tradesDiff:Math.abs(a.trades-b.trades)};
    if(parity.finalDiff>1e-7||parity.mddDiff>1e-9||parity.tradesDiff!==0)throw new Error('guard runner parity failed '+JSON.stringify(parity));

    const days=commonDays('2009-01-01','2099-12-31',['TECL','TQQQ']);
    return {days,guardMaps,parity,meta:Object.fromEntries(['TECL','TQQQ'].map(s=>{const d=Object.keys(M[s]||{}).sort();return [s,{first:d[0],last:d.at(-1),n:d.length,basis:PBASIS[s]}];})),runVRGuardedSource:src};
  });

  const common=setup.days,first=common[0],last=common.at(-1),start2020=common.find(d=>d>='2020-01-01')||first;
  const starts=[];let pm='';
  for(const d of common){const m=d.slice(0,7);if(m!==pm){pm=m;if(addYears(d,5)<=last)starts.push(d);}}
  const windows=starts.map(start=>{const target=addYears(start,5);let end=start;for(const d of common){if(d<start)continue;if(d<=target)end=d;else break;}return {start,end};});

  const grid=await vr.evaluate(({caps,buffers,scales,continues,common,first,last,start2020,windows,guardMaps,runnerSource})=>{
    const runVRGuarded=eval('('+runnerSource+')');
    function one(start,end,cap,buffer,scale,cont){
      const days=common.filter(d=>d>=start&&d<=end);
      const r=runVRGuarded(days,'TECL',{contrib:0,G:10,bandPct:15,mode:.5,formula:'basic',initAmt:cap,withdraw:0,startV:0,startPool:0,cycStart:'',costOn:true,model:'ladder',
        guardMap:guardMaps[String(buffer)],guardScale:scale,guardContinue:cont});
      const cagr=(Math.pow(Math.max(r.final,1)/Math.max(r.invested,1),1/Math.max(r.yrs,.05))-1)*100;
      return {start:days[0],end:days.at(-1),final:r.final,invested:r.invested,cagr,mdd:r.mdd,trades:r.trades};
    }
    const out={};
    for(const cap of caps){
      const arr=[];
      for(const buffer of buffers)for(const scale of scales)for(const cont of continues){
        const rolling=windows.map(w=>one(w.start,w.end,cap,buffer,scale,cont));
        const cc=rolling.map(x=>x.cagr).sort((a,b)=>a-b),mm=rolling.map(x=>x.mdd).sort((a,b)=>a-b);
        const qq=(a,p)=>{const k=(a.length-1)*p,f=Math.floor(k),z=Math.ceil(k);return f===z?a[f]:a[f]+(a[z]-a[f])*(k-f);};
        arr.push({buffer,scale,continueV:cont,summary:{n:rolling.length,cagrAvg:cc.reduce((a,b)=>a+b,0)/cc.length,cagrMedian:qq(cc,.5),cagrP10:qq(cc,.1),
          cagrWorst:cc[0],cagrBest:cc.at(-1),mddMedian:qq(mm,.5),mddWorst:mm.at(-1)},
          full:one(first,last,cap,buffer,scale,cont),post2020:one(start2020,last,cap,buffer,scale,cont)});
      }
      out[cap]=arr;
    }
    return out;
  },{caps:CAPS,buffers:BUFFERS,scales:SCALES,continues:CONT,common,first,last,start2020,windows,guardMaps:setup.guardMaps,runnerSource:setup.runVRGuardedSource});

  const plan=await browser.newPage();
  await plan.goto(BASE+'/plan.html',{waitUntil:'domcontentloaded',timeout:120000});
  await plan.waitForFunction(()=>window.JKPlanSessionEngine&&typeof window.JKPlanSessionEngine.replay==='function',{timeout:120000});
  const planBase=await plan.evaluate(async ({caps,common,first,last,start2020,windows})=>{
    async function getQ(sym){
      const r=await fetch('/api/quote?symbol='+encodeURIComponent(sym)+'&range=max&div=1&_ts='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error(sym+' HTTP '+r.status);const j=await r.json();
      const mk=x=>(x||[]).map(d=>({date:d.date,close:+d.close})).filter(d=>d.date&&d.close>0);
      const adj=mk(j.series),trade=!!(j.priceBasis==='trade'&&j.ohlcTrade&&j.ohlcTrade.length);
      return {rows:trade?mk(j.ohlcTrade):adj,div:j.dividends||[],basis:trade?'trade':j.priceBasis};
    }
    const [t,q]=await Promise.all([getQ('TECL'),getQ('TQQQ')]),set=new Set(common);
    const tr=t.rows.filter(x=>set.has(x.date)),qr=q.rows.filter(x=>set.has(x.date)),safe=common.map(date=>({date,close:100}));
    function one(start,end,cap){
      const r=window.JKPlanSessionEngine.replay({horizon:5,startDate:start,endDate:end,principal:cap,monthlyAdd:0,tecl:tr,tqqq:qr,sgov:safe,teclDiv:t.div,tqqqDiv:q.div,sgovDiv:[]});
      if(!r.stats)throw new Error('plan failed '+start);
      return {start:r.stats.from,end:r.stats.to,final:r.stats.total,invested:r.stats.inflow,cagr:r.stats.cagr,mdd:r.stats.mdd,trades:r.stats.nTrade};
    }
    const out={};
    for(const cap of caps){
      const rolling=windows.map(w=>one(w.start,w.end,cap)),cc=rolling.map(x=>x.cagr).sort((a,b)=>a-b),mm=rolling.map(x=>x.mdd).sort((a,b)=>a-b);
      const qq=(a,p)=>{const k=(a.length-1)*p,f=Math.floor(k),z=Math.ceil(k);return f===z?a[f]:a[f]+(a[z]-a[f])*(k-f);};
      out[cap]={summary:{n:rolling.length,cagrAvg:cc.reduce((a,b)=>a+b,0)/cc.length,cagrMedian:qq(cc,.5),cagrP10:qq(cc,.1),cagrWorst:cc[0],cagrBest:cc.at(-1),mddMedian:qq(mm,.5),mddWorst:mm.at(-1)},
        full:one(first,last,cap),post2020:one(start2020,last,cap)};
    }
    return {out,meta:{TECL:{basis:t.basis,n:tr.length,first:tr[0]?.date,last:tr.at(-1)?.date},TQQQ:{basis:q.basis,n:qr.length,first:qr[0]?.date,last:qr.at(-1)?.date}}};
  },{caps:CAPS,common,first,last,start2020,windows});

  const report={generatedAt:new Date().toISOString(),source:{base:BASE,vr:'production backtest.html runVR dynamically instrumented only with MA200 overlay hook',plan:'production plan.html + plan-session-engine.js',
    costs:'양쪽 동일: 매매수수료 0.1%, 양도세 0, 배당 세전, 안전자산/Pool 0%',signal:'TECL 전일 종가 vs TECL SMA200, buffer hysteresis, 오늘 종가 위험축소/복귀, Guard OFF 신규 VR 매수 차단'},
    parity:setup.parity,grid:{bufferPct:BUFFERS.map(x=>x*100),riskScale:SCALES,continueV:CONT,combos:BUFFERS.length*SCALES.length*CONT.length},
    data:{first,last,commonDays:common.length,rollingWindows:windows.length,start2020,vr:setup.meta,plan:planBase.meta},goal:GOAL,capital:{}};

  for(const cap of CAPS){
    const p=planBase.out[cap],rows=grid[cap].map(x=>{
      const pass={median:x.summary.cagrMedian>=GOAL.median,p10:x.summary.cagrP10>=GOAL.p10,worst:x.summary.cagrWorst>=GOAL.worst,mdd:x.summary.mddWorst<=GOAL.mddWorst};
      return {...x,delta:{median:x.summary.cagrMedian-p.summary.cagrMedian,p10:x.summary.cagrP10-p.summary.cagrP10,worst:x.summary.cagrWorst-p.summary.cagrWorst,mddWorst:x.summary.mddWorst-p.summary.mddWorst},pass:{...pass,all:pass.median&&pass.p10&&pass.worst&&pass.mdd}};
    });
    const score=x=>{
      const s=x.summary;
      return (s.cagrMedian-GOAL.median)*3+(s.cagrP10-GOAL.p10)*2+(s.cagrWorst-GOAL.worst)*2-(Math.max(0,s.mddWorst-GOAL.mddWorst))*1.5;
    };
    report.capital[cap]={
      plan:p,
      counts:{all:rows.length,goalPass:rows.filter(x=>x.pass.all).length,mdd50:rows.filter(x=>x.pass.mdd).length},
      goalPass:rows.filter(x=>x.pass.all).sort((a,b)=>score(b)-score(a)).slice(0,20),
      bestScore:[...rows].sort((a,b)=>score(b)-score(a)).slice(0,15),
      bestMdd:[...rows].sort((a,b)=>a.summary.mddWorst-b.summary.mddWorst||b.summary.cagrMedian-a.summary.cagrMedian).slice(0,15),
      bestMedian:[...rows].sort((a,b)=>b.summary.cagrMedian-a.summary.cagrMedian||a.summary.mddWorst-b.summary.mddWorst).slice(0,15),
      bestWorst:[...rows].sort((a,b)=>b.summary.cagrWorst-a.summary.cagrWorst||a.summary.mddWorst-b.summary.mddWorst).slice(0,15)
    };
  }

  console.log('===TECL_VR_MA200_GUARD_JSON===');
  console.log(JSON.stringify(clean(report),null,2));
  console.log('===END_TECL_VR_MA200_GUARD_JSON===');
}finally{await browser.close();}
