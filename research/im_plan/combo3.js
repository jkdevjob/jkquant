// 무매 + 5년 플랜 조합 — 두 계좌 사이 돈 옮기는 방식 비교 · 실제(2011~) · 합성(2000~) · 1만$·10만$
// 무매 일별 자산은 imh(backtest.html 실제 runIM)로, 플랜은 px+plan_rules 로 만든다. 여기서는 '옮기기'만 흉내낸다.
// 방식: none(안 옮김) · year(매년 첫 거래일 비중 복원) · band:b(전일 종가 비중이 목표±b 를 넘으면 오늘 종가에 복원)
//       oneway(매년 · 무매가 목표보다 많을 때만 넘치는 몫을 플랜으로, 다시 채우지 않음) · oneband:b(무매 비중이 목표+b 를 넘으면 그 몫만 플랜으로)
// 근사: 무매 계좌를 펀드처럼 비례로 줄이고 늘림(사이클 중 입출금 영향 무시) · 옮긴 금액에 수수료 0.25%(편도) · 옮길 때 생기는 추가 양도세는 무시
// 사용: node combo3.js [무매후보,…] [방식,…] [무매비중,…]
const {open}=require('./imh'); const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules');
const IMV={
  tp10y:{cashYield:true,sig:{bearTP:10,bearMA:150}},        // 10-12 기준선 조합에 쓴 무매(이자 이상형)
  base:{}, auto:{autoTp:true}, age20:{autoTp:true,m1:{maxAge:20}}, slopeAll:{autoTp:true,m1:{slope20:'all'}},
};
const pickIM=(process.argv[2]||'tp10y,base,auto,age20,slopeAll').split(',');
const MODES=(process.argv[3]||'none,year,band:0.1,band:0.15,band:0.2,oneway,oneband:0.1,oneband:0.15,oneband:0.2').split(',');
const WS=(process.argv[4]||'0.5').split(',').map(Number);
const FEE=0.0025;
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const f=x=>x.toFixed(1);
function mix(im,pl,w,mode){ const [kind,bs]=mode.split(':'), b=+bs||0;
  const ds=Object.keys(pl).filter(d=>im[d]!=null).sort(); let a=w, p=1-w, yr=ds[0].slice(0,4), flag=false, moved=0; const out=[[ds[0],1]];
  for(let k=1;k<ds.length;k++){ const d=ds[k], d0=ds[k-1];
    a*=im[d0]>0?im[d]/im[d0]:1; p*=pl[d0]>0?pl[d]/pl[d0]:1;
    let go=false; if(kind==='year'||kind==='oneway'){ if(d.slice(0,4)!==yr){ go=true; yr=d.slice(0,4); } } else if(kind==='band'||kind==='oneband') go=flag;
    if(go){ const t=a+p; let x=a-t*w; if(kind.startsWith('one')&&x<0) x=0;     // x>0: 무매 → 플랜
      if(Math.abs(x)>1e-12){ const c=Math.abs(x)*FEE; a-=x; p+=x; if(x>0) p-=c; else a-=c; moved+=Math.abs(x)/t; } }
    const wa=a/(a+p); if(kind==='band') flag=Math.abs(wa-w)>b; else if(kind==='oneband') flag=wa-w>b;   // 내일 옮길지 — 오늘 종가로 정한다(전일 확정)
    out.push([d,a+p]); }
  return {eq:out,moved}; }
function roll(eq,y0){ const ds=eq.map(x=>x[0]); const R=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>ds[ds.length-1]||s<ds[0]) continue; const sl=eq.filter(x=>x[0]>=s&&x[0]<e); R.push(stats(sl.map(([d,v])=>[d,v/sl[0][1]]),1)); } return R; }
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  for(const [lab,TK,P,R,G,from,y0] of [['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011],['합성','SYNSOXL',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000]]){
    for(const cap of [10000,100000]){
      const pl={}; sim(P,Object.assign({cap,from},mk(P,R,G,JSON.parse(process.env.PLAN||'{}')))).eq.forEach(([d,v])=>pl[d]=v);   // PLAN='{…}' 로 플랜 변형
      { const s=stats(Object.entries(pl).sort().map(([d,v])=>[d,v/cap]),1), Rr=roll(Object.entries(pl).sort().map(([d,v])=>[d,v/cap]),y0);
        console.log(`\n■ ${lab} ${cap/1e4}만$ · 플랜 단독 ${f(s.cagr)}/${f(s.mdd)} · 5y롤링 중앙 ${f(q(Rr.map(x=>x.cagr),.5))}/${f(q(Rr.map(x=>x.mdd),.5))} 최악MDD ${f(Math.max(...Rr.map(x=>x.mdd)))}`); }
      for(const k of pickIM){ const r=await pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1]]).concat([[r.last+'~',r.final]]); },Object.assign({cap,tkr:TK},IMV[k]));
        const im={}; r.forEach(([d,v])=>{ if(!String(d).endsWith('~')) im[d]=v; });
        for(const w of WS) for(const mode of MODES){ const {eq,moved}=mix(im,pl,w,mode); const s=stats(eq,1), Rr=roll(eq,y0);
          console.log(`  ${(k+' '+Math.round(w*100)+'/'+Math.round((1-w)*100)).padEnd(15)} ${mode.padEnd(12)} | ${f(s.cagr)}/${f(s.mdd)} MAR ${(s.cagr/s.mdd).toFixed(2)} | 5y롤링 CAGR 중앙 ${f(q(Rr.map(x=>x.cagr),.5))} 하위10% ${f(q(Rr.map(x=>x.cagr),.1))} · MDD 중앙 ${f(q(Rr.map(x=>x.mdd),.5))} 최악 ${f(Math.max(...Rr.map(x=>x.mdd)))} | 옮긴 양 ${f(moved*100)}%`); } } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
