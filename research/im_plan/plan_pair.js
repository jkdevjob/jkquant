// 두 플랜 변형을 같은 5년 창(매월 시작 · 창마다 새로 시작)에서 짝지어 비교 — 이긴 창 비율 · 차이 중앙값 · 매매 기록(언제 몇 번 걸렸나)
// 사용: node plan_pair.js '{"기준":{…},"후보":{…},…}'  — 첫 항목이 기준, 나머지를 하나씩 기준과 비교. 실제 2011~ · 합성 2000~(소수 주) · 1만$·10만$
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const real=prep(['TECL','TQQQ']), syn=prep(['SYNTECL','SYNTQQQ']); const V=Object.entries(JSON.parse(process.argv[2])); const f=x=>x.toFixed(1);
const mkO=(P,R,G,p,cap,isSyn)=>{ const o=Object.assign({cap},mk(P,R,G,p)); if(p.fee!=null) o.fee=p.fee; if(isSyn) o.frac=true; return o; };
function wins(P,o,y0){ const R=[], last=P.dates[P.dates.length-1]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; R.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,o.cap)); } return R; }
for(const [lab,P,R,G,y0,from,isSyn] of [['실제',real,'TECL','TQQQ',2011,'2011-01-01',false],['합성',syn,'SYNTECL','SYNTQQQ',2000,'2000-01-01',true]]) for(const cap of [10000,100000]){
  const [bn,bp]=V[0]; const ob=mkO(P,R,G,bp,cap,isSyn), wb=wins(P,ob,y0);
  for(const [nm,p] of V.slice(1)){ const o=mkO(P,R,G,p,cap,isSyn), w=wins(P,o,y0); const dc=w.map((x,i)=>x.cagr-wb[i].cagr), dm=w.map((x,i)=>x.mdd-wb[i].mdd);
    const both=w.filter((x,i)=>dc[i]>=-0.05&&dm[i]<=0.05&&(dc[i]>0.05||dm[i]<-0.05)).length, worse=w.filter((x,i)=>dc[i]<=0.05&&dm[i]>=-0.05&&(dc[i]<-0.05||dm[i]>0.05)).length, same=w.filter((x,i)=>Math.abs(dc[i])<=0.05&&Math.abs(dm[i])<=0.05).length;
    const c1=Object.assign({},o,{from,cnt:{}}), c0=Object.assign({},ob,{from,cnt:{}}); sim(P,c1); sim(P,c0);
    const ev=(c1.cnt[G]||[]).filter(x=>!(c0.cnt[G]||[]).some(y=>y[0]===x[0]&&y[1]===x[1])).map(x=>x[0]+x[1]);   // 기준엔 없던 TQQQ 매매
    console.log(`${lab} ${cap/1e4}만$ ${nm} vs ${bn} | 창 ${w.length} — 둘 다 나음 ${both} · 둘 다 나쁨 ${worse} · 같음 ${same} · CAGR 높은 창 ${dc.filter(x=>x>0.05).length} 낮은 창 ${dc.filter(x=>x<-0.05).length} · MDD 낮은 창 ${dm.filter(x=>x<-0.05).length} 높은 창 ${dm.filter(x=>x>0.05).length} | 차이 중앙 CAGR ${f(q(dc,.5))} 하10 ${f(q(dc,.1))} 상10 ${f(q(dc,.9))} · MDD ${f(q(dm,.5))} 하10 ${f(q(dm,.1))} 상10 ${f(q(dm,.9))} | 기준에 없던 ${G} 매매 ${ev.length}번${ev.length&&ev.length<=12?' ('+ev.join(' ')+')':''}`); } }
