const {pair,q}=require('./inv_lib');const [INV,LNG,IDX]=(process.argv[2]||'SOXS,SOXL,SOXX').split(',');
const R=pair(INV,LNG,IDX,'2017-08-01');const n=R.length,f=(x,d=1)=>(x*100).toFixed(d);
console.log(`■ ${INV}/${LNG} · 지수 ${IDX} · ${R[0].date}~${R[n-1].date} · ${n}거래일`);
for(const t of [.5,.7,1])console.log(`  비율 ${t===1?'>':'≥'} ${t*100}%: ${R.filter(z=>t===1?z.r>1:z.r>=t).length}일 (${f(R.filter(z=>t===1?z.r>1:z.r>=t).length/n)}%)`);
const hot=R.filter(z=>z.r>=.7);console.log(`  ≥70% 날 전고점 대비 중앙: ${IDX} ${f(q(hot.map(z=>z.ddX),.5))} · ${LNG} ${f(q(hot.map(z=>z.ddL),.5))}`);
// 신호는 그날 종가 뒤에 안다 → 다음 거래일 종가에 산다고 보고(룩어헤드 없음) 그 뒤 H 거래일 수익
const H=[5,10,20,60,120,250];const fw=(i,h,k)=>(i+1+h<n)?R[i+1+h][k]/R[i+1][k]-1:null;
const stat=(idxs,k)=>H.map(h=>{const a=idxs.map(i=>fw(i,h,k)).filter(x=>x!=null);return a.length?`${f(q(a,.5))}(${f(a.filter(x=>x>0).length/a.length,0)}%·${a.length})`:'-';}).join('  ');
const all=R.map((_,i)=>i);
console.log(`\n  다음날 종가 매수 뒤 수익 중앙(오른 비율·표본) — 보유 ${H.join(' / ')}일`);
for(const k of ['X','L']){console.log(`  [${k==='X'?IDX:LNG}]`);
  console.log('   모든 날        ',stat(all,k));
  for(const [nm,fn] of [['비율 ≥50%',z=>z.r>=.5],['비율 ≥70%',z=>z.r>=.7],['비율 >100%',z=>z.r>1],['비율 <30%',z=>z.r<.3]])console.log('   '+nm.padEnd(11),stat(all.filter(i=>fn(R[i])),k));}
// 대조: 지수 낙폭 깊이가 같은 날끼리 — 신호(≥70%) 있는 날 vs 없는 날(<50%)
console.log(`\n  낙폭 깊이를 맞춘 비교(${IDX} 전고점 대비) — ${LNG} 수익 중앙: 신호 ≥70% ↔ 신호 없음 <50%`);
for(const [lo,hi] of [[-.10,0],[-.20,-.10],[-.30,-.20],[-.40,-.30],[-1,-.40]]){const B=all.filter(i=>R[i].ddX>lo&&R[i].ddX<=hi||(hi===0&&R[i].ddX===0&&false));const s=B.filter(i=>R[i].r>=.7),c=B.filter(i=>R[i].r<.5),m=B.filter(i=>R[i].r>=.5&&R[i].r<.7);
  console.log(`   낙폭 ${f(hi,0)}~${f(lo,0)}%  신호 ${String(s.length).padStart(3)}일 ${stat(s,'L')}\n                 중간 ${String(m.length).padStart(3)}일 ${stat(m,'L')}\n                 없음 ${String(c.length).padStart(3)}일 ${stat(c,'L')}`);}
// 사건 묶음: 신호일(≥70%) 사이가 20거래일 넘게 벌어지면 다른 사건
const ep=[];let cur=null;all.filter(i=>R[i].r>=.7).forEach(i=>{if(!cur||i-cur.e>20){cur={s:i,e:i,n:0,mx:0};ep.push(cur);}cur.e=i;cur.n++;cur.mx=Math.max(cur.mx,R[i].r);});
console.log(`\n  사건(≥70% · 20거래일 넘게 끊기면 새 사건) ${ep.length}개:`);
for(const e of ep){let lowI=e.s;for(let i=Math.max(0,e.s-60);i<=Math.min(n-1,e.e+120);i++)if(R[i].X<R[lowI].X)lowI=i;
  console.log(`   ${R[e.s].date}~${R[e.e].date} ${String(e.n).padStart(3)}일 최고 ${f(e.mx,0)}% · 첫 신호일 낙폭 ${IDX} ${f(R[e.s].ddX,0)} ${LNG} ${f(R[e.s].ddL,0)} · 그 뒤 저점 ${R[lowI].date}(첫 신호 ${lowI-e.s>=0?'+':''}${lowI-e.s}일 · 첫 신호 다음날 대비 ${LNG} ${f(R[lowI].L/R[Math.min(n-1,e.s+1)].L-1,0)}%) · 첫 신호 뒤 ${LNG} 60일 ${fw(e.s,60,'L')!=null?f(fw(e.s,60,'L'),0):'-'} · 250일 ${fw(e.s,250,'L')!=null?f(fw(e.s,250,'L'),0):'-'}`);}
// 해마다 신호일 뒤 60일
const yr={};all.filter(i=>R[i].r>=.7).forEach(i=>{const v=fw(i,60,'L');if(v!=null)(yr[R[i].date.slice(0,4)]=yr[R[i].date.slice(0,4)]||[]).push(v);});
console.log('\n  해마다 신호일(≥70%) 뒤 '+LNG+' 60일 중앙:',Object.entries(yr).map(([y,a])=>`${y} ${f(q(a,.5),0)}%(${a.length}일)`).join(' · '));
