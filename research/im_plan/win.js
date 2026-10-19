// 무매(익절 자동) 단독 vs 5년 플랜 단독 — 최근(2022-01~ · 모의투자 기간)과 5년 롤링 창마다 누가 이겼나 · 사용: node win.js

const {open}=require('./imh'); const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules');
(async()=>{ const {pg,close}=await open([{sym:'SOXL'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const P=prep(['TECL','TQQQ']);
  for(const cap of [10000,100000]){
    const pl={}; sim(P,Object.assign({cap,from:'2011-01-01'},mk(P,'TECL','TQQQ',{}))).eq.forEach(([d,v])=>pl[d]=v);
    const r=await pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1]]); },{cap,tkr:'SOXL',autoTp:true});
    const im={}; r.forEach(([d,v])=>im[d]=v);
    const ds=Object.keys(pl).filter(d=>im[d]!=null).sort();
    const win=(s,e)=>{ const a=ds.filter(d=>d>=s&&d<=e); const f=(S)=>stats(a.map(d=>[d,S[d]/S[a[0]]]),1); return {im:f(im),pl:f(pl),from:a[0],to:a[a.length-1]}; };
    const w=win('2022-01-01','2099'); const tot=x=>((Math.pow(1+x.cagr/100,(Date.parse(w.to)-Date.parse(w.from))/(365.25*864e5))-1)*100).toFixed(0);
    console.log(`${cap/1e4}만$ 최근 ${w.from}~${w.to}: 무매 CAGR ${w.im.cagr.toFixed(1)} (누적 +${tot(w.im)}%) MDD ${w.im.mdd.toFixed(1)} | 플랜 CAGR ${w.pl.cagr.toFixed(1)} (누적 +${tot(w.pl)}%) MDD ${w.pl.mdd.toFixed(1)}`);
    let n=0,imWin=0; const diff=[]; const per=[];
    for(let y=2011;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>ds[ds.length-1]) continue;
      const x=win(s,e); n++; if(x.im.cagr>x.pl.cagr) imWin++; diff.push(x.im.cagr-x.pl.cagr); if(m===1) per.push(`${y}:${x.im.cagr.toFixed(0)}/${x.pl.cagr.toFixed(0)}`); }
    diff.sort((a,b)=>a-b);
    console.log(`  5년 창 ${n}개: 무매가 이긴 창 ${imWin}개(${(imWin/n*100).toFixed(0)}%) · CAGR 차이 중앙 ${diff[Math.floor(n/2)].toFixed(1)}%p · 1월 시작 창(무매/플랜): ${per.join(' ')}`);
  }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
