'use strict';
// Research only. Load the complete pinned backtest page in Chromium; never copy
// its account engine into a standalone simulator. Only signal/fill hooks differ.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.resolve(process.env.G8_OUT||'g8-output');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
fs.mkdirSync(OUT,{recursive:true});

async function main(){
  const html=fs.readFileSync(path.join(ROOT,'backtest.html'),'utf8');
  const mainSha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const manifest=[],errors=[],pageErrors=[];
  const server=http.createServer((req,res)=>{
    const p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));
    if(!p.startsWith(ROOT+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){
      res.writeHead(404);res.end();return;
    }
    res.setHeader('content-type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':'text/plain');
    res.end(fs.readFileSync(p));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();
    const page=await context.newPage();
    page.on('pageerror',e=>pageErrors.push(e.message));
    // Isolated research fixture: no signed-in account, auth calls or writes.
    await page.route('**/jk-access.js',r=>r.fulfill({contentType:'application/javascript',body:'window.JKAccess={guard(){},isAdmin(){return false}};'}));
    await page.route('https://www.gstatic.com/firebasejs/**',r=>r.abort());
    await page.route('**/api/quote?**',async r=>{
      const u=new URL(r.request().url());
      const url='https://jkquant.pages.dev'+u.pathname+u.search;
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await context.request.get(url,{timeout:45000});
          const body=await response.body();
          const data=JSON.parse(body.toString());
          if(!response.ok()||!Array.isArray(data.ohlc)||!data.ohlc.length)throw Error('invalid quote '+response.status());
          const file='quote-'+manifest.length+'.json';fs.writeFileSync(path.join(OUT,file),body);
          manifest.push({url,at:new Date().toISOString(),status:response.status(),file,sha256:sha(body),
            source:data.src,rows:data.ohlc.length,first:data.ohlc[0]?.date,last:data.ohlc.at(-1)?.date,
            tradeRows:data.ohlcTrade?.length||0});
          await r.fulfill({status:200,contentType:'application/json',body});return;
        }catch(e){if(attempt===2){errors.push({url,error:e.message});await r.fulfill({status:503,body:'{}'});}}
      }
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/backtest.html',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction('typeof runMA200==="function" && typeof loadData==="function"');
    const loaded=await page.evaluate(async()=>{
      TICKERS.splice(0,TICKERS.length,'SPY','QQQ','SOXL','TQQQ');
      META.SPY={name:'S&P500',lev:1,color:'#aaa'};
      return await loadData('1998-01-01','2026-11-12');
    });
    if(!loaded)throw Error('original application loadData failed');
    const result=await page.evaluate(()=>{
      const tickers=['SPY','QQQ','SOXL','TQQQ'];
      const sources=tickers.map(t=>({ticker:t,basis:PBASIS[t],first:Object.keys(M[t]||{}).sort()[0],last:Object.keys(M[t]||{}).sort().at(-1),rows:Object.keys(M[t]||{}).length}));
      if(sources.some(s=>s.basis!=='trade'||s.last!=='2026-11-12'||s.rows<200))throw Error('incomplete/stale trade-basis data: '+JSON.stringify(sources));
      const native=runMA200;
      let original=native.toString(),patched=original;
      const changes=[];
      function edit(a,b){const n=patched.split(a).length-1;if(n!==1)throw Error('engine anchor count '+n+': '+a);patched=patched.replace(a,b);changes.push({from:a,to:b});}
      edit('const O=_maOpt(opt), SHORT=O.short, PARK=O.park;',
        'const O=_maOpt(opt), SHORT=O.short, PARK=O.park; const __mode=window.__g8Mode; const __trace=[],__curve=[];');
      edit('const FEE=costOn?costOf(tkr).fee:0;', 'const FEE=costOn?(costOf(tkr).fee+(window.__g8Stress||0)):0;');
      edit('const want = g>0 ? above[dts[g-1]] : true;',
        'const want = __mode ? window.__g8Want(tkr,d,shares>0) : (g>0 ? above[dts[g-1]] : true); const __bp=__mode?window.__g8BuyPx(tkr,d):c, __sp=__mode===\'breakout\'?c:(__mode?tradeBar(tkr,d)[1]:c);');
      edit('const q=iq(cash/(1+FEE),c); const spend=q*c, fee=spend*FEE;',
        'const q=iq(cash/(1+FEE),__bp); const spend=q*__bp, fee=spend*FEE;');
      edit('if(q>0){ shares=q; avg=c; lotBuy(LOT,q,c,fee); cash-=spend+fee; feesTotal+=fee; trades++; }',
        'if(q>0){ shares=q; avg=__bp; lotBuy(LOT,q,__bp,fee); cash-=spend+fee; feesTotal+=fee; trades++; __trace.push({side:"buy",date:d,signalDate:__mode===\'breakout\'?d:dts[g-1],price:__bp,qty:q,fee}); }');
      edit('}else if(!want && shares>0){','} if((__mode===\'breakout\'||!want) && shares>0){');
      edit('const gross=shares*c, fee=gross*FEE; cash+=gross-fee;',
        'const gross=shares*__sp, fee=gross*FEE; cash+=gross-fee; __trace.push({side:"sell",date:d,price:__sp,qty:shares,fee});');
      edit('const pnl=lotSell(LOT,shares,c,fee); realized+=pnl; yearPnl+=pnl;',
        'const pnl=lotSell(LOT,shares,__sp,fee); realized+=pnl; yearPnl+=pnl;');
      edit('const eq=cash+shares*c;', 'const eq=cash+shares*c; __curve.push([d,eq]);');
      edit('return {invested:cap,final:fin,ret:', 'return {trace:__trace,curve:__curve,invested:cap,final:fin,ret:');
      const hook=eval('('+patched+')');
      const opt={park:'cash'};
      function range(t,start,end){WARM_FROM=warmStartOf(start);WARM_TO=end;return Object.keys(M[t]).filter(d=>d>=start&&d<=end).sort();}
      // Disabled hooks must leave the complete native account result unchanged.
      const parity=[];
      for(const t of tickers)for(const cap of [10000,100000]){
        const days=range(t,'2020-01-01','2026-11-12');window.__g8Mode=null;window.__g8Stress=0;
        const a=native(days,t,cap,200,true,opt),b=hook(days,t,cap,200,true,opt);
        for(const k of ['final','mdd','fees','tax','endCash','endShares','trades']){
          if(Math.abs(a[k]-b[k])>1e-8)throw Error('native parity mismatch '+t+' '+cap+' '+k);
        }
        parity.push({ticker:t,capital:cap,passed:true});
      }
      const cache={},dateIndex={};let current;
      for(const t of tickers){const ds=Object.keys(M[t]).sort();dateIndex[t]={ds,idx:Object.fromEntries(ds.map((d,i)=>[d,i]))};}
      function indicators(t,n,w){
        const key=[t,n,w].join(':');if(cache[key])return cache[key];
        const ds=Object.keys(M[t]).sort(),cl=ds.map(d=>M[t][d][0]),idx=Object.fromEntries(ds.map((d,i)=>[d,i]));
        const sig=ds.map((d,i)=>{
          if(i<n-1)return {entry:false,exit:false};
          const ma=cl.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n;
          const closes=cl.slice(i-w+1,i+1);
          return {entry:cl[i]>ma&&cl[i]<=Math.min(...closes),exit:cl[i]>=Math.max(...closes)};
        });
        return cache[key]={ds,idx,sig};
      }
      window.__g8Want=(t,d,held)=>{
        const q=current;
        if(q.mode==='breakout'){
          const {ds,idx}=dateIndex[t],i=idx[d];if(i<1)return false;
          const b=M[t][d],prev=M[t][ds[i-1]];
          const target=b[1]+q.k*(prev[2]-prev[3]);
          return b[2]>=target;
        }
        const v=indicators(t,q.n,q.w),i=v.idx[d]-1;
        if(i<0)return false;
        return held?!v.sig[i].exit:v.sig[i].entry;
      };
      window.__g8BuyPx=(t,d)=>{
        const q=current;
        if(q.mode!=='breakout')return tradeBar(t,d)[1];
        const {ds,idx}=dateIndex[t],i=idx[d],prev=M[t][ds[i-1]];
        return (M[t][d][1]+q.k*(prev[2]-prev[3]))*unitOf(t,d);
      };
      function metrics(r,days,cap){
        const curve=r.curve||r.snap,years=(Date.parse(days.at(-1))-Date.parse(days[0]))/86400000/365.25;
        let prev=cap,worst=0,positiveDays=0;const year={};
        for(const [d,e] of curve){const v=(e/prev-1)*100;if(v>0)positiveDays++;worst=Math.min(worst,v);prev=e;year[d.slice(0,4)]=e;}
        // Last-year settlement is in final, after the last pre-settlement mark.
        worst=Math.min(worst,(r.final/prev-1)*100);
        let entry=null;const returns=[],hold=[];
        for(const x of r.trace||[]){
          if(x.side==='buy'){entry=x;continue;}
          if(entry){returns.push((x.price*splitRatio(r.tkr,entry.date,x.date)*(1-x.fee/(x.qty*x.price))/(entry.price*(1+entry.fee/(entry.qty*entry.price)))-1)*100);
            hold.push((Date.parse(x.date)-Date.parse(entry.date))/86400000);entry=null;}
        }
        const gains=returns.filter(x=>x>0).reduce((a,b)=>a+b,0),losses=-returns.filter(x=>x<0).reduce((a,b)=>a+b,0);
        let yprev=cap;const yr=Object.entries(year).map(([year,end])=>{const x={year,returnPct:(end/yprev-1)*100};yprev=end;return x;});
        if(yr.length)yr.at(-1).returnPct=(r.final/(yr.length>1?Object.values(year).at(-2):cap)-1)*100;
        return {start:days[0],end:days.at(-1),capital:cap,final:r.final,totalReturnPct:r.ret,cagrPct:cagrOf(r.final,cap,years),
          mddPct:-r.mdd,worstDayPct:worst,fees:r.fees,tax:r.tax,trades:r.trades,roundTrips:returns.length,
          expectancyPerTradeAfterFeePct:returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null,
          pfAfterFee:losses>0?gains/losses:null,yearly:yr,positiveYearFraction:yr.filter(x=>x.returnPct>0).length/yr.length,
          openPosition:r.endShares>0,meanHoldCalendarDays:hold.length?hold.reduce((a,b)=>a+b,0)/hold.length:0,
          maxHoldCalendarDays:hold.length?Math.max(...hold):0,
          trace:r.trace||[],curve:r.curve||[],note:'Trade PF/expectancy use split-corrected price returns and both fees, excluding allocated dividends/tax. Account CAGR/MDD include annual tax and dividend events. No new post-registration forward observations.'};
      }
      function run(t,cap,start,end,q,stress=0){
        const days=range(t,start,end);current=q;window.__g8Mode=q?.mode||null;window.__g8Stress=stress;
        const r=hook(days,t,cap,q?.n||200,true,opt);
        return metrics(r,days,cap);
      }
      const variants=[{name:'Double7_nextOpen',mode:'double7',n:200,w:7},
        {name:'VolatilityBreakout_k050_dayClose',mode:'breakout',k:.5}];
      const rows=[];
      for(const t of tickers)for(const cap of [10000,100000]){
        const listed=sources.find(s=>s.ticker===t).first;
        const starts=[{label:'2010_or_listing',start:listed>'2010-01-01'?listed:'2010-01-01'},
          {label:'publication_after_2016',start:'2016-02-11'}, {label:'2020_onward',start:'2020-01-01'},
          {label:'2022_bear',start:'2022-01-01',end:'2022-12-31'}, {label:'recent',start:'2024-01-01'}];
        for(const win of starts){
          const end=win.end||'2026-11-12';
          const baseline=run(t,cap,win.start,end,null);
          for(const q of variants){
            const base=run(t,cap,win.start,end,q),stress=run(t,cap,win.start,end,q,.0005);
            rows.push({ticker:t,capital:cap,window:win.label,method:q.name,baseline,base,stress});
          }
        }
      }
      // Fixed rules, no best-parameter selection. Monthly 3/5y independent starts.
      const rolling=[];
      for(const t of tickers)for(const cap of [10000,100000])for(const yrs of [3,5]){
        const all=[];
        for(let y=2011;y<=2026-yrs;y++)for(let m=1;m<=12;m++){
          const start=y+'-'+String(m).padStart(2,'0')+'-01';
          const last=new Date(Date.UTC(y+yrs,m-1,0)).toISOString().slice(0,10);
          if(last>'2026-11-12')continue;
          const q=variants[0],a=run(t,cap,start,last,q),b=run(t,cap,start,last,null);
          all.push({start:a.start,end:a.end,cagrPct:a.cagrPct,mddPct:a.mddPct,baselineCagrPct:b.cagrPct,deltaCagrPp:a.cagrPct-b.cagrPct});
        }
        rolling.push({ticker:t,capital:cap,years:yrs,windows:all});
      }
      const sensitivity=[];
      for(const t of tickers)for(const cap of [10000,100000])for(const [n,w] of [[200,5],[200,6],[200,8],[200,10],[150,7],[250,7]]){
        const r=run(t,cap,'2020-01-01','2026-11-12',{mode:'double7',n,w});
        delete r.trace;delete r.curve;sensitivity.push({ticker:t,capital:cap,n,w,...r});
      }
      const validation={nativeParity:parity,nonFutureSignal:rows.every(r=>r.method!=='Double7_nextOpen'||r.base.trace.filter(x=>x.side==='buy').every(x=>x.signalDate<x.date)),
        intradayFlat:rows.every(r=>r.method!=='VolatilityBreakout_k050_dayClose'||!r.base.openPosition&&r.base.maxHoldCalendarDays===0),
        nonNegativeAccounts:rows.every(r=>r.base.final>=0&&r.stress.final>=0),
        baselineDataBasis:sources.every(s=>s.basis==='trade'),
        costStressPairs:rows.every(r=>r.base.start===r.stress.start&&r.base.end===r.stress.end)};
      if(!Object.entries(validation).every(([k,v])=>k==='nativeParity'?v.every(x=>x.passed):v))throw Error('validation failed '+JSON.stringify(validation));
      return {sources,changes,rows,rolling,sensitivity,validation,
        originalEngineSource:original,patchedEngineSource:patched,
        costs:costOf('QQQ'),baseSlippageInNativeMAEngine:0,
        limits:['Double 7 is a multi-session swing method; it fails the current intraday holding limit.',
          'Breakout uses the published open-plus-prior-range concept with an explicitly experimental day-close exit; it is not certified as Larry Williams original.',
          'Daily OHLC touch and next-open execution are approximations; queue, spread and market impact are not observed.',
          'Annual tax allowance is for one isolated account; it cannot be duplicated when combining accounts.',
          'Previously viewed history and publication-after slices are historical diagnostics, not newly unseen forward results.',
          'No live recommendation without the preregistered prospective and risk gates; open positions remain marked, not falsely counted as closed.']};
    });
    const compact=r=>{const x={...r};delete x.trace;delete x.curve;return x;};
    const full={research:'G8-20261113',generatedAt:new Date().toISOString(),mainSha,backtestSha256:sha(html),
      browserVersion:browser.version(),manifest,errors,pageErrors,...result};
    fs.writeFileSync(path.join(OUT,'result_byGPT.json'),JSON.stringify(full,null,2));
    const summary={research:full.research,generatedAt:full.generatedAt,mainSha,sources:result.sources,validation:result.validation,
      rows:result.rows.filter(r=>r.window==='2020_onward').map(r=>({...r,baseline:compact(r.baseline),base:compact(r.base),stress:compact(r.stress)})),
      costs:result.costs,limits:result.limits,manifestCount:manifest.length,requestErrors:errors.length};
    fs.writeFileSync(path.join(OUT,'summary_byGPT.json'),JSON.stringify(summary,null,2));
    console.log('G8_RESULT '+JSON.stringify(summary));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{fs.writeFileSync(path.join(OUT,'failure_byGPT.json'),JSON.stringify({at:new Date().toISOString(),error:e.stack},null,2));console.error(e);process.exitCode=1;});
