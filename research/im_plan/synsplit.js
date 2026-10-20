// 합성 3배 자료에 '주식 병합·분할'을 넣는다 — 실제 ETF 처럼 거래 가격을 8~400$ 안에 둔다.
// 2000년 합성 TQQQ 1주가 67,137$ 라 정수 주로는 아예 못 사고(=폭락을 피한 것처럼 보임), 2009년 합성 SOXL 은 0.0004$ 라
// 센트 단위 지정가가 망가졌다(2026-10-21 combo50 점검). 일 수익률은 그대로이고 거래 단위만 바뀐다.
// 앱 엔진은 splits(분할 뒤 주수 ÷ 분할 전 주수)와 분할 보정 체결가(ohlcTrade)로 그날 실제 가격(tradeBar)을 되살린다.
// 사용: node synsplit.js  → data/SYNTQQQ_S.json · SYNTECL_S.json · SYNSOXL_S.json · SYNQLD_S.json
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'data');
function withSplits(name,lo=8,hi=400,start=100){
  const j=JSON.parse(fs.readFileSync(path.join(D,name+'.json'))); const rows=j.ohlcTrade;
  let u=start/rows[0].close; const ev=[]; const us=[];
  for(const r of rows){ let a=r.close*u;
    if(a<lo){ const f=Math.pow(10,Math.ceil(Math.log10(20/a))); u*=f; ev.push({date:r.date,ratio:1/f}); }        // 병합: 가격 ×f, 주수 ÷f
    else if(a>hi){ const f=Math.pow(10,Math.ceil(Math.log10(a/200))); u/=f; ev.push({date:r.date,ratio:f}); }    // 분할: 가격 ÷f, 주수 ×f
    us.push(u); }
  const uEnd=u, sc=x=>x*uEnd;   // 마지막 분할 뒤 단위 = 1 이 되도록 전체를 uEnd 로 맞춘다 (그날 가격 = 보정가 × 그 뒤 분할들의 곱)
  const ohlc=rows.map(r=>({date:r.date,open:sc(r.open),high:sc(r.high),low:sc(r.low),close:sc(r.close)}));
  const out={symbol:name+'_S',src:'synthetic',series:ohlc.map(r=>({date:r.date,close:r.close})),ohlc,ohlcTrade:ohlc,dividends:[],splits:ev,raw:ohlc.map(r=>({date:r.date,close:r.close}))};
  fs.writeFileSync(path.join(D,name+'_S.json'),JSON.stringify(out));
  // 점검: 그날 실제 가격 범위
  const act=rows.map((r,i)=>r.close*us[i]); return {name,splits:ev.length,min:Math.min(...act),max:Math.max(...act)}; }
if(require.main===module) for(const n of ['SYNTQQQ','SYNTECL','SYNSOXL','SYNQLD']) console.log(withSplits(n));
module.exports={withSplits};
