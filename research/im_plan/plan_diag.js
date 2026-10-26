// 5년 플랜 변형 진단 — 큰 낙폭 3개(고점→바닥 날짜) · 종목별 매매 횟수/년 · TQQQ 보유 중 평균·최대 비중
// 사용: node plan_diag.js '{"이름":{파라미터}, …}' [cap=10000] [from=2011-01-01]   (SYN=1 이면 합성 2000~ · 소수 주)
const {prep,sim}=require('./px'); const {mk}=require('./plan_rules');
const syn=process.env.SYN==='1'; const [R,G]=syn?['SYNTECL','SYNTQQQ']:['TECL','TQQQ']; const P=prep([R,G]);
const V=JSON.parse(process.argv[2]); const cap=+(process.argv[3]||10000), from=process.argv[4]||(syn?'2000-01-01':'2011-01-01');
const f=x=>x.toFixed(1);
function dds(eq){ const E=[]; let pk=eq[0][1], pd=eq[0][0], tr=pk, td=pd;
  for(const [d,v] of eq){ if(v>=pk){ if(pk>tr) E.push([pd,td,(pk-tr)/pk]); pk=v; pd=d; tr=v; td=d; } else if(v<tr){ tr=v; td=d; } }
  if(pk>tr) E.push([pd,td,(pk-tr)/pk]); return E.sort((a,b)=>b[2]-a[2]).slice(0,3); }
for(const [nm,p] of Object.entries(V)){ const o=Object.assign({cap,from},mk(P,R,G,p)); if(p.fee!=null) o.fee=p.fee; if(syn) o.frac=true;
  const W=[]; const t0=o.target; o.target=(k,cur,st)=>{ const t=t0(k,cur,st); W.push([cur[G],t[G]>0]); return t; }; o.cnt={};
  const r=sim(P,o), eq=r.eq, yrs=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/(365.25*864e5);
  const on=W.filter(x=>x[1]&&x[0]>0).map(x=>x[0]), avg=on.reduce((a,b)=>a+b,0)/Math.max(1,on.length);
  const n=s=>(o.cnt[s]||[]).length/yrs, nb=s=>(o.cnt[s]||[]).filter(x=>x[1]==='b').length/yrs;
  console.log(`${nm.padEnd(12)} 낙폭 ${dds(eq).map(([a,b,x])=>`${f(x*100)}(${a}→${b})`).join(' · ')} | 매매/년 ${R} ${f(n(R))} · ${G} ${f(n(G))}(매수 ${f(nb(G))}) | ${G} 보유 중 비중 평균 ${f(avg*100)}% 최대 ${f(Math.max(...on)*100)}% · 보유일 ${f(on.length/W.length*100)}%`); }
