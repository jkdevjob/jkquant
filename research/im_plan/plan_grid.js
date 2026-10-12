const {prep,sim,stats,roll}=require('./px'); const {mk}=require('./plan_rules');
const real=prep(['TECL','TQQQ','GLD','TLT']), syn=prep(['SYNTECL','SYNTQQQ']);
const V=JSON.parse(process.argv[2]);
const f=x=>x.toFixed(1);
for(const [nm,p] of Object.entries(V)) for(const cap of [10000,100000]){
  const oR=Object.assign({cap},mk(real,'TECL','TQQQ',p)), oS=Object.assign({cap},mk(syn,'SYNTECL','SYNTQQQ',Object.assign({},p,{div:undefined})));
  const a=stats(sim(real,Object.assign({from:'2011-01-01'},oR)).eq,cap), r=roll(real,oR,2011,2021);
  const b=stats(sim(syn,Object.assign({from:'1999-01-01'},oS)).eq,cap), rs=roll(syn,oS,2000,2021);
  console.log(`${nm.padEnd(14)} ${String(cap/1e4).padStart(2)}만$ | 실제 2011~ ${f(a.cagr)}/${f(a.mdd)} 5y중앙 ${f(r.cMed)} 하10 ${f(r.cP10)} MDD중앙 ${f(r.mMed)} 최악 ${f(r.mMax)} | 합성 2000~ ${f(b.cagr)}/${f(b.mdd)} 5y중앙 ${f(rs.cMed)} 하10 ${f(rs.cP10)} 최악 ${f(rs.cMin)} MDD중앙 ${f(rs.mMed)} 최악 ${f(rs.mMax)}`); }
