(async function __imLocScaleResearch(){
  if(fail!==0) throw new Error('regression setup failed: '+fail);
  const OUTDIR=path.join(__d,'research-output-scale'); fs.mkdirSync(OUTDIR,{recursive:true});
  const epoch=s=>Math.floor(new Date(s+'T00:00:00Z').getTime()/1000);
  const iso=d=>d.toISOString().slice(0,10);
  const addYears=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+n);return iso(d);};

  async function fetchChunk(from,to){
    const u='https://jkquant.pages.dev/api/quote?symbol=SOXL&range=5y&period1='+epoch(from)+'&period2='+epoch(to)+'&intraday=0&div=1';
    let e;
    for(let a=0;a<4;a++){
      try{
        const r=await fetch(u,{headers:{accept:'application/json','user-agent':'JKQuant-LOC-Scale/1.0'}});
        if(!r.ok) throw new Error('HTTP '+r.status);
        const j=await r.json();
        if(j&&j.priceBasis==='trade'&&Array.isArray(j.ohlcTrade)&&j.ohlcTrade.length) return j;
        throw new Error('bad quote payload '+(j&&j.priceBasis));
      }catch(x){e=x;await new Promise(r=>setTimeout(r,700*(a+1)));}
    }
    throw e;
  }
  async function loadLive(){
    const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const end=iso(tomorrow), chunks=[]; let cur='2010-03-01';
    while(cur<end){let to=addYears(cur,4);if(to>end)to=end;chunks.push([cur,to]);cur=to;}
    const bars=new Map(),adj=new Map(),div=new Map(),splits=new Map(),sources=[];
    for(const [a,b] of chunks){
      const j=await fetchChunk(a,b);sources.push({from:a,to:b,src:j.src,basis:j.priceBasis,bars:j.ohlcTrade.length});
      for(const x of j.ohlcTrade||[])if(x&&x.date&&+x.close>0)bars.set(x.date,[+x.close,+x.open||+x.close,+x.high||+x.close,+x.low||+x.close]);
      for(const x of j.series||[])if(x&&x.date&&+x.close>0)adj.set(x.date,[+x.close,+x.close,+x.close,+x.close]);
      for(const x of j.dividends||[])if(x&&x.date&&+x.amount>0)div.set(x.date,+x.amount);
      for(const x of j.splits||[])if(x&&x.date&&+x.ratio>0)splits.set(x.date,+x.ratio);
    }
    const days=[...bars.keys()].sort();
    if(days.length<3000)throw new Error('too few days '+days.length);
    return {days,bars,adj,div,splits,sources};
  }
  const live=await loadLive();
  M.SOXL={};ADJ.SOXL={};
  for(const d of live.days){M.SOXL[d]=live.bars.get(d);ADJ.SOXL[d]=live.adj.get(d)||M.SOXL[d].slice();}
  DAYS.SOXL=live.days.slice();PBASIS.SOXL='trade';DIVMAP.SOXL=Object.fromEntries(live.div);
  global.SPLITS.SOXL=Object.fromEntries(live.splits);global.SPLIT_TRADE=true;
  global.META=global.META||{};global.META.SOXL=Object.assign({},global.META.SOXL||{},{lev:3});

  const origBuy=global.imBuyOrders,origRows=global.imRowsOf;
  const origFlags={imReverse:global.imReverse,imCostOn:global.imCostOn,imTgtDyn:global.imTgtDyn,imAutoTp:global.imAutoTp,imRevGap:global.imRevGap};
  let src=extractFn(bt,'function imBuyOrders(o)');
  if(!src.includes('o.buy1/(Q+k)'))throw new Error('production LOC marker missing');
  src=src.replace('o.buy1/(Q+k)','o.buy1/(Q*(1+global.__LOC_BETA*k))');
  const scaleBuy=new Function(src+'\nreturn imBuyOrders;')();

  Object.assign(global,{imReverse:false,imCostOn:true,imTgtDyn:false,imRevGap:0});
  const caps=[10000,100000];
  const periods={full:[live.days[0],live.days.at(-1)],recent:['2020-01-01',live.days.at(-1)],train:[live.days[0],'2021-12-31'],holdout:['2022-01-01',live.days.at(-1)]};
  const names=Object.keys(periods), sub=n=>live.days.filter(d=>d>=periods[n][0]&&d<=periods[n][1]);
  function yrs(d){return Math.max(1/365.25,(new Date(d.at(-1)+'T00:00:00Z')-new Date(d[0]+'T00:00:00Z'))/(365.25*864e5));}
  function pack(r,cap,d){const y=yrs(d);return {final:+r.final,ret:+r.ret,cagr:(Math.pow(Math.max(+r.final,1e-12)/cap,1/y)-1)*100,mdd:+r.mdd,cycles:+r.cycles};}
  const run=(d,cap)=>pack(runIM(d,'SOXL',cap,20,20,true,20),cap,d);

  function baselines(auto){
    global.imBuyOrders=origBuy;global.imRowsOf=origRows;global.imAutoTp=auto;
    const z={};
    for(const n of names){const d=sub(n);z[n]={};for(const c of caps)z[n][c]=run(d,c);}
    return z;
  }
  const baseFixed=baselines(false),baseAuto=baselines(true);
  global.imBuyOrders=scaleBuy;

  const betas=[];for(let b=.01;b<=.25001;b+=.01)betas.push(+b.toFixed(2));
  const rows=[1,2,3,4,5,6,7,8,9,10];
  function grid(auto,base){
    global.imAutoTp=auto;const out=[];
    for(const beta of betas){global.__LOC_BETA=beta;
      for(const nr of rows){global.imRowsOf=()=>nr;
        const sc={},rat=[],md=[];let wins=0;
        for(const n of names){const d=sub(n);sc[n]={};
          for(const c of caps){const x=run(d,c),b=base[n][c],q=x.final/b.final;sc[n][c]=x;rat.push(q);md.push(x.mdd-b.mdd);if(q>1+1e-12)wins++;}
        }
        const geo=Math.exp(rat.reduce((a,b)=>a+Math.log(Math.max(b,1e-12)),0)/rat.length);
        const tg=Math.sqrt((sc.train[10000].final/base.train[10000].final)*(sc.train[100000].final/base.train[100000].final));
        const hg=Math.sqrt((sc.holdout[10000].final/base.holdout[10000].final)*(sc.holdout[100000].final/base.holdout[100000].final));
        out.push({beta,rows:nr,geoRatio:geo,minRatio:Math.min(...rat),maxRatio:Math.max(...rat),wins,trainGeo:tg,holdoutGeo:hg,
          avgMddDelta:md.reduce((a,b)=>a+b,0)/md.length,scenarios:sc});
      }
    }
    return out;
  }
  const fixed=grid(false,baseFixed),auto=grid(true,baseAuto);
  const rank=a=>a.slice().sort((x,y)=>y.geoRatio-x.geoRatio||y.minRatio-x.minRatio);
  const strict=a=>rank(a.filter(x=>x.wins===8&&x.minRatio>=1&&x.trainGeo>=1&&x.holdoutGeo>=1));
  const fixedStrict=strict(fixed),autoStrict=strict(auto);
  const fixedTop=rank(fixed).slice(0,15),autoTop=rank(auto).slice(0,15);

  function rollingGroup(cfgs,autoMode,baseMode,years,cap){
    const span=Math.round(years*252),step=21,vs=cfgs.map(()=>[]);
    global.imAutoTp=autoMode;
    for(let i=0;i+span<=live.days.length;i+=step){
      const d=live.days.slice(i,i+span);
      global.imBuyOrders=origBuy;global.imRowsOf=origRows;const b=run(d,cap);
      global.imBuyOrders=scaleBuy;
      cfgs.forEach((cfg,j)=>{global.__LOC_BETA=cfg.beta;global.imRowsOf=()=>cfg.rows;const x=run(d,cap);vs[j].push(x.final/b.final);});
    }
    return vs.map(v=>{v.sort((a,b)=>a-b);const wins=v.filter(x=>x>1).length;return {windows:v.length,wins,winRate:wins/v.length*100,
      avgRatio:v.reduce((a,b)=>a+b,0)/v.length,medianRatio:v[Math.floor(v.length/2)],worstRatio:v[0],bestRatio:v.at(-1)};});
  }
  function rollingFinal(gridStrict,gridTop,autoMode){
    const mp=new Map(),add=x=>{if(x)mp.set(x.beta+'|'+x.rows,x);};
    gridStrict.slice(0,6).forEach(add);gridTop.slice(0,4).forEach(add);
    const cfg=[...mp.values()].slice(0,8), out={};
    for(const x of cfg)out[x.beta+'|'+x.rows]={};
    for(const c of caps)for(const y of [3,5]){
      const st=rollingGroup(cfg,autoMode,null,y,c);
      cfg.forEach((x,i)=>{out[x.beta+'|'+x.rows][c]=out[x.beta+'|'+x.rows][c]||{};out[x.beta+'|'+x.rows][c]['y'+y]=st[i];});
    }
    const scores=cfg.map(x=>{const r=out[x.beta+'|'+x.rows],av=[r[10000].y3.avgRatio,r[10000].y5.avgRatio,r[100000].y3.avgRatio,r[100000].y5.avgRatio],
      med=[r[10000].y3.medianRatio,r[10000].y5.medianRatio,r[100000].y3.medianRatio,r[100000].y5.medianRatio];
      return {beta:x.beta,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta,
        rollingMinAvg:Math.min(...av),rollingGeoAvg:Math.exp(av.reduce((a,b)=>a+Math.log(b),0)/av.length),rollingMinMedian:Math.min(...med),rolling:r};})
      .sort((a,b)=>b.rollingMinAvg-a.rollingMinAvg||b.geoRatio-a.geoRatio);
    const final=scores.filter(x=>x.wins===8&&x.minRatio>=1&&x.rollingMinAvg>=1).sort((a,b)=>b.geoRatio-a.geoRatio||b.rollingMinAvg-a.rollingMinAvg)[0]||null;
    return {candidates:cfg.map(x=>({beta:x.beta,rows:x.rows})),scores,final};
  }
  const fixedRoll=rollingFinal(fixedStrict,fixedTop,false);
  const autoRoll=rollingFinal(autoStrict,autoTop,true);

  const lite=x=>({beta:x.beta,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta,scenarios:x.scenarios});
  const report={generatedAt:new Date().toISOString(),source:{first:live.days[0],last:live.days.at(-1),days:live.days.length,priceBasis:'trade',sources:live.sources},
    formula:{production:'buy1/(Q+k)',scale:'buy1/(Q*(1+beta*k))',betas,rows},
    fixed:{baseline:baseFixed,strictCount:fixedStrict.length,top:fixedTop.map(lite),strict:fixedStrict.slice(0,25).map(lite),rolling:fixedRoll},
    auto:{baseline:baseAuto,strictCount:autoStrict.length,top:autoTop.map(lite),strict:autoStrict.slice(0,25).map(lite),rolling:autoRoll}};
  fs.writeFileSync(path.join(OUTDIR,'im-loc-scale.json'),JSON.stringify(report,null,2));
  const summary={generatedAt:report.generatedAt,source:report.source,formula:report.formula,
    fixed:{strictCount:fixedStrict.length,top:fixedTop.slice(0,10).map(x=>({beta:x.beta,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta})),rolling:fixedRoll},
    auto:{strictCount:autoStrict.length,top:autoTop.slice(0,10).map(x=>({beta:x.beta,rows:x.rows,geoRatio:x.geoRatio,minRatio:x.minRatio,wins:x.wins,trainGeo:x.trainGeo,holdoutGeo:x.holdoutGeo,avgMddDelta:x.avgMddDelta})),rolling:autoRoll}};
  fs.writeFileSync(path.join(OUTDIR,'im-loc-scale-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  global.imBuyOrders=origBuy;global.imRowsOf=origRows;Object.assign(global,origFlags);
})().catch(e=>{console.error('LOC SCALE FAILED',e&&e.stack||e);process.exitCode=1;});
