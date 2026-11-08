// trio_eval.json — 우위가 다른 시기에도 이어지나(선택 구간 우위 통과 → 검증 구간 우위 통과율 vs 전체 기준율) + 서로 다른 전략 계열만의 2·3개 상위
const r=require(process.argv[2]); const F=r.meta.fields.split(','); const N=r.meta.names; const FR={1:'1/6',2:'1/3',3:'1/2',4:'2/3',5:'5/6',6:'100%'};
const nm=id=>id.split('+').map(p=>{ const [k,w]=p.split(':'); return N[k]+' '+FR[w]; }).join(' + ');
const at={}; r.ids.forEach((id,i)=>at[id]=i); const CUR=at[r.meta.cur];
const g=(k,i)=>{ const a=r.sum[k][i]; if(!a) return null; const o={}; F.forEach((f,j)=>o[f]=a[j]); return o; };
const CAPS=[10000,100000];
const dom=(sub,i,t)=>{ t=t||{}; return CAPS.every(c=>{ const k=sub.replace('#',c), x=g(k,i), u=g(k,CUR); return x&&x.dMed>0&&x.mMed<=u.mMed+(t.m??0)&&x.mMax<=u.mMax+(t.mx??1)&&x.cMin>=u.cMin-(t.c??0.5)&&x.half<=u.half+1e-9; }); };
const all=r.ids.map((_,i)=>i).filter(i=>i!==CUR);
const persist=(trainSubs,testSub,t)=>{ const tr=all.filter(i=>trainSubs.every(s=>dom(s,i,t))); const okT=all.filter(i=>g(testSub.replace('#',10000),i)); const base=okT.filter(i=>dom(testSub,i,t)).length/okT.length*100;
  const trT=tr.filter(i=>g(testSub.replace('#',10000),i)); const hit=trT.filter(i=>dom(testSub,i,t)).length; const dm=trT.map(i=>(g(testSub.replace('#',10000),i).dMed+g(testSub.replace('#',100000),i).dMed)/2).sort((a,b)=>a-b);
  return `선택(${trainSubs.join('·')}) 통과 ${tr.length} → 검증(${testSub}) 우위 ${hit}/${trT.length} = ${(hit/Math.max(1,trT.length)*100).toFixed(0)}% (전체 기준율 ${base.toFixed(0)}%) · 검증 짝 중앙 차의 중앙 ${dm.length?dm[Math.floor(dm.length/2)].toFixed(2):'-'} · 하위10% ${dm.length?dm[Math.floor(dm.length*.1)].toFixed(2):'-'}`; };
for(const t of [{},{c:1,mx:2}]){ console.log('\n허용폭 '+JSON.stringify(t));
  console.log('  '+persist(['real#A'],'real#B',t));
  console.log('  '+persist(['syn#EARLY','syn#MID'],'real#B',t));
  console.log('  '+persist(['syn#EARLY','syn#MID','real#A'],'real#B',t));
  console.log('  '+persist(['real#ALL'],'syn#EARLY',t));
  console.log('  '+persist(['real#ALL'],'syn#MID',t));
  console.log('  '+persist(['syn#EARLY'],'syn#LATE',t)); }
// 서로 다른 전략 계열만(5년 플랜 3벌은 한 계열 · 섀넌 USD 2벌 한 계열 · 무매 3종은 종목이 달라 따로)
const fam=k=>/^P5/.test(k)?'P5':/^IVS_U/.test(k)?'IVS_U':k;
const distinct=i=>{ const ks=r.ids[i].split('+').map(p=>fam(p.split(':')[0])); return new Set(ks).size===ks.length; };
const nk=i=>r.ids[i].split('+').length;
const score=i=>Math.min(...['real','syn'].flatMap(s=>CAPS.map(c=>{ const x=g(s+c+'ALL',i); return x?x.dMed:-99; })));
const row=(k,i)=>{ const x=g(k,i); return x?`${x.cMed.toFixed(1).padStart(5)} ${x.cMin.toFixed(1).padStart(6)} -${x.mMed.toFixed(0).padStart(2)}/-${x.mMax.toFixed(0).padStart(3)} ${(x.dMed>=0?'+':'')+x.dMed.toFixed(1)} ${x.beat.toFixed(0).padStart(3)}% ${x.both.toFixed(0).padStart(3)}% ${x.half.toFixed(0)}%`:'(없음)'; };
const keys=['real10000ALL','real100000ALL','syn10000ALL','syn100000ALL'];
for(const t of [{},{c:1,mx:2},{c:2,mx:4}]){ const P=all.filter(i=>distinct(i)&&dom('real#ALL',i,t)&&dom('syn#ALL',i,t));
  console.log(`\n서로 다른 계열 · 실제·합성 모두 우위(허용 ${JSON.stringify(t)}) ${P.length}개`);
  for(const K of [1,2,3]){ const L=P.filter(i=>nk(i)===K).sort((a,b)=>score(b)-score(a)).slice(0,K===3?15:10); if(!L.length) continue; console.log(`  ${K}개`);
    for(const i of L) console.log('   '+nm(r.ids[i]).padEnd(52)+' | '+keys.map(k=>row(k,i)).join(' | ')); } }
