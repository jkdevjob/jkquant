// 합성 3배: 일 수익 = 3×기초 − (보수 0.95% + 2×T-bill)/252 · 장중 고저는 전일 종가 기준 3배 선형(레버리지 ETF 일중 가격과 같음)
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'data');
function synth(base,lev,fee,out,startPx=100){
  const j=JSON.parse(fs.readFileSync(path.join(D,base+'.json'))); const irx={}; JSON.parse(fs.readFileSync(path.join(D,'IRX.json'))).series.forEach(x=>irx[x.date]=x.close);
  const o=j.ohlc.filter(x=>x.close>0); let last=0, prevS=null, px=startPx; const rows=[];
  for(const x of o){ if(irx[x.date]!=null) last=irx[x.date];
    if(prevS==null){ prevS=x.close; rows.push({date:x.date,open:px,high:px,low:px,close:px}); continue; }
    const cost=(fee+(lev-1)*last/100)/252, f=v=>px*(1+lev*(v/prevS-1)-cost);
    const c=f(x.close), op=f(x.open||x.close), hi=f(x.high||x.close), lo=f(x.low||x.close);
    rows.push({date:x.date,open:Math.max(op,1e-6),high:Math.max(hi,op,c),low:Math.max(Math.min(lo,op,c),1e-6),close:Math.max(c,1e-6)}); px=Math.max(c,1e-6); prevS=x.close; }
  fs.writeFileSync(path.join(D,out+'.json'),JSON.stringify({symbol:out,src:'synthetic',series:rows.map(r=>({date:r.date,close:r.close})),ohlc:rows,ohlcTrade:rows,dividends:[],splits:[],raw:rows.map(r=>({date:r.date,close:r.close}))}));
  return rows; }
module.exports={synth};
if(require.main===module){
  const s=synth('SOX',3,0.0095,'SYNSOXL'); synth('XLK',3,0.0095+0.035,'SYNTECL'); synth('NDX',3,0.0095,'SYNTQQQ');   // TECL 은 실제와 맞추려 연 3.5%p 비용 추가(검증: 2010~ 실제 40.6 vs 합성 39.4)
  const real=JSON.parse(fs.readFileSync(path.join(D,'SOXL.json'))).series; const m={}; s.forEach(r=>m[r.date]=r.close);
  // 겹치는 구간 연복리 비교 (실제 SOXL 조정종가 = 총수익)
  for(const [a,b] of [['2010-03-11','2026-10-12'],['2010-03-11','2015-12-31'],['2016-01-04','2020-12-31'],['2021-01-04','2026-10-12']]){
    const ra=real.find(x=>x.date>=a), rb=[...real].reverse().find(x=>x.date<=b); const y=(Date.parse(rb.date)-Date.parse(ra.date))/(365.25*864e5);
    const cr=(Math.pow(rb.close/ra.close,1/y)-1)*100, cs=(Math.pow(m[rb.date]/m[ra.date],1/y)-1)*100; console.log(a,'~',b,'실제',cr.toFixed(1),'합성',cs.toFixed(1)); }
  const dd=(arr)=>{ let pk=0,md=0; arr.forEach(v=>{ if(v>pk)pk=v; else md=Math.max(md,(pk-v)/pk); }); return (md*100).toFixed(1); };
  console.log('합성 1994~ 최대낙폭',dd(s.map(r=>r.close)),' 2000-03→2002 저점 비율', (Math.min(...s.filter(r=>r.date>='2000-03-01'&&r.date<='2002-12-31').map(r=>r.close))/Math.max(...s.filter(r=>r.date>='2000-01-01'&&r.date<='2000-04-30').map(r=>r.close))).toFixed(4));
}
