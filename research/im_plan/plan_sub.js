// 플랜 변형을 앞뒤 기간으로 나눠 본다 — 실제 2011~2018 · 2019~ · 합성 2000~2009 · 2010~ (각 구간 새로 시작) · 1만$·10만$
// 사용: node plan_sub.js '{"이름":{파라미터}, …}'
const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules');
const real=prep(['TECL','TQQQ']), syn=prep(['SYNTECL','SYNTQQQ']); const V=JSON.parse(process.argv[2]); const f=x=>x.toFixed(1);
for(const [nm,p] of Object.entries(V)) for(const cap of [10000,100000]){ const row=[];
  for(const [P,R,G,from,to,isSyn] of [[real,'TECL','TQQQ','2011-01-01','2018-12-31',0],[real,'TECL','TQQQ','2019-01-01',null,0],[syn,'SYNTECL','SYNTQQQ','2000-01-01','2009-12-31',1],[syn,'SYNTECL','SYNTQQQ','2010-01-01',null,1]]){
    const o=Object.assign({cap,from},to?{to}:{},mk(P,R,G,p)); if(p.fee!=null) o.fee=p.fee; if(isSyn) o.frac=true; const s=stats(sim(P,o).eq,cap); row.push(`${f(s.cagr)}/${f(s.mdd)}`); }
  console.log(`${nm.padEnd(10)} ${String(cap/1e4).padStart(2)}만$ | 실제 2011~18 ${row[0]} · 2019~ ${row[1]} | 합성 2000~09 ${row[2]} · 2010~ ${row[3]}`); }
