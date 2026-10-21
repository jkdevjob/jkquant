// 5년 플랜 변형 비교 — 실제 2011~ · 합성 2000~ · 1만$·10만$ · 5년 롤링(창마다 새로 시작)
// 사용: node plan2.js '{"이름":{파라미터}, …}'   (gAsset:'QLD' 는 합성에서 SYNQLD 로 바꿔 읽는다)
const {prep,sim,stats,roll}=require('./px'); const {mk}=require('./plan_rules');
const real=prep(['TECL','TQQQ','QLD']), syn=prep(['SYNTECL','SYNTQQQ','SYNQLD']);
const V=JSON.parse(process.argv[2]); const f=x=>x.toFixed(1);
for(const [nm,p] of Object.entries(V)) for(const cap of [10000,100000]){
  const pS=Object.assign({},p); if(pS.gAsset) pS.gAsset='SYN'+pS.gAsset;
  const oR=Object.assign({cap},mk(real,'TECL','TQQQ',p)), oS=Object.assign({cap},mk(syn,'SYNTECL','SYNTQQQ',pS));
  if(p.fee!=null){ oR.fee=p.fee; oS.fee=p.fee; }   // 매매 수수료 민감도(기본 0.25%)
  if(process.env.FRAC!=='0') oS.frac=true;   // 합성은 소수 주(2000년 합성 TQQQ 1주 67,137$ 왜곡 없앰 · 10-21 고침) — FRAC=0 이면 옛 정수 주
  const a=stats(sim(real,Object.assign({from:'2011-01-01'},oR)).eq,cap), r=roll(real,oR,2011,2021);
  const b=stats(sim(syn,Object.assign({from:'2000-01-01'},oS)).eq,cap), rs=roll(syn,oS,2000,2021);
  console.log(`${nm.padEnd(10)} ${String(cap/1e4).padStart(2)}만$ | 실제 ${f(a.cagr)}/${f(a.mdd)} MAR ${(a.cagr/a.mdd).toFixed(2)} 롤링 중앙 ${f(r.cMed)}/${f(r.mMed)} 하10 ${f(r.cP10)} 최악MDD ${f(r.mMax)} | 합성 ${f(b.cagr)}/${f(b.mdd)} MAR ${(b.cagr/b.mdd).toFixed(2)} 롤링 중앙 ${f(rs.cMed)}/${f(rs.mMed)} 하10 ${f(rs.cP10)} 최악 ${f(rs.cMin)} 최악MDD ${f(rs.mMax)}`); }
