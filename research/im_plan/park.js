// 남는 돈(대기 자산)을 단기국채 대신 SCHD 에 두면?(11-10 · 사용자 "듀얼이나 섀넌에서 sgov대신 schd사면 어떨까") — plan_rules park · 세후(해마다 22% · 공제 250만원) · 수수료 0.1%
// 듀얼가드 v1.0 기본(TECL 70% 역분산 + TQQQ 30% Guard) · 섀넌 USD(역분산 s0 55 · σ 40일 · 밴드 15%p) · 실제 + 합성 · 1만$·10만$ · 전체 · 5년 창(매달 시작) · 같은 창 짝 · 위기 낙폭
// SCHDX = SCHD 총수익 − 배당세 15.4%(2011-10 전은 VEIPX 대용 · mk_schdx.js). 사용: node mk_schdx.js && node park.js
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const f=x=>x.toFixed(1); function dd(eq,s,e){ let pk=0,x=0; for(const [d,v] of eq){ if(d>e) break; pk=Math.max(pk,v); if(d>=s) x=Math.max(x,(pk-v)/pk); } return x*100; }
const DUAL={gsb:1e9,fee:0.001}, SHAN={tw:1,gw:0,look:40,s0:.55,sb:.15,fee:0.001};
const CR=[['금융위기','2007-10-09','2009-03-31'],['2015','2015-06-01','2016-02-29'],['2018','2018-09-01','2018-12-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31'],['2025','2025-02-01','2025-04-30']];
const CS=[['닷컴','2000-03-10','2002-10-31'],['금융위기','2007-10-09','2009-03-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31']];
const RUNS=[
  ['듀얼가드 · 실제 2011~',['TECL','TQQQ','SCHDX','SPY'],'TECL','TQQQ',DUAL,'2011-01-01',2011,false,'SCHDX',CR],
  ['듀얼가드 · 합성 2000~',['SYNTECL','SYNTQQQ','SYNSCHDX','SPY'],'SYNTECL','SYNTQQQ',DUAL,'2000-01-01',2000,true,'SYNSCHDX',CS],
  ['섀넌 USD · 실제 2008~',['USD','QQQ','SCHDX','SPY'],'USD','QQQ',SHAN,'2008-01-01',2008,false,'SCHDX',CR],
  ['섀넌 USD · 합성 2000~',['SYNUSD','SYNQQQ','SYNSCHDX','SPY'],'SYNUSD','SYNQQQ',SHAN,'2000-01-01',2000,true,'SYNSCHDX',CS]];
const ONLY=process.env.ONLY;
for(const [lab,syms,R,G,BP,from,y0,isSyn,PK,W] of RUNS){ if(ONLY&&!lab.includes(ONLY)) continue;
  const P=prep(syms), last=P.dates[P.dates.length-1];
  const mkO=(p,cap,extra)=>{ const o=Object.assign({cap,fee:p.fee},mk(P,R,G,p),extra||{}); if(isSyn) o.frac=true; return o; };
  const wins=(p,cap)=>{ const o=mkO(p,cap), out=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last||s<from) continue; out.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,cap)); } return out; };
  for(const cap of [10000,100000]){
    const V=[['기준(단기국채)',BP],['SCHD 전부',Object.assign({},BP,{park:{sym:PK}})],['SCHD 절반',Object.assign({},BP,{park:{sym:PK,frac:.5}})],['(참고)SPY 전부',Object.assign({},BP,{park:{sym:'SPY'}})]];
    console.log(`\n■ ${lab} · ${cap/1e4}만$ (자료 ~${last})`); let B=null;
    for(const [nm,p] of V){ const cnt={},daily=[]; const r=sim(P,mkO(p,cap,{from,cnt,daily})), s=stats(r.eq,cap), ne=sim(P,mkO(p,cap,{from,endTax:false})).eq, w=wins(p,cap);
      const yrs=(Date.parse(r.eq[r.eq.length-1][0])-Date.parse(r.eq[0][0]))/(365.25*864e5), ps=p.park?p.park.sym:null;
      const pw=ps?daily.reduce((a,x)=>{ const tot=x.cash+Object.keys(x.q).reduce((t,z)=>t+x.q[z]*x.px[z],0); return a+x.q[ps]*x.px[ps]/tot; },0)/daily.length*100:0;
      const cw=daily.reduce((a,x)=>{ const tot=x.cash+Object.keys(x.q).reduce((t,z)=>t+x.q[z]*x.px[z],0); return a+x.cash/tot; },0)/daily.length*100;
      let pair=''; if(!B) B=w; else { const dc=w.map((x,i)=>x.cagr-B[i].cagr), dm=w.map((x,i)=>x.mdd-B[i].mdd), e=0.05;
        const both=dc.filter((x,i)=>x>=-e&&dm[i]<=e&&(x>e||dm[i]<-e)).length, worse=dc.filter((x,i)=>x<=e&&dm[i]>=-e&&(x<-e||dm[i]>e)).length;
        pair=` | 짝 ${both}:${worse}/${w.length} · 연 ↑${dc.filter(x=>x>e).length} ↓${dc.filter(x=>x<-e).length} 중앙 ${dc.length?f(q(dc,.5)):'-'} 하10 ${f(q(dc,.1))} · MDD ↓${dm.filter(x=>x<-e).length} ↑${dm.filter(x=>x>e).length} 중앙 ${f(q(dm,.5))} 상90 ${f(q(dm,.9))}`; }
      console.log(`  ${nm.padEnd(12)} 전체 ${f(s.cagr)}/${f(s.mdd)} ×${(s.fin/cap).toFixed(1)} · 5년 창 중앙 ${f(q(w.map(x=>x.cagr),.5))}/${f(q(w.map(x=>x.mdd),.5))} 하10 ${f(q(w.map(x=>x.cagr),.1))} 최악 연 ${f(Math.min(...w.map(x=>x.cagr)))} 최악MDD ${f(Math.max(...w.map(x=>x.mdd)))} · 위기 ${W.filter(([n,a])=>a>=r.eq[0][0]||n==='금융위기'&&r.eq[0][0]<'2008-06').map(([n,a,b])=>n+' '+dd(ne,a,b).toFixed(0)).join(' ')} · 평균 현금 ${f(cw)}%${ps?' · 대기자산 '+f(pw)+'% · 매매 '+f((cnt[ps]||[]).length/yrs)+'회/년':''}${pair}`); } } }
