// 운영 메뉴 적립·거치 ② (11-18) — 주기(매일 10$ · 매주 50$ · 매달 210$) · 하락 배수(전일 종가 ≤ 200일선이면 × 1.5 · 2 · 3)
// backtest.html _dcaOne(앱 엔진 그대로 · 앱 기본 USD · 배당 재투자 · 비용 켬) · 값: 돈 가중 연수익(IRR · 세전) · 끝날 청산세(22% · 250만원 · 1350원) 뺀 IRR(낸 돈 1만$·10만$ 규모) · 단위 MDD
// 실제 USD 2007~ · 합성 SYNUSD_S 1995~ · 5년 창(매달 시작) — 기준(매일 10$ · 배수 1) 대비 같은 창 짝 차. 하락 배수는 낸 돈 합이 달라 IRR 로만 비교.
// 사용: node dca2.js [out.json]   env: DS=usd,usdsyn
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'dca2_out.json', DS=(process.env.DS||'usd,usdsyn').split(',');
const SETS={usd:{sym:'USD',file:'USD',y0:2007,half:'2014-06-01'},usdsyn:{sym:'USD',file:'SYNUSD_S',y0:1995,half:'2008-06-01'}};
const VARS=[['base','daily',10,1],['F1','weekly',50,1],['F2','monthly',210,1],['D2','daily',10,2],['D15','daily',10,1.5],['D3','daily',10,3]];
const PAGE=()=>{ window.DCARUN2=function(tkr,from,to,amt,freq,mul){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=_dcaOne(tkr,days,amt,freq,true,mul);
  const t=d=>(Date.parse(d)-Date.parse(days[0]))/(365.25*864e5), T=t(days[days.length-1]);
  const solve=(cfs,fin)=>{ const f=x=>{ let s=0; for(const [d,a] of cfs) s-=a*Math.pow(1+x,-t(d)); return s+fin*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f(lo)*f(hi)>0) return null; for(let k=0;k<100;k++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  const at=(scale)=>{ const k=scale/r.invested, fin=r.final*k, inv=r.invested*k, g=fin-inv, tax=g>0?Math.max(0,g*1350-250e4)*0.22/1350:0; return solve(r.cf.map(([d,a])=>[d,a*k]),fin-tax); };
  return {inv:r.invested,fin:r.final,irr:solve(r.cf,r.final),at1:at(1e4),at10:at(1e5),mdd:r.mdd,first:days[0],last:days[days.length-1]}; }; };
(async()=>{ const out={sets:{}}; const q=(a,p)=>{ const b=[...a].filter(x=>x!=null).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f2=x=>x==null?'-':(x>=0?'+':'')+x.toFixed(2);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.sym,file:S.file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.sym), END=all[all.length-1], F0=all[0];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const W=[]; for(const [s,e] of starts){ const row={s}; for(const [v,fr,amt,mul] of VARS) row[v]=await pg.evaluate(a=>DCARUN2(...a),[S.sym,s,e,amt,fr,mul]); W.push(row); }
    out.sets[ds]={sym:S.sym,file:S.file,win:W};
    console.log(`\n■ ${ds} ${S.file} · 5년 창 ${W.length} · 기준(매일 10$ · 배수 1) IRR 중앙 ${q(W.map(r=>r.base.irr),.5).toFixed(1)} · 세후(1만$) ${q(W.map(r=>r.base.at1),.5).toFixed(1)} · 단위 MDD 중앙 ${q(W.map(r=>r.base.mdd),.5).toFixed(1)}`);
    for(const [v] of VARS.slice(1)){ const d=k=>W.map(r=>(r[v][k]!=null&&r.base[k]!=null)?r[v][k]-r.base[k]:null).filter(x=>x!=null);
      const h1=W.filter(r=>r.s<S.half).map(r=>r[v].irr-r.base.irr), h2=W.filter(r=>r.s>=S.half).map(r=>r[v].irr-r.base.irr), di=d('irr');
      console.log(`  ${v.padEnd(4)} IRR 차 중앙 ${f2(q(di,.5))} · 나은 창 ${(di.filter(x=>x>0).length/di.length*100).toFixed(0)}% · 앞/뒤 ${f2(q(h1,.5))}/${f2(q(h2,.5))} · 10% ${f2(q(di,.1))} · 최소 ${f2(Math.min(...di))} | 세후 IRR 차(1만$/10만$) ${f2(q(d('at1'),.5))}/${f2(q(d('at10'),.5))} · 단위 MDD 차 중앙 ${f2(q(d('mdd'),.5))} · 최악 MDD 차 ${f2(Math.max(...W.map(r=>r[v].mdd))-Math.max(...W.map(r=>r.base.mdd)))} · 낸 돈 비 중앙 ×${q(W.map(r=>r[v].inv/r.base.inv),.5).toFixed(2)}`); }
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
