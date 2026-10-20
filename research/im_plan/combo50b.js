// combo50 보충 — '5:5 로 새로 시작'을 시기·위기마다 따로 잰다(전체 곡선을 잘라 보면 따로 굴린 두 계좌 비중이 15년 새 크게 벌어져
// 5:5 비교가 아니게 된다). 연도별·1년 롤링은 매년 1월 5:5 로 다시 맞춘 곡선에서 잰다(그 해가 실제 5:5 로 시작).
// 사용: node combo50b.js 기존.json 출력.json
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const [IN,OUT]=process.argv.slice(2); const res=JSON.parse(fs.readFileSync(IN));
const CAPS=[10000,30000,100000];
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; };
// combo50.js 의 규칙·짝·엔진 호출을 그대로 가져온다(같은 걸 두 번 적지 않는다)
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
// eval 안의 const 는 밖에서 안 보인다 — 가져온 조각의 선언만 var 로 바꿔 이 함수 범위에 올린다
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
(async()=>{
  const {pg,close}=await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'SYNSOXL_S'},{sym:'SYNTQQQ_S'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  // 고리 주입·엔진 호출·지표 — await 가 들어 있어 async 함수로 감싸 돌리고 필요한 것만 받는다
  const {run,metrics,series,mixNone,mixYear,slice,crisis}=await eval('(async()=>{'+grab('  // 일별 자산 고리','  // ── 지표 ──')+'\n'+grab('  // ── 지표 ──','  const res=')
    +'\nreturn {run,metrics,series,mixNone,mixYear,slice,crisis};})()');
  const shift=(d,months)=>{ const t=new Date(d+'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth()+months); return t.toISOString().slice(0,10); };
  for(const syn of [false,true]){ const out=syn?res.syn:res.real, PS=partners(syn), from=syn?'2000-04-03':'2011-03-01';
    const PER=syn?[['2000-04-03','2002-12-31','닷컴 붕괴'],['2003-01-02','2007-09-28','회복'],['2007-10-01','2009-03-31','금융위기'],['2009-04-01','2015-12-31','2009~2015'],['2016-01-04','2020-12-31','2016~2020'],['2021-01-04','2026-12-31','2021~']]
                 :[['2011-03-01','2015-12-31','2011~2015'],['2016-01-04','2020-12-31','2016~2020'],['2021-01-04','2026-12-31','2021~2026'],['2022-01-03','2026-12-31','2022~(모의 기간)']];
    const CR=syn?[['2000-03-24','2002-10-09','닷컴 붕괴'],['2007-10-09','2009-03-09','금융위기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장']]
                :[['2011-07-22','2011-10-03','2011 미국 강등'],['2015-07-20','2016-02-11','2015 중국·유가'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','2020 코로나'],['2021-11-19','2022-12-28','2022 하락장'],['2024-07-10','2025-04-08','2024~25 관세']];
    for(const cap of CAPS){ const R=out[cap], half=cap/2; console.error(`[${syn?'합성':'실제'} ${cap/1e4}만$] 보충`);
      R.periodsFresh={}; R.crisisFresh={};
      for(const [s,e,lab] of PER){ R.periodsFresh[lab]={}; const a=await run('IM',half,s,e,syn), af=await run('IM',cap,s,e,syn);
        R.periodsFresh[lab].IM100=metrics(series(af));
        for(const [k,,spec] of PS){ const x=await run(spec,half,s,e,syn); R.periodsFresh[lab][k]=metrics(series(mixNone(a,x))); if(k==='P5'){ const xf=await run(spec,cap,s,e,syn); R.periodsFresh[lab].P5_100=metrics(series(xf)); } } }
      for(const [s,e,lab] of CR){ const st=shift(s,-6)<from?from:shift(s,-6), en='2099-12-31'; R.crisisFresh[lab]={start:st};   // 위기 6개월 전에 5:5 로 시작 · 회복을 보려고 끝까지 돌린다
        const a=await run('IM',half,st,en,syn), af=await run('IM',cap,st,en,syn); R.crisisFresh[lab].IM100=crisis(af,s,e);
        for(const [k,,spec] of PS){ const x=await run(spec,half,st,en,syn); R.crisisFresh[lab][k]=crisis(mixNone(a,x),s,e); if(k==='P5'){ const xf=await run(spec,cap,st,en,syn); R.crisisFresh[lab].P5_100=crisis(xf,s,e); } } }
      // 매년 1월 5:5 로 맞춘 곡선 — 연도별 수익 · 1년 롤링
      const IMf=await run('IM',cap,from,'2099-12-31',syn); R.calYear={}; R.roll1y={};
      for(const [k,,spec] of PS){ const xf=await run(spec,cap,from,'2099-12-31',syn), m=mixYear(IMf,xf), ds=Object.keys(m).sort(); const yrs={};
        for(const y of [...new Set(ds.map(d=>d.slice(0,4)))]){ const prev=ds.filter(d=>d<y+'-01-01'), inY=ds.filter(d=>d.slice(0,4)===y); const v0=prev.length?m[prev[prev.length-1]]:m[inY[0]]; yrs[y]=(m[inY[inY.length-1]]/v0-1)*100; }
        R.calYear[k]=yrs;
        const one=[]; for(let y=+from.slice(0,4);y<=2025;y++) for(let mo=1;mo<=12;mo++){ const s=`${y}-${String(mo).padStart(2,'0')}-01`, e=`${y+1}-${String(mo).padStart(2,'0')}-01`; if(s<from||e>ds[ds.length-1]) continue; const sl=slice(m,s,e); if(sl.length>200) one.push(metrics(sl)); }
        R.roll1y[k]={n:one.length,cMed:q(one.map(x=>x.cagr),.5),c10:q(one.map(x=>x.cagr),.1),cMin:Math.min(...one.map(x=>x.cagr)),pLoss:one.filter(x=>x.cagr<0).length/one.length*100,mMed:q(one.map(x=>x.mdd),.5),mMax:Math.max(...one.map(x=>x.mdd))}; }
      const yrs={}; const ds=Object.keys(IMf).sort(); for(const y of [...new Set(ds.map(d=>d.slice(0,4)))]){ const prev=ds.filter(d=>d<y+'-01-01'), inY=ds.filter(d=>d.slice(0,4)===y); const v0=prev.length?IMf[prev[prev.length-1]]:IMf[inY[0]]; yrs[y]=(IMf[inY[inY.length-1]]/v0-1)*100; } R.calYear.IM100=yrs;
      fs.writeFileSync(OUT,JSON.stringify(res)); } }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
