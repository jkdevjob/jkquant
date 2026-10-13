// 무매 2종목 분산 — 종목마다 따로 무매(각자 사이클 · 공식 익절: SOXL 20 · TQQQ 15), 원금을 비중대로 나눠 시작.
//   따로 = 두 계좌를 그냥 더함(리밸 없음) · 연리밸 = 매년 첫 거래일에 비중대로 다시 나눔(일별 수익률로 근사 — 정수 주 차이는 무시)
// 실제: node pair.js   ·   합성: SYN=1 Y0=1995 node pair.js   ·   OPT='{"cashYield":true}' 로 공통 옵션
const {open,stats}=require('./imh');
const SYN=!!process.env.SYN, Y0=+(process.env.Y0||2010), OPT=JSON.parse(process.env.OPT||'{}');
const A=SYN?{sym:'SYNSOXL',tgt:20}:{sym:'SOXL',tgt:20}, B=SYN?{sym:'SYNTQQQ',tgt:15}:{sym:'TQQQ',tgt:15};
const WS=(process.env.WS||'1,0.7,0.5,0.3,0').split(',').map(Number);   // SOXL 비중
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const f=x=>x.toFixed(1);
function combine(ra,rb,wa,reb){   // ra·rb: {eqs:[[d,v]],final,first,last} (null = 비중 0)
  if(!rb) return ra; if(!ra) return rb;
  const mb={}; rb.eqs.forEach(([d,v])=>mb[d]=v); const ds=ra.eqs.filter(([d])=>mb[d]>0).map(x=>x[0]); const ma={}; ra.eqs.forEach(([d,v])=>ma[d]=v);
  if(!reb){ return {eqs:ds.map(d=>[d,ma[d]+mb[d]]), final:ra.final+rb.final, first:ra.first, last:ra.last}; }
  let va=ma[ds[0]], vb=mb[ds[0]], yr=ds[0].slice(0,4); const out=[[ds[0],va+vb]];
  for(let k=1;k<ds.length;k++){ const d=ds[k]; va*=ma[d]/ma[ds[k-1]]; vb*=mb[d]/mb[ds[k-1]];
    if(d.slice(0,4)!==yr){ const t=va+vb; va=t*wa; vb=t*(1-wa); yr=d.slice(0,4); } out.push([d,va+vb]); }
  const L=ds[ds.length-1]; const fin=va*ra.final/ma[L]+vb*rb.final/mb[L];
  return {eqs:out, final:fin, first:ra.first, last:ra.last};
}
(async()=>{ const {pg,close}=await open([{sym:A.sym},{sym:B.sym}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const [da,db]=await pg.evaluate(([a,b])=>[Object.keys(M[a]).sort(),Object.keys(M[b]).sort()],[A.sym,B.sym]);
  const F0=da[0]>db[0]?da[0]:db[0], LAST=da[da.length-1]<db[db.length-1]?da[da.length-1]:db[db.length-1];
  const s20=(da[20]>db[20]?da[20]:db[20]);
  const run=async(t,cap,from,to)=>cap>0?pg.evaluate(o=>{ const r=RUN(o); return {eqs:r.eqs.map(x=>[x[0],x[1]]),final:r.final,first:r.first,last:r.last}; },Object.assign({},OPT,{cap,from,to,tkr:t.sym,tgt:t.tgt})):null;
  const starts=[]; for(let y=Y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<s20) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>LAST) continue; starts.push([s,e]); }
  for(const cap of [10000,100000]){
    // 상관 (전체 · 각자 100%)
    { const ra=await run(A,cap,F0,LAST), rb=await run(B,cap,F0,LAST); const mb={}; rb.eqs.forEach(([d,v])=>mb[d]=v);
      const ds=ra.eqs.filter(([d])=>mb[d]>0); const x=[],y=[]; for(let k=1;k<ds.length;k++){ x.push(ds[k][1]/ds[k-1][1]-1); y.push(mb[ds[k][0]]/mb[ds[k-1][0]]-1); }
      const mx=x.reduce((a,b)=>a+b,0)/x.length, my=y.reduce((a,b)=>a+b,0)/y.length; let sxy=0,sxx=0,syy=0; for(let k=0;k<x.length;k++){ sxy+=(x[k]-mx)*(y[k]-my); sxx+=(x[k]-mx)**2; syy+=(y[k]-my)**2; }
      console.log(`${cap} 일수익 상관 ${A.sym}·${B.sym} 무매 ${(sxy/Math.sqrt(sxx*syy)).toFixed(2)} (${F0}~)`); }
    for(const wa of WS){ for(const reb of (wa>0&&wa<1)?[false,true]:[false]){ const row={};
      for(const [nm,from] of [['full',F0],['s15',SYN?'2003-01-01':'2015-01-01'],['s20',SYN?'2010-03-11':'2020-01-01']]){ const r=combine(await run(A,cap*wa,from,LAST),await run(B,cap*(1-wa),from,LAST),wa,reb); row[nm]=stats(r,cap); }
      const roll=[]; for(const [s,e] of starts){ const r=combine(await run(A,cap*wa,s,e),await run(B,cap*(1-wa),s,e),wa,reb); roll.push(stats(r,cap)); }
      const nm=`${A.sym}${Math.round(wa*100)}/${B.sym}${Math.round((1-wa)*100)}${reb?' 연리밸':''}`;
      console.log(`${nm.padEnd(24)} ${String(cap).padStart(6)} | 전체 ${f(row.full.cagr)}/${f(row.full.mdd)} | ${SYN?'03':'15'}~ ${f(row.s15.cagr)}/${f(row.s15.mdd)} | ${SYN?'10':'20'}~ ${f(row.s20.cagr)}/${f(row.s20.mdd)} | 5y롤링(${roll.length}) CAGR 중앙 ${f(q(roll.map(x=>x.cagr),.5))} 하위10% ${f(q(roll.map(x=>x.cagr),.1))} 최악 ${f(Math.min(...roll.map(x=>x.cagr)))} · MDD 중앙 ${f(q(roll.map(x=>x.mdd),.5))} 상위10% ${f(q(roll.map(x=>x.mdd),.9))} 최악 ${f(Math.max(...roll.map(x=>x.mdd)))}`);
    } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
