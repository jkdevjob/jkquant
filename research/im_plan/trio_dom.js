// 2026-11-10 사용자: "현재 듀얼보다 mdd는 낮고 수익률이 높은 전략은 없으려나?"
// trio_legs(11-08 · 25 다리 · 5년 창 곡선)로 단독·2개·3개 조합 24,525개를 다시 재되, 기준을 바꿔 잰다 — 기본 기준 = 듀얼 100%(P5:6) · 보조 기준 = 지금 구성 C(듀얼 5/6 + 섀넌 USD(현금 짝) 1/6).
// '둘 다 좋음' = 같은 창들에서 (연수익 중앙 ↑) 그리고 (MDD 중앙 ↓) 그리고 (최악 MDD 더 나쁘지 않음). 네 곳(실제·합성 × 1만$·10만$) 모두면 '강건'.
// 엄격 = 둘 다 좋음 + 최악 연수익 ≥ 기준 + 반토막 창 ≤ 기준. 창마다 짝 비교 '둘 다'(그 창에서 수익↑·MDD↓) 비율도 같이 적는다.
// 공식/실험 구분: P5N(새 규칙)·P5X(공격형)은 실험적 확장 → 표에 † 표시, '공식만' 목록은 그 둘을 뺀다.
// 파레토: 실제 1만$ · 합성 1만$ 에서 (연수익 중앙 최대 · MDD 중앙 최소) 비지배 조합 — 기준이 어디쯤인지 본다.
// 사용: node trio_dom.js <legs-prefix> [기준id,기준id…] [out.json]   예) node trio_dom.js ../../../trio_legs P5:6,P5:5+IVS_Uc:1 trio_dom.json
const fs=require('fs');
const PFX=process.argv[2]||'trio_legs', BASES=(process.argv[3]||'P5:6').split(','), OUT=process.argv[4]||'';
const I=JSON.parse(fs.readFileSync(PFX+'.json','utf8')), BIN=fs.readFileSync(PFX+'.bin'); const N=I.names;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const SETS=['real','syn'].filter(s=>I[s]); const CAPS=[10000,100000].filter(c=>I.blocks.some(b=>b.cap===c));
const U=[...I[SETS[SETS.length-1]].legs]; for(const k of I.real.legs) if(!U.includes(k)) U.push(k); const L=U.length;
const COMBOS=[], GROUPS=[]; const W2=[1,2,3,4,5].map(a=>[a,6-a]), W3=[]; for(let a=1;a<=4;a++) for(let b=1;a+b<=5;b++) W3.push([a,b,6-a-b]);
const addG=(k,ws)=>{ const g={k,ws,ci:[]}; for(const w of ws){ g.ci.push(COMBOS.length); COMBOS.push({k,w}); } GROUPS.push(g); };
for(let i=0;i<L;i++) addG([i],[[6]]);
for(let i=0;i<L;i++) for(let j=i+1;j<L;j++) addG([i,j],W2);
for(let i=0;i<L;i++) for(let j=i+1;j<L;j++) for(let k=j+1;k<L;k++) addG([i,j,k],W3);
const NC=COMBOS.length; const FR={1:'1/6',2:'1/3',3:'1/2',4:'2/3',5:'5/6',6:'100%'};
const idOf=c=>c.k.map((x,t)=>U[x]+':'+c.w[t]).join('+'), nameOf=c=>c.k.map((x,t)=>N[U[x]].replace(/^5년 플랜/,'듀얼')+' '+FR[c.w[t]]).join(' + ');
const EXP=new Set(['P5N','P5X']); const isExp=c=>c.k.some(x=>EXP.has(U[x])); const tag=c=>isExp(c)?'†':' ';
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
for(const set of SETS) for(const cap of CAPS){ const legs=I[set].legs; const wins=I.blocks.filter(b=>b.set===set&&b.cap===cap&&b.kind==='win').sort((a,b)=>a.s<b.s?-1:1);
  const nW=wins.length; const r={starts:wins.map(b=>b.s), nW, c:new Float32Array(NC*nW), d:new Float32Array(NC*nW), m:new Float32Array(NC*nW)};
  const full=I.blocks.find(b=>b.set===set&&b.cap===cap&&b.kind==='full'); r.fc=new Float32Array(NC); r.fd=new Float32Array(NC); r.fm=new Float32Array(NC);
  wins.forEach((b,wi)=>evalBlock(b,legs,r.c,r.d,r.m,nW,wi)); evalBlock(full,legs,r.fc,r.fd,r.fm,1,0); r.fullSpan=full.dates[0]+'~'+full.dates[full.n-1]; R[set+cap]=r; console.error(`[${set} ${cap/1e4}만$] 창 ${nW} · 누적 ${((Date.now()-t0)/1e3).toFixed(0)}초`); }
const PLACES=SETS.flatMap(s=>CAPS.map(c=>s+c)); const PN={real10000:'실제1만',real100000:'실제10만',syn10000:'합성1만',syn100000:'합성10만'};
function summ(r,ci,CUR){ const n=r.nW, c=[],d=[],m=[]; for(let i=0;i<n;i++){ c.push(r.c[ci*n+i]); d.push(r.d[ci*n+i]); m.push(r.m[ci*n+i]); } if(!c.every(Number.isFinite)) return null;
  const cc=[],cd=[]; for(let i=0;i<n;i++){ cc.push(r.c[CUR*n+i]); cd.push(r.d[CUR*n+i]); } const dc=c.map((x,i)=>x-cc[i]), dd=d.map((x,i)=>x-cd[i]);
  return {cMed:med(c),c10:q(c,.1),cMin:Math.min(...c),mMed:med(d),m90:q(d,.9),mMax:Math.max(...d),half:m.filter(x=>x<0.5).length/n*100,loss:c.filter(x=>x<0).length/n*100,
    dMed:med(dc),d10:q(dc,.1),dMin:Math.min(...dc),beat:dc.filter(x=>x>0).length/n*100,both:c.filter((x,i)=>x>cc[i]&&d[i]<cd[i]).length/n*100,ddMed:med(dd),ddMax:Math.max(...dd)}; }
const out={meta:{made:new Date().toISOString(),legs:U,names:N,note:I.note,nW:Object.fromEntries(PLACES.map(k=>[k,R[k].nW])),exp:[...EXP]},bases:{}};
const row=x=>x?`${x.cMed.toFixed(1).padStart(5)} ${x.cMin.toFixed(1).padStart(6)} -${x.mMed.toFixed(0).padStart(2)}/-${x.mMax.toFixed(0).padStart(2)} ${(x.dMed>=0?'+':'')+x.dMed.toFixed(1).padStart(4)} ${(x.ddMed>=0?'+':'')+x.ddMed.toFixed(1).padStart(4)} ${x.beat.toFixed(0).padStart(3)}% ${x.both.toFixed(0).padStart(3)}%`:'   (자료 없음)';
const HDR='  '+'조합'.padEnd(54)+' | 연수익중앙 최악 MDD중/최 수익차 MDD차 이김 둘다 | …';
// 파레토(비지배): 연수익 중앙 최대 · MDD 중앙 최소
function pareto(S,filter){ const idx=COMBOS.map((_,i)=>i).filter(i=>S[i]&&filter(i)).sort((a,b)=>S[b].cMed-S[a].cMed||S[a].mMed-S[b].mMed); const F=[]; let best=Infinity; for(const i of idx){ if(S[i].mMed<best-1e-9){ F.push(i); best=S[i].mMed; } } return F; }
for(const bid of BASES){ const CUR=COMBOS.findIndex(c=>idOf(c)===bid); if(CUR<0) throw new Error('기준 조합 없음: '+bid);
  const S={}; for(const k of PLACES) S[k]=COMBOS.map((_,ci)=>summ(R[k],ci,CUR));
  const u=k=>S[k][CUR];
  const good=(k,ci)=>{ const x=S[k][ci], b=u(k); return !!x&&x.dMed>0&&x.mMed<b.mMed&&x.mMax<=b.mMax; };
  const strict=(k,ci)=>good(k,ci)&&S[k][ci].cMin>=u(k).cMin&&S[k][ci].half<=u(k).half+1e-9;
  const allP=f=>COMBOS.map((_,ci)=>PLACES.every(k=>f(k,ci)));
  const realP=f=>COMBOS.map((_,ci)=>CAPS.every(c=>f('real'+c,ci)));
  const G=allP(good), GS=allP(strict), GR=realP(good);
  const scoreMin=ci=>Math.min(...PLACES.map(k=>S[k][ci]?S[k][ci].dMed:-Infinity)), mddGain=ci=>Math.max(...PLACES.map(k=>S[k][ci]?S[k][ci].ddMed:Infinity));
  const nk=c=>c.k.length; const idxs=COMBOS.map((_,i)=>i);
  const show=(title,list)=>{ console.log('\n'+title); console.log('  '+'조합'.padEnd(54)+' | '+PLACES.map(k=>PN[k]+': 중앙 최악 MDD중/최 수익차 MDD차 이김 둘다').join(' | '));
    for(const ci of list) console.log('  '+tag(COMBOS[ci])+nameOf(COMBOS[ci]).padEnd(53)+' | '+PLACES.map(k=>row(S[k][ci])).join(' | ')); };
  console.log(`\n${'═'.repeat(30)} 기준 ${nameOf(COMBOS[CUR])} (${bid}) ${'═'.repeat(30)}`);
  show('기준',[CUR]);
  const gAll=idxs.filter(i=>G[i]).sort((a,b)=>scoreMin(b)-scoreMin(a)), gS=idxs.filter(i=>GS[i]).sort((a,b)=>scoreMin(b)-scoreMin(a)), gR=idxs.filter(i=>GR[i]).sort((a,b)=>Math.min(...CAPS.map(c=>S['real'+c][b].dMed))-Math.min(...CAPS.map(c=>S['real'+c][a].dMed)));
  const off=l=>l.filter(i=>!isExp(COMBOS[i]));
  console.log(`\n둘 다 좋음(연수익 중앙↑ · MDD 중앙↓ · 최악 MDD 안 나쁨) — 실제 1만·10만: ${gR.length} (공식만 ${off(gR).length}) · 네 곳 모두(강건): ${gAll.length} (공식만 ${off(gAll).length}) · 엄격(최악 연수익·반토막도): ${gS.length} (공식만 ${off(gS).length}) / ${NC}`);
  for(const K of [1,2,3]) show(`강건 — ${K}개 전략 (네 곳 수익차 중앙의 최소값 순 · † = 실험적 확장 포함)`,gAll.filter(i=>nk(COMBOS[i])===K).slice(0,15));
  show('강건 · 공식 전략만 (상위 20)',off(gAll).slice(0,20));
  show('강건 · 공식만 · MDD 를 가장 많이 줄인 순 (상위 12)',off(gAll).slice().sort((a,b)=>mddGain(a)-mddGain(b)).slice(0,12));
  show('엄격 통과 (상위 15)',gS.slice(0,15));
  show('실제(1만·10만)만 둘 다 좋음 · 합성은 못 넘음 — 공식만 상위 12',off(gR).filter(i=>!G[i]).slice(0,12));
  for(const k of ['real10000','syn10000']){ for(const [nm,f] of [['전부',()=>true],['공식만',i=>!isExp(COMBOS[i])]]){ const F=pareto(S[k],f); const bi=F.indexOf(CUR);
      console.log(`\n파레토(${PN[k]} · ${nm} · 연수익 중앙 ↑ · MDD 중앙 ↓) ${F.length}점 · 기준은 ${bi>=0?'경계 위':'경계 아래'}`); const b=u(k);
      const near=F.filter(i=>Math.abs(S[k][i].mMed-b.mMed)<=12); for(const i of near) console.log(`   ${tag(COMBOS[i])}${nameOf(COMBOS[i]).padEnd(53)} 연수익 ${S[k][i].cMed.toFixed(1).padStart(5)} · MDD ${S[k][i].mMed.toFixed(1).padStart(5)} · 최악 ${S[k][i].mMax.toFixed(1)}${i===CUR?'  ← 기준':''}`); } }

  // ── 공식 조합 근접 분석: 세 조건(수익 중앙↑ · MDD 중앙↓ · 최악 MDD ≤)을 네 곳에서 각각 몇 곳 통과하나 ──
  const offIdx=idxs.filter(i=>!isExp(COMBOS[i])&&PLACES.every(k=>S[k][i]));
  const flags=(k,i)=>{ const x=S[k][i], b=u(k); return [x.dMed>0, x.mMed<b.mMed, x.mMax<=b.mMax]; };
  const nPass=i=>PLACES.filter(k=>flags(k,i).every(Boolean)).length;
  const twoAxis=i=>PLACES.every(k=>{ const f=flags(k,i); return f[0]&&f[1]; });
  const relaxed=i=>PLACES.every(k=>{ const x=S[k][i], b=u(k); return x.dMed>=-0.5&&x.mMed<=b.mMed-2&&x.mMax<=b.mMax; });
  const hist=[0,0,0,0,0]; for(const i of offIdx) hist[nPass(i)]++;
  console.log(`\n공식 조합 ${offIdx.length}개 — 세 조건 모두 통과한 곳 수: 0곳 ${hist[0]} · 1곳 ${hist[1]} · 2곳 ${hist[2]} · 3곳 ${hist[3]} · 4곳 ${hist[4]}`);
  const fl=i=>PLACES.map(k=>{ const f=flags(k,i); return PN[k]+' '+(f[0]?'수↑':'수↓')+(f[1]?'중↓':'중↑')+(f[2]?'최≤':'최>'); }).join(' · ');
  const near3=offIdx.filter(i=>nPass(i)>=2).sort((a,b)=>scoreMin(b)-scoreMin(a));
  console.log(`\n공식 · 2곳 이상 통과 (${near3.length}) — 어디서 무엇이 걸렸나`); for(const i of near3.slice(0,20)) console.log('  '+nameOf(COMBOS[i]).padEnd(53)+' | '+fl(i));
  const two=offIdx.filter(twoAxis).sort((a,b)=>scoreMin(b)-scoreMin(a));
  show(`공식 · 네 곳 모두 수익 중앙↑ 그리고 MDD 중앙↓ (최악 MDD 는 무시) — ${two.length}개 · 상위 15`,two.slice(0,15));
  const rel=offIdx.filter(relaxed).sort((a,b)=>mddGain(a)-mddGain(b));
  show(`공식 · 느슨: 네 곳 모두 수익 중앙 ≥ 기준−0.5 · MDD 중앙 ≤ 기준−2 · 최악 MDD ≤ 기준 — ${rel.length}개 · MDD 줄인 순 상위 15`,rel.slice(0,15));
  // ── 듀얼(기본) + 다른 공식 전략 1/6 · 1/3 슬리브 표 (창 중앙 차 + 전 구간 한 길) ──
  const P5i=U.indexOf('P5'); const full=(k,ci)=>({c:R[k].fc[ci],d:R[k].fd[ci]});
  const sleeve=(w)=>{ console.log(`\n듀얼(기본) ${FR[6-w]} + X ${FR[w]} — 창 중앙 차(수익 / MDD 중앙 / 최악 MDD · 기준 대비 %p) · 전 구간 한 길(실제 ${R.real10000.fullSpan} · 합성 ${R.syn10000?R.syn10000.fullSpan:'-'})`);
    console.log('  '+'X'.padEnd(22)+' | '+PLACES.map(k=>PN[k].padEnd(16)).join(' | ')+' | 전구간 실제1만 연수익·MDD (기준) | 전구간 합성1만');
    const rows=[]; for(let x=0;x<L;x++){ if(x===P5i||EXP.has(U[x])) continue; const ci=COMBOS.findIndex(c=>c.k.length===2&&c.k[0]===Math.min(P5i,x)&&c.k[1]===Math.max(P5i,x)&&c.w[c.k.indexOf(P5i)]===6-w); if(ci<0||!PLACES.every(k=>S[k][ci])) continue;
      const cell=k=>{ const s=S[k][ci], b=u(k); const f=(v,sg)=>(v>=0?'+':'')+v.toFixed(1); return `${f(s.dMed)}/${f(s.ddMed)}/${f(s.mMax-b.mMax)}`.padEnd(16); };
      const fr=full('real10000',ci), fb=full('real10000',CUR), fs=R.syn10000?full('syn10000',ci):null, fsb=R.syn10000?full('syn10000',CUR):null;
      rows.push({ci,x,line:'  '+N[U[x]].padEnd(22)+' | '+PLACES.map(cell).join(' | ')+` | ${fr.c.toFixed(1)} · ${fr.d.toFixed(1)} (${fb.c.toFixed(1)} · ${fb.d.toFixed(1)})`+(fs?` | ${fs.c.toFixed(1)} · ${fs.d.toFixed(1)} (${fsb.c.toFixed(1)} · ${fsb.d.toFixed(1)})`:''),score:scoreMin(ci)}); }
    rows.sort((a,b)=>b.score-a.score); for(const r of rows) console.log(r.line); return rows.map(r=>({x:U[r.x],id:idOf(COMBOS[r.ci]),places:Object.fromEntries(PLACES.map(k=>[k,{dMed:+S[k][r.ci].dMed.toFixed(2),ddMed:+S[k][r.ci].ddMed.toFixed(2),dMax:+(S[k][r.ci].mMax-u(k).mMax).toFixed(2),both:+S[k][r.ci].both.toFixed(0)}])),full:{real:full('real10000',r.ci),syn:R.syn10000?full('syn10000',r.ci):null}})); };
  const SL={ w1:sleeve(1), w2:sleeve(2) };
  console.log(`\n기준 전 구간 한 길: 실제1만 ${full('real10000',CUR).c.toFixed(1)}% · MDD ${full('real10000',CUR).d.toFixed(1)} | 실제10만 ${full('real100000',CUR).c.toFixed(1)} · ${full('real100000',CUR).d.toFixed(1)}`+(R.syn10000?` | 합성1만 ${full('syn10000',CUR).c.toFixed(1)} · ${full('syn10000',CUR).d.toFixed(1)}`:''));
  const pack=x=>x?Object.fromEntries(Object.entries(x).map(([a,v])=>[a,+v.toFixed(2)])):null;
  out.bases[bid]={name:nameOf(COMBOS[CUR]),base:Object.fromEntries(PLACES.map(k=>[k,pack(u(k))])),counts:{real:gR.length,realOff:off(gR).length,all:gAll.length,allOff:off(gAll).length,strict:gS.length,strictOff:off(gS).length},
    robust:gAll.map(i=>({id:idOf(COMBOS[i]),name:nameOf(COMBOS[i]),exp:isExp(COMBOS[i]),strict:GS[i],places:Object.fromEntries(PLACES.map(k=>[k,pack(S[k][i])]))})),
    realOnly:off(gR).filter(i=>!G[i]).slice(0,40).map(i=>({id:idOf(COMBOS[i]),name:nameOf(COMBOS[i]),places:Object.fromEntries(PLACES.map(k=>[k,pack(S[k][i])]))})),
    offHist:hist,near3:near3.map(i=>({id:idOf(COMBOS[i]),flags:PLACES.map(k=>flags(k,i))})),twoAxis:two.slice(0,40).map(i=>({id:idOf(COMBOS[i]),places:Object.fromEntries(PLACES.map(k=>[k,pack(S[k][i])]))})),relaxed:rel.slice(0,40).map(i=>({id:idOf(COMBOS[i]),places:Object.fromEntries(PLACES.map(k=>[k,pack(S[k][i])]))})),sleeve:SL,
    pareto:Object.fromEntries(['real10000','syn10000'].map(k=>[k,pareto(S[k],()=>true).map(i=>({id:idOf(COMBOS[i]),cMed:+S[k][i].cMed.toFixed(2),mMed:+S[k][i].mMed.toFixed(2),mMax:+S[k][i].mMax.toFixed(2)}))]))}; }
if(OUT){ fs.writeFileSync(OUT,JSON.stringify(out)); console.error('done',OUT,((Date.now()-t0)/1e3).toFixed(0)+'초'); }
