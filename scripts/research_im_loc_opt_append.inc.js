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
        wins,avgMddDelta:mddD.reduce((a,b)=>a+b,0)/mddD.length,trainGeo,holdoutGeo:holdGeo,scenarios});
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

  // Full alpha x row grid again with current automatic TP/M10 enabled.
  const autoBaseline={};
  global.__LOC_ALPHA=1; global.imRowsOf=()=>3; global.imAutoTp=true;
  for(const pn of scenarioNames){
    const d=subDays(pn); autoBaseline[pn]={};
    for(const cap of caps) autoBaseline[pn][cap]=run(d,cap);
  }
  const autoGrid=[];
  for(const alpha of alphas){
    global.__LOC_ALPHA=alpha;
    for(const n of rowGrid){
      global.imRowsOf=()=>n; global.imAutoTp=true;
      const scenarios={}; const ratios=[]; const mddD=[]; let wins=0;
      for(const pn of scenarioNames){
        const d=subDays(pn); scenarios[pn]={};
        for(const cap of caps){
          const x=run(d,cap), b=autoBaseline[pn][cap];
          scenarios[pn][cap]=x;
          const ratio=x.final/b.final;
          ratios.push(ratio); mddD.push(x.mdd-b.mdd);
          if(ratio>1+1e-12) wins++;
        }
      }
      const geo=Math.exp(ratios.reduce((a,b)=>a+Math.log(Math.max(b,1e-12)),0)/ratios.length);
      const trainGeo=Math.sqrt((scenarios.train[10000].final/autoBaseline.train[10000].final)*
                               (scenarios.train[100000].final/autoBaseline.train[100000].final));
      const holdGeo=Math.sqrt((scenarios.holdout[10000].final/autoBaseline.holdout[10000].final)*
                              (scenarios.holdout[100000].final/autoBaseline.holdout[100000].final));
      autoGrid.push({alpha,rows:n,geoRatio:geo,minRatio:Math.min(...ratios),maxRatio:Math.max(...ratios),
        wins,avgMddDelta:mddD.reduce((a,b)=>a+b,0)/mddD.length,trainGeo,holdoutGeo:holdGeo,scenarios});
    }
  }
  const autoByGeo=autoGrid.slice().sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio);
  const autoByMin=autoGrid.slice().sort((a,b)=>b.minRatio-a.minRatio||b.geoRatio-a.geoRatio);
  const autoByTrain=autoGrid.slice().sort((a,b)=>b.trainGeo-a.trainGeo||b.holdoutGeo-a.holdoutGeo);
  const autoEligible=autoGrid.filter(x=>x.trainGeo>=1 && x.holdoutGeo>=1 && x.wins>=6);
  const autoRobust=autoEligible.slice().sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio)[0]||null;
  function autoBestScenario(pn,cap){
    return autoGrid.slice().sort((a,b)=>b.scenarios[pn][cap].final-a.scenarios[pn][cap].final)[0];
  }
  // 2차 정밀탐색: coarse grid에서 강했던 구간을 alpha 0.05 간격으로 다시 훑는다.
  const fineAlphas=[]; for(let a=1.25;a<=2.75001;a+=0.05) fineAlphas.push(+a.toFixed(2));
  const fineRows=[3,4,5,6,7,8,9,10];
  const autoFineGrid=[];
  for(const alpha of fineAlphas){
    global.__LOC_ALPHA=alpha;
    for(const n of fineRows){
      global.imRowsOf=()=>n; global.imAutoTp=true;
      const scenarios={}; const ratios=[]; const mddD=[]; let wins=0;
      for(const pn of scenarioNames){
        const d=subDays(pn); scenarios[pn]={};
        for(const cap of caps){
          const x=run(d,cap), b=autoBaseline[pn][cap];
          scenarios[pn][cap]=x;
          const ratio=x.final/b.final;
          ratios.push(ratio); mddD.push(x.mdd-b.mdd);
          if(ratio>1+1e-12) wins++;
        }
      }
      const geo=Math.exp(ratios.reduce((a,b)=>a+Math.log(Math.max(b,1e-12)),0)/ratios.length);
      const trainGeo=Math.sqrt((scenarios.train[10000].final/autoBaseline.train[10000].final)*
                               (scenarios.train[100000].final/autoBaseline.train[100000].final));
      const holdGeo=Math.sqrt((scenarios.holdout[10000].final/autoBaseline.holdout[10000].final)*
                              (scenarios.holdout[100000].final/autoBaseline.holdout[100000].final));
      autoFineGrid.push({alpha,rows:n,geoRatio:geo,minRatio:Math.min(...ratios),maxRatio:Math.max(...ratios),
        wins,avgMddDelta:mddD.reduce((a,b)=>a+b,0)/mddD.length,trainGeo,holdoutGeo:holdGeo,scenarios});
    }
  }
  const fineStrict=autoFineGrid.filter(x=>x.wins===8 && x.minRatio>=1 && x.trainGeo>=1 && x.holdoutGeo>=1)
    .sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio);
  const fineNear=autoFineGrid.filter(x=>x.wins>=7 && x.trainGeo>=1 && x.holdoutGeo>=1)
    .sort((a,b)=>b.geoRatio-a.geoRatio||b.minRatio-a.minRatio);

  /* Rolling은 같은 창의 baseline을 후보마다 다시 계산하지 않는다.
     각 창에서 현재값(1,3)을 한 번만 돌린 뒤 후보를 모두 비교한다. */
  function rollingAutoGroup(cfgs,yrs,cap){
    const span=Math.round(yrs*252), step=21;
    const vals=cfgs.map(()=>[]);
    for(let i=0;i+span<=live.days.length;i+=step){
      const d=live.days.slice(i,i+span);
      global.__LOC_ALPHA=1; global.imRowsOf=()=>3; global.imAutoTp=true;
      const b=run(d,cap);
      cfgs.forEach((cfg,j)=>{
        global.__LOC_ALPHA=cfg.alpha; global.imRowsOf=()=>cfg.rows; global.imAutoTp=true;
        const x=run(d,cap);
        vals[j].push(x.final/b.final);
      });
    }
    return vals.map(v=>{
      v.sort((a,b)=>a-b);
      return {windows:v.length,wins:v.filter(x=>x>1).length,
        winRate:v.length?v.filter(x=>x>1).length/v.length*100:0,
        avgRatio:v.reduce((a,b)=>a+b,0)/Math.max(1,v.length),
        medianRatio:v.length?v[Math.floor(v.length/2)]:null,
        worstRatio:v[0]||null,bestRatio:v[v.length-1]||null};
    });
  }

  // 정밀탐색 상위 + coarse에서 8/8이었던 단순 후보를 rolling 결선에 올린다.
  const rollMap=new Map();
  const addRoll=x=>{ if(x) rollMap.set(x.alpha+'|'+x.rows,x); };
  fineStrict.slice(0,5).forEach(addRoll);
  fineNear.slice(0,3).forEach(addRoll);
  addRoll(autoFineGrid.find(x=>x.alpha===1.5&&x.rows===4));
  addRoll(autoFineGrid.find(x=>x.alpha===2.25&&x.rows===10));
  addRoll(autoFineGrid.find(x=>x.alpha===2.5&&x.rows===8));
  const autoRollCfgs=[...rollMap.values()].slice(0,12);

  const autoRollingFinal={};
  for(const cfg of autoRollCfgs) autoRollingFinal[cfg.alpha+'|'+cfg.rows]={};
  for(const cap of caps){
    for(const yrs of [3,5]){
      const stats=rollingAutoGroup(autoRollCfgs,yrs,cap);
      autoRollCfgs.forEach((cfg,i)=>{
        autoRollingFinal[cfg.alpha+'|'+cfg.rows][cap]=autoRollingFinal[cfg.alpha+'|'+cfg.rows][cap]||{};
        autoRollingFinal[cfg.alpha+'|'+cfg.rows][cap]['y'+yrs]=stats[i];
      });
    }
  }
  const rollingScores=autoRollCfgs.map(cfg=>{
    const r=autoRollingFinal[cfg.alpha+'|'+cfg.rows];
    const avgs=[r[10000].y3.avgRatio,r[10000].y5.avgRatio,r[100000].y3.avgRatio,r[100000].y5.avgRatio];
    const meds=[r[10000].y3.medianRatio,r[10000].y5.medianRatio,r[100000].y3.medianRatio,r[100000].y5.medianRatio];
    const wr=[r[10000].y3.winRate,r[10000].y5.winRate,r[100000].y3.winRate,r[100000].y5.winRate];
    return {alpha:cfg.alpha,rows:cfg.rows,geoRatio:cfg.geoRatio,minRatio:cfg.minRatio,wins:cfg.wins,
      trainGeo:cfg.trainGeo,holdoutGeo:cfg.holdoutGeo,avgMddDelta:cfg.avgMddDelta,
      rollingMinAvg:Math.min(...avgs),rollingGeoAvg:Math.exp(avgs.reduce((a,b)=>a+Math.log(Math.max(b,1e-12)),0)/avgs.length),
      rollingMinMedian:Math.min(...meds),rollingMinWinRate:Math.min(...wr),rolling:r};
  }).sort((a,b)=>b.rollingMinAvg-a.rollingMinAvg||b.geoRatio-a.geoRatio);

  // 모든 주요기간 8/8 개선 + 네 종류 rolling 평균도 모두 >= 현재값인 후보만 최종 강건 후보.
  const finalRobust=rollingScores.filter(x=>x.wins===8&&x.minRatio>=1&&x.rollingMinAvg>=1)
    .sort((a,b)=>b.geoRatio-a.geoRatio||b.rollingMinAvg-a.rollingMinAvg)[0]||null;

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
    autoOptimization:{
      baseline:autoBaseline,
      eligibleCount:autoEligible.length,
      robust:autoRobust?lite(autoRobust):null,
      topGeo:autoByGeo.slice(0,15).map(lite),
      topMin:autoByMin.slice(0,15).map(lite),
      topTrain:autoByTrain.slice(0,15).map(lite),
      bestFull10k:lite(autoBestScenario('full',10000)),
      bestFull100k:lite(autoBestScenario('full',100000)),
      bestRecent10k:lite(autoBestScenario('recent',10000)),
      bestRecent100k:lite(autoBestScenario('recent',100000)),
      fineAlphaGrid:fineAlphas,
      fineRows,
      fineStrictCount:fineStrict.length,
      fineTop:fineStrict.slice(0,20).map(lite),
      rollingCandidates:autoRollCfgs.map(x=>({alpha:x.alpha,rows:x.rows})),
      rollingScores,
      finalRobust,
      rolling:autoRollingFinal
    },
    grid:grid.map(lite),
    autoGrid:autoGrid.map(lite),
    autoFineGrid:autoFineGrid.map(lite)
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
    fixedEligibleCount:eligible.length,
    autoTpCheck:autoTpCheck.map(x=>({alpha:x.alpha,rows:x.rows,full10k:x.scenarios.full[10000],recent10k:x.scenarios.recent[10000],holdout10k:x.scenarios.holdout[10000]})),
    autoOptimization:{
      baseline:{full10k:autoBaseline.full[10000],full100k:autoBaseline.full[100000],recent10k:autoBaseline.recent[10000],recent100k:autoBaseline.recent[100000]},
      eligibleCount:autoEligible.length,
      robust:autoRobust?lite(autoRobust):null,
      bestFull10k:lite(autoBestScenario('full',10000)),
      bestFull100k:lite(autoBestScenario('full',100000)),
      bestRecent10k:lite(autoBestScenario('recent',10000)),
      bestRecent100k:lite(autoBestScenario('recent',100000)),
      topGeo:autoByGeo.slice(0,10).map(x=>({alpha:x.alpha,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta})),
      topTrain:autoByTrain.slice(0,10).map(x=>({alpha:x.alpha,rows:x.rows,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins})),
      fineStrictCount:fineStrict.length,
      fineTop:fineStrict.slice(0,10).map(x=>({alpha:x.alpha,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta})),
      rollingCandidates:autoRollCfgs.map(x=>({alpha:x.alpha,rows:x.rows})),
      rollingScores,
      finalRobust
    }
  };
  fs.writeFileSync(path.join(OUTDIR,'im-loc-opt-summary.json'),JSON.stringify(summary,null,2));
  console.log('\n=== IM LOC OPT SUMMARY JSON ===');
  console.log(JSON.stringify(summary,null,2));

  global.imBuyOrders=origBuy; global.imRowsOf=origRows;
  Object.assign(global,origFlags);
})().catch(e=>{ console.error('IM LOC RESEARCH FAILED',e&&e.stack||e); process.exitCode=1; });
