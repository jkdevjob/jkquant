(async function __imLocResearch(){
  if (fail !== 0) throw new Error('regression-check failed before LOC research: '+fail);

  const OUTDIR=path.join(__d,'research-output');
  fs.mkdirSync(OUTDIR,{recursive:true});

  function epoch(s){ return Math.floor(new Date(s+'T00:00:00Z').getTime()/1000); }
  function isoDay(d){ return d.toISOString().slice(0,10); }
  function addYears(s,n){ const d=new Date(s+'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear()+n); return isoDay(d); }

  async function fetchChunk(from,to){
    const u='https://jkquant.pages.dev/api/quote?symbol=SOXL&range=5y&period1='+epoch(from)+'&period2='+epoch(to)+'&intraday=0&div=1';
    let lastErr=null;
    for(let a=0;a<4;a++){
      try{
        const r=await fetch(u,{headers:{accept:'application/json','user-agent':'JKQuant-LOC-Research/1.0'}});
        if(!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,300));
        const j=await r.json();
        if(j && Array.isArray(j.ohlcTrade) && j.ohlcTrade.length) return j;
        throw new Error('ohlcTrade missing/empty; priceBasis='+(j&&j.priceBasis));
      }catch(e){
        lastErr=e;
        await new Promise(res=>setTimeout(res,800*(a+1)));
      }
    }
    throw lastErr;
  }

  async function loadLive(){
    const start='2010-03-01';
    const tomorrow=new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const end=isoDay(tomorrow);
    const chunks=[];
    let cur=start;
    while(cur<end){
      let to=addYears(cur,4);
      if(to>end) to=end;
      chunks.push([cur,to]);
      cur=to;
    }
    const bars=new Map(), adj=new Map(), div=new Map(), splits=new Map(), sources=[];
    for(const ab of chunks){
      const a=ab[0], b=ab[1];
      const j=await fetchChunk(a,b);
      sources.push({from:a,to:b,src:j.src||'',basis:j.priceBasis||'',bars:j.ohlcTrade.length});
      if(j.priceBasis!=='trade') throw new Error('live API not trade basis for '+a+'~'+b+': '+j.priceBasis);
      for(const x of j.ohlcTrade||[]){
        if(!x||!x.date||!(+x.close>0)) continue;
        bars.set(x.date,[+x.close,+x.open||+x.close,+x.high||+x.close,+x.low||+x.close]);
      }
      for(const x of j.series||[]){ if(x&&x.date&&+x.close>0) adj.set(x.date,[+x.close,+x.close,+x.close,+x.close]); }
      for(const x of j.dividends||[]){ if(x&&x.date&&+x.amount>0) div.set(x.date,+x.amount); }
      for(const x of j.splits||[]){ if(x&&x.date&&+x.ratio>0) splits.set(x.date,+x.ratio); }
    }
    const days=[...bars.keys()].sort();
    if(days.length<3000) throw new Error('too few live SOXL daily bars: '+days.length);
    return {days,bars,adj,div,splits,sources};
  }

  const live=await loadLive();
  M.SOXL={}; ADJ.SOXL={};
  for(const d of live.days){
    M.SOXL[d]=live.bars.get(d);
    ADJ.SOXL[d]=live.adj.has(d)?live.adj.get(d):M.SOXL[d].slice();
  }
  DAYS.SOXL=live.days.slice();
  PBASIS.SOXL='trade';
  DIVMAP.SOXL=Object.fromEntries(live.div);
  global.SPLITS.SOXL=Object.fromEntries(live.splits);
  global.SPLIT_TRADE=true;
  global.META=global.META||{};
  global.META.SOXL=Object.assign({},global.META.SOXL||{},{lev:3});

  const origBuy=global.imBuyOrders;
  const origRows=global.imRowsOf;
  const origFlags={
    imReverse:global.imReverse, imCostOn:global.imCostOn, imTgtDyn:global.imTgtDyn,
    imAutoTp:global.imAutoTp, imRevGap:global.imRevGap
  };

  let expSrc=extractFn(bt,'function imBuyOrders(o)');
  const needle='o.buy1/(Q+k)';
  if(!expSrc.includes(needle)) throw new Error('imBuyOrders LOC formula marker not found');
  expSrc=expSrc.replace(needle,'o.buy1/(Q+global.__LOC_ALPHA*k)');
  const expBuy=new Function(expSrc+'\nreturn imBuyOrders;')();

  Object.assign(global,{imReverse:false,imCostOn:true,imTgtDyn:false,imAutoTp:false,imRevGap:0});

  const periods={
    full:[live.days[0],live.days[live.days.length-1]],
    recent:['2020-01-01',live.days[live.days.length-1]],
    train:[live.days[0],'2021-12-31'],
    holdout:['2022-01-01',live.days[live.days.length-1]]
  };
  const caps=[10000,100000];
  const scenarioNames=['full','recent','train','holdout'];
  const subDays=(name)=>{
    const p=periods[name];
    return live.days.filter(d=>d>=p[0]&&d<=p[1]);
  };

  function yearsOf(days){
    if(!days.length) return 0;
    return Math.max(1/365.25,(new Date(days[days.length-1]+'T00:00:00Z')-new Date(days[0]+'T00:00:00Z'))/(365.25*864e5));
  }
  function pack(r,cap,days){
    const yrs=yearsOf(days);
    return {
      final:+r.final, ret:+r.ret, cagr:(Math.pow(Math.max(+r.final,1e-12)/cap,1/yrs)-1)*100,
      mdd:+r.mdd, cycles:+r.cycles, fees:+r.fees||0, tax:+r.tax||0, days:days.length,
      from:days[0],to:days[days.length-1]
    };
  }
  function run(days,cap){ return pack(runIM(days,'SOXL',cap,20,20,true,20),cap,days); }

  global.imBuyOrders=origBuy; global.imRowsOf=origRows;
  const baseline={};
  for(const pn of scenarioNames){
    const d=subDays(pn); baseline[pn]={};
    for(const cap of caps) baseline[pn][cap]=run(d,cap);
  }

  global.__LOC_ALPHA=1;
  global.imBuyOrders=expBuy;
  global.imRowsOf=()=>3;
  const parity=[];
  for(const pn of scenarioNames){
    const d=subDays(pn);
    for(const cap of caps){
      const x=run(d,cap), b=baseline[pn][cap];
      const rel=Math.abs(x.final-b.final)/Math.max(1,Math.abs(b.final));
      parity.push({period:pn,cap,relFinalDiff:rel,mddDiff:Math.abs(x.mdd-b.mdd),cyclesDiff:x.cycles-b.cycles});
      if(rel>1e-10 || Math.abs(x.mdd-b.mdd)>1e-10 || x.cycles!==b.cycles)
        throw new Error('alpha=1 rows=3 parity failed '+pn+' '+cap+' '+JSON.stringify(parity[parity.length-1]));
    }
  }

  const alphas=[]; for(let a=0.5;a<=3.0001;a+=0.25) alphas.push(+a.toFixed(2));
  const rowGrid=[0,1,2,3,4,5,6,7,8,9,10];
  const grid=[];
  for(const alpha of alphas){
    global.__LOC_ALPHA=alpha;
    for(const n of rowGrid){
      global.imRowsOf=()=>n;
      const scenarios={}; const ratios=[]; const mddD=[];
      let wins=0;
      for(const pn of scenarioNames){
        const d=subDays(pn); scenarios[pn]={};
        for(const cap of caps){
          const x=run(d,cap), b=baseline[pn][cap];
          scenarios[pn][cap]=x;
          const ratio=x.final/b.final;
          ratios.push(ratio); mddD.push(x.mdd-b.mdd);
          if(ratio>1+1e-12) wins++;
        }
      }
      const geo=Math.exp(ratios.reduce((a,b)=>a+Math.log(Math.max(b,1e-12)),0)/ratios.length);
      const trainGeo=Math.sqrt((scenarios.train[10000].final/baseline.train[10000].final)*
                               (scenarios.train[100000].final/baseline.train[100000].final));
      const holdGeo=Math.sqrt((scenarios.holdout[10000].final/baseline.holdout[10000].final)*
                              (scenarios.holdout[100000].final/baseline.holdout[100000].final));
      grid.push({alpha,rows:n,geoRatio:geo,minRatio:Math.min(...ratios),maxRatio:Math.max(...ratios),
        wins,avgMddDelta:mddD.reduce((a,b)=>a+b,0)/mddD.length,trainGeo,holdoutGeo,scenarios});
    }
  }

  const byGeo=grid.slice().sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio);
  const byMin=grid.slice().sort((a,b)=>b.minRatio-a.minRatio||b.geoRatio-a.geoRatio);
  const byTrain=grid.slice().sort((a,b)=>b.trainGeo-a.trainGeo||b.holdoutGeo-a.holdoutGeo);
  const eligible=grid.filter(x=>x.holdoutGeo>=1 && x.trainGeo>=1 && x.wins>=6);
  const robust=(eligible.length?eligible:grid).slice().sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio)[0];

  function bestScenario(pn,cap){
    return grid.slice().sort((a,b)=>b.scenarios[pn][cap].final-a.scenarios[pn][cap].final)[0];
  }

  const candKeys=new Map();
  const addCand=x=>{ if(x) candKeys.set(x.alpha+'|'+x.rows,x); };
  addCand(grid.find(x=>x.alpha===1&&x.rows===3));
  addCand(robust);
  byGeo.slice(0,3).forEach(addCand);
  byTrain.slice(0,3).forEach(addCand);
  byMin.slice(0,3).forEach(addCand);
  const cands=[...candKeys.values()].slice(0,10);

  function runCfg(days,cap,cfg,autoTp){
    global.__LOC_ALPHA=cfg.alpha; global.imRowsOf=()=>cfg.rows; global.imAutoTp=!!autoTp;
    return run(days,cap);
  }
  function rollingYears(cfg,yrs,cap){
    const span=Math.round(yrs*252), step=21, vals=[];
    for(let i=0;i+span<=live.days.length;i+=step){
      const d=live.days.slice(i,i+span);
      global.__LOC_ALPHA=1; global.imRowsOf=()=>3; global.imAutoTp=false;
      const b=run(d,cap);
      const x=runCfg(d,cap,cfg,false);
      vals.push(x.final/b.final);
    }
    vals.sort((a,b)=>a-b);
    const avg=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
    return {windows:vals.length,wins:vals.filter(x=>x>1).length,winRate:vals.length?vals.filter(x=>x>1).length/vals.length*100:0,
      avgRatio:avg,medianRatio:vals.length?vals[Math.floor(vals.length/2)]:null,worstRatio:vals[0]||null,bestRatio:vals[vals.length-1]||null};
  }
  const rolling={};
  for(const cfg of cands){
    const k=cfg.alpha+'|'+cfg.rows; rolling[k]={};
    for(const cap of caps) rolling[k][cap]={y3:rollingYears(cfg,3,cap),y5:rollingYears(cfg,5,cap)};
  }

  const autoCandidates=[grid.find(x=>x.alpha===1&&x.rows===3),robust,...byGeo.slice(0,2)];
  const autoMap=new Map(autoCandidates.filter(Boolean).map(x=>[x.alpha+'|'+x.rows,x]));
  const autoTpCheck=[];
  for(const cfg of autoMap.values()){
    const scenarios={};
    for(const pn of ['full','recent','holdout']){
      const d=subDays(pn); scenarios[pn]={};
      for(const cap of caps) scenarios[pn][cap]=runCfg(d,cap,cfg,true);
    }
    autoTpCheck.push({alpha:cfg.alpha,rows:cfg.rows,scenarios});
  }
  global.imAutoTp=false;

  function lite(x){
    return {alpha:x.alpha,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,maxRatio:x.maxRatio,wins:x.wins,
      avgMddDelta:x.avgMddDelta,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,scenarios:x.scenarios};
  }

  const report={
    schema:1,
    generatedAt:new Date().toISOString(),
    source:{endpoint:'https://jkquant.pages.dev/api/quote',symbol:'SOXL',priceBasis:'trade',chunks:live.sources,
      first:live.days[0],last:live.days[live.days.length-1],days:live.days.length,dividends:live.div.size,splits:live.splits.size},
    engine:{file:'backtest.html',run:'runIM',formulaProduction:'buy1/(Q+k)',formulaExperiment:'buy1/(Q+alpha*k)',
      fixed:{ticker:'SOXL',divs:20,targetPct:20,compound:true,reverse:false,big:20,costs:true,autoTp:false},
      alphaGrid:alphas,rowGrid:rowGrid,baseline:{alpha:1,rows:3},parity},
    periods,baseline,
    best:{
      robust:lite(robust),
      byGeo:byGeo.slice(0,15).map(lite),
      byMin:byMin.slice(0,15).map(lite),
      byTrain:byTrain.slice(0,15).map(lite),
      full10k:lite(bestScenario('full',10000)),
      full100k:lite(bestScenario('full',100000)),
      recent10k:lite(bestScenario('recent',10000)),
      recent100k:lite(bestScenario('recent',100000))
    },
    rolling,
    autoTpCheck,
    grid:grid.map(lite)
  };

  fs.writeFileSync(path.join(OUTDIR,'im-loc-opt.json'),JSON.stringify(report,null,2));

  const summary={
    generatedAt:report.generatedAt,
    data:report.source,
    baseline:{
      full10k:baseline.full[10000],full100k:baseline.full[100000],
      recent10k:baseline.recent[10000],recent100k:baseline.recent[100000]
    },
    robust:lite(robust),
    bestFull10k:lite(bestScenario('full',10000)),
    bestFull100k:lite(bestScenario('full',100000)),
    bestRecent10k:lite(bestScenario('recent',10000)),
    bestRecent100k:lite(bestScenario('recent',100000)),
    topGeo:byGeo.slice(0,10).map(x=>({alpha:x.alpha,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta})),
    topTrain:byTrain.slice(0,10).map(x=>({alpha:x.alpha,rows:x.rows,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins})),
    rolling:rolling[robust.alpha+'|'+robust.rows],
    autoTpCheck:autoTpCheck.map(x=>({alpha:x.alpha,rows:x.rows,full10k:x.scenarios.full[10000],recent10k:x.scenarios.recent[10000],holdout10k:x.scenarios.holdout[10000]}))
  };
  fs.writeFileSync(path.join(OUTDIR,'im-loc-opt-summary.json'),JSON.stringify(summary,null,2));
  console.log('\n=== IM LOC OPT SUMMARY JSON ===');
  console.log(JSON.stringify(summary,null,2));

  global.imBuyOrders=origBuy; global.imRowsOf=origRows;
  Object.assign(global,origFlags);
})().catch(e=>{ console.error('IM LOC RESEARCH FAILED',e&&e.stack||e); process.exitCode=1; });
