'use strict';
// All detailed results go to the GPT log only. Raw arrays stay reproducible
// in scratch; no app files, Claude log, or replication requests are changed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),LOG=path.join(ROOT,'research/im_plan/RESEARCH_LOG_GPT.md');
const real=JSON.parse(fs.readFileSync('/tmp/jkq-pf-monthly-real-20261113.json')),syn=JSON.parse(fs.readFileSync('/tmp/jkq-pf-monthly-synthetic-20261113.json')),audit=JSON.parse(fs.readFileSync('/tmp/jkq-pf-audit-20261113.json'));
const fmt=(x,d=3)=>x==null?'—':(+x).toFixed(d),signed=x=>(x>=0?'+':'')+fmt(x),ci=a=>'['+a.map(x=>fmt(x,4)).join('~')+']',m=(a,p=.5)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)];
const A=real.sets.real,S=syn.sets.syn,O=syn.sets.oos,names={"10k":'1만$ 거치',"100k":'10만$ 거치',user:'3만$+월210$'};
if(!A||!S||!O||Object.keys(O).length!==3||audit.parity.n!==258)throw Error('required batch incomplete');
const rows=[...Object.values(A),...Object.values(S),...Object.values(O)].flatMap(s=>s.rows);
if(rows.length!==1503)throw Error('expected 1503 account-windows, got '+rows.length);
const lines=[
'\n### 2026-11-13 · 포트폴리오 결과 — 실행 완료·후보 탈락 / 기준선 재현 확인',
'',
'- **판정: 새 실투자 권유 전략 없음. F10과 이웃F9/F11 탈락.** 결과 전 사전등록은 원격 `e7aa08be849d52897f06c50aefc8b4960aacc764`에 저장한 뒤 계산했다. 실제128창·합성258창·다른기초자산 대용115창 × 3규모 = **1,503 계좌창·4판=6,012번** 사람단위 세금 장부 검사까지 끝냈다. 이번은 클로드 발견 후보를 재현한 회차가 아니라 내 새 적용 후보 시험이다. 재현 확인은 기존 기준선에 대한 것이며 새 전략 재현 승격이 아니다. REPLICATION.md에 새 요청을 올릴 대상은 없다.',
'- 현재 비교 정본/현재 유지 선택: **공포 모드 듀얼가드v1.1 5/6 + 섀넌USD1/6, 월210$ 듀얼 입금, 다리 사이 맞춤 없음, 무매1만$는 사이클 종료 뒤 섀넌5천$+듀얼5천$**. 이미 산 적립종목 보유만. 실계좌 설정·앱·주문은 이 회차에서 바꾸지 않았다.',
'',
'**실제 자료 · 매달 시작5년128짝 · F10 대 L9**',
'',
'| 규모 | 세후 끝값 짝 비 중앙 [12창블록5~95%] | 이긴 창 | 짝 세후 연 차 %p [5~95%] | 앞/뒤 끝값 비 | 짝 ΔMDD 중앙 / 최악MDD 차 %p | 가장 나쁜 짝 ΔMDD %p |',
'|---|---|---|---|---|---|---|'];
for(const [key,set] of Object.entries(A)){const r=set.summary.F10;lines.push(`| ${names[key]} | ${fmt(r.ratio,4)} ${ci(r.ratioCI)} | ${r.wins}/${r.n} | ${signed(r.annDelta)} ${ci(r.annCI)} | ${fmt(r.front.ratio,4)}/${fmt(r.back.ratio,4)} | ${signed(r.deltaMdd)} / ${signed(r.deltaMaxMdd)} | ${signed(r.worstPairMdd)} |`);}
lines.push('',
'- 위 연 차는 **짝별** 값을 먼저 뺀 중앙이다. 거치1만/10만$는 CAGR 차, 사용자 적립 계좌는 끝값/누적입금의 등가연율 차로 IRR이 아니다. MDD는 두 다리 세후곡선에서 당일 입금을 뺀 단위 수익률이다. 최악MDD 차는 분포 최대끼리의 차이이며, 가장 나쁜 짝 ΔMDD와 다르다. F10의 분포 최악은 줄어도 개별 창 MDD는 +1.3~+1.6%p 커졌다. 혼합 세전/세후 pf_app TWR은 판정에 쓰지 않았다.',
'',
'| 규모 | L9 세후 연 중앙 → F10(%) | L9 MDD 중앙/최악 → F10(%) | F10 끝값 하10비/상10비 |',
'|---|---|---|---|');
for(const [key,set] of Object.entries(A)){const b=set.summary.base,r=set.summary.F10;lines.push(`| ${names[key]} | ${fmt(b.annualMedian,2)} → ${fmt(r.annualMedian,2)} | ${fmt(b.mdd,2)}/${fmt(b.maxMdd,2)} → ${fmt(r.mdd,2)}/${fmt(r.maxMdd,2)} | ${fmt(r.ratio10,4)}/${fmt(r.ratio90,4)} |`);}
lines.push('',
'**합성·표본 밖·이웃 — 전부 실행, 실제 실패를 숨기지 않음**',
'',
'| 합성2000~ 규모 | F10 끝값 비 [블록5~95%] · 이긴창 | 앞/뒤 비 | 시작2000~05 / 2006~10 비 | 짝 Δ연 / ΔMDD 중앙 / 최악MDD 차 %p |',
'|---|---|---|---|---|');
for(const [key,set] of Object.entries(S)){const r=set.summary.F10;lines.push(`| ${names[key]} | ${fmt(r.ratio,4)} ${ci(r.ratioCI)} · ${r.wins}/${r.n} | ${fmt(r.front.ratio,4)}/${fmt(r.back.ratio,4)} | ${fmt(r.oosEarly.ratio,4)}/${fmt(r.oosLate.ratio,4)} | ${signed(r.annDelta)} / ${signed(r.deltaMdd)} / ${signed(r.deltaMaxMdd)} |`);}
lines.push('',
'| 1990~99시작 TQQQ 대용115창 | F10 끝값 비 · 이긴창 | 앞/뒤 비 | 짝 Δ연 / ΔMDD 중앙 / 최악MDD 차 %p |',
'|---|---|---|---|');
for(const [key,set] of Object.entries(O)){const r=set.summary.F10;lines.push(`| ${names[key]} | ${fmt(r.ratio,4)} · ${r.wins}/${r.n} | ${fmt(r.front.ratio,4)}/${fmt(r.back.ratio,4)} | ${signed(r.annDelta)} / ${signed(r.deltaMdd)} / ${signed(r.deltaMaxMdd)} |`);}
lines.push('',
'| 규모 | 실제 F9 / F10 / F11 끝값 비 | 합성 F9 / F10 / F11 끝값 비 |',
'|---|---|---|');
for(const key of Object.keys(A))lines.push(`| ${names[key]} | ${['F9','F10','F11'].map(k=>fmt(A[key].summary[k].ratio,4)).join(' / ')} | ${['F9','F10','F11'].map(k=>fmt(S[key].summary[k].ratio,4)).join(' / ')} |`);
lines.push('',
'- 실제 세 규모에서 F10 이긴창은2~3/128뿐이며 앞뒤 모두1미만이다. 이웃9/11개월도 실제끝값비1미만이라 매개변수 한 점을 잘못 골라서 생긴 결과가 아니다. 합성의 앞 절반/닷컴 구간에서는 추세 대피가 낫지만 뒤 절반은 반대로 수익을 깎았다. TQQQ 대용의 좋고 나쁨을 USD의 독립 실제 검증이라고 해석하지 않는다. 합성은 기존 비용보정/가격재기준 모형이므로 진짜 미관측 표본이 아니다. 겹친5년창·후보선택·희소위기를 블록2000회가 전부 보정하는 것도 아니다.',
'- 0계좌·새90%꼬리·반토막 증가도 검사했다. 실제F10은 반토막0·0계좌0·새90%꼬리0. 합성/대용의 기준 대비 반토막 수와 개별 악화는 다음과 같다: '+[...Object.entries(S).map(([k,s])=>`합성${names[k]} ${s.summary.base.halfLoss}→${s.summary.F10.halfLoss}, 새90%${s.summary.F10.newTail}, 0계좌${s.summary.F10.zero}`),...Object.entries(O).map(([k,s])=>`대용${names[k]} ${s.summary.base.halfLoss}→${s.summary.F10.halfLoss}, 새90%${s.summary.F10.newTail}, 0계좌${s.summary.F10.zero}`)].join(' · ')+'. 수익 기준에서 먼저 탈락하므로 위험 감소를 공통 개선으로 승격하지 않는다.',
'',
'**원인·회계 감사**',
'',
'| 규모 | 가장 나쁜 실제 F10 창 | 끝값 비 | 해당창 섀넌 다리→F10 끝값($) | secondary 수수료 차 / 거래수 차 |',
'|---|---|---|---|---|');
for(const [key,set] of Object.entries(A)){const r=set.rows.reduce((a,b)=>a.v.F10.final/a.v.base.final<b.v.F10.final/b.v.base.final?a:b);lines.push(`| ${names[key]} | ${r.s} | ${fmt(r.v.F10.final/r.v.base.final,4)} | ${fmt(r.v.base.secondary,0)}→${fmt(r.v.F10.secondary,0)} | ${fmt(r.v.F10.fees-r.v.base.fees,2)}$ / ${r.v.F10.trades-r.v.base.trades} |`);}
lines.push('',
'- 거래·수수료가 줄어도 끝값이 낮아졌다. 비용 절감이 월말 대피/재진입 지연과 USD 상승 노출 감소를 메우지 못했다. 이 표는 가장 나쁜 창의 다리값이고 전체 포트폴리오 값/독립 사건 수로 바꿔 쓰지 않는다. runMA200의 bill 대기금리와 runIVS의 국채세·보수·반대편 수수료는 앱 원래 규약의 차이까지 유지했다. 따라서 공정한 원문 Faber vs 원문 섀넌 비교가 아니라 사용자 앱 전략 다리 교체의 실험이다.',
'- 기존 `pf_app.js` 자체를 Playwright로 실행한43창×3규모×비중2개=258건을 내 새 관측/듀얼장부와 대조: 최대 끝값 차 '+fmt(audit.parity.maxFinalError,12)+'$. 관측 고리를 끈 native runIVS도 매번 final/tax/fee/trade가 정확히 같다. 월말신호 교체를 끈 runMA200도 '+audit.maNativeCases+'건 원본과 동일하고 같은9건의 native 끝매도 후 잔여주수0을 확인했다. 독립 월말 신호 계산은4978일×3길이 모두차0, 오늘 종가90%변이4건의 전일·그 이전 신호 변화0. 앱 전체 HTML을 실제 Chromium에서 열었고 대체 간이 체결엔진은 없다.',
'- 사람단위 산출세 = 두 다리 같은 해 손익합−공제1회에22%. native 세금 요청액이 아닌 실제납부를 기록하고 미납액은 부채로 평가에서 빼자 **6,012 계좌판 전부 검산**, 최대 합계오차 '+fmt(Math.max(real.audit.maxPersonTaxError,syn.audit.maxPersonTaxError),12)+'$. 수작업5사례(손실상계·남은공제·부호반대 등)도 일치. 초기 실패와 원인/수정은 앞 기록에 보존했다. 실제L9의 누적 미납 부채 최대는 '+Object.entries(A).map(([k,s])=>{const debt=s.rows.map(r=>Object.values(r.v.base.years).reduce((a,y)=>a+Math.max(0,y.target-y.paid),0));return names[k]+' '+fmt(Math.max(...debt),3)+'$';}).join(' · ')+'. 앱 코드는 고치지 않았다.',
'',
'| 규모 | native 섀넌 끝청산을 넣은 전체 끝값 비 중앙(기존 미청산 대비) | 섀넌 누락 청산비용·세금 최대($) | 합산세 차액 모형 / 공제분할 청산 모형 끝값 비 중앙 |',
'|---|---|---|---|');
for(const [key,set] of Object.entries(A)){const a=set.audit;lines.push(`| ${names[key]} | ${fmt(a.terminalRatio,5)} | ${fmt(a.terminalOmissionMax,2)} | ${fmt(a.nettingRatio,6)} |`);}
lines.push('',
'- 앞 회차의 미완료 중 **전환 후 L9의 청산 누락 측정·사람단위 세금 합계 감사**는 위 범위에서 마쳤다. 그러나 (1) 듀얼은 세금 가상단위 차감이라 실제 세금출금 주문/재맞춤이 없고 (2) 섀넌의 세금차액은 섀넌 현금으로 돌려 배분경로를 선택했으며 (3) 미납부채의 이자/뒤 실제출금은 없고 (4) 듀얼 끝평가익 세금은 기존 afterTax 규약(가상청산·마지막 매도수수료 없음), 섀넌은 native 실제sell 수수료를 적용했다. **완전히 동일한 실계좌 통합 청산엔진 검증이라고 하지 않는다.** 무매→전환연도의 공제·계좌간 상계는 여전히 미완료다. 위 아주 작은 합산세 차이를 실투자 개선으로 권하지 않는다.',
'',
'**5/6 방향·시장·보존·다음**',
'',
'- 요청한 앱 체결가 방향 점검(현재v1.1, 기존과 같은 공제비중/섀넌 미청산 규약을 양쪽에 동일 적용): '+Object.entries(real.orientation).map(([k,r])=>`${names[k]} 5/6대2/3 끝값비${fmt(r.ratio,4)}, ${r.wins}/${r.n}창 승, 앞/뒤${fmt(r.front,4)}/${fmt(r.back,4)}`).join(' · ')+'. **전체 방향 뒤집힘 없음**. 10만$ 뒤절반은1보다작다는 국소반례도 공개한다. 가이드의 종전v1.0 수치를 v1.1 숫자로 소급대체하지 않는다.',
'- 시장은11-12 확정종가: SOXL65.53$, TECL150.95$, TQQQ59.88$, VIX18.70. native replay 최신상태 GuardOFF·공포모드무장/빠른모드OFF. 내 투자잔고/실제 주문 제안이 아니다.',
'- 실행 명령: `node research/gpt/run.cjs --environment`; `cd research/im_plan && ./fetch.sh && node synsplit.js`; `cd planrule && ./fetch.sh`; USD/GLDM은같은API의 period1=0/period2현재/div=1; `node research/im_plan/synusd.js`; `node research/im_plan/mkdca_data.js`; `node research/gpt/run.cjs research/im_plan/pf_app.js /tmp/jkq-pf-app-20261113.json`; `DS=real node research/gpt/portfolio-monthly-20261113.cjs /tmp/jkq-pf-monthly-real-20261113.json`; `DS=syn,oos node research/gpt/portfolio-monthly-20261113.cjs /tmp/jkq-pf-monthly-synthetic-20261113.json`; `node research/gpt/audit-portfolio-20261113.cjs /tmp/jkq-pf-audit-20261113.json`; `node research/gpt/record-portfolio-20261113.cjs`.',
'- 원자료/엔진SHA256: '+Object.entries(real.files).map(([p,h])=>p+'='+h).join(' · ')+'. 끝날과 해시를 보존했지만 API의 향후 역사수정까지 막는 snapshot 보장은 아니다. GC=F 미확정 봉과 금 다리는 이번 판정에 사용하지 않았다. 자료는 요청대로 gitignore에 두고 상세 결과의 정본은 이 로그다.',
'- 판정 관문: 실제3규모 끝값비>1/이긴창>50%/블록하한≥1/앞뒤≥1 모두 실패. 이웃도 실패. 합성 전체/뒤 절반과 일부 표본 밖도 미달. 그래서 **실행 완료·후보 탈락**, 새 발견0·새 교차재현요청0·실투자 변경권유0. 실패 뒤 반복탐색으로 좋은 한 점을 고르지 않았다. 승인 요청·PR·main 푸시·배포·실주문·무매 외부게시0.',
'- 다음은 설정200격자를 반복하지 않고 **연말 세금 절차의 사람 단위 실제 현금출금과 이후 주수 영향**을 연구 전용 고리로 검증한다. 청산세/합산세의 이번 완료 범위와 아직 없는 실제 통합 경로를 구분한다. 클로드의 새 재현 대기가 생기면 그것부터 우선한다. 반복 연구가 계속 필요하므로 예약을 중단할 조건은 아니다.'
);
const text=lines.join('\n');
if(fs.readFileSync(LOG,'utf8').includes('### 2026-11-13 · 포트폴리오 결과 — 실행 완료'))throw Error('already recorded');
fs.appendFileSync(LOG,text+'\n');
console.log(JSON.stringify({recorded:true,accountWindows:rows.length,personTaxChecks:rows.length*4,newCandidates:0,log:LOG}));
