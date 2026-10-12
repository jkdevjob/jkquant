// 단리 무매(원금 고정) + 사이클 이익을 5년 플랜으로 쓸어 담기 — 무매 계좌의 위험은 원금 크기로 묶인다
const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules'); const fs=require('fs');
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
function roll(eq,y0){ const ds=eq.map(x=>x[0]); const R=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>ds[ds.length-1]||s<ds[0]) continue; const sl=eq.filter(x=>x[0]>=s&&x[0]<e); R.push(stats(sl.map(([d,v])=>[d,v/sl[0][1]*10000]),10000)); } return R; }
const f=x=>x.toFixed(1);
for(const [lab,imf,P,R,G,y0] of [['실제','im_eq_s.json',prep(['TECL','TQQQ']),'TECL','TQQQ',2011],['합성','im_eq_s_syn.json',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ',2000]]){
  const IM=JSON.parse(fs.readFileSync(imf));
  for(const cap of [10000,100000]){
  const plEq=sim(P,Object.assign({cap:1e6,from:'1990-01-01'},mk(P,R,G,{}))).eq; const pl={}; plEq.forEach(([d,v])=>pl[d]=v);
  for(const k of ['simple','simpleTp']){ const rows=IM[k+'_'+cap].filter(r=>!String(r[0]).endsWith('~')&&pl[r[0]]>0);
    for(const [mode,ws] of [['T빌',0],['플랜100%',1],['플랜50%',0.5]]){
      let ps=0, prevS=0, prevD=null, out=[];
      for(const [d,eq,saved] of rows){ const dep=saved-prevS; if(prevD) ps*=pl[d]/pl[prevD]; ps+=dep*ws; prevS=saved; prevD=d; out.push([d,eq-saved*ws+ps]); }   // ws 몫만 플랜으로, 나머지는 엔진 안 T-빌(이자 없음 → 아래서 보정 안 함)
      const s=stats(out,cap), Rr=roll(out,y0);
      console.log(`${lab} ${String(cap/1e4).padStart(2)}만$ ${k.padEnd(8)} 이익→${mode.padEnd(6)} | ${out[0][0]}~ CAGR ${f(s.cagr)} MDD ${f(s.mdd)} MAR ${(s.cagr/s.mdd).toFixed(2)} | 5y롤링 CAGR 중앙 ${f(q(Rr.map(x=>x.cagr),.5))} 하위10% ${f(q(Rr.map(x=>x.cagr),.1))} 최악 ${f(Math.min(...Rr.map(x=>x.cagr)))} · MDD 중앙 ${f(q(Rr.map(x=>x.mdd),.5))} 최악 ${f(Math.max(...Rr.map(x=>x.mdd)))}`); } } } }
