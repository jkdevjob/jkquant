// 시작일이 결과를 얼마나 바꾸나 — 모의 화면(2022-01 시작 · 무매 TR +900%)과 같은 엔진으로 시작일만 바꿔 본다 (2026-10-21 사용자 '수익률이 이런데')
// ① 시작일 6개(2021-10-21 ~ 2025-01-02)부터 오늘까지: 무매 · 5년 플랜 · 지금 구성 · 새 플랜 · TQQQ · VR · 200일선 · 역분산 — 1만$·10만$
// ② 2011-03 ~ 2021-10 분기마다 시작한 5년 구간 43개에서 무매 100% 와 5년 플랜 100% 의 연수익 — 누가 몇 번 이겼나 · 2021-10 구간은 몇 등인가
// combo50.js 의 짝 규칙·엔진 호출을 그대로 가져온다. 사용: node startdate.js out.json
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'startdate_out.json';
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
(async()=>{
  const {pg,close}=await open([{sym:'SOXL'},{sym:'TQQQ'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const {run,metrics,series,mixNone}=await eval('(async()=>{'+grab('  // 일별 자산 고리','  // ── 지표 ──')+'\n'+grab('  // ── 지표 ──','  const res=')
    +'\nreturn {run,metrics,series,mixNone};})()');
  const P=Object.fromEntries(partners(false).map(([k,n,s])=>[k,s]));
  const S={IM:'IM',P5:P.P5,P5N:{px:['TECL','TQQQ'],rule:Pp=>mk(Pp,'TECL','TQQQ',{gbOn:.01,gbOff:.03,sbDn:0,sbUp:.15})},TQ:P.TQ,VR:P.VR,MA:P.MA,IVS:P.IVS};
  const NAME={IM:'무매 100%',P5:'5년 플랜 100%',NOW:'지금(무매 1/3 + 플랜 2/3)',P5N:'새 플랜 100%(앱 미반영)',TQ:'TQQQ 보유',VR:'VR(TQQQ)',MA:'200일선(TQQQ)',IVS:'역분산(TQQQ)'};
  const curve=async(k,cap,s,e,memo)=>{ if(k==='NOW'){ const a=await curve('IM',cap/3,s,e,memo), b=await curve('P5',cap*2/3,s,e,memo); return mixNone(a,b); }
    const key=k+'@'+cap; if(!memo[key]) memo[key]=await run(S[k],cap,s,e,false); return memo[key]; };
  const res={starts:{},roll:{}};
  for(const cap of [10000,100000]){ res.starts[cap]={};
    for(const s of ['2021-10-21','2022-01-03','2022-07-01','2023-01-03','2024-01-02','2025-01-02']){ const memo={}, o={};
      for(const k of ['IM','P5','NOW','P5N','TQ','VR','MA','IVS']){ const m=await curve(k,cap,s,'2099-12-31',memo), x=metrics(series(m)); o[k]={tr:(x.mult-1)*100,cagr:x.cagr,mdd:x.mdd,mar:x.mdd>0?x.cagr/x.mdd:null}; }
      res.starts[cap][s]=o; console.error(cap,s,Object.entries(o).map(([k,v])=>k+' '+v.tr.toFixed(0)+'%').join(' · ')); }
    // 5년 구간 43개 — 무매 vs 플랜
    const W=[]; for(let y=2011;y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<'2011-03-01'||e>'2026-10-19') continue;
      const memo={}, im=metrics(series(await curve('IM',cap,s,e,memo))), p5=metrics(series(await curve('P5',cap,s,e,memo))), now=metrics(series(await curve('NOW',cap,s,e,memo)));
      W.push({s,im:im.cagr,p5:p5.cagr,now:now.cagr,imMdd:im.mdd,p5Mdd:p5.mdd}); }
    res.roll[cap]=W; fs.writeFileSync(OUT,JSON.stringify(res)); }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done'); })().catch(e=>{console.error(e);process.exit(1);});
