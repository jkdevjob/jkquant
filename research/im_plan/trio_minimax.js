// 국면 최악 기준 — 칸(실제 전체·앞·뒤 · 합성 2000~05·2006~10·2011~ 시작) × 1만·10만 = 12칸에서 '짝 중앙 연수익 차'의 최소값. 중앙 MDD 는 칸마다 지금 + tol 이하여야.
const r=require(process.argv[2]); const F=r.meta.fields.split(','); const N=r.meta.names; const FR={1:'1/6',2:'1/3',3:'1/2',4:'2/3',5:'5/6',6:'100%'};
const nm=id=>id.split('+').map(p=>{ const [k,w]=p.split(':'); return N[k]+' '+FR[w]; }).join(' + ');
const at={}; r.ids.forEach((id,i)=>at[id]=i); const CUR=at[r.meta.cur];
const g=(k,i)=>{ const a=r.sum[k][i]; if(!a) return null; const o={}; F.forEach((f,j)=>o[f]=a[j]); return o; };
const CELLS=[]; for(const s of ['realALL','realA','realB','synEARLY','synMID','synLATE']) for(const c of [10000,100000]) CELLS.push(s.replace(/^(real|syn)/,'$1'+c));
const TOL=+(process.env.TOL??0), TOLX=+(process.env.TOLX??2);
const fam=k=>/^P5/.test(k)?'P5':/^IVS_U/.test(k)?'IVS_U':k; const distinct=i=>{ const ks=r.ids[i].split('+').map(p=>fam(p.split(':')[0])); return new Set(ks).size===ks.length; };
const res=[]; for(let i=0;i<r.ids.length;i++){ if(i===CUR) continue; let mn=Infinity, ok=true, wMin=Infinity, sumD=0;
  for(const k of CELLS){ const x=g(k,i), u=g(k,CUR); if(!x){ ok=false; break; } if(x.mMed>u.mMed+TOL||x.mMax>u.mMax+TOLX){ ok=false; break; } mn=Math.min(mn,x.dMed); wMin=Math.min(wMin,x.beat); sumD+=x.dMed; }
  if(ok) res.push({i,mn,wMin,avg:sumD/CELLS.length}); }
res.sort((a,b)=>b.mn-a.mn);
console.log(`칸 ${CELLS.length} · MDD 중앙 ≤ 지금+${TOL} · 최악 MDD ≤ 지금+${TOLX} 통과 ${res.length} · 그중 12칸 모두 짝 중앙 차 > 0: ${res.filter(x=>x.mn>0).length}`);
const show=(title,L)=>{ console.log('\n'+title); for(const x of L) console.log(`  ${nm(r.ids[x.i]).padEnd(56)} 12칸 최소 ${(x.mn>=0?'+':'')+x.mn.toFixed(2)} · 평균 ${(x.avg>=0?'+':'')+x.avg.toFixed(2)} · 이긴 창 최소 ${x.wMin.toFixed(0)}%`); };
show('전체 상위 20',res.slice(0,20));
for(const K of [1,2,3]) show(`서로 다른 계열 ${K}개 상위`,res.filter(x=>distinct(x.i)&&r.ids[x.i].split('+').length===K).slice(0,K===1?5:12));
if(process.env.CELL){ const ids=process.env.CELL.split(' '); for(const id of ids){ const i=at[id]; console.log('\n'+nm(id)); for(const k of CELLS){ const x=g(k,i),u=g(k,CUR); console.log(`  ${k.padEnd(16)} 중앙 ${x.cMed.toFixed(1)} (지금 ${u.cMed.toFixed(1)}) 차 ${x.dMed.toFixed(1)} · MDD ${x.mMed.toFixed(0)}/${x.mMax.toFixed(0)} (지금 ${u.mMed.toFixed(0)}/${u.mMax.toFixed(0)}) · 이김 ${x.beat.toFixed(0)}% · 최악 ${x.cMin.toFixed(1)} (지금 ${u.cMin.toFixed(1)})`); } } }
