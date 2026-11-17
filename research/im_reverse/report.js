const fs=require('fs'); const CAP=process.argv[2]||10000;
const D=JSON.parse(fs.readFileSync(__dirname+'/events_'+CAP+'.json'));
const p=x=>x==null?'   — ':((x>=0?'+':'')+(x*100).toFixed(1)+'%').padStart(7);
const med=a=>{const b=a.filter(x=>x!=null).sort((x,y)=>x-y);return b.length?b[Math.floor((b.length-1)/2)]:null;};
for(const tkr of Object.keys(D)){
  const ev=D[tkr];
  // 에피소드: E 가 60 일(달력) 안에 이어지면 한 묶음
  const eps=[]; for(const e of ev){ const last=eps[eps.length-1]; if(last&&(Date.parse(e.E)-Date.parse(last[last.length-1].E))<60*864e5) last.push(e); else eps.push([e]); }
  console.log(`\n■ ${tkr} · 원금 ${CAP}$ · 소진 사건 ${ev.length}개 · 묶음 ${eps.length}개 (켬÷끔 평가액 − 1 · 묶음 안 중앙값)`);
  console.log('묶음 첫 날     | 사건 | 종가/평단 | T    | 3달     6달     1년     2년     끝      | 끔 회복(거래일) · 켬 회복');
  for(const g of eps){ const r=med(g.map(x=>x.ratio));
    console.log(`${g[0].E} ~ ${g[g.length-1].E.slice(5)} | ${String(g.length).padStart(3)}  | ${r.toFixed(2).padStart(5)}     | ${med(g.map(x=>x.T)).toFixed(1).padStart(4)} | ${p(med(g.map(x=>x.h[60])))} ${p(med(g.map(x=>x.h[120])))} ${p(med(g.map(x=>x.h[250])))} ${p(med(g.map(x=>x.h[500])))} ${p(med(g.map(x=>x.end)))} | ${med(g.map(x=>x.recOff))??'못함'} · ${med(g.map(x=>x.recOn))??'못함'}`); }
  for(const [lab,f] of [['전체',x=>true],['종가/평단 ≤ 0.70',x=>x.ratio<=0.70],['종가/평단 ≤ 0.62',x=>x.ratio<=0.62]]){
    const sel=eps.map(g=>g.filter(f)).filter(g=>g.length);
    const agg=h=>sel.map(g=>med(g.map(x=>h==='end'?x.end:x.h[h]))).filter(x=>x!=null);
    const line=['60','120','250','500','end'].map(h=>{ const a=agg(h); const w=a.filter(x=>x>0).length; return `${h==='end'?'끝':h+'일'} 켬 우세 ${w}/${a.length} 중앙 ${p(med(a)).trim()}`; }).join(' · ');
    console.log(`  [${lab} · 묶음 ${sel.length}] ${line}`);
  }
}
