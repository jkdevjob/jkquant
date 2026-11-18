const fs=require('fs'); const CAP=process.argv[2]||10000; const D=JSON.parse(fs.readFileSync(__dirname+'/delay_'+CAP+'.json'));
const KS=[0,5,10,20,40,60]; const med=a=>{const b=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);return b.length?b[Math.floor((b.length-1)/2)]:null;};
const p=(x,d=1)=>x==null?'—':((x>=0?'+':'')+(x*100).toFixed(d)+'%');
for(const tkr of Object.keys(D)){
  const ev=D[tkr].events;
  const eps=[]; for(const e of ev){ const last=eps[eps.length-1]; if(last&&(Date.parse(e.E)-Date.parse(last[last.length-1].E))<60*864e5) last.push(e); else eps.push([e]); }
  console.log(`\n■ ${tkr} · 원금 ${CAP}$ · 소진 묶음 ${eps.length}개 — 소진일부터 h 거래일 뒤 평가액(끔 대비)`);
  for(const h of [120,250,500]){
    const line=KS.map(K=>{ const a=eps.map(g=>med(g.map(x=>x.h[K][h]))).filter(x=>x!=null); const w=a.filter(x=>x>1e-9).length, l=a.filter(x=>x<-1e-9).length;
      return `${K===0?'즉시':K+'일'} ${w}승${l}패 중앙 ${p(med(a))} 최악 ${p(Math.min(...a))} 최고 ${p(Math.max(...a),0)}`; }).join(' | ');
    console.log(`  ${h}일 뒤: ${line}`); }
  const W=D[tkr].windows;
  console.log(`  5년 창 ${W.length}개 (끔 연복리 중앙 ${p(med(W.map(w=>w.r.off.cagr)))} · MDD 중앙 ${p(med(W.map(w=>w.r.off.mdd)))})`);
  console.log('  '+KS.map(K=>{ const d=W.map(w=>w.r[K].cagr-w.r.off.cagr), m=W.map(w=>w.r[K].mdd-w.r.off.mdd);
    return `${K===0?'즉시':K+'일'}: 연복리 끔보다 높은 창 ${d.filter(x=>x>1e-9).length}/낮은 ${d.filter(x=>x<-1e-9).length} · 차 중앙 ${p(med(d),2)} · 최악 ${p(Math.min(...d),1)} · MDD 차 중앙 ${p(med(m),1)} · MDD 더 얕은 창 ${m.filter(x=>x<-1e-9).length}`; }).join('\n  '));
}
