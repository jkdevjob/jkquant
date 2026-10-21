// 무매에 SOX 200일선 출구를 붙였을 때 플랜과 섞은 계좌 전체 — 무매 1/3·1/2 · 실제 2011~ · 합성 2000~ · 1만$·3만$(분기 새로 시작 5년 롤링)
const fs=require('fs'); const {open}=require('./imh'); const {prep,sim}=require('./px'); const {mk}=require('./plan_rules');
const src=fs.readFileSync(__dirname+'/regime.js','utf8'); eval(src.slice(src.indexOf('const load=s=>'),src.indexOf('const RULES=')).replace(/\bconst /g,'var '));
const met=eq=>{ const v0=eq[0][1],v1=eq[eq.length-1][1],y=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/(365.25*864e5); let pk=v0,m=0; for(const [,v] of eq){ if(v>pk)pk=v; else m=Math.max(m,(pk-v)/pk); } return {cagr:(Math.pow(Math.max(v1,1e-9)/v0,1/y)-1)*100,mdd:m*100}; };
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]); const irxm={}; IRX.forEach(x=>irxm[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irxm);
  const run=o=>pg.evaluate(o=>{ const r=RUN(o); const m={}; r.eqs.forEach(x=>m[x[0]]=x[1]); const ks=Object.keys(m).sort(); m[ks[ks.length-1]]=r.final; return m; },o);
  for(const [lab,tk,from,E,T,frac] of [['실제','SOXL','2011-03-01','TECL','TQQQ',false],['합성','SYNSOXL_S','2000-04-03','SYNTECL','SYNTQQQ',true]]){
    const days=await pg.evaluate(tk=>Object.keys(M[tk]).sort(),tk); const reg={st:stateFor(SIG.MA200,days),gate:true,exit:true}; const P=prep([E,T]);
    const plan=(cap,s,e)=>{ const m={}; sim(P,Object.assign({cap,from:s,to:e,fee:.0025,tax:true,frac},mk(P,E,T,{}))).eq.forEach(([d,v])=>m[d]=v); return m; };
    for(const cap of [10000,30000]) for(const w of [1/3,1/2]){ const out={};
      for(const [nm,rg] of [['무매 그대로',null],['무매+200일선 출구',reg]]){ const W=[]; const last=days[days.length-1];
        const one=async(s,e)=>{ const a=await run({cap:cap*w,tkr:tk,autoTp:true,from:s,to:e,regime:rg}), b=plan(cap*(1-w),s,e); return Object.keys(b).filter(d=>a[d]!=null).sort().map(d=>[d,a[d]+b[d]]); };
        const full=met(await one(from,'2099-12-31'));
        for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>last) continue; W.push(met(await one(s,e))); }
        out[nm]={full,cMed:q(W.map(x=>x.cagr),.5),c10:q(W.map(x=>x.cagr),.1),cMin:Math.min(...W.map(x=>x.cagr)),mMed:q(W.map(x=>x.mdd),.5),mMax:Math.max(...W.map(x=>x.mdd)),n:W.length}; }
      for(const [nm,x] of Object.entries(out)) console.log(`${lab} ${cap/1e4}만$ 무매 ${Math.round(w*100)}% · ${nm.padEnd(12)} 전체 ${x.full.cagr.toFixed(1)}/${x.full.mdd.toFixed(1)} · 5년 ${x.n}개 중앙 ${x.cMed.toFixed(1)} 하위10% ${x.c10.toFixed(1)} 최악 ${x.cMin.toFixed(1)} · MDD 중앙 ${x.mMed.toFixed(1)} 최악 ${x.mMax.toFixed(1)}`); } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
