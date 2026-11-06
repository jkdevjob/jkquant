// 새 플랜(앱 v1.44.0 '새 규칙' = Guard −3% + TECL 비대칭 0.7%p/10.5%p + TQQQ 연 1회) 심층 분석(11-06)
// B 5년 창 분포(분위 · 시작 해별 · 위기 포함/제외 · 최악 창) · C Guard 전환 해부(가짜 이탈 · 늦은 이탈 비용) · E 위기별 요소 기여(G·T·Y 2³) · F 해마다 표
// G 블록 부트스트랩(연 로그수익 차이 신뢰구간 · 차이의 집중도) · H 비용·세금 민감도 · J 오늘 신호.  요소 분해(A)는 planx.js / planoos.js 로(VARS 2³).
// 사용: node deep1.js [B,C,E,F,G,H,J]  — 앱 조건(수수료 0.1% · 정수 주(합성은 소수 주) · 양도세 22% 연 정산 · 전일 신호 → 당일 종가 체결)
const {prep,sim,stats,q,ind}=require('./px'); const {mk}=require('./plan_rules');
const f=x=>x.toFixed(1), f2=x=>x.toFixed(2), sg=x=>(x>0?'+':'')+f(x), mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const CUR={gsb:1e9,fee:0.001}, COMP={G:{gbOn:0.01,gbOff:0.03}, T:{sbDn:0.01,sbUp:0.15}, Y:{gReb:'y'}};
const combo=ks=>Object.assign({},CUR,...ks.split('').map(k=>COMP[k])); const NEW=combo('GTY');
const SEC=process.argv[2]?process.argv[2].split(','):['B','C','E','F','G','H','J'];
const real=prep(['TECL','TQQQ']), syn=prep(['SYNTECL','SYNTQQQ']);
const mkO=(P,R,G,p,cap,o2)=>Object.assign({cap,fee:p.fee},mk(P,R,G,p),P===syn?{frac:true}:{},o2||{});
const run=(P,R,G,p,cap,o2)=>sim(P,mkO(P,R,G,p,cap,o2));
const wins=(P,R,G,p,cap,y0)=>{ const o=mkO(P,R,G,p,cap), out=[], last=P.dates[P.dates.length-1]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; out.push(Object.assign({s},stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,cap))); } return out; };
const E=0.05, isBoth=(c,m)=>c>=-E&&m<=E&&(c>E||m<-E), isWorse=(c,m)=>c<=E&&m>=-E&&(c<-E||m>E);
const pairs=(w,b)=>{ const dc=w.map((x,i)=>x.cagr-b[i].cagr), dm=w.map((x,i)=>x.mdd-b[i].mdd); return {dc,dm,both:dc.filter((x,i)=>isBoth(x,dm[i])).length, worse:dc.filter((x,i)=>isWorse(x,dm[i])).length}; };
const SETS=[['실제',real,'TECL','TQQQ','2011-01-01',2011],['합성',syn,'SYNTECL','SYNTQQQ','2000-01-01',2000]];

if(SEC.includes('B')) for(const [lab,P,R,G,,y0] of SETS) for(const cap of [1e4,1e5]){
  const wb=wins(P,R,G,CUR,cap,y0), wn=wins(P,R,G,NEW,cap,y0), {dc,dm,both,worse}=pairs(wn,wb);
  console.log(`\n■ B. 5년 창 분포 — 새 − 지금 · ${lab} ${cap/1e4}만$ · 창 ${wb.length} · 둘 다 나음 ${both} · 둘 다 나쁨 ${worse}`);
  const qs=a=>[.1,.25,.5,.75,.9].map(p=>sg(q(a,p))).join(' / ');
  console.log(`  ΔCAGR 10/25/50/75/90% ${qs(dc)} · 평균 ${sg(mean(dc))} · CAGR 낮은 창 ${dc.filter(x=>x<-E).length}`);
  console.log(`  ΔMDD  10/25/50/75/90% ${qs(dm)} · 평균 ${sg(mean(dm))} · MDD 높은 창 ${dm.filter(x=>x>E).length}`);
  const by={}; wb.forEach((x,i)=>{ const Y=x.s.slice(0,4); const b=(by[Y]=by[Y]||{n:0,c:[],m:[],w:0,b:0}); b.n++; b.c.push(dc[i]); b.m.push(dm[i]); if(dc[i]<-E) b.w++; if(isBoth(dc[i],dm[i])) b.b++; });
  console.log('  시작 해 → 창 수 · ΔCAGR 평균 · ΔMDD 평균 · 둘 다 나음 · CAGR 낮은 창: '+Object.keys(by).sort().map(Y=>{ const b=by[Y]; return `${Y} ${b.n}·${sg(mean(b.c))}·${sg(mean(b.m))}·${b.b}·${b.w}`; }).join(' | '));
  const splits=lab==='실제'?[['2022 안 포함(끝 ≤ 2021-12 · 시작 ≤ 2016-12)',x=>x.s<='2016-12-01'],['2022 포함',x=>x.s>'2016-12-01'],['2020-03 포함',x=>x.s>'2015-03-01'&&x.s<='2020-03-01'],['2020-03·2022 둘 다 안 포함(시작 ≤ 2015-03)',x=>x.s<='2015-03-01'],['2024-25 포함(시작 ≥ 2020-05)',x=>x.s>='2020-05-01']]
    :[['닷컴 포함(시작 ≤ 2002-10)',x=>x.s<='2002-10-01'],['금융위기 포함(2003-04~2009-03 시작)',x=>x.s>'2002-10-01'&&x.s<='2009-03-01'],['둘 다 안 포함(2009-04~ 시작)',x=>x.s>'2009-03-01']];
  for(const [n,fn] of splits){ const I=wb.map((x,i)=>fn(x)?i:-1).filter(i=>i>=0); if(!I.length) continue; const c=I.map(i=>dc[i]), m=I.map(i=>dm[i]);
    console.log(`  ${n}: 창 ${I.length} · ΔCAGR 중앙 ${sg(q(c,.5))}(하10 ${sg(q(c,.1))}) · ΔMDD 중앙 ${sg(q(m,.5))}(상90 ${sg(q(m,.9))}) · 둘 다 나음 ${I.filter(i=>isBoth(dc[i],dm[i])).length} · 둘 다 나쁨 ${I.filter(i=>isWorse(dc[i],dm[i])).length}`); }
  console.log('  CAGR 가장 나쁜 5창: '+dc.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]).slice(0,5).map(([x,i])=>`${wb[i].s.slice(0,7)} ${sg(x)}(${f(wb[i].cagr)}→${f(wn[i].cagr)} · MDD ${f(wb[i].mdd)}→${f(wn[i].mdd)})`).join(' · '));
  console.log('  MDD 가장 나쁜 3창: '+dm.map((x,i)=>[x,i]).sort((a,b)=>b[0]-a[0]).slice(0,3).map(([x,i])=>`${wb[i].s.slice(0,7)} ${sg(x)}(${f(wb[i].mdd)}→${f(wn[i].mdd)} · CAGR ${f(wb[i].cagr)}→${f(wn[i].cagr)})`).join(' · ')); }

function flips(P,R,G,p,cap,from){ const o=mkO(P,R,G,p,cap,{from,endTax:false}); const t0=o.target, ev=[]; let g=null;
  o.target=(k,cur,st)=>{ const t=t0(k,cur,st); if(g===null) g=st.g; else if(st.g!==g){ g=st.g; ev.push({k:k+1,d:P.dates[k+1],px:P.C[G][k+1],on:st.g}); } return t; };   // 신호 k(전일) → 체결 k+1 종가
  const r=sim(P,o); return {ev,eq:r.eq,g0:null}; }
if(SEC.includes('C')) for(const [lab,P,R,G,from] of SETS){ const last=P.dates.length-1;
  const A=flips(P,R,G,CUR,1e4,from).ev, B=flips(P,R,G,NEW,1e4,from).ev;
  const eps=ev=>{ const out=[]; for(let i=0;i<ev.length;i++) if(!ev[i].on){ const on=ev[i+1], k0=ev[i].k, k1=on?on.k:last; let mn=Infinity; for(let k=k0;k<=k1;k++) mn=Math.min(mn,P.C[G][k]); out.push({off:ev[i],on,ret:(on?on.px:P.C[G][last])/ev[i].px-1,days:k1-k0,low:mn/ev[i].px-1,open:!on}); } return out; };
  const EA=eps(A), EB=eps(B);
  const sum=(X,n)=>{ const ws=X.filter(e=>e.ret>0), av=X.filter(e=>e.ret<=0); return `${n} OFF ${X.length}번(진행 중 ${X.filter(e=>e.open).length}) · 가짜 이탈(되살 때 더 비쌈) ${ws.length}번 — 놓친 상승 합 ${sg(ws.reduce((a,e)=>a+e.ret*100,0))}%p(중앙 ${ws.length?sg(q(ws.map(e=>e.ret*100),.5)):'-'}) · 피한 하락 ${av.length}번 합 ${sg(av.reduce((a,e)=>a+e.ret*100,0))}%p(중앙 ${av.length?sg(q(av.map(e=>e.ret*100),.5)):'-'}) · OFF 거래일 중앙 ${X.length?q(X.map(e=>e.days),.5):'-'}`; };
  console.log(`\n■ C. Guard 전환 해부 · ${lab} ${from.slice(0,4)}~ (TQQQ 이탈가→재진입가 · 비중 30% 가 겪는 수익)`); console.log('  '+sum(EA,'지금(−1%)')); console.log('  '+sum(EB,'새(−3%)'));
  const late=[], skipped=[]; for(const e of EA){ const k0=e.off.k, k1=e.on?e.on.k:Infinity; const m=EB.find(x=>x.off.k>=k0&&x.off.k<=k1); if(m) late.push({e,m,cost:m.off.px/e.off.px-1}); else skipped.push(e); }
  const extraB=EB.filter(x=>!late.some(l=>l.m===x));
  console.log(`  지금의 OFF ${EA.length}번 중 새 규칙도 나간 것 ${late.length}번 — 이탈 지연 중앙 ${late.length?q(late.map(x=>x.m.off.k-x.e.off.k),.5):'-'}거래일 · 늦게 나가 더 겪은 TQQQ 변화 중앙 ${late.length?sg(q(late.map(x=>x.cost*100),.5)):'-'}%p · 합 ${sg(late.reduce((a,x)=>a+x.cost*100,0))}%p(음수 = 비용) | 새 규칙은 안 나간 것 ${skipped.length}번 — 그동안 TQQQ ${sg(skipped.reduce((a,e)=>a+e.ret*100,0))}%p(양수 = 새 규칙이 지킨 몫 · 중앙 ${skipped.length?sg(q(skipped.map(e=>e.ret*100),.5)):'-'}) | 새 규칙만 나간 것 ${extraB.length}번`);
  const show=X=>X.map(e=>`${e.off.d}→${e.on?e.on.d:'진행 중'} ${sg(e.ret*100)}(최저 ${f(e.low*100)})`).join(' · ');
  if(lab==='실제'){ console.log('  지금 OFF 구간: '+show(EA)); console.log('  새 OFF 구간: '+show(EB)); console.log('  새 규칙이 건너뛴 지금의 OFF: '+(show(skipped)||'없음')); } }

function ddw(eq,s,e){ let pk=0,x=0; for(const [d,v] of eq){ if(d>e) break; pk=Math.max(pk,v); if(d>=s) x=Math.max(x,(pk-v)/pk); } return x*100; }
if(SEC.includes('E')) for(const [lab,P,R,G,from,W] of [['실제',real,'TECL','TQQQ','2011-01-01',[['2015','2015-06-01','2016-02-29'],['2018','2018-09-01','2018-12-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31'],['2024-25','2024-07-10','2025-04-30'],['2026-10~','2026-10-01','2026-12-31']]],['합성',syn,'SYNTECL','SYNTQQQ','2000-01-01',[['닷컴','2000-03-10','2002-10-31'],['금융위기','2007-10-09','2009-03-31'],['2011','2011-07-01','2011-10-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31']]]]){
  console.log(`\n■ E. 위기별 최고점 대비 낙폭(%) — 요소 2³ · ${lab} 1만$ (G=Guard −3% · T=TECL 비대칭 · Y=TQQQ 연 1회 · 끝날 세금 안 뺀 곡선)`);
  console.log('  구성 | 전체 CAGR/MDD | '+W.map(w=>w[0]).join(' | ')+' | TECL 매매/년');
  for(const ks of ['','G','T','Y','GT','GY','TY','GTY']){ const p=combo(ks), cnt={}; const ne=run(P,R,G,p,1e4,{from,endTax:false,cnt}).eq, s=stats(run(P,R,G,p,1e4,{from}).eq,1e4), yrs=(Date.parse(ne[ne.length-1][0])-Date.parse(ne[0][0]))/(365.25*864e5);
    console.log(`  ${(ks||'지금').padEnd(4)} | ${f(s.cagr)}/${f(s.mdd)} | ${W.map(([n,a,b])=>ddw(ne,a,b).toFixed(1)).join(' | ')} | ${f((cnt[R]||[]).length/yrs)}`); } }

if(SEC.includes('F')){ const P=real,R='TECL',G='TQQQ';
  const yrOf=eq=>{ const m={}; eq.forEach(([d,v])=>{ const Y=d.slice(0,4); (m[Y]=m[Y]||{a:v}).b=v; }); const o={}; let prev=null; for(const Y of Object.keys(m).sort()){ o[Y]=(m[Y].b/(prev??m[Y].a)-1)*100; prev=m[Y].b; } return o; };
  const pxY=S=>{ const m={}; P.dates.forEach((d,i)=>{ if(d<'2011-01-01') return; const Y=d.slice(0,4); (m[Y]=m[Y]||{a:P.C[S][i-1]}).b=P.C[S][i]; }); const o={}; let prev=null; for(const Y of Object.keys(m).sort()){ o[Y]=(m[Y].b/(prev??m[Y].a)-1)*100; prev=m[Y].b; } return o; };
  const pq=pxY(G), pt=pxY(R);
  for(const cap of [1e4,1e5]){ const ya=yrOf(run(P,R,G,CUR,cap,{from:'2011-01-01'}).eq), yb=yrOf(run(P,R,G,NEW,cap,{from:'2011-01-01'}).eq);
    console.log(`\n■ F. 해마다 수익(%) · 실제 ${cap/1e4}만$ — 해: 지금 | 새 | 차이 | TQQQ | TECL`);
    const up=[],dn=[]; console.log('  '+Object.keys(ya).map(Y=>{ const d=yb[Y]-ya[Y]; (pq[Y]>=0?up:dn).push(d); return `${Y}: ${f(ya[Y])} | ${f(yb[Y])} | ${sg(d)} | ${f(pq[Y])} | ${f(pt[Y])}`; }).join('\n  '));
    console.log(`  TQQQ 오른 해 ${up.length}개 차이 평균 ${sg(mean(up))} · 내린 해 ${dn.length}개 ${sg(mean(dn))} · 차이 양수 해 ${[...up,...dn].filter(x=>x>0).length}/${up.length+dn.length}`); } }

if(SEC.includes('G')) for(const [lab,P,R,G,from] of SETS) for(const cap of [1e4,1e5]){
  const a=run(P,R,G,CUR,cap,{from}).eq, b=run(P,R,G,NEW,cap,{from}).eq, d=[]; for(let i=1;i<a.length;i++) d.push(Math.log(b[i][1]/b[i-1][1])-Math.log(a[i][1]/a[i-1][1]));
  const n=d.length, L=21, nb=Math.ceil(n/L); let seed=20261106; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const ms=[]; for(let r=0;r<2000;r++){ let s=0,c=0; for(let j=0;j<nb&&c<n;j++){ const st=Math.floor(rnd()*n); for(let t=0;t<L&&c<n;t++,c++) s+=d[(st+t)%n]; } ms.push(s/n*252*100); }
  const tot=d.reduce((x,y)=>x+y,0), srt=[...d].sort((x,y)=>y-x), top=k=>srt.slice(0,k).reduce((x,y)=>x+y,0), nz=d.filter(x=>Math.abs(x)>1e-12).length;
  console.log(`\n■ G. 블록 부트스트랩(21거래일 블록 · 2000회) 연 로그수익 차이(새 − 지금 · %p) · ${lab} ${cap/1e4}만$: 실측 ${sg(tot/n*252*100)} · 5/50/95% ${sg(q(ms,.05))} / ${sg(q(ms,.5))} / ${sg(q(ms,.95))} · 차이 > 0 비율 ${(ms.filter(x=>x>0).length/ms.length*100).toFixed(0)}%`);
  console.log(`  집중도: 두 곡선이 다른 날 ${nz}/${n} · 상위 5일 합 ${sg(top(5)*100)}%p · 상위 1%(${Math.ceil(n*0.01)}일) ${sg(top(Math.ceil(n*0.01))*100)}%p · 전체 합 ${sg(tot*100)}%p · 하루 최대 ${sg(srt[0]*100)} 최소 ${sg(srt[n-1]*100)} · 양(+)인 날 ${d.filter(x=>x>1e-12).length} 음(−)인 날 ${d.filter(x=>x<-1e-12).length}`);
  const yrs={}; for(let i=1;i<a.length;i++){ const Y=a[i][0].slice(0,4); yrs[Y]=(yrs[Y]||0)+d[i-1]; } console.log('  해마다 로그 차이 합(%p): '+Object.keys(yrs).sort().map(Y=>`${Y} ${sg(yrs[Y]*100)}`).join(' · ')); }

if(SEC.includes('H')){ const P=real,R='TECL',G='TQQQ'; console.log('\n■ H. 비용·세금 민감도 · 실제 2011~ 전체 CAGR/MDD — 지금 → 새 (ΔCAGR · ΔMDD)');
  for(const tax of [true,false]) for(const fee of [0.001,0.0025,0.005]){ const row=[]; for(const cap of [1e4,1e5,1e6]){ const a=stats(run(P,R,G,Object.assign({},CUR,{fee}),cap,{from:'2011-01-01',tax}).eq,cap), b=stats(run(P,R,G,Object.assign({},NEW,{fee}),cap,{from:'2011-01-01',tax}).eq,cap); row.push(`${cap/1e4}만$ ${f(a.cagr)}/${f(a.mdd)} → ${f(b.cagr)}/${f(b.mdd)} (${sg(b.cagr-a.cagr)} · ${sg(b.mdd-a.mdd)})`); }
    console.log(`  세금 ${tax?'22%':'없음'} · 수수료 ${(fee*100).toFixed(2)}%: ${row.join(' | ')}`); }
  for(const fee of [0.0025,0.005]) for(const cap of [1e4,1e5]){ const wb=wins(P,R,G,Object.assign({},CUR,{fee}),cap,2011), wn=wins(P,R,G,Object.assign({},NEW,{fee}),cap,2011), pr=pairs(wn,wb); console.log(`  수수료 ${(fee*100).toFixed(2)}% 롤링 중앙 ${cap/1e4}만$: 지금 ${f(q(wb.map(x=>x.cagr),.5))}/${f(q(wb.map(x=>x.mdd),.5))} → 새 ${f(q(wn.map(x=>x.cagr),.5))}/${f(q(wn.map(x=>x.mdd),.5))} · 짝 ${pr.both}:${pr.worse}/${wb.length}`); } }

if(SEC.includes('J')){ const P=real,R='TECL',G='TQQQ', k=P.dates.length-1, sma=ind.ma(P.C[G],225)[k], c=P.C[G][k], s20=ind.vol(P.C[R],20)[k], w=Math.min(1,0.55*0.55/(s20*s20));
  const state=p=>{ const o=mkO(P,R,G,p,1e4,{from:'2011-01-01'}); const t0=o.target; let g=null,cur=null; o.target=(kk,cu,st)=>{ const t=t0(kk,cu,st); g=st.g; cur=Object.assign({},cu); return t; }; const r=sim(P,o); return {g,cur,fin:r.eq[r.eq.length-1][1]}; };
  const a=state(CUR), b=state(NEW);
  console.log(`\n■ J. 오늘 신호(${P.dates[k]} 종가): TQQQ ${f2(c)} / SMA225 ${f2(sma)} (${sg((c/sma-1)*100)}%) · 켜지는 선 ${f2(sma*1.01)} · 지금 꺼지는 선 ${f2(sma*0.99)} · 새 꺼지는 선 ${f2(sma*0.97)} · TECL ${f2(P.C[R][k])} σ20 ${f(s20*100)}% → 슬리브 ${f(w*100)}% · 전체 ${f(w*70)}%`);
  console.log(`  2011~ 1만$ 모의 상태(전일 비중) — 지금: Guard ${a.g?'ON':'OFF'} · TECL ${f((a.cur.TECL||0)*100)}% · TQQQ ${f((a.cur.TQQQ||0)*100)}% · 평가 ${Math.round(a.fin)}$ | 새: Guard ${b.g?'ON':'OFF'} · TECL ${f((b.cur.TECL||0)*100)}% · TQQQ ${f((b.cur.TQQQ||0)*100)}% · 평가 ${Math.round(b.fin)}$`); }
