// 200일선 출구의 '얼마나 깊이 빠지면 나가나' 주변값 — 나갈 때 −3·−6·−10·−15% · 돌아올 때 +3% (+0 · +6 도) · 무매 단독 · 합성 1995~ · 실제 2010~
const fs=require('fs'); const {open}=require('./imh');
const src=fs.readFileSync(__dirname+'/regime.js','utf8'); eval(src.slice(src.indexOf('const load=s=>'),src.indexOf('const RULES=')).replace(/\bconst /g,'var '));
function sigAsym(lo,hi){ let on=true; return sc.map((c,k)=>{ const m=MA200[k]; if(m>0){ if(on&&c<m*(1-lo)) on=false; else if(!on&&c>m*(1+hi)) on=true; } return on; }); }
const met=eq=>{ const v0=eq[0][1],v1=eq[eq.length-1][1],y=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/(365.25*864e5); let pk=v0,m=0; for(const [,v] of eq){ if(v>pk)pk=v; else m=Math.max(m,(pk-v)/pk); } return {cagr:(Math.pow(Math.max(v1,1e-9)/v0,1/y)-1)*100,mdd:m*100}; };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]); const irxm={}; IRX.forEach(x=>irxm[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irxm);
  const run=o=>pg.evaluate(o=>{ const r=RUN(o); const eq=r.eqs.map(x=>[x[0],x[1]]); eq[eq.length-1]=[eq[eq.length-1][0],r.final]; return {eq,exits:r.exits}; },o);
  const V=[[null,null],[.03,.03],[.06,.03],[.10,.03],[.15,.03],[.10,0],[.10,.06],[.20,.03]];
  for(const [lab,tk,from] of [['합성','SYNSOXL_S','1995-06-01'],['실제','SOXL','2010-04-01']]){ const days=await pg.evaluate(tk=>Object.keys(M[tk]).sort(),tk);
    for(const cap of [10000,100000]) for(const [lo,hi] of V){ const reg=lo==null?null:{st:stateFor(sigAsym(lo,hi),days),gate:true,exit:true};
      const r=await run({cap,tkr:tk,autoTp:true,cashYield:true,from,regime:reg}); const m=met(r.eq);
      let flips=0; if(lo!=null){ const s=sigAsym(lo,hi); for(let i=1;i<s.length;i++) if(s[i]!==s[i-1]&&sd[i]>=from) flips++; }
      const seg=(a,b)=>{ const sl=r.eq.filter(([d])=>d>=a&&d<=b); const pv=r.eq.filter(([d])=>d<a); return sl.length>2?met([pv.length?pv[pv.length-1]:sl[0],...sl]):null; };
      const extra=lab==='합성'?` | 닷컴 ${(seg('2000-01-01','2002-12-31')||{}).cagr?.toFixed(0)} · 금융위기 ${(seg('2007-10-01','2009-12-31')||{}).cagr?.toFixed(0)} · 2010~ ${(seg('2010-01-01','2026-12-31')||{}).cagr?.toFixed(1)}`:'';
      console.log(`${lab} ${cap/1e4}만$ ${lo==null?'출구 없음      ':'나갈 때 −'+(lo*100)+'% · 돌아올 때 +'+(hi*100)+'%'} → ${m.cagr.toFixed(1)}/${m.mdd.toFixed(1)} · 신호 전환 ${flips}${extra}`); } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
