// 듀얼가드 해부(11-10) — 사용자 "듀얼보다 더 좋은 매매 전략을 아주아주 심도있게 고민해보라": 규칙을 바꾸기 전에 어디서 잃고 어디서 새는지 본다.
// 앱 조건(수수료 0.1% · TQQQ 는 Guard 바뀔 때만 · 전일 종가 주수) · 실제 2011~ · 1만$. ① 낙폭 사건(15% 넘는 것)마다 슬리브별 기여 · 비중·σ 경로 · Guard 전환
// ② Guard 전환 사건 전부(이탈가 → 재진입가 · 놓친/피한 몫) ③ TECL 비중 분포와 '늦음'(비중이 높은 채로 떨어진 날의 손실 합) ④ 연도별 수익 · 거치 비교
const {prep,sim,stats,ind}=require('./px'); const {mk}=require('./plan_rules');
const CAP=+(process.env.CAP||10000), FROM=process.env.FROM||'2011-01-01';
const P=prep(['TECL','TQQQ']); const R='TECL', G='TQQQ';
const rule=mk(P,R,G,{gsb:1e9}); const daily=[], cnt={}; let lastT=null; const t0=rule.target; rule.target=(k,cur,st)=>{ const t=t0(k,cur,st); lastT={k,t:Object.assign({},t),g:st.g}; return t; };
const o=Object.assign({cap:CAP,fee:0.001,sizePrev:true,from:FROM,daily,cnt},rule); const r=sim(P,o); const S=stats(r.eq,CAP);
const vol=ind.vol(P.C[R],20), gm=ind.ma(P.C[G],225);
// 날마다: 평가액 · 비중(전일 보유 기준 당일 수익 기여)
const D=daily.map((x,i)=>{ const vT=x.q[R]*x.px[R], vQ=x.q[G]*x.px[G], tot=x.cash+vT+vQ; return Object.assign(x,{vT,vQ,tot,wT:vT/tot,wQ:vQ/tot,wC:x.cash/tot}); });
const ki=Object.fromEntries(P.dates.map((d,i)=>[d,i]));
for(let i=1;i<D.length;i++){ const a=D[i-1], b=D[i]; const rT=b.px[R]/a.px[R]-1, rQ=b.px[G]/a.px[G]-1; b.ret=b.tot/a.tot-1; b.cT=a.wT*rT; b.cQ=a.wQ*rQ; b.cX=b.ret-b.cT-b.cQ; b.rT=rT; b.rQ=rQ; b.sig=vol[ki[b.d]-1]; b.gOn=b.q[G]>0; }
D[0].ret=0; D[0].cT=0; D[0].cQ=0; D[0].cX=0; D[0].gOn=D[0].q[G]>0;
console.log(`듀얼가드(앱 조건) 실제 ${D[0].d}~${D[D.length-1].d} · ${CAP/1e4}만$ · 연수익 ${S.cagr.toFixed(1)}% · MDD ${S.mdd.toFixed(1)}% · 끝 ×${(S.fin/CAP).toFixed(1)}`);
const bh=(sym)=>{ const a=P.C[sym][ki[D[0].d]], b=P.C[sym][ki[D[D.length-1].d]]; const yrs=(Date.parse(D[D.length-1].d)-Date.parse(D[0].d))/(365.25*864e5); let pk=0,m=0; for(let i=ki[D[0].d];i<=ki[D[D.length-1].d];i++){ const v=P.C[sym][i]; if(v>pk) pk=v; else m=Math.max(m,1-v/pk); } return `${sym} 거치 연 ${((Math.pow(b/a,1/yrs)-1)*100).toFixed(1)} · MDD ${(m*100).toFixed(0)}`; };
console.log('참고(세전·비용 없음): '+bh(R)+' · '+bh(G));
// ① 낙폭 사건
console.log('\n① 낙폭 사건(고점 대비 15% 넘게 빠진 것) — 고점 → 바닥 · 깊이 · 회복 · 기여(로그 합 ≈ 바닥까지 수익률 분해: TECL · TQQQ · 그 밖) · 평균 비중 · σ20 · Guard 전환');
let pk=D[0].tot, pkI=0, inDD=false, trI=0, trV=Infinity; const EP=[];
for(let i=1;i<D.length;i++){ const v=D[i].tot; if(v>=pk){ if(inDD){ EP.push({pkI,trI,recI:i}); inDD=false; } pk=v; pkI=i; trV=Infinity; } else { const dd=1-v/pk; if(dd>=0.15) inDD=true; if(v<trV){ trV=v; trI=i; } } }
if(inDD) EP.push({pkI,trI,recI:null});
const sum=(a,b,f)=>{ let s=0; for(let i=a+1;i<=b;i++) s+=f(D[i]); return s; }; const mean=(a,b,f)=>sum(a,b,f)/(b-a);
for(const e of EP){ const a=D[e.pkI], t=D[e.trI]; const depth=(1-t.tot/a.tot)*100; const lT=sum(e.pkI,e.trI,x=>Math.log(1+x.cT)), lQ=sum(e.pkI,e.trI,x=>Math.log(1+x.cQ)), lX=sum(e.pkI,e.trI,x=>Math.log(1+x.cX));
  // 로그 수익 기여: Σlog(1+ret) 를 슬리브 기여 비율로 나눔
  const tot=sum(e.pkI,e.trI,x=>Math.log(1+x.ret)); const sh=v=>tot?(v/tot*depth):0;
  const flips=sum(e.pkI,e.trI,(x)=>0); let fl=0; for(let i=e.pkI+1;i<=e.trI;i++) if(D[i].gOn!==D[i-1].gOn) fl++;
  const tR=(P.C[R][ki[t.d]]/P.C[R][ki[a.d]]-1)*100, qR=(P.C[G][ki[t.d]]/P.C[G][ki[a.d]]-1)*100;
  const sig=[a.sig,t.sig].map(x=>x?(x*100).toFixed(0):'-');
  console.log(`  ${a.d} → ${t.d} (${e.trI-e.pkI}일) 깊이 ${depth.toFixed(1)}% · 회복 ${e.recI?D[e.recI].d+' ('+(e.recI-e.pkI)+'일)':'미회복'} | 기여 TECL ${sh(lT).toFixed(1)} · TQQQ ${sh(lQ).toFixed(1)} · 비용·이자 ${sh(lX).toFixed(1)} | 평균 비중 TECL ${(mean(e.pkI,e.trI,x=>x.wT)*100).toFixed(0)}% TQQQ ${(mean(e.pkI,e.trI,x=>x.wQ)*100).toFixed(0)}% | 시작 비중 T ${(a.wT*100).toFixed(0)} Q ${(a.wQ*100).toFixed(0)} | σ20 ${sig[0]}→${sig[1]} | TECL ${tR.toFixed(0)}% TQQQ ${qR.toFixed(0)}% | Guard 전환 ${fl}`); }
// ② Guard 전환 사건
console.log('\n② Guard 전환 — OFF(이탈) 날 TQQQ 종가 → 다시 ON 날 종가 · 그 사이 TQQQ 변화(+면 가짜 이탈 = 놓친 상승 · −면 피한 하락) · OFF 기간 TECL 변화');
let offs=[]; for(let i=1;i<D.length;i++){ if(D[i-1].gOn&&!D[i].gOn) offs.push({off:i}); else if(!D[i-1].gOn&&D[i].gOn&&offs.length&&offs[offs.length-1].on==null) offs[offs.length-1].on=i; }
let missed=0, avoided=0, nF=0, nT=0;
for(const e of offs){ const a=D[e.off], b=e.on!=null?D[e.on]:D[D.length-1]; const ch=(b.px[G]/a.px[G]-1)*100, chT=(b.px[R]/a.px[R]-1)*100; const days=(e.on!=null?e.on:D.length-1)-e.off;
  if(ch>0){ missed+=ch; nF++; } else { avoided+=ch; nT++; }
  console.log(`  ${a.d} OFF ${a.px[G].toFixed(2)} → ${e.on!=null?b.d+' ON':'(진행 중)'} ${b.px[G].toFixed(2)} · ${days}일 · TQQQ ${ch>=0?'+':''}${ch.toFixed(1)}% · TECL ${chT>=0?'+':''}${chT.toFixed(1)}% · OFF 날 평가액 고점 대비 ${((1-a.tot/Math.max(...D.slice(0,e.off+1).map(x=>x.tot)))*100).toFixed(0)}%`); }
console.log(`  합계: 가짜 이탈 ${nF}번(놓친 TQQQ 상승 합 +${missed.toFixed(0)}%p) · 피한 하락 ${nT}번(${avoided.toFixed(0)}%p) — 30% 비중이라 포트폴리오엔 ×0.3`);
// ③ TECL 비중 분포 · 늦음
const hist={}; for(const x of D){ const b=Math.min(70,Math.floor(x.wT*100/10)*10); hist[b]=(hist[b]||0)+1; }
console.log('\n③ TECL 비중 분포(날 수): '+Object.keys(hist).sort((a,b)=>a-b).map(k=>`${k}~${+k+10}% ${hist[k]}`).join(' · '));
// 늦음: TECL 이 하루 −8% 넘게 빠진 날들의 손실 기여와 그날 비중 — 비중이 크면 크게 잃는다
const big=D.filter(x=>x.rT<=-0.08); const lossBig=big.reduce((a,x)=>a+x.cT,0);
console.log(`  TECL 하루 −8% 넘게 빠진 날 ${big.length}일 · 포트 손실 기여 합 ${(lossBig*100).toFixed(0)}%p · 그날 평균 TECL 비중 ${(big.reduce((a,x)=>a+x.wT,0)/big.length*100).toFixed(0)}% · 그 전날 σ20 중앙 ${(big.map(x=>x.sig||0).sort((a,b)=>a-b)[Math.floor(big.length/2)]*100).toFixed(0)}%`);
const up=D.filter(x=>x.rT>=0.08); console.log(`  TECL 하루 +8% 넘게 오른 날 ${up.length}일 · 기여 합 +${(up.reduce((a,x)=>a+x.cT,0)*100).toFixed(0)}%p · 평균 비중 ${(up.reduce((a,x)=>a+x.wT,0)/up.length*100).toFixed(0)}%`);
// 비중이 높은(≥50%) 날 vs 낮은 날의 TECL 일수익 평균 — 변동성 조절이 '좋은 날'을 더 잡나
for(const [lab,f] of [['TECL 비중 ≥55%',x=>x.wT>=.55],['35~55%',x=>x.wT>=.35&&x.wT<.55],['<35%',x=>x.wT<.35]]){ const s=D.filter(f); if(!s.length) continue; const m=s.reduce((a,x)=>a+x.rT,0)/s.length, sd=Math.sqrt(s.reduce((a,x)=>a+(x.rT-m)**2,0)/s.length); console.log(`  ${lab}: ${s.length}일 · TECL 일수익 평균 ${(m*100).toFixed(3)}% · σ ${(sd*100).toFixed(2)}% · 연율 ${(m*252*100).toFixed(1)}% / ${(sd*Math.sqrt(252)*100).toFixed(0)}% · 평균/σ² ${(m/(sd*sd)).toFixed(1)}`); }
// Guard ON vs OFF 날의 TQQQ 일수익
for(const [lab,f] of [['Guard ON',x=>x.gOn],['Guard OFF',x=>!x.gOn]]){ const s=D.slice(1).filter(f); const m=s.reduce((a,x)=>a+x.rQ,0)/s.length, sd=Math.sqrt(s.reduce((a,x)=>a+(x.rQ-m)**2,0)/s.length); console.log(`  ${lab}: ${s.length}일 · TQQQ 일수익 평균 ${(m*100).toFixed(3)}% · σ ${(sd*100).toFixed(2)}% · 연율 ${(m*252*100).toFixed(1)}% / ${(sd*Math.sqrt(252)*100).toFixed(0)}%`); }
// ④ 연도별
const yr={}; for(const x of D){ const Y=x.d.slice(0,4); (yr[Y]=yr[Y]||{a:x.tot,cT:0,cQ:0,cX:0,n:0,wT:0,wQ:0}); yr[Y].b=x.tot; yr[Y].cT+=Math.log(1+x.cT); yr[Y].cQ+=Math.log(1+x.cQ); yr[Y].cX+=Math.log(1+x.cX); yr[Y].n++; yr[Y].wT+=x.wT; yr[Y].wQ+=x.wQ; }
console.log('\n④ 연도별 수익(%) · 기여 분해(로그 %p · TECL / TQQQ / 비용·이자·세금) · 평균 비중 T/Q · TECL·TQQQ 그 해 거치');
let prev=null; for(const Y of Object.keys(yr).sort()){ const y=yr[Y]; const a=prev??y.a; const ret=(y.b/a-1)*100; const i0=ki[D.find(x=>x.d.startsWith(Y)).d], i1=ki[[...D].reverse().find(x=>x.d.startsWith(Y)).d]; const pT=(P.C[R][i1]/P.C[R][Math.max(0,i0-1)]-1)*100, pQ=(P.C[G][i1]/P.C[G][Math.max(0,i0-1)]-1)*100;
  console.log(`  ${Y} ${ret>=0?'+':''}${ret.toFixed(1).padStart(6)} | ${(y.cT*100).toFixed(1).padStart(6)} / ${(y.cQ*100).toFixed(1).padStart(6)} / ${(y.cX*100).toFixed(1).padStart(5)} | ${(y.wT/y.n*100).toFixed(0)}/${(y.wQ/y.n*100).toFixed(0)} | TECL ${pT>=0?'+':''}${pT.toFixed(0)} TQQQ ${pQ>=0?'+':''}${pQ.toFixed(0)}`); prev=y.b; }
// 저장(그림·후속용)
require('fs').writeFileSync(process.env.OUT||'/dev/null',JSON.stringify(D.map(x=>({d:x.d,tot:+x.tot.toFixed(2),wT:+x.wT.toFixed(4),wQ:+x.wQ.toFixed(4),sig:x.sig,g:x.gOn,rT:x.rT,rQ:x.rQ}))));
