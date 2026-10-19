// 단리 무매(원금 고정) + 사이클 이익을 비율대로 5년 플랜 / T-bill 로 — 실제 2011~ · 합성 2000~ · 1만$·10만$ · 5년 롤링(창마다 새로 시작)
// sweep.js 를 고쳐 다시 짰다: ① 무매와 플랜을 같은 날 새로 시작(예전엔 무매가 2010-03 부터 먼저 불어난 값을 원금으로 봐 CAGR 이 부풀었다)
//   ② 엔진은 savedYield 없이 돌리고, 쌓인 이익의 T-bill 이자는 T-bill 로 남긴 몫에만 밖에서 붙인다(예전엔 플랜으로 보낸 몫에도 이자가 이중으로 붙었다).
// 이익 = 엔진의 savedProfit 증가분(사이클 끝 원금 초과분 − 단리 세금 차감). 이익을 옮길 때 수수료 0.25%(편도).
// 사용: node sweep2.js [무매후보,…] [비율,…]
const {open}=require('./imh'); const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules'); const fs=require('fs');
const IMV={ sNo:{compound:false}, sTp:{compound:false,sig:{bearTP:10,bearMA:150}}, sAuto:{compound:false,autoTp:true}, cBase:{} };
const pick=(process.argv[2]||'sNo,sTp,sAuto').split(','); const WS=(process.argv[3]||'0,0.25,0.5,0.75,1').split(',').map(Number);
const FEE=0.0025; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }; const f=x=>x.toFixed(1);
const IRX={}; JSON.parse(fs.readFileSync(__dirname+'/data/IRX.json')).series.forEach(x=>IRX[x.date]=x.close);
function combine(rows,pl,ws){   // rows: [[d,eq,saved]] · pl: {d:NAV}
  const R=rows.filter(r=>pl[r[0]]>0); if(!R.length) return null; let ps=0, tb=0, prevS=R[0][2], prevD=null, irx=0; const out=[];
  for(const [d,eq,saved] of R){ if(IRX[d]!=null) irx=IRX[d];
    if(prevD){ ps*=pl[d]/pl[prevD]; const g=Math.max(1,Math.round((Date.parse(d)-Date.parse(prevD))/864e5)); tb*=1+Math.max(0,irx/100-0.0009)*(1-0.154)*g/365; }
    const dep=saved-prevS; if(dep>0){ ps+=dep*ws*(1-FEE); tb+=dep*(1-ws); } else if(dep<0){ const t=ps+tb; if(t>0){ ps+=dep*ps/t; tb+=dep*tb/t; } }   // 세금 등으로 줄면 두 몫에서 비례로 뺀다
    prevS=saved; prevD=d; out.push([d,(eq-saved)+ps+tb]); }
  return out; }
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL'}]);
  const runIM=(o)=>pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1],x[2]]); },o);
  for(const [lab,TK,P,R,G,from,y0] of [['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011],['합성','SYNSOXL',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000]]){
    const o0=mk(P,R,G,JSON.parse(process.env.PLAN||'{}'));   /* PLAN='{…}' 로 플랜 변형 */ const plOf=(s,e)=>{ const m={}; sim(P,Object.assign({cap:1e6,from:s,to:e},o0)).eq.forEach(([d,v])=>m[d]=v); return m; };
    const plFull=plOf(from); const d0=Object.keys(plFull).sort()[0], last=Object.keys(plFull).sort().pop();
    const starts=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(s<d0||e>last) continue; starts.push([s,e]); }
    const plW=starts.map(([s,e])=>plOf(s,e));
    for(const cap of [10000,100000]){ console.log(`\n■ ${lab} ${cap/1e4}만$ (${d0}~ · 플랜 단독 ${f(stats(Object.entries(plFull).sort().map(([d,v])=>[d,v]),1e6).cagr)}/${f(stats(Object.entries(plFull).sort().map(([d,v])=>[d,v]),1e6).mdd)})`);
      for(const k of pick){ const full=await runIM(Object.assign({cap,tkr:TK,from:d0},IMV[k])); const wins=[]; for(const [s,e] of starts) wins.push(await runIM(Object.assign({cap,tkr:TK,from:s,to:e},IMV[k])));
        for(const ws of (k==='cBase'?[0]:WS)){ const eq=combine(full,plFull,ws), st=stats(eq.map(([d,v])=>[d,v]),eq[0][1]);
          const roll=wins.map((w,i)=>{ const c=combine(w,plW[i],ws); return c&&c.length>20?stats(c,c[0][1]):null; }).filter(Boolean);
          console.log(`  ${k.padEnd(6)} 이익→플랜 ${String(Math.round(ws*100)).padStart(3)}% | ${f(st.cagr)}/${f(st.mdd)} MAR ${(st.cagr/st.mdd).toFixed(2)} | 5y롤링(${roll.length}) CAGR 중앙 ${f(q(roll.map(x=>x.cagr),.5))} 하위10% ${f(q(roll.map(x=>x.cagr),.1))} · MDD 중앙 ${f(q(roll.map(x=>x.mdd),.5))} 최악 ${f(Math.max(...roll.map(x=>x.mdd)))}`); } } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
