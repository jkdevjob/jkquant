/* 부동산(클로드) 경매 계산 엔진 값 시험 — node scripts/test_realestate_claude_auction.cjs
   손으로 계산한 값과 맞춘다. 변이 시험은 REC_AUC 로 바꾼 엔진을 넣는다. */
'use strict';
const path=require('path');
const U=require(process.env.REC_AUC||path.join(__dirname,'..','realestate-claude-auction.js'));
const APT=require(path.join(__dirname,'..','realestate-claude-apt.js'));
let pass=0,fail=0;
function ok(name,cond,detail){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(detail?' — '+detail:''));} }
const near=(a,b,e)=>a!=null&&b!=null&&Math.abs(a-b)<=(e||1e-9);
const NOW='2026-11-08';

console.log('[부동산 클로드 경매] 유찰 · 보증금');
{
  ok('대전지방법원 30%: 3억 → 2.1억 → 1.47억 → 1.029억 → 7,203만 → 5,042만(앞 회차에서 30%씩)', U.schedule(30000).map(r=>r.min).join()==='30000,21000,14700,10290,7203,5042', U.schedule(30000).map(r=>r.min).join());
  ok('입찰보증금 = 그 회차 최저가 × 10%', U.schedule(30000).map(r=>r.deposit).slice(0,3).join()==='3000,2100,1470');
  ok('저감률을 바꿀 수 있다(20%: 3억 → 2.4억 → 1.92억)', U.minPriceAt(30000,2,0.2)===24000&&U.minPriceAt(30000,3,0.2)===19200);
  ok('회차 1(신건)은 감정가 그대로 · 감정가가 없으면 null', U.minPriceAt(30000,1)===30000&&U.minPriceAt(0,2)===null&&U.minPriceAt('',1)===null);
  const r=U.analyze({appraisal:30000,round:2,resale:true,bid:22000,market:28000},{},NOW);
  ok('재매각(앞 낙찰자가 잔금 안 냄)이면 보증금 20%', r.deposit===4200, r.deposit);
}

console.log('[부동산 클로드 경매] 권리 연습');
{
  const base='2020-05-10';
  const one=(t,bid,flags)=>U.rights({base,tenants:[t],flags},bid);
  let r=one({deposit:5000,moveIn:'2020-05-10'},25000);
  ok('말소기준과 같은 날 전입 → 대항력 없음 · 떠안을 돈 0', r.level==='safe'&&r.assumeMax===0&&/같은 날/.test(r.items[0].why), JSON.stringify(r.items));
  r=one({deposit:5000,moveIn:'2020-05-11'},25000);
  ok('말소기준 뒤 전입 → 대항력 없음', r.assumeMax===0&&r.level==='safe');
  r=one({deposit:15000,moveIn:'2020-05-09',fixed:'2020-05-01',claimed:true},25000);
  ok('하루라도 앞 전입 · 배당요구 · 확정일자 앞섬 · 입찰가가 넉넉 → 배당에서 다 받아 떠안을 돈 0', r.assumeMax===0&&r.level==='safe', JSON.stringify(r));
  r=one({deposit:15000,moveIn:'2020-05-09',fixed:'2020-05-01',claimed:true},14000);
  ok('같은 임차인 · 입찰가 1.4억 → 경매비용(1%) 빼고 모자란 1,140만을 떠안음', r.assumeMax===1140&&r.assumeMin===0&&r.level==='check', JSON.stringify(r));
  r=one({deposit:15000,moveIn:'2020-05-09',fixed:'2020-05-10',claimed:true},25000);
  ok('확정일자가 말소기준과 같은 날(앞서지 않음) → 0 ~ 보증금 전액(배당표 필요)', r.assumeMin===0&&r.assumeMax===15000&&r.level==='check');
  r=one({deposit:8000,moveIn:'2019-01-01',claimed:false},25000);
  ok('대항력 있는데 배당요구 안 함 → 보증금 전액 떠안음 · 위험', r.assumeMin===8000&&r.assumeMax===8000&&r.level==='danger');
  r=one({deposit:8000,moveIn:'2019-01-01',claimed:true},25000);
  ok('배당요구는 했지만 확정일자 없음 → 전액 떠안음', r.assumeMin===8000&&r.level==='danger'&&/확정일자 없음/.test(r.items[0].why));
  r=one({deposit:6000},25000);
  ok('전입일을 모르면 최악(전액)으로 · 확인 필요', r.assumeMax===6000&&r.assumeMin===0&&r.level==='check');
  r=U.rights({base,tenants:[],flags:{lien:true,share:true}},25000);
  ok('유치권·지분 같은 특수 권리 → 계산 없이 위험(초보는 피하기)', r.level==='danger'&&r.red.join()==='유치권 신고,지분 경매(일부만 팖)');
  r=U.rights({tenants:[{deposit:1000,moveIn:'2020-01-01'}]},25000);
  ok('말소기준 날짜가 없으면 판단 안 함(unknown)', r.level==='unknown'&&r.assumeMax===0);
  r=U.rights({base,tenants:[{deposit:3000,moveIn:'2020-05-11'},{deposit:8000,moveIn:'2019-01-01'}]},25000);
  ok('임차인이 여럿이면 떠안는 돈을 더한다', r.assumeMin===8000&&r.assumeMax===8000&&r.items.length===2);
}

console.log('[부동산 클로드 경매] 비용 · 내 돈 · 2년 뒤 · 입찰가');
{
  // 감정가 3억 · 2회차(최저 2.1억) · 입찰 2.3억 · 시세 2.8억 · 권리 입력 없음
  const a=U.analyze({appraisal:30000,round:2,bid:23000,market:28000},{},NOW);
  ok('최저가 2.1억 · 보증금 2,100만', a.minPrice===21000&&a.deposit===2100);
  ok('비용: 취득세 253만(1.1%) · 법무 100만 · 명도 300만 → 총 2억 3,653만', a.costs.acq===253&&a.costs.legal===100&&a.costs.moveOut===300&&a.total===23653, JSON.stringify(a.costs));
  ok('취득세·중개·양도세는 아파트 엔진과 같은 함수', a.costs.acq===Math.round(23000*APT.acqRate(23000))&&a.y2.broker===Math.round(28000*APT.brokerRate(28000))&&a.y1.tax===APT.gainTax(23653,28000,a.y1.broker,12,APT_K()));
  ok('시세 대비 15.5% 싸게 산 셈(비용 포함)', near(a.disc,1-23653/28000));
  ok('대출 추정 = min(낙찰가 70%, 감정가 60%) = 1.61억 · 내 돈 7,553만', a.loan===16100&&a.cash===7553);
  ok('2년 뒤(시세 그대로): 중개 123만 · 양도세 0(1주택 비과세) · 이자 1,449만 · 보유세 84만 → 대출 갚고 1억 244만 · 이익 2,691만', a.y2.broker===123&&a.y2.tax===0&&a.y2.interest===1449&&a.y2.hold===84&&a.y2.back===10244&&a.y2.profit===2691, JSON.stringify(a.y2));
  ok('1년 뒤 팔면 양도세 66% → 2,788만 · 이익 669만', a.y1.tax===2788&&a.y1.profit===669, JSON.stringify(a.y1));
  ok('시세보다 15% 싸게(비용 포함) 사려면 입찰가 2억 3,145만 이하 · 판정 ok', a.maxBid===23145&&a.verdict==='ok', a.maxBid);
  const c=U.costsAt(23145,U.DEFAULTS,0),c2=U.costsAt(23146,U.DEFAULTS,0);
  ok('그 입찰가는 경계: 1만 원 더 쓰면 목표를 넘는다', 23145+c.acq+c.legal+c.moveOut<=28000*0.85&&23146+c2.acq+c2.legal+c2.moveOut>28000*0.85);
  ok('입찰가를 직접 넣은 대출로 바꾸면 내 돈도 바뀐다', U.analyze({appraisal:30000,round:2,bid:23000,market:28000,loan:10000},{},NOW).cash===13653);
  ok('떠안는 돈은 총비용에 들어간다(권리 연습 결과의 큰 쪽)', U.analyze({appraisal:30000,round:2,bid:23000,market:28000,rights:{base:'2020-05-10',tenants:[{deposit:8000,moveIn:'2019-01-01'}]}},{},NOW).total===23653+8000);
  ok('떠안는 돈을 직접 넣으면 그 값으로', U.analyze({appraisal:30000,round:2,bid:23000,market:28000,assume:500,rights:{base:'2020-05-10',tenants:[{deposit:8000,moveIn:'2019-01-01'}]}},{},NOW).total===24153);
  const w=U.analyze({appraisal:30000,round:2,bid:20000,market:28000},{},NOW);
  ok('최저가보다 낮게 쓰면 무효(belowMin)', w.warn.indexOf('belowMin')>=0);
  const v=U.analyze({appraisal:30000,round:2,bid:21000,market:20000},{},NOW);
  ok('시세가 낮아 목표 입찰가가 최저가 아래면 → 유찰 기다리기(wait)', v.verdict==='wait'&&v.maxBid<21000, v.maxBid);
  const d=U.analyze({appraisal:30000,round:2,bid:23000,market:28000,rights:{base:'2020-05-10',flags:{lien:true}}},{},NOW);
  ok('특수 권리면 판정은 위험(danger)', d.verdict==='danger'&&d.warn.indexOf('danger')>=0);
  ok('시세가 없으면 계산하지 않음', U.analyze({appraisal:30000,bid:23000},{},NOW).ok===false);
  const big=U.analyze({appraisal:100000,round:1,bid:90000,market:120000},{},NOW);
  ok('9억 낙찰이면 취득세 3.3% · 대출 추정은 감정가 60%(6억)', big.costs.acq===2970&&big.loan===60000, JSON.stringify([big.costs.acq,big.loan]));
}
function APT_K(){ const m=/^(\d{4})-(\d{2})/.exec(NOW); return (+m[1])*12+(+m[2])-1; }

console.log('[부동산 클로드 경매] 모의입찰 장부');
{
  const input={court:'대전지방법원',caseNo:'2026타경1234',itemNo:1,name:'도안 ○○',appraisal:30000,round:2,saleDate:'2026-11-20',bid:23000,market:28000};
  let threw=false; try{ U.newCase(Object.assign({},input,{caseNo:''}),{},'2026-11-08T00:00:00Z'); }catch(e){ threw=/사건번호/.test(e.message); }
  ok('사건번호 없으면 저장 안 함', threw);
  threw=false; try{ U.newCase(Object.assign({},input,{bid:20000}),{},'2026-11-08T00:00:00Z'); }catch(e){ threw=/최저가/.test(e.message); }
  ok('최저가보다 낮은 입찰가는 저장 안 함', threw);
  const c=U.newCase(input,{},'2026-11-08T00:00:00Z');
  ok('저장: 그때의 입력 · 가정 · 계산(총비용 · 할인 · 내 돈 · 2년 뒤)을 그대로 남긴다', c.input.bid===23000&&c.params.cut===0.3&&c.snap.total===23653&&c.snap.cash===7553&&c.snap.y2.profit===2691&&c.snap.maxBid===23145&&c.result===null&&c.engine===U.VERSION);
  const e=U.editBid(c,23100,{},'2026-11-09T00:00:00Z');
  ok('결과 전에는 입찰가를 바꿀 수 있고 계산도 다시', e.input.bid===23100&&e.snap.total===23100+254+400&&e.edited==='2026-11-09T00:00:00Z');
  const s=U.setResult(c,{status:'sold',win:23500,bidders:7},'2026-11-21T00:00:00Z');
  ok('결과: 낙찰 2.35억 · 7명 → 내 2.3억은 짐 · 감정가 대비 78.3% · 시세 대비 83.9% · 내 입찰가는 낙찰가보다 −2.1%', s.result.won===false&&near(s.result.winApp,23500/30000)&&near(s.result.winMkt,23500/28000)&&near(s.result.myVsWin,23000/23500-1)&&s.result.bidders===7);
  ok('내가 더 높게 썼으면 이김 · 같으면 tie', U.setResult(c,{status:'sold',win:22900},'t').result.won===true&&U.setResult(c,{status:'sold',win:23000},'t').result.won==='tie');
  threw=false; try{ U.setResult(s,{status:'sold',win:1},'t'); }catch(e2){ threw=/이미/.test(e2.message); }
  ok('결과는 한 번만(지난 기록은 고치지 않음)', threw);
  threw=false; try{ U.editBid(s,24000,{},'t'); }catch(e2){ threw=/바꿀 수 없/.test(e2.message); }
  ok('결과를 넣은 뒤엔 입찰가를 못 바꾼다', threw);
  const un=U.setResult(c,{status:'unsold'},'t');
  ok('유찰이면 낙찰가 없이 기록', un.result.status==='unsold'&&un.result.win===undefined);
  const S=U.ledgerSummary([s,un,U.setResult(c,{status:'sold',win:22000},'t'),c]);
  ok('장부 요약: 4건 · 결과 3 · 낙찰 2 · 유찰 1 · 이겼을 것 1 · 평균 낙찰가율', S.n===4&&S.done===3&&S.sold===2&&S.unsold===1&&S.won===1&&near(S.avgWinApp,(23500+22000)/2/30000)&&near(S.avgWonDisc,c.snap.disc), JSON.stringify(S));
}

console.log('[부동산 클로드 경매] 온비드 공매 — 회차를 물건으로 묶기 · 요약 · 분석 칸으로');
{
  const T='2026-11-08';
  const its=[
    // 아파트 A: 1회차 유찰 → 2회차 진행 예정(최저가 4.5억)
    {cltrMngNo:'A',name:'둔산동 ○○아파트',usage:'주거용건물 > 아파트',appraisal:50000,minPrice:50000,round:'1',fails:0,bidEnd:'2026-11-04 17:00',status:'유찰',onbidCltrno:'2026-A'},
    {cltrMngNo:'A',name:'둔산동 ○○아파트',usage:'주거용건물 > 아파트',appraisal:50000,minPrice:45000,round:'2',fails:1,bidEnd:'2026-11-11 17:00',status:'입찰준비중',onbidCltrno:'2026-A'},
    // 아파트 B: 1회차 유찰 → 2회차 낙찰(결과 금액 있음) → 3회차 취소
    {cltrMngNo:'B',name:'한솔동 ○○아파트',usage:'아파트',appraisal:30000,minPrice:30000,round:'1',bidEnd:'2026-10-01 17:00',status:'유찰'},
    {cltrMngNo:'B',name:'한솔동 ○○아파트',usage:'아파트',appraisal:30000,minPrice:27000,round:'2',bidEnd:'2026-10-08 17:00',status:'낙찰',result:{status:'낙찰',win:28000,bidders:4}},
    {cltrMngNo:'B',name:'한솔동 ○○아파트',usage:'아파트',appraisal:30000,minPrice:24000,round:'3',bidEnd:'2026-10-15 17:00',status:'취소'},
    // 상가 C: 다 취소 · 지난 회차만
    {cltrMngNo:'C',name:'유성 상가',usage:'상가용및업무용건물',appraisal:20000,minPrice:10000,round:'5',bidEnd:'2026-10-28 17:00',status:'취소'},
    // 땅 D: 낙찰(금액 모름 — 입찰결과 API 권한 전) · 감정가가 회차에 따라 빈 값
    {cltrMngNo:'D',name:'대지',usage:'토지 > 대지',appraisal:null,minPrice:5000,round:'1',bidEnd:'',status:'낙찰'},
    // E: 낙찰 뒤 잔금 안 내 재공매 — 새 회차가 열려 있으면 진행 중
    {cltrMngNo:'E',name:'재공매 상가',usage:'상가',appraisal:10000,minPrice:9000,round:'1',bidEnd:'2026-10-01 17:00',status:'낙찰'},
    {cltrMngNo:'E',name:'재공매 상가',usage:'상가',appraisal:10000,minPrice:9000,round:'2',bidEnd:'2026-11-20 17:00',status:'입찰준비중'},
    // F: 앞으로 있을 회차가 취소됨 → 끝남 / G: 상태는 준비중인데 마감일이 지남(묵은 자료) → 끝남
    {cltrMngNo:'F',name:'취소된 예정',usage:'대지',appraisal:5000,minPrice:5000,round:'1',bidEnd:'2026-11-20 17:00',status:'취소'},
    {cltrMngNo:'G',name:'묵은 준비중',usage:'대지',appraisal:5000,minPrice:5000,round:'1',bidEnd:'2026-10-01 17:00',status:'입찰준비중'}];
  const G=U.onbidGroups(its,T),g=k=>G.find(x=>x.key===k);
  ok('회차를 물건으로: 11줄 → 7물건', G.length===7);
  ok('A: 진행 중 · 다음 회차 2회차(11-11) · 지금 최저가 4.5억', g('A').state==='open'&&g('A').next.round==='2'&&g('A').minNow===45000&&g('A').rounds.length===2&&g('A').apt);
  ok('B: 낙찰(2회차 2.8억 · 4명) — 뒤 회차 취소는 상관없음', g('B').state==='sold'&&g('B').sold.round==='2'&&g('B').win===28000&&g('B').bidders===4&&g('B').next===null);
  ok('C: 끝남(다 취소·지난 회차)', g('C').state==='done'&&g('C').next===null&&!g('C').apt);
  ok('D: 낙찰이지만 금액 모름 · 감정가 없음', g('D').state==='sold'&&g('D').win===null&&g('D').appraisal===null);
  ok('E: 낙찰 뒤 재공매 회차가 열려 있으면 진행 중(지난 낙찰은 기록으로)', g('E').state==='open'&&g('E').next.round==='2'&&g('E').sold.round==='1');
  ok('F: 앞으로 있을 회차가 취소면 끝남 · G: 마감일 지난 준비중은 끝남', g('F').state==='done'&&g('G').state==='done');
  ok('진행 중이 먼저(마감 가까운 순)', G[0].key==='A'&&G[1].key==='E');
  const all=U.onbidSummary(G),apt=U.onbidSummary(G,true);
  ok('요약: 7물건 · 진행 2 · 낙찰 2 · 끝남 3 · 금액 있는 낙찰 1(감정가 대비 93.3%) · 평균 4명', all.n===7&&all.open===2&&all.sold===2&&all.done===3&&all.priced===1&&near(all.avgWinApp,28000/30000)&&near(all.avgBidders,4), JSON.stringify(all));
  ok('아파트만: 2물건 · 진행 1 · 낙찰 1', apt.n===2&&apt.open===1&&apt.sold===1);
  const c=U.onbidToCase(g('A'));
  ok('분석 칸으로: 다음 회차 최저가 · 유찰 횟수 · 마감일 · 물건 감정가', c.court==='온비드 공매'&&c.caseNo==='2026-A'&&c.appraisal===50000&&c.minPrice===45000&&c.fails===1&&c.saleDate==='2026-11-11');
  const a=U.analyze({appraisal:c.appraisal,minPrice:c.minPrice,round:c.fails+1,bid:46000,market:52000},{},NOW);
  ok('공고 최저가가 있으면 그 값을 쓴다(저감 계산 안 함)', a.minPrice===45000&&a.deposit===4500);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
