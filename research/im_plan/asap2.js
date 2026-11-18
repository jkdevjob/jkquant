// 운영 메뉴 ASAP ② (11-19) — base · mid · deep 주변값(하나씩 ±30% · ±60%) · backtest.html runASAP 앱 엔진 그대로(SOXL · 비용 켬 · 적립 매일 10$ · 리저브)
// 값: 적립 돈 가중 연수익(IRR 세전) · 끝날 청산세 뺀 IRR(낸 돈 1만$·10만$ 규모로 비례) · 엔진 MDD · 기준(base 10 · mid 50 · deep 100) 대비 같은 5년 창 짝 차
// 실제 SOXL 2010~ · 합성 SYNSOXL_S 1995~ · 5년 창(매달 시작). 사용: node asap2.js [out.json]   env: DS=soxl,soxlsyn
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'asap2_out.json', DS=(process.env.DS||'soxl,soxlsyn').split(',');
const SETS={soxl:{sym:'SOXL',file:'SOXL',y0:2010,half:'2016-01-01'},soxlsyn:{sym:'SOXL',file:'SYNSOXL_S',y0:1995,half:'2008-06-01'}};
const B={base:10,mid:50,deep:100};
const VARS=[['기준',{}]]; for(const k of ['base','mid','deep']) for(const m of [0.4,0.7,1.3,1.6]) VARS.push([k+'×'+m,{[k]:Math.round(B[k]*m)}]);
const PAGE=()=>{ const tx=g=>g>0?Math.max(0,g*1350-250e4)*0.22/1350:0;
  const irrOf=(cf,fin,t,T)=>{ const f=x=>{ let s=0; for(const [d,a] of cf) s-=a*Math.pow(1+x,-t(d)); return s+fin*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f(lo)*f(hi)>0) return null; for(let k=0;k<100;k++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  window.ASAP2=function(tkr,from,to,o){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const t=d=>(Date.parse(d)-Date.parse(days[0]))/(365.25*864e5), T=t(days[days.length-1]);
    const a=runASAP(days,tkr,Object.assign({base:10,mid:50,deep:100,costOn:true},o));
    const at=scale=>{ const k=scale/a.invested, fin=a.final*k, cf=a.cf.map(([d,x])=>[d,x*k]); return irrOf(cf,fin-tx(fin-a.invested*k),t,T); };
    return {irr:irrOf(a.cf,a.final,t,T),at1:at(1e4),at10:at(1e5),mdd:a.mdd,inv:a.invested}; }; };
(async()=>{ const out={sets:{}}; const q=(a,p)=>{ const b=[...a].filter(x=>x!=null).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f2=x=>x==null?'-':(x>=0?'+':'')+x.toFixed(2);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.sym,file:S.file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.sym), END=all[all.length-1], F0=all[0];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const W=[]; for(const [s,e] of starts){ const row={s}; for(const [v,o] of VARS) row[v]=await pg.evaluate(a=>ASAP2(...a),[S.sym,s,e,o]); W.push(row); }
    out.sets[ds]={win:W};
    console.log(`\n■ ${ds} ${S.file} · 5년 창 ${W.length} · 기준 IRR 중앙 ${q(W.map(r=>r['기준'].irr),.5).toFixed(1)} · 세후(1만$) ${q(W.map(r=>r['기준'].at1),.5).toFixed(1)} · MDD 중앙 ${q(W.map(r=>r['기준'].mdd),.5).toFixed(1)}`);
    for(const [v] of VARS.slice(1)){ const d=k=>W.map(r=>(r[v][k]!=null&&r['기준'][k]!=null)?r[v][k]-r['기준'][k]:null).filter(x=>x!=null); const di=d('irr');
      const h1=W.filter(r=>r.s<S.half).map(r=>r[v].irr-r['기준'].irr), h2=W.filter(r=>r.s>=S.half).map(r=>r[v].irr-r['기준'].irr);
      console.log(`  ${v.padEnd(9)} IRR 차 중앙 ${f2(q(di,.5))} · 나은 창 ${(di.filter(x=>x>0).length/di.length*100).toFixed(0)}% · 앞/뒤 ${f2(q(h1,.5))}/${f2(q(h2,.5))} · 최소 ${f2(Math.min(...di))} | 세후 IRR 차(1만$/10만$) ${f2(q(d('at1'),.5))}/${f2(q(d('at10'),.5))} · MDD 차 중앙 ${f2(q(d('mdd'),.5))} · 최악 MDD 차 ${f2(Math.max(...W.map(r=>r[v].mdd))-Math.max(...W.map(r=>r['기준'].mdd)))} · 낸 돈 비 중앙 ×${q(W.map(r=>r[v].inv/r['기준'].inv),.5).toFixed(2)}`); }
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
