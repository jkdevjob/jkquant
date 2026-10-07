/* 부동산(클로드) 아파트 매매 전략 apt-1 값 시험 — node scripts/test_realestate_claude_apt.cjs
   합성 단지로 "이 상황이면 이 단지를 이 값에 사고판다"를 값으로 확인하고, 실제 자료가 있으면 룩어헤드·장부를 실제 자료로도 본다.
   변이 시험은 REC_APT 로 바꾼 엔진을 넣는다. */
'use strict';
const fs=require('fs'),path=require('path');
const E=require(path.join(__dirname,'..','realestate-claude-engine.js'));
const X=require(process.env.REC_APT||path.join(__dirname,'..','realestate-claude-apt.js'));
let pass=0,fail=0;
function ok(name,cond,detail){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(detail?' — '+detail:''));} }
const near=(a,b,eps)=>a!=null&&b!=null&&Math.abs(a-b)<=(eps||1e-9)*Math.max(1,Math.abs(a),Math.abs(b));
const clone=x=>JSON.parse(JSON.stringify(x));
const K=E.ymk;

/* ── 합성 자료 ── 2004-01 부터 n달 */
function series(rates,dep){ return {series:{macro:{baseRate:{start:'2002-01',v:rates},depositRate:{start:'2002-01',v:dep||rates.map(()=>3)}}}}; }
function flatRates(n,v){ return Array.from({length:n},()=>v); }
function path_(n,f){ return Array.from({length:n},(_,i)=>Math.round(f(i))); }
function aptDoc(list){
  const doc={universe:[],sise:{},real:{}};
  for(const c of list){
    doc.universe.push({id:c.id,name:c.name,gu:c.gu,dong:c.dong||'동',built:c.built||'2000.01',units:c.units,excl:84.9,lat:c.lat||36.35,lng:c.lng||127.38});
    doc.sise[c.id]={start:c.start||'2004-01',mid:c.mid,low:c.mid.map(x=>x==null?null:Math.round(x*0.9)),high:c.mid.map(x=>x==null?null:Math.round(x*1.1)),jeonse:c.mid.map(x=>x==null?null:Math.round(x*0.6))};
    if(c.real) doc.real[c.id]=c.real;
  }
  return doc;
}
const N=120;               // 2004-01 ~ 2013-12
const R0=flatRates(24+N,3);  // 2002-01 ~ 2013-12 금리 3% 고정
// A: 2005-01 부터 월 1% 상승 → 2009-01 부터 월 1% 하락
const midA=path_(N,i=>30000*(i<12?1:Math.pow(1.01,Math.min(i,60)-12))*Math.pow(0.99,Math.max(0,i-60)));
// B: 월 0.4% 꾸준히(6개월 +2.4% → 3% 미만이라 1위여도 사지 않음)
const midB=path_(N,i=>28000*Math.pow(1.004,i));
// S: 작은 단지(800세대) — 월 3% 폭등이지만 대단지가 아니라 후보 밖
const midS=path_(N,i=>20000*Math.pow(1.03,i));
const BASE=[{id:1,name:'에이',gu:'서구',units:1500,mid:midA},{id:2,name:'비',gu:'유성구',units:1200,mid:midB},{id:3,name:'작은',gu:'중구',units:800,mid:midS}];
const EVD={events:[{date:'2005-03-02',region:'대전·세종',type:'호재',title:'행복도시법',src:'s1'},{date:'2005-08-10',region:'세종',type:'호재',title:'세종만',src:'s2'},{date:'2005-09-05',region:'대전',type:'악재',title:'같은 달',src:'s3'}]};
function prep(list,rates){ return X.prepareApt(aptDoc(list),E.prepare(series(rates||R0)),EVD); }

console.log('[부동산 클로드 아파트 전략] 후보 · 시장');
{
  const A=prep(BASE),o=X.DEFAULTS,k=K('2005-09');
  const C=X.candidatesAt(A,k,o);
  ok('후보: 1,000세대 미만(폭등하는 작은 단지)은 뺀다', C.length===2&&C.every(c=>c.id!==3), JSON.stringify(C.map(c=>c.id)));
  ok('후보 6개월 상승률은 k-1월 ÷ k-7월 (k월 값은 안 봄)', near(C[0].mom,midA[K('2005-08')-K('2004-01')]/midA[K('2005-02')-K('2004-01')]-1), C[0].mom);
  ok('후보는 상승률 순(같으면 세대수 큰 쪽)', C[0].id===1&&C[1].id===2);
  const m=X.marketAt(A,k,o);
  ok('금리 변화는 k-1월 − k-13월', m.rate===3&&m.rate0===3&&m.rateUp===0);
}

console.log('[부동산 클로드 아파트 전략] 매수');
{
  const A=prep(BASE),o=X.DEFAULTS,S=X.simulate(A);
  const t=S.trades[0],bk=K(t.buy.m),i=bk-K('2004-01');
  // A 는 2005-01 부터 월 1% → 2005-05 결정 때 처음으로 4월÷작년 10월 = 1.01³ = +3.03% ≥ 3%
  ok('첫 매수: 상승률 1위가 +3%를 처음 넘는 달(2005-05)에 그 단지를 산다', t.id===1&&t.buy.m==='2005-05', t.id+' '+t.buy.m);
  ok('체결은 그 달 KB 일반거래가', t.buy.price===midA[i], t.buy.price+' vs '+midA[i]);
  ok('매수 비용: 취득세(6억 이하 1.1%)·중개(0.44%) 기록', t.buy.costs.acq===Math.round(midA[i]*0.011)&&t.buy.costs.broker===Math.round(midA[i]*0.0044)&&t.buy.total===midA[i]+t.buy.costs.acq+t.buy.costs.broker);
  ok('매수 근거: 6개월 상승률·순위·금리 기록', near(t.buy.mom,midA[i-1]/midA[i-7]-1)&&t.buy.rank===1&&t.buy.of===2&&t.buy.rate===3&&t.buy.rateUp===0);
  ok('그때 뉴스: 결정 직전 6개월(같은 달 제외) · 그 지역+전국+대전·세종만', t.buy.news.map(n=>n.title).join()==='행복도시법', JSON.stringify(t.buy.news));
  const B=prep([BASE[1]]),SB=X.simulate(B);
  ok('1위라도 6개월 +3% 미만이면 사지 않는다(계속 예금)', SB.trades.length===0&&SB.months.every(m=>m.action==='wait'));
  ok('예금은 세후(이자소득세 15.4%) 이자로 매달 불어난다', near(SB.final,30000*Math.pow(1+0.03*(1-0.154)/12,SB.months.length),1e-9), SB.final);
}
{
  const up=R0.map((v,i)=>i>=K('2004-12')-K('2002-01')?3.25:3);   // 2004-12 부터 3.25%
  const A=prep(BASE,up),S=X.simulate(A);
  ok('금리가 1년 전보다 높으면(2005-01~2005-12 결정) 사지 않는다', S.trades[0].buy.m==='2006-01', S.trades[0].buy.m);
  const w=S.months.find(m=>m.k===K('2005-09'));
  ok('기다린 이유 기록(rateUp)', w.action==='wait'&&w.why.indexOf('rateUp')>=0, JSON.stringify(w.why));
}

{
  const A=prep(BASE),k=K('2005-09');
  const nd=X.newsFor(A,k,'대전',6).map(n=>n.title),ns=X.newsFor(A,k,'세종',6).map(n=>n.title);
  ok('그때 뉴스: 결정 직전 k-6~k-1월만(결정 달 사건 제외) · 대전 단지엔 세종만 사건을 붙이지 않는다', nd.join()==='행복도시법', JSON.stringify(nd));
  ok('그때 뉴스: 세종 단지엔 세종·대전세종 사건(최근 것 먼저)', ns.join()==='세종만,행복도시법', JSON.stringify(ns));
}

console.log('[부동산 클로드 아파트 전략] 매도 · 갈아타기 · 세금');
{
  const A=prep(BASE),S=X.simulate(A),t=S.trades[0];
  // 고점 2009-01 뒤 월 1% 하락 → 0.99³×1.01³ < 1 이 되는 2009-04 시세를 보는 2009-05 결정에서 처음 음수
  ok('2년이 지난 뒤 6개월 상승률이 처음 음수가 된 달(2009-05)에 판다', t.sell&&t.sell.m==='2009-05', t.sell&&t.sell.m);
  const i=K(t.sell.m)-K('2004-01');
  ok('매도 체결은 그 달 KB 시세, 사유 mom', t.sell.price===midA[i]&&t.sell.why.join()==='mom'&&t.sell.mom<0);
  const hold=t.sell.costs.hold,net=t.sell.price-t.sell.costs.broker-t.sell.costs.tax-hold;
  ok('순수익 = 매도가 − 중개 − 양도세 − 보유세, 수익률 = 순수익 ÷ 매수 총액 − 1', near(t.result.net,(t.sell.price-t.sell.costs.broker-t.sell.costs.tax-t.sell.costs.hold)/t.buy.total-1,1e-4)&&Math.abs(t.sell.net-net)<=1);
  ok('1주택 2년 보유·6억 이하라 양도세 0', t.sell.costs.tax===0);
  const hc=(()=>{ let h=0; for(let k=K(t.buy.m)+1;k<K(t.sell.m);k++) h+=midA[k-K('2004-01')]*0.0015/12; return h; })();
  ok('보유세 연 0.15%를 보유 달마다(매수 다음 달 ~ 매도 전달) 쌓아 기록', t.sell.costs.hold>0&&Math.abs(t.sell.costs.hold-hc)<=1, t.sell.costs.hold+' vs '+hc);
  ok('자산은 거래 수익률대로 이어진다(매수 시점 자산 × (1+수익률))', near(t.result.eqOut,t.result.eqIn*(1+t.result.net),1e-9));
}
{
  // 금리 급등: 2007-01 부터 3.75% → 2007-02 결정부터 1년 새 +0.75%p (2005-05 매수, 보유 21개월 — 아직 못 팖) → 24개월 채운 2007-05 에 판다
  const up=R0.map((v,i)=>i>=K('2007-01')-K('2002-01')?3.75:3);
  const S=X.simulate(prep(BASE,up)),t=S.trades[0];
  ok('금리가 1년 새 +0.5%p 이상이면 2년 채운 달(2007-05)에 판다(가격이 올라도)', t.sell&&t.sell.m==='2007-05'&&t.sell.held===24&&t.sell.why.join()==='rate'&&t.sell.mom>0, t.sell&&(t.sell.m+' '+t.sell.why));
}
{
  // 갈아타기: A 가 꺾일 때 C2 가 강하게 오르면 같은 달 바로 산다
  const midC=path_(N,i=>15000*Math.pow(1.012,Math.max(0,i-50)));
  const S=X.simulate(prep(BASE.concat([{id:4,name:'씨',gu:'동구',units:2000,mid:midC}])));
  const sw=S.months.find(m=>m.k===K(S.trades[0].sell.m));
  ok('판 달에 매수 조건이 맞는 다른 단지가 있으면 바로 갈아탄다', sw.action==='switch'&&S.trades[1]&&S.trades[1].buy.m===S.trades[0].sell.m&&S.trades[1].id===4, sw.action+' '+(S.trades[1]&&S.trades[1].buy.m));
}
{
  ok('취득세: 6억 1.1% · 7.5억 2.2% · 10억 3.3%', near(X.acqRate(60000),0.011)&&near(X.acqRate(75000),0.022)&&near(X.acqRate(100000),0.033));
  ok('중개보수: 3억 0.44% · 10억 0.55% · 1.5억 0.55%', near(X.brokerRate(30000),0.0044)&&near(X.brokerRate(100000),0.0055)&&near(X.brokerRate(15000),0.0055));
  ok('1주택 비과세 기준: 2008-09 6억 · 2008-10 9억 · 2021-12 12억', X.exemptLimit(K('2008-09'))===60000&&X.exemptLimit(K('2008-10'))===90000&&X.exemptLimit(K('2021-12'))===120000);
  ok('양도세: 기준 이하 0 · 기준 넘으면 넘은 비율만 과세', X.gainTax(50000,80000,300,30,K('2015-01'))===0&&X.gainTax(80000,130000,600,30,K('2023-01'))>0);
  // 13억 매도·12억 기준: 차익 49,400 × 1억/13억 = 3,800 → 3년 장특공 24% → 2,888 − 기본공제 250 = 2,638 × 38.5% = 1,016
  ok('양도세 값: 12억 넘는 부분만 · 3년 보유 장기보유특별공제 24% · 기본공제 · 38.5%', X.gainTax(80000,130000,600,36,K('2023-01'))===1016, X.gainTax(80000,130000,600,36,K('2023-01')));
  ok('양도세: 2년 미만은 단기 세율(이 전략은 안 씀)', X.gainTax(50000,60000,300,13,K('2015-01'))===Math.round((60000-300-50000)*0.66));
}

console.log('[부동산 클로드 아파트 전략] 룩어헤드 금지');
function lookahead(list,rates,month,tag){
  const A1=prep(list,rates),S1=X.simulate(A1),M=K(month);
  const bump=v=>v==null?null:Math.round(v*1.5);
  const L2=list.map(c=>Object.assign({},c,{mid:c.mid.map((v,i)=>K(c.start||'2004-01')+i>M?bump(v):v)}));
  const R2=rates.map((v,i)=>K('2002-01')+i>M?v+2:v);
  const S2=X.simulate(prep(L2,R2));
  const upTo=(S)=>JSON.stringify(S.months.filter(m=>m.k<=M).map(m=>[m.k,m.action,m.opened&&m.opened.id,m.opened&&m.opened.buy.price,m.closed&&m.closed.sell.price,Math.round(m.eq)]));
  ok(tag+': '+month+' 뒤 시세·금리를 바꿔도 그달까지 결정·체결·자산은 같다', upTo(S1)===upTo(S2));
}
lookahead(BASE,R0,'2006-06','합성');
lookahead(BASE,R0,'2008-12','합성');

console.log('[부동산 클로드 아파트 전략] 사건 · 주변 · 지금');
{
  const A=prep(BASE);
  const ev=X.eventStudy(A).find(e=>e.title==='행복도시법');
  const k=K('2005-03'),avg=h=>{ const a=midA[k-1-K('2004-01')],b=midA[k-1+h-K('2004-01')],c=midB[k-1-K('2004-01')],d=midB[k-1+h-K('2004-01')]; return ((b/a-1)+(d/c-1))/2; };
  ok('사건 뒤 6·12개월: 사건 직전 달 대비 대전 대단지 평균(작은 단지 제외)', near(ev.res['대전'][6].avg,avg(6))&&near(ev.res['대전'][12].avg,avg(12))&&ev.res['대전'][6].n===2, JSON.stringify(ev.res['대전']));
  ok('세종 대단지가 없으면 세종 칸은 비어 있다', ev.res['세종'][6]===null);
  const re=X.rateEvents(E.prepare(series(R0.map((v,i)=>i>=30?3.5:3))));
  ok('기준금리 변경을 사건으로 자동 추가(달·방향·값)', re.length===1&&re[0].date===E.kym(K('2002-01')+30)&&re[0].type==='금리인상'&&/3% → 3.5%/.test(re[0].title), JSON.stringify(re));
  const L=[{id:11,name:'가까운신축',gu:'서구',units:1200,mid:midB,built:'2010.01',lat:36.351,lng:127.381},{id:12,name:'가까운구축',gu:'서구',units:1200,mid:midB,built:'1995.01',lat:36.3505,lng:127.3805},{id:13,name:'먼곳',gu:'서구',units:1200,mid:midB,built:'2012.01',lat:36.5,lng:127.5}];
  const nb=X.nearby(prep(L),36.35,127.38);
  ok('주변 대단지: 3km 안만 · 10년 안 신축 먼저', nb.length===2&&nb[0].id===11&&nb[1].id===12&&nb[0].isNew&&!nb[1].isNew, JSON.stringify(nb.map(x=>[x.id,x.km,x.isNew])));
  const nv=X.nowView(prep([BASE[1]]),X.DEFAULTS,null);
  ok('지금: 다음 달 판단(현금·상승률 부족이면 weak)', nv.forMonth==='2014-01'&&nv.dataMonth==='2013-12'&&nv.action==='wait'&&nv.why.indexOf('weak')>=0, JSON.stringify([nv.forMonth,nv.action,nv.why]));
}

console.log('[부동산 클로드 아파트 전략] 모의장부 — 덧붙이기만 · 백테와 같은 함수');
{
  const cut=K('2006-06'),short=BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+1)}));
  const A0=prep(short),L0=X.paperUpdate(null,A0,{},'t0').ledger;
  ok('만든 날엔 지난 달 기록 없이 그 달 자료까지만', L0.months.length===0&&L0.startedData==='2006-06'&&L0.acct.eq===30000);
  const A1=prep(BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+7)}))),r1=X.paperUpdate(L0,A1,{},'t1');
  ok('새 달 6개가 생기면 6줄 덧붙인다', r1.added===6&&r1.ledger.months.length===6&&r1.ledger.months[0].m==='2006-07');
  const st={eq:30000,pos:null},want=[]; for(let k=cut+1;k<=cut+6;k++){ const r=X.stepMonth(A1,st,k,X.DEFAULTS); want.push([r.action,Math.round(r.eq*100)/100]); }
  ok('장부 한 줄 = 같은 stepMonth 결과', JSON.stringify(r1.ledger.months.map(m=>[m.action,m.eq]))===JSON.stringify(want));
  const r2=X.paperUpdate(r1.ledger,A1,{},'t2');
  ok('같은 자료로 다시 돌리면 덧붙일 게 없다(지난 기록 그대로)', r2.added===0&&JSON.stringify(r2.ledger.months)===JSON.stringify(r1.ledger.months));
  let threw=false; try{ X.paperUpdate(Object.assign({},r1.ledger,{strategyVersion:'apt-0'}),A1,{},'t'); }catch(e){ threw=true; }
  ok('전략 버전이 다른 장부는 건드리지 않는다', threw);
}

/* ── 실제 자료 ── */
const DIR=path.join(__dirname,'..','data','realestate','claude');
if(fs.existsSync(path.join(DIR,'apt.json'))){
  console.log('[부동산 클로드 아파트 전략] 실제 자료');
  const read=f=>JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  const doc=read('series.json'),apt=read('apt.json'),evd=read('events.json'),D=E.prepare(doc),A=X.prepareApt(apt,D,evd);
  ok('실제 자료: 대단지 30곳 이상 · 대전과 세종 모두', A.U.length>=30&&A.U.some(u=>u.city==='세종')&&A.U.some(u=>u.city==='대전'), A.U.length);
  ok('연표: 날짜·지역·종류·제목·출처가 모두 있다', evd.events.every(e=>/^\d{4}-\d{2}(-\d{2})?$/.test(e.date)&&e.region&&e.type&&e.title&&/^https:\/\//.test(e.src)));
  const S=X.simulate(A),tr=S.trades;
  ok('실제: 거래가 있고 겹치지 않는다(앞 거래를 판 달 이후에 다음 매수)', tr.length>0&&tr.every((t,i)=>i===0||K(t.buy.m)>=K(tr[i-1].sell.m)));
  ok('실제: 끝난 거래는 모두 24개월 이상 보유', tr.filter(t=>!t.open).every(t=>t.sell.held>=24));
  ok('실제: 매수·매도가는 그 달 그 단지 KB 시세 그대로', tr.every(t=>t.buy.price===X.price(A,t.id,K(t.buy.m))&&(!t.sell||t.sell.price===X.price(A,t.id,K(t.sell.m)))));
  ok('실제: 매수 근거(금리 1년 전보다 높지 않음·1위 +3% 이상)가 모든 매수에 맞다', tr.every(t=>t.buy.rateUp<=0&&t.buy.mom>=0.03&&t.buy.rank===1));
  lookahead2(A,'2012-06');
  lookahead2(A,E.kym(A.lastK-20));
  const nv=X.nowView(A,X.DEFAULTS,null);
  ok('실제: 지금 판단은 마지막 시세 다음 달', nv.forMonth===E.kym(A.lastK+1)&&nv.top.length>0);
}
function lookahead2(A,month){
  const M=K(month),S1=X.simulate(A);
  const B=Object.assign({},A,{P:{}});
  for(const id in A.P){ const s=A.P[id]; B.P[id]={k0:s.k0,v:s.v.map((v,i)=>s.k0+i>M&&v!=null?Math.round(v*(1.3+0.2*Math.sin(i))):v)}; }
  const S2=X.simulate(B);
  const upTo=S=>JSON.stringify(S.months.filter(m=>m.k<=M).map(m=>[m.k,m.action,m.opened&&m.opened.id,Math.round(m.eq)]));
  ok('실제: '+month+' 뒤 시세를 바꿔도 그달까지 결정은 같다', upTo(S1)===upTo(S2));
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
