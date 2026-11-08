// 2~3 전략 조합 탐색(11-08) 1단계 평가 — trio_legs 곡선으로 단독 · 2개(1/6 격자 5칸) · 3개(6 을 셋으로 나눈 10칸) 전부를 5년 창마다 잰다.
// 기준 = 지금(무매 SOXL 1/3 + 5년 플랜 2/3). 짝 비교 = 같은 창에서 연수익 차이(중앙 · 하위 10%) · 이긴 창 · 둘 다(수익↑·MDD↓) 이긴 창.
// 과적합 검사: ① 실제 앞(2011~13 시작 · 자료 ~2018-10) 으로 고른 상위가 뒤(2018-10~ 시작 · 자료 2018-10~) 에서도 이기나 — 자료 기간이 안 겹친다
//               ② 실제(2011~)로 고른 상위가 합성 2000~05 시작(자료 2000~2010 · 실제와 안 겹침)에서도 이기나
// 사용: node trio_eval.js trio_legs trio_eval.json
const fs=require('fs');
const PFX=process.argv[2]||'trio_legs', OUT=process.argv[3]||'trio_eval.json';
const I=JSON.parse(fs.readFileSync(PFX+'.json','utf8')), BIN=fs.readFileSync(PFX+'.bin'); const N=I.names;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const SETS=['real','syn'].filter(s=>I[s]); const CAPS=[10000,100000].filter(c=>I.blocks.some(b=>b.cap===c));
const U=[...I[SETS[SETS.length-1]].legs]; for(const k of I.real.legs) if(!U.includes(k)) U.push(k); const L=U.length;
// ── 조합 목록(무리 단위: 같은 다리 묶음은 한 번에 훑는다) ──
const COMBOS=[], GROUPS=[]; const W2=[1,2,3,4,5].map(a=>[a,6-a]), W3=[]; for(let a=1;a<=4;a++) for(let b=1;a+b<=5;b++) W3.push([a,b,6-a-b]);
const addG=(k,ws)=>{ const g={k,ws,ci:[]}; for(const w of ws){ g.ci.push(COMBOS.length); COMBOS.push({k,w}); } GROUPS.push(g); };
for(let i=0;i<L;i++) addG([i],[[6]]);
for(let i=0;i<L;i++) for(let j=i+1;j<L;j++) addG([i,j],W2);
for(let i=0;i<L;i++) for(let j=i+1;j<L;j++) for(let k=j+1;k<L;k++) addG([i,j,k],W3);
const NC=COMBOS.length; const FR={1:'1/6',2:'1/3',3:'1/2',4:'2/3',5:'5/6',6:'100%'};
const idOf=c=>c.k.map((x,t)=>U[x]+':'+c.w[t]).join('+'), nameOf=c=>c.k.map((x,t)=>N[U[x]]+' '+FR[c.w[t]]).join(' + ');
const CUR=COMBOS.findIndex(c=>idOf(c)==='IM:2+P5:4'); if(CUR<0) throw new Error('기준 조합 없음');
console.error(`다리 ${L} · 조합 ${NC} (단독 ${L} · 2개 ${L*(L-1)/2*5} · 3개 ${L*(L-1)*(L-2)/6*10}) · 기준 ${nameOf(COMBOS[CUR])}`);
// ── 창마다 전 조합 (c 연수익% · d MDD% · m 배수) ──
function evalBlock(b,legs,outC,outD,outM,stride,wi){ const n=b.n, nl=legs.length; const arr=new Float64Array(BIN.buffer.slice(BIN.byteOffset+b.off,BIN.byteOffset+b.off+n*nl*8));
  const col=U.map(k=>legs.indexOf(k)); const yrs=(Date.parse(b.dates[n-1])-Date.parse(b.dates[0]))/(365.25*864e5);
  for(const g of GROUPS){ const cols=g.k.map(x=>col[x]); if(cols.some(c=>c<0)){ for(const ci of g.ci){ outC[ci*stride+wi]=NaN; outD[ci*stride+wi]=NaN; outM[ci*stride+wi]=NaN; } continue; }
    const nw=g.ws.length, m=cols.length, o=cols.map(c=>c*n); const wa=g.ws.map(w=>w[0]), wb=g.ws.map(w=>w[1]||0), wc=g.ws.map(w=>w[2]||0);
    const pk=new Float64Array(nw), md=new Float64Array(nw), v0=new Float64Array(nw);
    const A=o[0], Bo=m>1?o[1]:o[0], Co=m>2?o[2]:o[0];
    for(let w=0;w<nw;w++){ const v=wa[w]*arr[A]+(m>1?wb[w]*arr[Bo]:0)+(m>2?wc[w]*arr[Co]:0); v0[w]=v; pk[w]=v; }
    if(m===1){ for(let t=1;t<n;t++){ const v=arr[A+t]*wa[0]; if(v>pk[0]) pk[0]=v; else { const dd=1-v/pk[0]; if(dd>md[0]) md[0]=dd; } } }
    else if(m===2){ for(let t=1;t<n;t++){ const x=arr[A+t], y=arr[Bo+t]; for(let w=0;w<nw;w++){ const v=wa[w]*x+wb[w]*y; if(v>pk[w]) pk[w]=v; else { const dd=1-v/pk[w]; if(dd>md[w]) md[w]=dd; } } } }
    else { for(let t=1;t<n;t++){ const x=arr[A+t], y=arr[Bo+t], z=arr[Co+t]; for(let w=0;w<nw;w++){ const v=wa[w]*x+wb[w]*y+wc[w]*z; if(v>pk[w]) pk[w]=v; else { const dd=1-v/pk[w]; if(dd>md[w]) md[w]=dd; } } } }
    for(let w=0;w<nw;w++){ const vT=wa[w]*arr[A+n-1]+(m>1?wb[w]*arr[Bo+n-1]:0)+(m>2?wc[w]*arr[Co+n-1]:0), mu=vT/v0[w], ci=g.ci[w];
      outC[ci*stride+wi]=(Math.pow(Math.max(mu,1e-9),1/yrs)-1)*100; outD[ci*stride+wi]=md[w]*100; outM[ci*stride+wi]=mu; } } }
const R={}; const t0=Date.now();
for(const set of SETS) for(const cap of CAPS){ const legs=I[set].legs; const wins=I.blocks.filter(b=>b.set===set&&b.cap===cap&&b.kind==='win').sort((a,b)=>a.s<b.s?-1:1), full=I.blocks.find(b=>b.set===set&&b.cap===cap&&b.kind==='full');
  const nW=wins.length; const r={starts:wins.map(b=>b.s), nW, c:new Float32Array(NC*nW), d:new Float32Array(NC*nW), m:new Float32Array(NC*nW), fc:new Float32Array(NC), fd:new Float32Array(NC), fm:new Float32Array(NC)};
  wins.forEach((b,wi)=>evalBlock(b,legs,r.c,r.d,r.m,nW,wi)); evalBlock(full,legs,r.fc,r.fd,r.fm,1,0); R[set+cap]=r; console.error(`[${set} ${cap/1e4}만$] 창 ${nW} · 누적 ${((Date.now()-t0)/1e3).toFixed(0)}초`); }
// ── 요약 ── S: 창 번호 목록
function summ(r,ci,S){ const c=S.map(i=>r.c[ci*r.nW+i]), d=S.map(i=>r.d[ci*r.nW+i]), m=S.map(i=>r.m[ci*r.nW+i]); if(!c.every(Number.isFinite)) return null;
  const cc=S.map(i=>r.c[CUR*r.nW+i]), cd=S.map(i=>r.d[CUR*r.nW+i]); const dc=c.map((x,i)=>x-cc[i]), dd=d.map((x,i)=>x-cd[i]); const n=S.length;
  return {cMed:med(c),c10:q(c,.1),cMin:Math.min(...c),mMed:med(d),m90:q(d,.9),mMax:Math.max(...d),half:m.filter(x=>x<0.5).length/n*100,loss:c.filter(x=>x<0).length/n*100,
    dMed:med(dc),d10:q(dc,.1),dMin:Math.min(...dc),beat:dc.filter(x=>x>0).length/n*100,both:c.filter((x,i)=>x>cc[i]&&d[i]<cd[i]).length/n*100,ddMed:med(dd)}; }
const SUB={ real:{ALL:s=>true, A:s=>s<='2013-10-01', B:s=>s>='2018-10-01'}, syn:{ALL:s=>true, EARLY:s=>s<='2005-10-01', MID:s=>s>='2006-01-01'&&s<='2010-10-01', LATE:s=>s>='2011-01-01'} };
const S={}; for(const set of SETS) for(const cap of CAPS){ const r=R[set+cap]; for(const [nm,f] of Object.entries(SUB[set])){ const idx=r.starts.map((s,i)=>f(s)?i:-1).filter(i=>i>=0); S[set+cap+nm]=COMBOS.map((_,ci)=>summ(r,ci,idx)); S[set+cap+nm].n=idx.length; } }
const cur=k=>S[k][CUR];
// 우위: 짝 중앙 연수익 차 > 0 · 중앙 MDD ≤ 지금 · 최악 MDD ≤ 지금+1 · 최악 연수익 ≥ 지금−0.5 · 반토막 창 ≤ 지금
const dom=(k,ci,tol)=>{ const x=S[k][ci], u=cur(k); tol=tol||{}; return !!x&&x.dMed>0&&x.mMed<=u.mMed+(tol.m??0)&&x.mMax<=u.mMax+(tol.mx??1)&&x.cMin>=u.cMin-(tol.c??0.5)&&x.half<=u.half+1e-9; };
const both=(nm,ci,tol)=>CAPS.every(cap=>dom(nm.replace('#',cap),ci,tol));
const passR=COMBOS.map((_,ci)=>both('real#ALL',ci)), passS=COMBOS.map((_,ci)=>I.syn&&both('syn#ALL',ci)), robust=COMBOS.map((_,ci)=>passR[ci]&&passS[ci]);
const avgD=(nm,ci)=>{ const v=CAPS.map(cap=>S[nm.replace('#',cap)][ci]); return v.every(Boolean)?v.reduce((a,x)=>a+x.dMed,0)/v.length:NaN; };
const scoreR=ci=>avgD('real#ALL',ci), scoreS=ci=>avgD('syn#ALL',ci), scoreMin=ci=>Math.min(scoreR(ci),I.syn?scoreS(ci):Infinity);
// ── 과적합 검사 ──
function spear(a,b){ const ok=a.map((x,i)=>Number.isFinite(x)&&Number.isFinite(b[i])?i:-1).filter(i=>i>=0); const rk=v=>{ const o=ok.map(i=>[v[i],i]).sort((x,y)=>x[0]-y[0]); const r={}; o.forEach(([,i],j)=>r[i]=j); return r; };
  const ra=rk(a), rb=rk(b), n=ok.length; let s=0; for(const i of ok) s+=(ra[i]-rb[i])**2; return 1-6*s/(n*(n*n-1)); }
const oos=(fromNm,toNm,top)=>{ const sc=COMBOS.map((_,ci)=>{ const ok=CAPS.every(cap=>{ const k=fromNm.replace('#',cap); const x=S[k][ci], u=cur(k); return x&&x.mMed<=u.mMed; }); return ok?avgD(fromNm,ci):NaN; });
  const to=COMBOS.map((_,ci)=>avgD(toNm,ci)); const order=COMBOS.map((_,i)=>i).filter(i=>Number.isFinite(sc[i])&&Number.isFinite(to[i])).sort((a,b)=>sc[b]-sc[a]);
  const T=order.slice(0,top); const all=order.map(i=>to[i]);
  return {rho:spear(COMBOS.map((_,i)=>avgD(fromNm,i)),to), nPool:order.length, top:T.map(i=>({id:idOf(COMBOS[i]),name:nameOf(COMBOS[i]),from:+sc[i].toFixed(2),to:+to[i].toFixed(2),toBeat:CAPS.map(cap=>S[toNm.replace('#',cap)][i].beat),toDom:CAPS.every(cap=>dom(toNm.replace('#',cap),i))})),
    topMedTo:med(T.map(i=>to[i])), poolMedTo:med(all), topWin:T.filter(i=>to[i]>0).length/T.length*100, poolWin:all.filter(x=>x>0).length/all.length*100, topDom:T.filter(i=>CAPS.every(cap=>dom(toNm.replace('#',cap),i))).length}; };
const OOS={ timeSplit:oos('real#A','real#B',30), realToSynEarly:I.syn?oos('real#ALL','syn#EARLY',30):null, realToSynMid:I.syn?oos('real#ALL','syn#MID',30):null };
// ── 출력 ──
const row=(ci,k)=>{ const x=S[k][ci]; return x?`${x.cMed.toFixed(1).padStart(5)} ${x.cMin.toFixed(1).padStart(6)} -${x.mMed.toFixed(0).padStart(2)}/-${x.mMax.toFixed(0).padStart(2)} ${(x.dMed>=0?'+':'')+x.dMed.toFixed(1)} ${x.beat.toFixed(0).padStart(3)}% ${x.both.toFixed(0).padStart(3)}% ${x.half.toFixed(0)}%`:'   (자료 없음)'; };
const nk=c=>c.k.length;
const show=(title,list)=>{ console.log('\n'+title); console.log('  '+'조합'.padEnd(52)+' | 실제1만: 중앙 최악 MDD중/최 차 이김 둘다 반토막 | 실제10만 | 합성1만 | 합성10만');
  for(const ci of list) console.log('  '+nameOf(COMBOS[ci]).padEnd(52)+' | '+SETS.flatMap(s=>CAPS.map(c=>row(ci,s+c+'ALL'))).join(' | ')); };
show('기준',[CUR]);
const rob=COMBOS.map((_,i)=>i).filter(i=>robust[i]).sort((a,b)=>scoreMin(b)-scoreMin(a));
console.log(`\n실제 통과 ${passR.filter(Boolean).length} · 합성 통과 ${passS.filter(Boolean).length} · 둘 다(강건) ${rob.length} / ${NC}`);
for(const K of [1,2,3]) show(`강건 상위 — ${K}개 전략 (실제·합성 1만·10만 네 곳 짝 중앙 차의 최소값 순)`,rob.filter(i=>nk(COMBOS[i])===K).slice(0,12));
const singles=COMBOS.map((_,i)=>i).filter(i=>nk(COMBOS[i])===1); show('참고 · 단독 전략',singles.sort((a,b)=>(S['real10000ALL'][b]?.cMed??-99)-(S['real10000ALL'][a]?.cMed??-99)));
console.log('\n과적합 검사');
for(const [nm,o] of Object.entries(OOS)){ if(!o) continue; console.log(`  ${nm}: 순위 상관 ρ ${o.rho.toFixed(2)} · 후보 ${o.nPool} · 상위30 중앙 차 ${o.topMedTo.toFixed(2)} (전체 ${o.poolMedTo.toFixed(2)}) · 상위30 이긴 비율 ${o.topWin.toFixed(0)}% (전체 ${o.poolWin.toFixed(0)}%) · 상위30 중 검증 구간 우위 통과 ${o.topDom}`);
  for(const t of o.top.slice(0,10)) console.log(`     ${t.name.padEnd(52)} 고른 곳 ${t.from>=0?'+':''}${t.from} → 검증 ${t.to>=0?'+':''}${t.to} (이김 ${t.toBeat.map(x=>x.toFixed(0)+'%').join('/')}${t.toDom?' · 우위':''})`); }
// 저장 — 전 조합 요약(실제·합성 ALL) + 부분 구간 + 과적합
const pack=x=>x?[x.cMed,x.c10,x.cMin,x.mMed,x.m90,x.mMax,x.half,x.loss,x.dMed,x.d10,x.dMin,x.beat,x.both,x.ddMed].map(v=>+v.toFixed(2)):null;
const out={meta:{made:new Date().toISOString(),legs:U,names:N,cur:idOf(COMBOS[CUR]),fields:'cMed,c10,cMin,mMed,m90,mMax,half,loss,dMed,d10,dMin,beat,both,ddMed',note:I.note,subs:Object.fromEntries(Object.keys(S).map(k=>[k,S[k].n]))},
  ids:COMBOS.map(idOf), robust:rob.map(i=>idOf(COMBOS[i])), passR:COMBOS.map((_,i)=>i).filter(i=>passR[i]).map(i=>idOf(COMBOS[i])), oos:OOS, sum:{}, full:{}};
for(const k of Object.keys(S)) out.sum[k]=S[k].map(pack);
for(const k of Object.keys(R)) out.full[k]={c:Array.from(R[k].fc,v=>+v.toFixed(2)),d:Array.from(R[k].fd,v=>+v.toFixed(2))};
fs.writeFileSync(OUT,JSON.stringify(out)); console.error('done',OUT,((Date.now()-t0)/1e3).toFixed(0)+'초');
