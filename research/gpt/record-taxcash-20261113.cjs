'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),LOG=path.join(ROOT,'research/im_plan/RESEARCH_LOG_GPT.md');
const read=f=>JSON.parse(fs.readFileSync('/tmp/'+f+'-20261113.json'));
const real=read('jkq-pf-taxcash-real'),syn=read('jkq-pf-taxcash-synthetic'),audit=read('jkq-pf-taxcash-audit'),alloc=read('jkq-pf-cash-allocation'),decomp=read('jkq-pf-taxcash-decomposition');
const A=real.sets.real,S=syn.sets.syn,O=syn.sets.oos,names={'10k':'1만$ 거치','100k':'10만$ 거치',user:'3만$+월210$'};
const q=(a,p=.5)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)],f=(x,n=4)=>x==null?'—':x.toFixed(n),sgn=x=>(x>=0?'+':'')+f(x,3),ci=a=>'['+a.map(x=>f(x)).join('~')+']';
if(!A||!S||!O||Object.keys(O).length!==3||Object.keys(alloc.sets).length!==3||Object.keys(decomp.sets).length!==3)throw Error('missing completed batch');
const n=Object.values(A).concat(Object.values(S),Object.values(O)).reduce((a,s)=>a+s.rows.length,0);if(n!==1503)throw Error('wrong window count');
if(decomp.maxParity!==0)throw Error('decomposition default changed');
const lines=[
'\n### 2026-11-13 · 포트폴리오 후속 결과 — 실제출금 검증 완료 / H90 후보 탈락',
'',
'- **실행 완료·후보 탈락, 새 실투자 권유 없음.** 원격 사전등록 `a94495590e0f91cc0d68355ee2dc2b9ce06a815e` 후에 계산했다. 사용자 H90의 세후 짝 등가연 차 **+0.0674%p < 사전 +0.1%p**, 5년 끝값 짝 비는 **1.002475(약+0.25%)**다. 개선은 있으나 사용자 규모에서 전략 변경을 권할 크기가 아니며 기준을 낮추지 않았다. 모든 관문 통과 후보가 아니므로 REPLICATION.md에 발견 요청을 올리지 않는다. H80/H95/E90도 추가 발견으로 고르지 않았다.',
'- 완료 범위: 직전 미완료였던 **전환 후 듀얼의 실제 세금현금 차감·부족액 자산매도·다음날 주수/신호 반영**을 연구용 고리에서 실행했다. 일반 투자신호는 원본 replay, 세금/절세 강제매도도 원본 targetOrders, 섀넌은 전체 backtest.html native runIVS다. 새로운 간이 체결 엔진은 없다. 앱·실계좌·배포·주문은 바꾸지 않았다. 현재 선택은 공포모드v1.1 듀얼5/6+섀넌USD1/6, 월210$ 듀얼, 다리 사이 맞춤 없음, 무매는 사이클 끝난 뒤 정한 배분으로 전환이다.',
'',
'**실제128개5년짝 · 실제출금 기준 B 대 H90**',
'',
'| 규모 | 세후 끝값 짝 비 [블록5~95%] | 승/창 | 짝 연 차 %p [블록5~95%] | 앞/뒤 끝값 비 | 짝 ΔMDD 중앙 / 최악MDD 차 %p | 가장 나쁜 짝 ΔMDD %p |',
'|---|---|---|---|---|---|---|'];
for(const [key,set]of Object.entries(A)){const r=set.summary.H90;lines.push(`| ${names[key]} | ${f(r.ratio)} ${ci(r.ratioCI)} | ${r.wins}/${r.n} | ${sgn(r.annDelta)} ${ci(r.annCI)} | ${f(r.front.ratio)}/${f(r.back.ratio)} | ${sgn(r.deltaMdd)} / ${sgn(r.deltaMaxMdd)} | ${sgn(r.worstPairMdd)} |`);}
lines.push('',
'- 연 차는 먼저 창마다 짝을 빼고 중앙을 구했다. 거치는 CAGR 차, 적립 사용자는 끝값/누적입금 등가연율 차이며 IRR이 아니다. 분포 중앙끼리 빼서 방향을 만들지 않았다. 모든 중앙은 기존 도구와 같은 하위 중앙 순서통계다. MDD는 두 다리의 실제 세후 일별 평가를 합친 뒤 신규입금을 제거한 단위곡선으로 잰다. 분포 최악이 낮아도 개별창은 일부 악화되며 위 마지막 열로 공개했다. pf_app의 혼합TWR은 판정에서 제외했다.',
'',
'| 규모 | B→H90 세후 연 중앙(%) | B→H90 MDD 중앙/최악(%) | H90 끝값 짝 비 하10/상10 |',
'|---|---|---|---|');
for(const [key,set]of Object.entries(A)){const b=set.summary.base,r=set.summary.H90;lines.push(`| ${names[key]} | ${f(b.annualMedian,2)}→${f(r.annualMedian,2)} | ${f(b.mdd,2)}/${f(b.maxMdd,2)}→${f(r.mdd,2)}/${f(r.maxMdd,2)} | ${f(r.ratio10)}/${f(r.ratio90)} |`);}
lines.push('',
'**합성·표본 밖·앞뒤·이웃도 실행 완료**',
'',
'| 자료/규모 | H90 끝값 짝 비 [블록5~95%] · 승/창 | 앞/뒤 비 | 시작2000~05 / 2006~10 비 | 짝 연 차 / ΔMDD 중앙 / 최악MDD 차 %p | 반토막 B→H90 · 새90%꼬리 · 0계좌 |',
'|---|---|---|---|---|---|');
for(const [ds,sets]of [['합성2000~',S],['NDX/TQQQ대용1990~99',O]])for(const [key,set]of Object.entries(sets)){const b=set.summary.base,r=set.summary.H90;lines.push(`| ${ds} ${names[key]} | ${f(r.ratio)} ${ci(r.ratioCI)} · ${r.wins}/${r.n} | ${f(r.front.ratio)}/${f(r.back.ratio)} | ${f(r.oosEarly.ratio)}/${f(r.oosLate.ratio)} | ${sgn(r.annDelta)} / ${sgn(r.deltaMdd)} / ${sgn(r.deltaMaxMdd)} | ${b.halfLoss}→${r.halfLoss} · ${r.newTail} · ${r.zero} |`);}
lines.push('',
'| 규모 | 실제 H80/H90/H95/E90 Δ연 %p | 합성 같은4판 끝값 짝 비 |',
'|---|---|---|');
for(const k of Object.keys(A))lines.push(`| ${names[k]} | ${['H80','H90','H95','E90'].map(v=>sgn(A[k].summary[v].annDelta)).join(' / ')} | ${['H80','H90','H95','E90'].map(v=>f(S[k].summary[v].ratio)).join(' / ')} |`);
lines.push('',
'- 실제 두 원금·사용자 및 합성/다른기초 대용·앞뒤에서 작은 수익 우위 방향은 대부분 유지된다. 실제0계좌/반토막/새90%꼬리는0. 그러나 주 후보 사용자 기준을 못 넘었으므로 전체 통과가 아니다. 합성은 앞서 비용을 맞춘 모형/창시작100$ 재기준 원본 정수주 replay이며, 1990년대는 두 듀얼 다리가 NDX에 기대는 구조 대용이다. 실제 USD의 독립 표본이라고 말하지 않는다. 12창블록2000회 구간도 겹치는5년창·희소위기·후보선택을 전부 보정한 유의확률이 아니다.',
'',
'**사후 원인분해 — 새 후보로 선택하지 않음**',
'',
'| 규모 | H90 전체 / 공제채우기만 / 손실상계만 Δ연 %p | 전체 H90의 채우기/상계 실행 건수(겹친128창 합) |',
'|---|---|---|');
for(const [k,set]of Object.entries(decomp.sets))lines.push(`| ${names[k]} | ${['H90','fill','offset'].map(v=>sgn(set.summary[v].annDelta)).join(' / ')} | ${set.fills}/${set.offsets} |`);
lines.push('',
'- 사용자 규모에서는 채우기만 +0.0646%p, 상계만 중앙0으로 **남는 연 공제를 사용해 원가를 올리는 몫**이 대부분이다. 큰 원금은 공제가 상대적으로 작아 효과가 줄며, 10만$에선 손실상계의 몫도 있다. 둘의 효과는 정수주·매매경로 상호작용 때문에 단순 합이 아니다. 옵션을 안 준 H90은 본 배치와 3규모×128창의 끝값/MDD/세금/수수료 전부 차0. 새 옵션으로 좋아 보이는 한 판을 골라 문턱을 바꾸지 않았다.',
'- 보충 공개 원문(결과 후 원인 설명용으로 읽음): Hayden Adams, Schwab, 2025-08-07, https://www.schwab.com/learn/story/how-to-save-money-with-tax-gain-harvesting . 미국의 낮은 장기양도세 구간에서 이익 실현/재매수로 원가를 올리는 절차를 설명한다. 한국 연250만원 공제·22%를 적용한 본 시험은 미국 원문 결과의 재현이 아니다. 손실 매도 뒤 같은 ETF를 즉시 되사는 모형 가정도 미국 wash-sale과 다르며 한국 실무 적격성을 이 백테스트만으로 보증하지 않는다.',
'',
'**원본·현금·사람단위 세금 감사**',
'',
`- 주 배치 실제384+합성774+대용345 = **1,503 계좌창×5판=7,515번** 실제 현금지급/세금 합계 검사. 고리OFF 원본 replay 전체 JSON(장부/NAV 포함) ${real.audit.nativeReplay+syn.audit.nativeReplay}건 동일, 섀넌 관측 원본 final/tax/fee/trade ${real.audit.nativeIVS+syn.audit.nativeIVS}건 동일. 사람단위 합계오차 최대 ${f(Math.max(real.audit.maxTaxError,syn.audit.maxTaxError),12)}$. 공제는 합계에서1회만, 손익은 같은 해 두 다리를 합산했고 실제 섀넌 납부와 듀얼 차액 납부를 맞췄다. 가상 세후비율로 현금을 지급한 척하지 않았다.`,
`- 별도 독립 장부 복원 ${audit.cases.length}계좌·${audit.cases.reduce((a,x)=>a+x.navDays,0)}일: 초기현금+입금+배당+매도−매수−수수료−세금(+환급)으로 재구성한 현금 최대오차 ${f(Math.max(...audit.cases.map(x=>x.maxCashError)),10)}$, 보유수량/NAV 일치, 독립 연간세금 오차 최대 ${f(Math.max(...audit.cases.map(x=>x.maxTaxError)),12)}$. 월초외부입금은 최초달 제외 실제 월변경수×210와 일치하며 세금/환급으로 누적납입을 바꾸지 않았다. 현재 TECL/TQQQ 종가50%변이 ${audit.mutations.length}건에도 그날의 일반 신호/목표주수는 불변이었다. 절세 의도는 전일 장부/가격/섀넌yearPnl에서 생성하고 집행 때 보유/현금만 한도로 줄였다.`,
'- 세금 부족액은 SGOV→TECL→TQQQ 순서로 native targetOrders를 통해 팔아 실제 현금으로 냈다. 일반 주문 뒤 처리하여 당일 세금매도 결과가 당일 일반 신호로 새지 않고 다음 날 상태로 반영된다. 끝날 양쪽 전량매도·각자 수수료·세금 정산까지 수행해 잔여 DG/섀넌 주수0을 확인했다. 소진/지급불능은 중단하도록 했으며 완료 배치에는 발생하지 않았다. 첫 스모크의 재매수 수량 부족과 수수료반올림/1센트 여유 수정은 앞 실패 행에 남겼다.',
'',
'**현재 배분 방향과 모형 한계**',
'',
'| 규모 | 기존 규약 원본 5/6 대2/3 비 · 승/128 | 실제출금/전량청산 모형 비 [블록구간] · 승/128 | 실제출금 앞/뒤 비 · 짝 ΔMDD 중앙 %p |',
'|---|---|---|---|');
for(const k of Object.keys(A)){const a=real.orientation[k],b=alloc.sets[k].summary;lines.push(`| ${names[k]} | ${f(q(a))} · ${a.filter(x=>x>1).length} | ${f(b.ratio)} ${ci(b.ci)} · ${b.wins} | ${f(b.front)}/${f(b.back)} · ${sgn(b.deltaMdd)} |`);}
lines.push('',
'- **5/6:1/6 전체 방향 반전 없음.** 원본 규약 값은 직전 회차의 하위중앙 통계와 정확히 같았다. 이번 API JSON 일부 조정 series에0.0001 단위 역사표기 차이가 있었지만 원본 체결가 역할/ohlcTrade는 그대로였고 이 기준 배분 수치는 같았다. 중간 두 중앙을 평균하는 통계와 기존 하위중앙을 섞어 수치변화로 해석하지 않았다.',
'- 새 실제출금 B / 기존 규약 L9 끝값 비 중앙은 '+Object.entries(A).map(([k,s])=>names[k]+' '+f(q(s.rows.map(x=>x.physicalVsCanonical)))).join(' · ')+'. **이 차이는 실제출금만의 효과가 아니라 마지막 청산수수료·섀넌 청산세·환급 귀속 경로도 함께 바꾼 모형 차이**다. 공인 앱 수익 또는 새 alpha라고 부르지 않는다. 후보 판정은 B와H90에 이 모든 규약을 동일 적용했다.',
'- 한계: 환율1350 고정·달력연도 거래일 기준 세금 모형, 실제 법정 납부시점/결제일·환급시차와 차이, TC의 결제일 마감/연도 추정과 엔진 거래일 장부 차이, 배당락일 현금지급 근사, 세금 조달 SGOV 우선·환급 듀얼 귀속 선택, 합성 가격단위 재기준과 과거 비용보정, 관리자 개인 설정 미조회. **전환 후 연구 현금경로 감사는 완료했지만 실제 브로커 세금·시세·실행까지 검증한 것이 아니다.** 무매→전환연도 상계/공제 통합은 별도 미완료로 남긴다. 실제 적용을 권할 새 근거로 승격하지 않았다.',
'',
'**시장·명령·다음**',
'',
'- 11-12 확정시장: SOXL65.53$, TECL150.95$, TQQQ59.88$, VIX18.70, 원본 공포모드 무장/빠른모드OFF·GuardOFF. 내 실계좌 설정/주문 상태를 조회한 값은 아니다.',
'- 실행: 새 clone/fetch/fast-forward/main 합치기 → `node research/gpt/run.cjs --environment` → 지정 fetch.sh/synsplit.js/planrule/fetch.sh 및 USD/GLDM API/synusd.js/mkdca_data.js → `DS=real node research/gpt/portfolio-taxcash-20261113.cjs /tmp/jkq-pf-taxcash-real-20261113.json`; `DS=syn,oos node research/gpt/portfolio-taxcash-20261113.cjs /tmp/jkq-pf-taxcash-synthetic-20261113.json`; `node research/gpt/audit-taxcash-20261113.cjs /tmp/jkq-pf-taxcash-audit-20261113.json`; `node research/gpt/allocation-taxcash-20261113.cjs /tmp/jkq-pf-cash-allocation-20261113.json`; `node research/gpt/decompose-taxcash-20261113.cjs /tmp/jkq-pf-taxcash-decomposition-20261113.json`; `node research/gpt/record-taxcash-20261113.cjs`. 모든 배치 exit0·자체도구 문법/diff 검사는 실제 실행 로그로 확인했다.',
'- 엔진/입력 SHA256: '+Object.entries(real.files).map(([p,h])=>p+'='+h).join(' · ')+'. 자료는 매회 갱신했고 확정주식 끝11-12이며 미확정 금 봉은 사용하지 않았다. 원금3벌 규칙은 이번 무매 없는 후보에는 적용 대상이 아니다. 원본 앱/클로드 로그/공유표 수정0·main 쓰기/PR/배포/실주문/무매 외부게시0.',
'- 다음: 현재 배분과 월210$ 듀얼 적립을 유지한다. 이미 탈락한 월말추세·설정200격자를 반복하지 않고 **무매 사이클 종료 전환연도의 사람단위 상계·공제 연결** 또는 아직 안 끝낸 새 각도를 결과 전 등록한다. 클로드 재현 대기가 생기면 우선한다. 이번은 완료·탈락이며 반복연구 자체를 중단하는 조건은 아니다.'
);
const prior=fs.readFileSync(LOG,'utf8');if(prior.includes('### 2026-11-13 · 포트폴리오 후속 결과 — 실제출금 검증 완료'))throw Error('already recorded');fs.appendFileSync(LOG,lines.join('\n')+'\n');
console.log(JSON.stringify({recorded:true,windows:n,physicalCases:n*5,newCandidate:false,reason:'user annual improvement below preregistered +0.1pp'}));
