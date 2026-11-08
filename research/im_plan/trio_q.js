// trio_eval.json 조회 — node trio_q.js eval.json [ids...] | 환경 LIST=robust|passR
const r=require(process.argv[2]); const F=r.meta.fields.split(','); const N=r.meta.names;
const FR={1:'1/6',2:'1/3',3:'1/2',4:'2/3',5:'5/6',6:'100%'};
const nm=id=>id.split('+').map(p=>{ const [k,w]=p.split(':'); return N[k]+' '+FR[w]; }).join(' + ');
const at={}; r.ids.forEach((id,i)=>at[id]=i);
const g=(k,id)=>{ const a=r.sum[k][at[id]]; if(!a) return null; const o={}; F.forEach((f,i)=>o[f]=a[i]); return o; };
const row=(k,id)=>{ const x=g(k,id); return x?`${x.cMed.toFixed(1).padStart(5)} ${x.cMin.toFixed(1).padStart(6)} -${x.mMed.toFixed(0).padStart(2)}/-${x.mMax.toFixed(0).padStart(3)} ${(x.dMed>=0?'+':'')+x.dMed.toFixed(1)} ${x.beat.toFixed(0).padStart(3)}% ${x.both.toFixed(0).padStart(3)}% ${x.half.toFixed(0)}%`:'(없음)'; };
const ids=process.env.LIST?r[process.env.LIST]:process.argv.slice(3);
const keys=(process.env.KEYS||'real10000ALL,real100000ALL,syn10000ALL,syn100000ALL').split(',');
console.log('조합'.padEnd(50)+' | '+keys.join(' | ')+'   [중앙 최악 MDD중/최 차 이김 둘다 반토막]');
for(const id of ids){ if(at[id]==null){ console.log('없음 '+id); continue; } console.log(nm(id).padEnd(50)+' | '+keys.map(k=>row(k,id)).join(' | ')); }
