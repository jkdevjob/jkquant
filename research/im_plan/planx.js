// 플랜 변형 한 벌 시험(11-04 · offasset.js 를 일반화) — 기준(지금 앱 · 새 플랜 운영형) 위에 VARS 의 파라미터를 얹어 같은 잣대로 본다.
// 실제 2011~ · 합성 2000~(소수 주) · 1만$·10만$ · 전체 · 5년 롤링(매월 시작 · 창마다 새로 시작) 중앙 · 같은 창 짝(둘 다 나음:둘 다 나쁨) · 앞뒤 기간 · 위기 낙폭(끝날 세금 빼기 없는 곡선) · TECL 매매/년 · 해마다 차이
// 사용: VARS='{"이름":{파라미터},…}' BASES='cur,new' node planx.js
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const BASE={cur:{gsb:1e9,fee:0.001}, new:{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}};
const BASES=(process.env.BASES||'cur,new').split(','), VARS=JSON.parse(process.env.VARS||'{}');
const f=x=>x.toFixed(1);
function dd(eq,s,e){ let pk=0,x=0; for(const [d,v] of eq){ if(d>e) break; pk=Math.max(pk,v); if(d>=s) x=Math.max(x,(pk-v)/pk); } return x*100; }
for(const [lab,P,R,G,from,y0,subs,W] of [
  ['실제',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011,[['2011~18','2011-01-01','2018-12-31'],['2019~','2019-01-01',null]],[['2015','2015-06-01','2016-02-29'],['2018','2018-09-01','2018-12-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31'],['2024-25','2024-07-10','2025-04-30'],['2026-10','2026-10-01','2026-12-31']]],
  ['합성',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000,[['2000~09','2000-01-01','2009-12-31'],['2010~','2010-01-01',null]],[['닷컴','2000-03-10','2002-10-31'],['금융위기','2007-10-09','2009-03-31'],['2022','2021-12-27','2022-12-31']]]]){
  const isSyn=lab==='합성', last=P.dates[P.dates.length-1];
  const mkO=(p,cap,extra)=>{ const o=Object.assign({cap,fee:p.fee},mk(P,R,G,p),extra||{}); if(isSyn) o.frac=true; return o; };
  const wins=(p,cap)=>{ const o=mkO(p,cap), out=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; out.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,cap)); } return out; };
  for(const cap of [10000,100000]) for(const bk of BASES){
    const bp=BASE[bk]; const V=[['기준',bp]].concat(Object.entries(VARS).map(([n,p])=>[n,Object.assign({},bp,p)]));
    console.log(`\n■ ${lab} ${cap/1e4}만$ · ${bk==='cur'?'지금 앱 플랜':'새 플랜 운영형'} (${from.slice(0,4)}~)`);
    let B=null, BY=null;
    for(const [nm,p] of V){ const cnt={}; const r=sim(P,mkO(p,cap,{from,cnt})), s=stats(r.eq,cap), ne=sim(P,mkO(p,cap,{from,endTax:false})).eq, w=wins(p,cap);
      const sub=subs.map(([n,a,b])=>{ const t=stats(sim(P,mkO(p,cap,{from:a,to:b||undefined})).eq,cap); return `${n} ${f(t.cagr)}/${f(t.mdd)}`; }).join(' · ');
      const yr={}; r.eq.forEach(([d,v])=>{ const Y=d.slice(0,4); (yr[Y]=yr[Y]||{a:v}).b=v; }); const yret={}; let prev=null; for(const Y of Object.keys(yr).sort()){ const a=prev??yr[Y].a; yret[Y]=(yr[Y].b/a-1)*100; prev=yr[Y].b; }
      const yrs=(Date.parse(r.eq[r.eq.length-1][0])-Date.parse(r.eq[0][0]))/(365.25*864e5), tt=(cnt[R]||[]).length/yrs;
      let pair='';
      if(!B){ B=w; BY=yret; } else { const dc=w.map((x,i)=>x.cagr-B[i].cagr), dm=w.map((x,i)=>x.mdd-B[i].mdd), e=0.05;
        const both=dc.filter((x,i)=>x>=-e&&dm[i]<=e&&(x>e||dm[i]<-e)).length, worse=dc.filter((x,i)=>x<=e&&dm[i]>=-e&&(x<-e||dm[i]>e)).length;
        const bigY=Object.keys(yret).map(Y=>[Y,yret[Y]-BY[Y]]).filter(([,x])=>Math.abs(x)>=1.5).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6).map(([Y,x])=>`${Y} ${x>0?'+':''}${f(x)}`).join(' ');
        pair=` | 짝 ${both}:${worse}/${w.length} · CAGR ↑${dc.filter(x=>x>e).length} ↓${dc.filter(x=>x<-e).length} 중앙 ${f(q(dc,.5))} · MDD ↓${dm.filter(x=>x<-e).length} ↑${dm.filter(x=>x>e).length} 중앙 ${f(q(dm,.5))} | 해마다(±1.5%p) ${bigY||'없음'}`; }
      console.log(`  ${nm.padEnd(10)} 전체 ${f(s.cagr)}/${f(s.mdd)} · 롤링 중앙 ${f(q(w.map(x=>x.cagr),.5))}/${f(q(w.map(x=>x.mdd),.5))} 하10 ${f(q(w.map(x=>x.cagr),.1))} 최악MDD ${f(Math.max(...w.map(x=>x.mdd)))} · ${sub} · 위기 ${W.map(([n,a,b])=>n+' '+dd(ne,a,b).toFixed(0)).join(' ')} · TECL ${f(tt)}회/년${pair}`); } } }
