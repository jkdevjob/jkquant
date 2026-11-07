/* 부동산(클로드) 아파트 매매 전략 apt-1 · apt-lead-1(대장) · -gap(전세 끼고, 실험적) 값 시험 — node scripts/test_realestate_claude_apt.cjs
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
    doc.sise[c.id]={start:c.start||'2004-01',mid:c.mid,low:c.mid.map(x=>x==null?null:Math.round(x*0.9)),high:c.mid.map(x=>x==null?null:Math.round(x*1.1)),jeonse:c.jeonse||c.mid.map(x=>x==null?null:Math.round(x*0.6))};
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

console.log('[부동산 클로드 아파트 전략] 대장 아파트(apt-lead-1)');
// J: 세종 대단지 1곳 — 2004-11 까지 1.5억, 2004-12 부터 월 1.5% 상승(24개월) → 2005-02 결정에서 6개월 +3.02%
const midJ=path_(N,i=>15000*Math.pow(1.015,Math.min(Math.max(i-10,0),24)));
// F: 대전 싼 대단지 — 3년간 월 2% 급등(6개월 +12.6%)이지만 시세 1위가 아니라 대장이 아니다
const midF=path_(N,i=>10000*Math.pow(1.02,Math.min(i,36)));
const LEAD=BASE.concat([{id:5,name:'세종하나',gu:'세종시',units:1100,mid:midJ},{id:6,name:'급등',gu:'동구',units:2000,mid:midF}]);
const LO=X.opts({strategy:'apt-lead-1'});
const ix=m=>K(m)-K('2004-01');
{
  const A=prep(LEAD);
  // 독립 계산: 도시마다 전달 시세가 가장 비싼 1,000세대 이상 단지
  const want=(k)=>{ const out={}; for(const c of LEAD){ if(c.units<1000) continue; const city=c.gu==='세종시'?'세종':'대전',p=c.mid[k-1-K('2004-01')]; if(p==null) continue; if(!out[city]||p>out[city].p||(p===out[city].p&&c.units>out[city].u)) out[city]={id:c.id,p,u:c.units}; } return out; };
  let same=true,seen=0;
  for(let k=K('2004-02');k<=K('2013-12');k++){ const L=X.leadersAt(A,k,LO),w=want(k); seen++;
    if(L.length!==2||L[0].city!=='대전'||L[1].city!=='세종'||L[0].id!==w['대전'].id||L[1].id!==w['세종'].id||L[0].price!==w['대전'].p) { same=false; break; } }
  ok('대장: 매달 도시마다 전달 84㎡ 시세가 가장 비싼 대단지(대전·세종 순) — 독립 계산과 '+seen+'달 모두 같다', same);
  const k=K('2006-01');
  ok('대장: 1,000세대 미만은 시세가 더 비싸도 대장이 아니다', midS[ix('2005-12')]>midA[ix('2005-12')]&&X.leadersAt(A,k,LO)[0].id===1, midS[ix('2005-12')]+' vs '+midA[ix('2005-12')]);
  const L1=X.leadersAt(A,K('2005-02'),LO);
  ok('대장 기록: 그 도시 대단지 수 · 2위 단지와 값', L1[0].n===3&&L1[0].next&&L1[0].next.id===2&&L1[0].next.price===midB[ix('2005-01')]&&L1[1].n===1&&L1[1].next===null, JSON.stringify(L1));
  const kk=K('2010-10'),bump=LEAD.map(c=>c.id===2?Object.assign({},c,{mid:c.mid.map((v,i)=>i===kk-K('2004-01')?v*3:v)}):c);
  ok('대장은 k월 시세를 보지 않는다(k월 값을 바꿔도 k월 대장은 같고, k+1월에 바뀐다)', X.leadersAt(prep(bump),kk,LO)[0].id===X.leadersAt(A,kk,LO)[0].id&&X.leadersAt(prep(bump),kk+1,LO)[0].id===2&&X.leadersAt(A,kk+1,LO)[0].id===1);
  const tie=prep([{id:7,name:'작은값',gu:'세종시',units:1100,mid:midB},{id:8,name:'큰값',gu:'세종시',units:1500,mid:midB}]);
  ok('대장: 시세가 같으면 세대수 많은 단지', X.leadersAt(tie,K('2005-01'),LO)[0].id===8);
  const C=X.candidatesAt(A,K('2005-02'),LO);
  ok('대장 후보: 대장만(급등하는 싼 대단지 제외) · 6개월 상승률 순', C.length===2&&C[0].id===5&&C[1].id===1&&C.every(c=>c.lead&&c.id!==6), JSON.stringify(C.map(c=>[c.id,c.mom])));
  const C1=X.candidatesAt(A,K('2005-02'),X.DEFAULTS);
  ok('apt-1 후보(같은 달)는 대단지 전부 — 급등 단지가 1위', C1[0].id===6&&C1.length===4&&!C1.some(c=>c.lead), JSON.stringify(C1.map(c=>c.id)));
}
{
  const A=prep(LEAD),S=X.simulate(A,{strategy:'apt-lead-1'}),S1=X.simulate(A);
  const t=S.trades[0],b=t.buy;
  ok('apt-1 은 급등하는 싼 대단지를 첫 달(2004-08)에 산다', S1.trades[0].id===6&&S1.trades[0].buy.m==='2004-08', S1.trades[0].id+' '+S1.trades[0].buy.m);
  ok('apt-lead-1 은 대장 중 6개월 +3%를 처음 넘는 달(2005-02)에 그 대장(세종하나)을 산다', t.id===5&&b.m==='2005-02'&&b.price===midJ[ix('2005-02')], t.id+' '+b.m);
  ok('대장 매수 기록: 도시 · 전달 시세 · 대단지 수 · 2위 없음 · 대장 2곳 중 1위 · 다른 대장', b.lead&&b.lead.city==='세종'&&b.lead.last===midJ[ix('2005-01')]&&b.lead.n===1&&b.lead.next===null&&b.rank===1&&b.of===2&&b.runners.length===1&&b.runners[0].id===1&&b.runners[0].mom===0, JSON.stringify(b.lead)+' '+JSON.stringify(b.runners));
  ok('대장 매수도 같은 체결·비용(취득세·중개) · 결정 직전 6개월 뉴스(이 창엔 없음)', b.costs.acq===Math.round(b.price*0.011)&&b.total===b.price+b.costs.acq+b.costs.broker&&b.news.length===0);
  ok('apt-lead-1 은 대장이 아닌 단지를 한 번도 사지 않는다', S.trades.every(x=>X.leadersAt(A,K(x.buy.m),LO).some(l=>l.id===x.id)), JSON.stringify(S.trades.map(x=>[x.id,x.buy.m])));
  ok('apt-1 매수 기록엔 대장 칸이 없다(전략 기록이 섞이지 않음)', S1.trades.every(x=>!('lead' in x.buy)));
  ok('전략 이름이 후보 방식을 정한다: apt-1 에 pick 을 넘겨도 대장으로 바뀌지 않는다', X.opts({strategy:'apt-1',pick:'leader'}).pick==='mom'&&JSON.stringify(X.simulate(A,{pick:'leader'}).trades)===JSON.stringify(S1.trades)&&S.opts.pick==='leader'&&S.opts.strategy==='apt-lead-1');
  let threw=false; try{ X.opts({strategy:'apt-9'}); }catch(e){ threw=/모르는 전략/.test(e.message); }
  ok('모르는 전략 이름은 멈춘다', threw);
  // 비교 기준 — 대장 계속 보유: 그달 대장(전달 시세 1위) 두 곳 평균 월수익 − 보유세/12 (독립 계산)
  const B=X.benchmarks(A,S),k0=K(S.start),k1=K(S.end);
  let v=30000,ok2=true;
  for(let k=k0;k<=k1;k++){ let s2=0,n=0;
    for(const city of ['대전','세종']){ let best=null; for(const c of LEAD){ if(c.units<1000||(c.gu==='세종시'?'세종':'대전')!==city) continue; const p=c.mid[k-1-K('2004-01')]; if(best==null||p>best.p) best={c,p}; }
      s2+=best.c.mid[k-K('2004-01')]/best.p-1; n++; }
    v*=1+s2/n-0.0015/12; if(!near(B.lead.curve[k-k0],v,1e-9)) ok2=false; }
  ok('비교 기준(대장 계속 보유) 값: 전달 시세 1위 두 곳의 그달 수익 평균 − 보유세', ok2&&near(B.lead.final,v,1e-9)&&B.lead.curve.length===S.curve.length, B.lead.final+' vs '+v);
  ok('비교 기준 곡선은 전략 곡선과 같은 달 수(화면이 다시 세지 않는다)', B.hold.curve.length===S.curve.length&&B.deposit.curve.length===S.curve.length&&near(B.hold.curve[B.hold.curve.length-1],B.hold.final)&&B.deposit.mdd===0);
  const lc=X.leaderChanges(A,{strategy:'apt-lead-1'});
  const want=[]; { const prev={}; for(let k=K('2004-02');k<=A.lastK+1;k++) for(const l of X.leadersAt(A,k,LO)) if(prev[l.city]!==l.id){ want.push([E.kym(k-1),l.city,l.id]); prev[l.city]=l.id; } }
  ok('대장이 바뀐 때: 시세 달 기준(첫 줄 2004-01 대전 에이 · 세종하나) · 대전 에이 → 비 한 번', lc.length===want.length&&lc.every((x,i)=>x.m===want[i][0]&&x.city===want[i][1]&&x.id===want[i][2])&&lc[0].m==='2004-01'&&lc[0].id===1&&lc[1].id===5&&lc.filter(x=>x.city==='대전').map(x=>x.id).join()==='1,2', JSON.stringify(lc.map(x=>[x.m,x.city,x.id])));
  const nv=X.nowView(A,{strategy:'apt-lead-1'},null);
  ok('지금(대장): 다음 달 대장 두 곳 · 6개월 상승률 · 2위 · 후보도 대장만', nv.strategy==='apt-lead-1'&&nv.leaders.length===2&&nv.leaders[0].id===2&&nv.leaders[1].id===5&&nv.leaders[0].next.id===1&&near(nv.leaders[0].mom,midB[N-1]/midB[N-7]-1)&&nv.top.every(x=>x.id===2||x.id===5), JSON.stringify(nv.leaders.map(l=>[l.id,l.mom])));
}
lookaheadLead(LEAD,R0,'2005-06');
lookaheadLead(LEAD,R0,'2009-12');
function lookaheadLead(list,rates,month){
  const M=K(month),bump=v=>v==null?null:Math.round(v*1.5);
  const L2=list.map(c=>Object.assign({},c,{mid:c.mid.map((v,i)=>K(c.start||'2004-01')+i>M?bump(v):v)}));
  const S1=X.simulate(prep(list,rates),{strategy:'apt-lead-1'}),S2=X.simulate(prep(L2,rates.map((v,i)=>K('2002-01')+i>M?v+2:v)),{strategy:'apt-lead-1'});
  const upTo=S=>JSON.stringify(S.months.filter(m=>m.k<=M).map(m=>[m.k,m.action,m.opened&&m.opened.id,m.opened&&m.opened.buy.lead,Math.round(m.eq)]));
  ok('대장 합성: '+month+' 뒤 시세·금리를 바꿔도 그달까지 대장 판단·체결·자산은 같다', upTo(S1)===upTo(S2));
}
{
  const cut=K('2006-06'),short=LEAD.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+1)}));
  const L0=X.paperUpdate(null,prep(short),{strategy:'apt-lead-1'},'t0').ledger;
  ok('대장 장부: 제 전략 버전 · 후보 방식(pick) 기록 · 만든 달 자료까지', L0.strategyVersion==='apt-lead-1'&&L0.params.pick==='leader'&&L0.months.length===0&&L0.startedData==='2006-06');
  const A1=prep(LEAD.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+13)}))),r1=X.paperUpdate(L0,A1,{strategy:'apt-lead-1'},'t1');
  const st={eq:30000,pos:null},want=[]; for(let k=cut+1;k<=cut+12;k++){ const r=X.stepMonth(A1,st,k,LO); want.push([r.action,Math.round(r.eq*100)/100,st.pos&&st.pos.id]); }
  ok('대장 장부 한 줄 = 같은 stepMonth(대장 후보) 결과', r1.added===12&&JSON.stringify(r1.ledger.months.map(m=>[m.action,m.eq,m.pos]))===JSON.stringify(want), JSON.stringify(r1.ledger.months.map(m=>m.action)));
  let t1=false,t2=false,t3=false;
  try{ X.paperUpdate(L0,A1,{},'t'); }catch(e){ t1=true; }
  try{ X.paperUpdate(X.paperUpdate(null,prep(short),{},'t0').ledger,A1,{strategy:'apt-lead-1'},'t'); }catch(e){ t2=true; }
  try{ X.paperUpdate(Object.assign({},L0,{params:Object.assign({},L0.params,{pick:'mom'})}),A1,{strategy:'apt-lead-1'},'t'); }catch(e){ t3=true; }
  ok('장부와 전략이 어긋나면 멈춘다(대장 장부를 apt-1 로 · apt-1 장부를 대장으로 · 후보 방식이 바뀐 장부)', t1&&t2&&t3);
}

console.log('[부동산 클로드 아파트 전략] 전세 끼고(갭, -gap 실험적 확장)');
const GO=X.opts({strategy:'apt-1-gap'});
{
  ok('전략 이름이 돈 방식을 정한다: apt-1-gap → 갭 · apt-1 에 lev 를 넘겨도 내 돈', GO.lev==='gap'&&GO.pick==='mom'&&X.opts({strategy:'apt-1',lev:'gap'}).lev==='cash'&&X.opts({strategy:'apt-lead-1-gap'}).pick==='leader'&&X.STRATEGIES['apt-1-gap'].experimental===true);
  const A=prep(BASE),S=X.simulate(A,{strategy:'apt-1-gap'}),S0=X.simulate(A),t=S.trades[0],t0=S0.trades[0];
  const i=K(t.buy.m)-K('2004-01'),px=midA[i],j=Math.round(px*0.6),acq=Math.round(px*X.acqRate(px)),br=Math.round(px*X.brokerRate(px)),need=px-j+acq+br;
  ok('갭: 사는 때·단지·가격은 apt-1 과 같다(2005-05 에이)', t.id===t0.id&&t.buy.m===t0.buy.m&&t.buy.price===t0.buy.price);
  ok('갭 매수 기록: 그 달 전세 · 전세가율 · 내 돈 = 가격 − 전세 + 취득세 + 중개', t.buy.gap&&t.buy.gap.jeonse===j&&near(t.buy.gap.ratio,j/px)&&t.buy.gap.need===need&&t.buy.gap.res===false, JSON.stringify(t.buy.gap));
  ok('gapNeed 도 같은 값', X.gapNeed(A,1,K(t.buy.m)).need===need);
  const mb=S.months.find(m=>m.k===K(t.buy.m));
  ok('산 달 자산 = 사기 전 자산 × (가격 − 전세) ÷ 내 돈 (취득세·중개만큼 줄어든다)', near(mb.eq,t.result.eqIn*(px-j)/need,1e-9)&&t.result.eqIn>30000, mb.eq);
  // 2년 뒤(2007-05) 재계약: 전세가 올랐으니(오르는 단지) 차액을 받는다 · 판 달(2009-05)엔 재계약 없음
  const k24=K(t.buy.m)+24,j24=Math.round(midA[k24-K('2004-01')]*0.6),sg=t.sell.gap;
  ok('2년마다 전세 재계약: 올랐으면 차액을 받는다(기록 1건, 판 달엔 없음)', sg.events.length===1&&sg.events[0].m===E.kym(k24)&&sg.events[0].jeonse===j24&&sg.events[0].inflow===j24-j&&sg.inflow===j24-j&&sg.calls===0&&sg.out===need, JSON.stringify(sg.events));
  const sp=t.sell.price,sb=t.sell.costs.broker,back=sp-sb-t.sell.costs.tax-t.sell.costs.hold-j24+sg.inflow;
  ok('팔 때 회수 = 매도가 − 중개 − 양도세 − 보유세 − 전세보증금(마지막 계약) + 받은 차액 · 수익률 = 회수 ÷ 내 돈 − 1', Math.abs(sg.back-back)<=1&&near(t.result.net,sg.back/sg.out-1,1e-4)&&sg.j===j24&&near(t.result.eqOut,t.result.eqIn*(1+t.result.net),1e-9), JSON.stringify([sg.back,back,t.result.net]));
  ok('같은 가격 흐름이면 갭 수익률(현금 기준)이 내 돈 수익률보다 크다(레버리지)', t.result.net>t0.result.net&&t.result.gross===t0.result.gross);
  ok('갭 거래의 차익 = 회수 − 내 돈', t.result.profit===Math.round(sg.back-sg.out));
}
{
  // 역전세: 가격은 그대로, 전세만 2년 뒤 20% 내리는 단지 → 재계약 때 차액을 내 돈으로 더 넣고(out 증가), 팔 때 낮아진 보증금을 돌려준다
  const midF=path_(N,i=>30000*(i<12?1:Math.pow(1.01,Math.min(i,24)-12))),jF=midF.map((x,i)=>i>=K('2007-05')-K('2004-01')?Math.round(x*0.48):Math.round(x*0.6));
  const A=prep([{id:1,name:'역전세',gu:'서구',units:1500,mid:midF,jeonse:jF}],R0.map((v,i)=>i>=K('2009-01')-K('2002-01')?4:3)),S=X.simulate(A,{strategy:'apt-1-gap'}),t=S.trades[0],sg=t.sell.gap;
  const kb=K(t.buy.m),j0=jF[kb-K('2004-01')],j1=jF[kb+24-K('2004-01')];
  ok('역전세: 재계약 때 내린 만큼 내 돈을 더 넣는다(call) · 내 돈 합계가 는다', t.buy.m==='2005-05'&&sg.events.length>=1&&sg.events[0].call===j0-j1&&sg.calls>=j0-j1&&sg.out===t.buy.gap.need+sg.calls, JSON.stringify([t.buy.m,sg.events,sg.out,t.buy.gap.need]));
  const mk=S.months.find(m=>m.k===kb+24),px=midF[kb+24-K('2004-01')];
  let h24=0; for(let k=kb+1;k<=kb+24;k++) h24+=midF[k-K('2004-01')]*0.0015/12;
  ok('재계약 달 평가: 사기 전 자산 × (가격 − 새 전세 − 보유세) ÷ 늘어난 내 돈', near(mk.eq,t.result.eqIn*(px-j1-h24)/(t.buy.gap.need+(j0-j1)),1e-6), mk.eq);
  ok('팔 때 돌려주는 보증금은 마지막 계약 전세(내린 것)', sg.j===j1&&t.sell.m==='2009-02', JSON.stringify([sg.j,j1,t.sell.m]));
}
{
  // 파산: 사고 나서 가격이 반토막(전세 계약은 그대로) → 평가가 0 아래 → 그 뒤 거래 없음
  const midR=path_(N,i=>30000*(i<12?1:i<30?Math.pow(1.02,i-12):Math.pow(1.02,18)*Math.pow(0.9,i-30)));
  const A=prep([{id:1,name:'반토막',gu:'서구',units:1500,mid:midR}]),S=X.simulate(A,{strategy:'apt-1-gap'}),sm=X.summary(A,S);
  const first=S.months.find(m=>m.ruin),after=S.months.filter(m=>m.k>first.k);
  ok('파산: 내 돈이 0 아래로 가면 파산 표시(달·요약)', S.ruin===true&&sm.ruin===true&&S.ruinM===E.kym(first.k)&&first.eq<=0, JSON.stringify([S.ruinM,first&&first.eq]));
  ok('파산 뒤엔 더 거래하지 않는다(행동 ruin · 거래 추가 없음)', after.length>0&&after.every(m=>m.action==='ruin'&&!m.opened&&!m.closed)&&S.trades.length===1, JSON.stringify(after.slice(0,2).map(m=>m.action)));
  ok('같은 단지를 내 돈으로 샀으면 파산이 아니라 손실', X.simulate(A).ruin===false&&X.summary(A,X.simulate(A)).mdd<0);
  ok('파산 뒤 최대낙폭은 −100% 로 센다', sm.mdd<=-1);
}
{
  ok('조정대상지역(월 단위): 세종 2016-11~2022-11 · 대전 2020-06~2022-09 · 대덕구 2020-12~', X.regulated({city:'세종'},K('2016-11'))&&!X.regulated({city:'세종'},K('2016-10'))&&X.regulated({city:'세종'},K('2022-11'))&&!X.regulated({city:'세종'},K('2022-12'))
    &&X.regulated({city:'대전',gu:'서구'},K('2020-06'))&&!X.regulated({city:'대전',gu:'서구'},K('2020-05'))&&!X.regulated({city:'대전',gu:'대덕구'},K('2020-06'))&&X.regulated({city:'대전',gu:'대덕구'},K('2020-12'))&&X.regulated({city:'대전',gu:'서구'},K('2022-09'))&&!X.regulated({city:'대전',gu:'서구'},K('2022-10')));
  // 비과세 없음: 전체 과세 · 3년 보유 일반 장기보유공제 6% · 기본공제 250 · 38.5%: (29,700 × 0.94 − 250) × 0.385 = 10,652
  ok('양도세(비과세 없음): 전체 차익 과세 · 일반 장기보유공제(3년 6%)', X.gainTax(50000,80000,300,36,K('2015-01'),true)===10652&&X.gainTax(50000,80000,300,36,K('2015-01'))===0, X.gainTax(50000,80000,300,36,K('2015-01'),true));
  // 조정대상지역일 때 전세 끼고 산 집은 거주 요건을 못 채워 비과세가 없다 — 2017-01 부터 오르는 세종 단지(자료 2015-01~2022-12)
  const N2=96,R2=flatRates(13*12+N2,3);   // 금리 2002-01~2022-12
  const midJ=path_(N2,i=>30000*(i<24?1:i<60?Math.pow(1.01,i-24):Math.pow(1.01,36)*Math.pow(0.99,i-60)));
  const L=[{id:7,name:'세종규제',gu:'세종시',units:1200,mid:midJ,start:'2015-01'}];
  const A=X.prepareApt(aptDoc(L),E.prepare(series(R2)),EVD),Sg=X.simulate(A,{strategy:'apt-1-gap'}),Sc=X.simulate(A),tg=Sg.trades[0],tc=Sc.trades[0];
  ok('조정대상지역 취득(세종 2017-05): 갭 거래는 비과세 없이 양도세를 내고, 내 돈 거래는 비과세', tg&&tg.buy.m==='2017-05'&&tg.buy.gap.res===true&&tg.sell&&tg.sell.costs.tax>0&&tc.sell.costs.tax===0&&tg.sell.m===tc.sell.m, JSON.stringify([tg&&tg.buy.m,tg&&tg.sell&&tg.sell.costs.tax,tc.sell.costs.tax]));
  ok('그 양도세 = gainTax(…, 비과세 없음)', tg.sell.costs.tax===X.gainTax(tg.buy.total,tg.sell.price,tg.sell.costs.broker,tg.sell.held,K(tg.sell.m),true));
}
{
  // 현실 점검 1: 분포 — 작은 두 단지로 독립 계산과 맞춘다
  const L=[{id:1,name:'에이',gu:'서구',units:1500,mid:midA},{id:2,name:'비',gu:'유성구',units:1200,mid:midB},{id:3,name:'작은',gu:'중구',units:800,mid:midS}];
  const A=prep(L),F=X.forwardStats(A),r=[];
  for(const c of [L[0],L[1]]) for(let k=0;k+24<N;k++){ const a=c.mid[k],b=c.mid[k+24],acq=Math.round(a*X.acqRate(a)),br=Math.round(a*X.brokerRate(a)),tot=a+acq+br,sb=Math.round(b*X.brokerRate(b));
    let h=0; for(let j=k+1;j<k+24;j++) h+=c.mid[j]*0.0015/12; r.push((b-sb-X.gainTax(tot,b,sb,24,K('2004-01')+k+24)-h)/tot-1); }
  r.sort((a,b)=>a-b); const med=r[Math.floor(r.length/2)];
  ok('아무 대단지·아무 달 24개월 뒤 순수익률 분포: n·중앙·이익 확률이 독립 계산과 같다(작은 단지 제외)', F.h[24].n===r.length&&near(F.h[24].med,med,1e-9)&&near(F.h[24].pos,r.filter(x=>x>0).length/r.length,1e-9)&&F.h[12]&&F.h[36]&&F.h[60], JSON.stringify([F.h[24].n,r.length,F.h[24].med,med]));
  ok('매수 연도별 24개월 중앙값(2004~2011)', Object.keys(F.byYear).join()==='2004,2005,2006,2007,2008,2009,2010,2011'&&F.byYear['2005'].med>F.byYear['2010'].med, Object.keys(F.byYear).join());
}
{
  // 현실 점검 2: 고점 스트레스 — 2015-01 부터 대전 단지 평균이 가장 높은 달에 대장을 사서 24개월 뒤 강제 매도(같은 openPos·markPos·closePos)
  const N2=96,R2=flatRates(13*12+N2,3);   // 금리 2002-01~2022-12
  const up=path_(N2,i=>30000*(i<24?1:i<48?Math.pow(1.02,i-24):Math.pow(1.02,24)*Math.pow(0.98,i-48)));           // 고점 2019-01(i=48)
  const flat=path_(N2,i=>20000);
  const L=[{id:1,name:'대장',gu:'서구',units:1500,mid:up,start:'2015-01'},{id:2,name:'둘째',gu:'유성구',units:1200,mid:flat,start:'2015-01'}];
  const A=X.prepareApt(aptDoc(L),E.prepare(series(R2)),EVD),sc=X.stress(A,{strategy:'apt-1'}),sg=X.stress(A,{strategy:'apt-1-gap'});
  const kp=K('2015-01')+48,ip=48;
  ok('고점 = 대단지 평균(2015-01 대비)이 가장 높은 달 · 그때 대장 · 24개월 뒤 강제 매도', sc.length===1&&sc[0].city==='대전'&&sc[0].id===1&&sc[0].peakM===E.kym(kp)&&sc[0].buy.m===E.kym(kp)&&sc[0].sell.m===E.kym(kp+24)&&sc[0].sell.why.join()==='stress', JSON.stringify(sc.map(x=>[x.id,x.peakM,x.sell.m])));
  const b=up[ip],e=up[ip+24],sb=Math.round(e*X.brokerRate(e)),tot=b+Math.round(b*X.acqRate(b))+Math.round(b*X.brokerRate(b));
  let h=0; for(let k=ip+1;k<ip+24;k++) h+=up[k]*0.0015/12;
  ok('내 돈 스트레스 배수 = (매도가 − 중개 − 보유세) ÷ 매수 총액 (손실이라 양도세 0)', near(sc[0].mult,(e-sb-h)/tot,1e-6)&&sc[0].mult<1&&sc[0].trough.price===Math.min(...up.slice(ip)), sc[0].mult);
  const j=Math.round(b*0.6),need=b-j+Math.round(b*X.acqRate(b))+Math.round(b*X.brokerRate(b)),j24=Math.round(up[ip+24]*0.6);
  ok('갭 스트레스: 내 돈 = gapNeed · 회수 = 매도가 − 중개 − 보유세 − 보증금(재계약 없음: 판 달) · 손실이 레버리지만큼 커진다', sg[0].buy.gap.need===need&&Math.abs(sg[0].sell.gap.back-(e-sb-h-j))<=1&&sg[0].mult<sc[0].mult&&near(sg[0].mult,1+sg[0].result.net,1e-9), JSON.stringify([sg[0].buy.gap,sg[0].sell.gap.back,e-sb-h-j]));
}
lookaheadGap(BASE,R0,'2006-06');
lookaheadGap(BASE,R0,'2008-12');
function lookaheadGap(list,rates,month){
  const M=K(month),bump=v=>v==null?null:Math.round(v*1.5);
  const L2=list.map(c=>Object.assign({},c,{mid:c.mid.map((v,i)=>K(c.start||'2004-01')+i>M?bump(v):v)}));
  const S1=X.simulate(prep(list,rates),{strategy:'apt-1-gap'}),S2=X.simulate(prep(L2,rates.map((v,i)=>K('2002-01')+i>M?v+2:v)),{strategy:'apt-1-gap'});
  const upTo=S=>JSON.stringify(S.months.filter(m=>m.k<=M).map(m=>[m.k,m.action,m.opened&&m.opened.id,m.opened&&m.opened.buy.gap,Math.round(m.eq*100)]));
  ok('갭 합성: '+month+' 뒤 시세·금리를 바꿔도 그달까지 판단·내 돈·자산은 같다', upTo(S1)===upTo(S2));
}
{
  const cut=K('2006-06'),short=BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+1)}));
  const L0=X.paperUpdate(null,prep(short),{strategy:'apt-1-gap'},'t0').ledger;
  ok('갭 장부: 제 전략 버전 · 돈 방식(lev) · 재계약 주기 기록', L0.strategyVersion==='apt-1-gap'&&L0.params.lev==='gap'&&L0.params.renew===24&&L0.params.pick==='mom');
  const A1=prep(BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+13)}))),r1=X.paperUpdate(L0,A1,{strategy:'apt-1-gap'},'t1');
  const st={eq:30000,pos:null},want=[]; for(let k=cut+1;k<=cut+12;k++){ const r=X.stepMonth(A1,st,k,GO); want.push([r.action,Math.round(r.eq*100)/100]); }
  ok('갭 장부 한 줄 = 같은 stepMonth(갭) 결과 · 보유 중이면 갭 상태(보증금·내 돈)도 장부에', r1.added===12&&JSON.stringify(r1.ledger.months.map(m=>[m.action,m.eq]))===JSON.stringify(want)&&r1.ledger.acct.pos&&r1.ledger.acct.pos.gap&&r1.ledger.acct.pos.gap.out===r1.ledger.acct.pos.buy.gap.need, JSON.stringify(r1.ledger.months.map(m=>m.action)));
  let t1=false,t2=false;
  try{ X.paperUpdate(Object.assign({},L0,{params:Object.assign({},L0.params,{lev:'cash'})}),A1,{strategy:'apt-1-gap'},'t'); }catch(e){ t1=/돈 방식/.test(e.message); }
  try{ X.paperUpdate(X.paperUpdate(null,prep(short),{},'t0').ledger,A1,{strategy:'apt-1-gap'},'t'); }catch(e){ t2=true; }
  ok('장부 돈 방식이 어긋나면 멈춘다 · 내 돈 장부(apt-1)를 갭으로 돌리면 멈춘다', t1&&t2);
  ok('옛 장부(lev 칸 없음)는 내 돈으로 본다', (()=>{ const L=X.paperUpdate(null,prep(short),{},'t0').ledger; delete L.params.lev; try{ X.paperUpdate(L,A1,{},'t'); return true; }catch(e){ return false; } })());
}

console.log('[부동산 클로드 아파트 전략] 모의장부 — 금리 자료가 늦으면 기다린다');
{
  // 시세는 2006-12 까지, 기준금리는 2006-09 까지만 들어온 상황 → 2006-11 판단(2006-10 금리 필요)부터는 쓰지 않는다
  const cut=K('2006-06'),short=BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,cut-K('2004-01')+1)}));
  const L0=X.paperUpdate(null,prep(short),{},'t0').ledger;
  const upto=BASE.map(c=>Object.assign({},c,{mid:c.mid.slice(0,K('2006-12')-K('2004-01')+1)}));
  const lateRates=R0.slice(0,K('2006-09')-K('2002-01')+1);
  const r1=X.paperUpdate(L0,prep(upto,lateRates),{},'t1');
  ok('금리 자료가 없는 달은 장부에 쓰지 않고 멈춘다(2006-07~10 넉 줄 · 2006-11 부터 기다림)', r1.added===4&&r1.ledger.months.map(m=>m.m).join()==='2006-07,2006-08,2006-09,2006-10'&&r1.waitFor==='2006-11', JSON.stringify([r1.added,r1.waitFor]));
  ok('장부에 금리 없음(noRate) 줄이 생기지 않는다', r1.ledger.months.every(m=>m.why.indexOf('noRate')<0));
  const r2=X.paperUpdate(r1.ledger,prep(upto),{},'t2'),once=X.paperUpdate(L0,prep(upto),{},'t2');
  ok('금리가 들어오면 이어 쓰고, 처음부터 한 번에 쓴 장부와 같다', r2.added===2&&r2.waitFor===null&&JSON.stringify(r2.ledger.months.map(m=>[m.m,m.action,m.eq]))===JSON.stringify(once.ledger.months.map(m=>[m.m,m.action,m.eq]))&&JSON.stringify(r2.ledger.acct)===JSON.stringify(once.ledger.acct), JSON.stringify([r2.added,r2.waitFor]));
  const g1=X.paperUpdate(X.paperUpdate(null,prep(short),{strategy:'apt-lead-1-gap'},'t0').ledger,prep(upto,lateRates),{strategy:'apt-lead-1-gap'},'t1');
  ok('전세 끼고 장부도 같이 기다린다', g1.waitFor==='2006-11'&&g1.added===4);
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
  const SL=X.simulate(A,{strategy:'apt-lead-1'}),LO2=X.opts({strategy:'apt-lead-1'});
  const leaderOf=(k,city)=>{ let best=null,n=0,sec=null; for(const u of A.U){ if(u.city!==city||u.units<1000) continue; const p=X.price(A,u.id,k-1); if(p==null) continue; n++;
      if(!best||p>best.p||(p===best.p&&u.units>best.u)){ sec=best; best={id:u.id,p,u:u.units}; } else if(!sec||p>sec.p||(p===sec.p&&u.units>sec.u)) sec={id:u.id,p,u:u.units}; } return {best,n,sec}; };
  ok('실제(대장): 산 단지는 모두 그 달 그 도시 대장(전달 시세 1위) · 대단지 수 · 2위 기록이 독립 계산과 같다', SL.trades.length>0&&SL.trades.every(t=>{ const w=leaderOf(K(t.buy.m),t.city); return w.best.id===t.id&&t.buy.lead.n===w.n&&t.buy.lead.last===w.best.p&&(w.sec?t.buy.lead.next.id===w.sec.id:t.buy.lead.next===null); }), JSON.stringify(SL.trades.map(t=>[t.id,t.buy.m])));
  ok('실제(대장): 매수 근거·2년 보유·체결가가 apt-1 과 같은 규칙', SL.trades.every(t=>t.buy.rateUp<=0&&t.buy.mom>=0.03&&t.buy.rank===1&&t.buy.price===X.price(A,t.id,K(t.buy.m))&&(t.open||t.sell.held>=24)));
  ok('실제(대장): 거래가 겹치지 않는다', SL.trades.every((t,i)=>i===0||K(t.buy.m)>=K(SL.trades[i-1].sell.m)));
  lookahead2(A,'2015-06','apt-lead-1');
  lookahead2(A,E.kym(A.lastK-8),'apt-lead-1');
  const nl=X.nowView(A,{strategy:'apt-lead-1'},null);
  ok('실제(대장): 지금 대장 = 대전 1곳 · 세종 1곳', nl.leaders.length===2&&nl.leaders[0].city==='대전'&&nl.leaders[1].city==='세종'&&nl.leaders.every(l=>l.id===leaderOf(A.lastK+1,l.city).best.id));
  for(const sv of ['apt-1-gap','apt-lead-1-gap']){
    const S=X.simulate(A,{strategy:sv}),cash=X.simulate(A,{strategy:sv.replace('-gap','')});
    ok('실제('+sv+'): 사고파는 달·단지는 내 돈 전략과 같고(전세 자료는 늘 있음) 매수마다 갭 기록(내 돈 = 가격 − 전세 + 취득세 + 중개)',
       S.trades.length===cash.trades.length&&S.trades.every((t,i)=>t.id===cash.trades[i].id&&t.buy.m===cash.trades[i].buy.m&&t.buy.gap&&t.buy.gap.need===t.buy.price-t.buy.gap.jeonse+t.buy.costs.acq+t.buy.costs.broker&&t.buy.gap.res===X.regulated(t,K(t.buy.m))), sv);
    ok('실제('+sv+'): 끝난 거래마다 회수 = 매도가 − 중개 − 양도세 − 보유세 − 보증금 + 받은 차액 · 내 돈 = 처음 내 돈 + 역전세 · 수익률 = 회수 ÷ 내 돈 − 1',
       S.trades.filter(t=>!t.open).every(t=>{ const g=t.sell.gap; return Math.abs(g.back-(t.sell.price-t.sell.costs.broker-t.sell.costs.tax-t.sell.costs.hold-g.j+g.inflow))<=1&&g.out===t.buy.gap.need+g.calls&&near(t.result.net,g.back/g.out-1,1e-4)&&g.events.every(e=>(e.call==null)!==(e.inflow==null)); }), sv);
    ok('실제('+sv+'): 조정대상지역에 산 거래는 차익이 있으면 양도세를 낸다 · 아니면 1주택 규칙 그대로', S.trades.filter(t=>!t.open).every(t=>t.sell.costs.tax===X.gainTax(t.buy.total,t.sell.price,t.sell.costs.broker,t.sell.held,K(t.sell.m),t.buy.gap.res)), sv);
    lookahead2(A,'2015-06',sv);
  }
  const FS=X.forwardStats(A),ST=X.stress(A,{strategy:'apt-lead-1-gap'});
  ok('실제: 아무 대단지·아무 달 24개월 분포가 있고(1만 건 이상) 5년이 2년보다 이익 확률이 높다', FS.h[24]&&FS.h[24].n>10000&&FS.h[60].pos>FS.h[24].pos&&Object.keys(FS.byYear).length>=20);
  ok('실제: 고점 스트레스는 대전·세종 한 곳씩 · 고점 달에 사서 24개월 뒤 강제 매도 · 갭 내 돈 = gapNeed', ST.length===2&&ST.every(x=>x.sell.why.join()==='stress'&&K(x.sell.m)-K(x.buy.m)===24&&x.buy.gap.need===X.gapNeed(A,x.id,K(x.buy.m)).need), JSON.stringify(ST.map(x=>[x.city,x.peakM,x.mult])));
}
function lookahead2(A,month,sv){
  const M=K(month),S1=X.simulate(A,{strategy:sv});
  const B=Object.assign({},A,{P:{}});
  for(const id in A.P){ const s=A.P[id]; B.P[id]={k0:s.k0,v:s.v.map((v,i)=>s.k0+i>M&&v!=null?Math.round(v*(1.3+0.2*Math.sin(i))):v)}; }
  const S2=X.simulate(B,{strategy:sv});
  const upTo=S=>JSON.stringify(S.months.filter(m=>m.k<=M).map(m=>[m.k,m.action,m.opened&&m.opened.id,Math.round(m.eq)]));
  ok('실제'+(sv?'('+sv+')':'')+': '+month+' 뒤 시세를 바꿔도 그달까지 결정은 같다', upTo(S1)===upTo(S2));
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
