// 운영 메뉴 적립·거치 기준선(11-13) — backtest.html _dcaOne(앱 엔진 그대로)을 앱 기본값(index.html defDcaSettings: USD · 매일 10$ · 하락 배수 1 · 배당 재투자)으로
// 실제 USD 2007~ · 합성 SYNUSD_S 1995~ · (참고) QQQ · TQQQ · 비용 켬 · 전체 기간 + 5년 창(매달 시작). 지피티 11-11 기준선의 독립 재현을 겸한다.
// 값: 돈 가중 연수익(IRR · 세전) · 단위값(평가액 ÷ 낸 돈) MDD(엔진 값) · 끝날 청산세(22% · 250만원 공제 · 1350원) 뺀 IRR — 낸 돈 합 1만$·10만$ 두 규모(적립은 비례라 세전 값은 같다)
// 참고: 같은 돈을 첫날 한 번에(거치) 넣은 그냥 보유 세전 연복리
// 사용: node dca_base.js [out.json]   env: DS=usd,usdsyn,qqq,tqqq
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'dca_base_out.json', DS=(process.env.DS||'usd,usdsyn,qqq,tqqq').split(',');
const SETS={usd:{sym:'USD',file:'USD',y0:2007},usdsyn:{sym:'USD',file:'SYNUSD_S',y0:1995},qqq:{sym:'QQQ',file:'QQQ',y0:2000},tqqq:{sym:'TQQQ',file:'TQQQ',y0:2010}};
const PAGE=()=>{ window.DCARUN=function(tkr,from,to,amt){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=_dcaOne(tkr,days,amt,'daily',true,1);
  const t=d=>(Date.parse(d)-Date.parse(days[0]))/(365.25*864e5), T=t(days[days.length-1]);
  const irr=(fin)=>{ const f=x=>{ let s=0; for(const [d,a] of r.cf) s-=a*Math.pow(1+x,-t(d)); return s+fin*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f(lo)*f(hi)>0) return null; for(let k=0;k<100;k++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  const p0=M[tkr][days[0]][C], p1=M[tkr][days[days.length-1]][C];
  const at=(scale)=>{ const k=scale/r.invested, fin=r.final*k, inv=r.invested*k, g=fin-inv, tax=g>0?Math.max(0,g*1350-250e4)*0.22/1350:0; const f2=x=>{ let s=0; for(const [d,a] of r.cf) s-=a*k*Math.pow(1+x,-t(d)); return s+(fin-tax)*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f2(lo)*f2(hi)>0) return null; for(let j=0;j<100;j++){ const m=(lo+hi)/2; if(f2(lo)*f2(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  return {inv:r.invested,fin:r.final,irr:irr(r.final),at1:at(1e4),at10:at(1e5),mdd:r.mdd,bh:(Math.pow(p1/p0,1/T)-1)*100,first:days[0],last:days[days.length-1],n:r.trades}; }; };
(async()=>{ const out={sets:{}}; const q=(a,p)=>{ const b=[...a].filter(x=>x!=null).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f1=x=>x==null?'-':x.toFixed(1);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.sym,file:S.file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.sym), END=all[all.length-1], F0=all[0];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const full=await pg.evaluate(a=>DCARUN(...a),[S.sym,F0,END,10]); const W=[];
    for(const [s,e] of starts){ const r=await pg.evaluate(a=>DCARUN(...a),[S.sym,s,e,10]); W.push(Object.assign({s},r)); }
    out.sets[ds]={sym:S.sym,file:S.file,full,win:W};
    console.log(`${ds} ${S.file} | 전체 ${full.first}~${full.last}: 낸 돈 ${(full.inv/1e3).toFixed(1)}k$ → ${(full.fin/1e3).toFixed(1)}k$ · IRR ${f1(full.irr)} · 청산세 뺀 IRR(1만$/10만$ 규모) ${f1(full.at1)}/${f1(full.at10)} · 단위 MDD ${f1(full.mdd)} | 그냥 보유(세전) ${f1(full.bh)}`
      +` || 5년 창 ${W.length}: IRR 중앙 ${f1(q(W.map(x=>x.irr),.5))} · 하10 ${f1(q(W.map(x=>x.irr),.1))} · 최악 ${f1(Math.min(...W.map(x=>x.irr??99)))} · 청산세 뺀(1만$) 중앙 ${f1(q(W.map(x=>x.at1),.5))} · (10만$) ${f1(q(W.map(x=>x.at10),.5))} · 단위 MDD 중앙 ${f1(q(W.map(x=>x.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.mdd)))} | 거치 그냥 보유 중앙 ${f1(q(W.map(x=>x.bh),.5))} · 적립 IRR > 거치 연복리 창 ${W.filter(x=>x.irr>x.bh).length}/${W.length}`);
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
