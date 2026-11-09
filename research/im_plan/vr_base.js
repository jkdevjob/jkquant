// 운영 메뉴 VR(밸류리밸런싱) 기준선(11-10) — backtest.html runVR 를 앱 기본값 그대로(TQQQ · 적립식 mode 0.75 · 기본 공식 · G 10 · 밴드 15% ·
// 회차 적립 100$ · 사다리 · 비용·세금 켬)로 실제 TQQQ 2010~ · 합성 SYNTQQQ_S 1990~ × 시작 1만$·10만$ · 전체 기간 + 5년 창(매달 시작).
// 값: 평가액 ÷ 낸 돈 · 돈 가중 연수익(IRR · 입금 날짜 그대로) · 엔진 MDD(인출 포함 자산 기준) · 참고: 같은 날 같은 돈으로 그냥 사서 보유(세전 · 수수료 없음)
// 사용: node vr_base.js [out.json]   env: PARAMS='{"G":10,"bandPct":15}' (기본값 위에 덮어씀 · 후보 시험용) · DS=real,syn · CAPS=10000,100000
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'vr_base_out.json', DS=(process.env.DS||'real,syn').split(','), CAPS=(process.env.CAPS||'10000,100000').split(',').map(Number);
const PARAMS=Object.assign({contrib:100,G:10,bandPct:15,mode:0.75,formula:'basic',costOn:true},JSON.parse(process.env.PARAMS||'{}'));
const SETS={real:{tk:'TQQQ',file:'TQQQ',y0:2010},syn:{tk:'SYNTQQQ_S',file:'SYNTQQQ_S',y0:1990}};
const PAGE=()=>{ window.VRRUN=function(tkr,from,to,P){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=runVR(days,tkr,P);
  // 같은 입금(날짜·금액)으로 그냥 사서 보유 — 그날 종가 · 세전 · 수수료 없음
  let u=0; for(const [d,a] of r.cf){ const px=M[tkr][d]?M[tkr][d][C]:null; if(px>0) u+=a/px; } const last=M[tkr][days[days.length-1]][C];
  return {final:r.final,invested:r.invested,mdd:r.mdd,yrs:r.yrs,trades:r.trades,tax:r.tax,fees:r.fees,cf:r.cf,last:days[days.length-1],bh:u*last}; }; };
// 돈 가중 연수익: Σ a_i (1+r)^((T−t_i)/365.25) = final 을 이분법으로
function irr(cf,final,end){ const T=Date.parse(end); const f=r=>cf.reduce((s,[d,a])=>s+a*Math.pow(1+r,(T-Date.parse(d))/(365.25*864e5)),0)-final;
  let lo=-0.99,hi=5; if(f(lo)>0) return -99; if(f(hi)<0) return 500; for(let k=0;k<80;k++){ const m=(lo+hi)/2; if(f(m)>0) hi=m; else lo=m; } return (lo+hi)/2*100; }
(async()=>{ const out={params:PARAMS,sets:{}}; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.tk,file:S.file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.tk), F0=all[0], END=all[all.length-1];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    out.sets[ds]={tk:S.tk,first:F0,last:END,starts:starts.map(x=>x[0]),caps:{}};
    for(const cap of CAPS){ const P=Object.assign({},PARAMS,{initAmt:cap});
      const full=await pg.evaluate(([t,a,b,P])=>VRRUN(t,a,b,P),[S.tk,F0,END,P]); const fi=irr(full.cf,full.final,full.last), bi=irr(full.cf,full.bh,full.last);
      const W=[]; for(const [s,e] of starts){ const r=await pg.evaluate(([t,a,b,P])=>VRRUN(t,a,b,P),[S.tk,s,e,P]); W.push({s,mult:r.final/r.invested,irr:irr(r.cf,r.final,r.last),mdd:r.mdd,bhMult:r.bh/r.invested,bhIrr:irr(r.cf,r.bh,r.last),trades:r.trades/r.yrs}); }
      out.sets[ds].caps[cap]={full:{final:full.final,invested:full.invested,mult:full.final/full.invested,irr:fi,mdd:full.mdd,bhMult:full.bh/full.invested,bhIrr:bi,trades:full.trades/full.yrs},win:W};
      const f1=x=>x.toFixed(1);
      console.log(`${ds} ${S.tk} ${cap/1e4}만$ | 전체 ${F0}~${END}: 낸 돈 ${(full.invested/1e3).toFixed(1)}k → ${(full.final/1e3).toFixed(1)}k(×${full.final/full.invested>=100?(full.final/full.invested).toFixed(0):(full.final/full.invested).toFixed(2)}) · IRR ${f1(fi)}% · MDD ${f1(full.mdd)} · 매매 ${f1(full.trades/full.yrs)}회/년 | 그냥 보유 IRR ${f1(bi)}%`
        +` || 5년 창 ${W.length}: IRR 중앙 ${f1(q(W.map(x=>x.irr),.5))} · 하10 ${f1(q(W.map(x=>x.irr),.1))} · 최악 ${f1(Math.min(...W.map(x=>x.irr)))} · 배수 중앙 ×${q(W.map(x=>x.mult),.5).toFixed(2)} · MDD 중앙 ${f1(q(W.map(x=>x.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.mdd)))} | 그냥 보유 IRR 중앙 ${f1(q(W.map(x=>x.bhIrr),.5))} · 최악 ${f1(Math.min(...W.map(x=>x.bhIrr)))} · VR 이 높은 창 ${W.filter(x=>x.irr>x.bhIrr).length}/${W.length}`); }
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
