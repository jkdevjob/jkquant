'use strict';
// Render actual batch outputs into the user's one research-log destination.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),log=path.join(ROOT,'research/im_plan/RESEARCH_LOG_GPT.md');
const load=m=>JSON.parse(fs.readFileSync(`/tmp/jkq-channel-${m}-20261113.json`,'utf8'));
const A=load('dual'),R=load('rotation'),I=load('im'),U=load('audit');
if(A.end!=='2026-11-12'||Object.keys(A.sets).length!==3||Object.keys(R.sets).length!==4||Object.keys(I.sets).length!==4)throw Error('incomplete batch');
if(U.im.at(-1).disabled<1||U.im.at(-1).nonLadderDiff!==0||U.terminalChecks!==48)throw Error('incomplete audit');
const f=(x,n=3)=>Number.isFinite(x)?x.toFixed(n):String(x),signed=(x,n=3)=>(x>=0?'+':'')+f(x,n),ci=a=>a.map(x=>signed(x)).join('~');
const L=['','### 2026-11-13 · 운영 심층 보충 결과 — 실행 완료·세 갈래 탈락·새 실투자 권유 없음','',
'- **결론: 기존 공포모드 듀얼가드v1.1·현재 L9 배분 유지. 이번에 새로 실투자를 권유할 전략 없음.** 공개 터틀의 원문 전체를 탈락시킨 것이 아니라, 사전등록한 **종가채널 ETF 변형**을 시험해 탈락시켰다. 듀얼·무매·차례 로테이션을 실제·합성·주변값까지 끝냈다. 결과를 본 뒤 좋은 이웃을 다시 후보로 고르지 않는다.',
'- 사전등록은 계산 전 로컬커밋 `6fde5d3`에 고정했고, 원격 보존은 결과와 함께 한다(결과 전에 원격 푸시했다고 주장하지 않음). 원자료는 API로 새로 받아 fetch.sh→synsplit.js→planrule/fetch.sh 완료, 마지막 확정주식일11-12. 원본앱/클로드기록 수동수정0. 예약08:37/11:37 활성 확인 후 결과·중단 기준을 보완했고, 자동실행이 매일 성공했다고 주장하지 않는다.',
'', '**1. 듀얼 — 정상모드 Guard를 종가55/20채널로 교체(D55/20)**', '',
'- 기준은 사용자 선택 공포모드v1.1. 정상모드만 채널, 공포 빠른모드는 원래 판정. 표의 Δ연은 같은 시작/종료창의 세후연율 차를 먼저 뺀 중앙이며 중앙끼리 차가 아니다. 목돈은 CAGR, 적립 규모는 최종세후/누적투입의 등가연율로 IRR이 아니다. MDD는 native replay 세전NAV, 별도 세후단위MDD도 파일에서 따로 계산했다. 분포 최악차와 개별 최악짝차를 구분한다.', '',
'| 자료·규모 | 창 | 짝 Δ연 %p [12창블록5~95%] | 승 | 짝 ΔMDD / 분포최악차 / 최악짝차 %p | 앞/뒤 Δ연 %p |',
'|---|---:|---|---:|---|---|'];
for(const[ds,S]of Object.entries(A.sets))for(const[k,x]of Object.entries(S)){const p=x.summary.C55_20.pair;
 L.push(`| ${ds} ${k} | ${p.n} | ${signed(p.ann)} [${ci(p.annCI)}] | ${p.win}/${p.n} | ${signed(p.mdd)} / ${signed(p.maxMddDiff)} / ${signed(p.worstPairMdd)} | ${signed(p.front)} / ${signed(p.back)} |`);}
L.push('', '|  실제 이웃(종가 진입/이탈 일수) | 1만$ Δ연 | 10만$ Δ연 | 사용자2.5만$+210$ Δ연 |', '|---|---:|---:|---:|');
for(const v of Object.keys(A.variants))L.push(`| ${v} | ${signed(A.sets.real.lump10.summary[v].pair.ann)} | ${signed(A.sets.real.lump100.summary[v].pair.ann)} | ${signed(A.sets.real.user25.summary[v].pair.ann)} |`);
L.push('', '- 실제128창에서 중심후보는 두 목돈·사용자·모의 모두 승0창이다. 수익이 낮은 대신 native MDD 중앙은 감소했지만 일부 창은 커졌다. 1987~94시작96창(평가끝1999)의 대용에서는 수익이 늘어도 실제/2000~합성 열세를 뒤집지 못한다. 실제 앞뒤와 이웃이 모두 음수여서 공통 개선 탈락이다. 합성은 창시작100$ 가격재기준 정수주 대용이며 실제분할 등가/진짜 미관측 표본이 아니다.', '',
'**2. 차례 로테이션 — SOXL/TQQQ 종가채널 ETF 변형(C55/20)**', '',
'- 기준은 native runMA200의200일선/현금대피, 양쪽 같은 창·비용ON·원본 매도본문의 최종전량청산·같은 세금정산. native 미청산값도 별도 보관했다. 이 함수의 수수료0.25% 외 별도 슬리피지 인자는 없으므로0.05%를 추가 반영했다고 하지 않는다. 현금대피는 이자0, 원문 터틀의 선물·ATR단위·피라미딩과 다르다. 새로운 로테이션이 개선돼도 현 듀얼/전체 포트폴리오보다 나은지는 별도 문제지만, 이번은 로테이션 자체 기준도 못 넘었다.', '',
'| 자료·원금 | 창 | 짝 Δ세후CAGR %p [블록5~95%] | 승 | 짝 ΔMDD / 분포최악차 / 최악짝차 %p |', '|---|---:|---|---:|---|');
for(const[ds,x]of Object.entries(R.sets))for(const cap of['10000','100000']){const p=x.summary[cap].C55_20.pair;L.push(`| ${ds} ${cap}$ | ${p.n} | ${signed(p.ann)} [${ci(p.annCI)}] | ${p.win}/${p.n} | ${signed(p.mdd)} / ${signed(p.maxMddDiff)} / ${signed(p.worstPairMdd)} |`);}
L.push('', '| 실제SOXL 이웃 | 1만$ ΔCAGR %p | 10만$ ΔCAGR %p |','|---|---:|---:|');
for(const v of Object.keys(R.variants))L.push(`| ${v} | ${signed(R.sets.real.summary[10000][v].pair.ann)} | ${signed(R.sets.real.summary[100000][v].pair.ann)} |`);
const rr=R.sets.real.rows.filter(x=>x.cap===10000),b=rr.find(x=>x.v==='base'),c=rr.find(x=>x.v==='C55_20');
L.push('',`- 원인 분해(실제SOXL 전체 ${R.sets.real.first}~${R.end}, 1만$): 기준→채널의 세후끝값 ${f(b.full.final,2)}→${f(c.full.final,2)}$, CAGR ${f(b.full.ann)}→${f(c.full.ann)}%, MDD ${f(b.full.mdd)}→${f(c.full.mdd)}%, 보유일비율 ${f(b.full.timeIn)}→${f(c.full.timeIn)}%, 거래 ${b.full.trades}→${c.full.trades}회, 수수료 ${f(b.full.fees,2)}→${f(c.full.fees,2)}$. 수수료가 줄어도 성과가 악화하므로 거래비용 증가가 주원인은 아니다. 진입·이탈로 보유한 경로가 달라진 결과이며 55일이 아닌 주변값에서도 실제창 수익이 낮다. 신호독립검산·미래봉변경 검사를 통과했으므로 이 열세를 구현오류로 숨기지 않는다. 이 결론은 원문 터틀 전체 또는 모든 돌파법의 성과 판정이 아니다.`, '',
'**3. 무매 — TQQQ Guard OFF일 때만 하방1주LOC 줄 끄기(G0)**', '',
'- 현재autoTP/M10·20분할·복리·리버스OFF·큰수20 기준. 원금 ×.99/1/1.01의 각 경로를 창마다 평균, 위약은 그 원금에×1.003. G1/G2는OFF일에1/2줄 남김. ON이면모두3줄. 본매수·익절·정수주·분할·현금배당·세금정산은 native 그대로다. IM 최종값은 native 잔존보유+실현세 기준으로 로테이션 전량청산값과 섞지 않는다.', '',
'| 자료·원금 | 창 | G0 짝 Δ연 %p [블록5~95%] | 승 | 짝 ΔMDD / 최악짝차 / 상10% %p | 위약 최악짝차 / 상10% %p | 앞/뒤 Δ연 |', '|---|---:|---|---:|---|---|---|');
for(const[ds,x]of Object.entries(I.sets))for(const cap of['10000','100000']){const a=x.summary[cap].G0,p=a.pair,pl=x.summary[cap].PL3;L.push(`| ${ds} ${cap}$ | ${p.n} | ${signed(p.ann)} [${ci(p.annCI)}] | ${p.win}/${p.n} | ${signed(p.mdd)} / ${signed(p.worstPairMdd)} / ${signed(a.mdd90)} | ${signed(pl.pair.worstPairMdd)} / ${signed(pl.mdd90)} | ${signed(p.front)} / ${signed(p.back)} |`);}
L.push('', '| 실제SOXL 하방줄 이웃 | 1만$ Δ연 %p | 10만$ Δ연 %p |', '|---|---:|---:|');
for(const v of['G0','G1','G2','PL3'])L.push(`| ${v} | ${signed(I.sets.real.summary[10000][v].pair.ann)} | ${signed(I.sets.real.summary[100000][v].pair.ann)} |`);
L.push('', '- 실제두목돈 모두 세후수익 개선 없음·앞뒤음수. 실제1만$ 최악짝ΔMDD+9.682%p는 위약+6.759보다 크지만 상10%는위약보다 작으므로 이것만으로 전분포에 새 꼬리가 입증됐다고 과장하지 않는다. 합성10만$ 최악짝+1.122는위약+.377보다 크고 뒤절반수익도음수다. 참고TQQQ10만$의아주작은양수(+.015%p)는실제SOXL실패를덮지못한다. 수익관문에서탈락, 새채택/재현요청없음.', '',
'**4. 범위·원본 동등성·감사·다음**', '',
`- 실제 종료코드: dual/rotation/im/audit 네 프로세스 모두exit0. 듀얼 고리OFF native replay 전체JSON ${A.audit.nativeExact}건 일치, taxCurve 대 기존afterTax ${A.audit.taxMatches}건 차이최대 ${A.audit.maxTaxDiff}$, 모든 native trade 신호일<체결일/정수주 검사. 로테이션 native전체 ${R.audit.nativeExact}건 및 별도 ${U.nativeControls}개통제 일치, 전량청산 ${U.terminalChecks}개검사. 독립단조deque로 채널/브라우저값 비교·미래봉17배/.01배 교란에서 과거신호 불변 총${U.signalChecks}개날짜확인. 이 수는 수익률의 독립표본 수가 아니다.`,
`- 무매 고리OFF native 전체8계좌의 final/MDD/fees/tax/cycles 일치. 별도실제6계좌의주문계획 ${U.im.at(-1).plans}건을 native와대조, 약세하방줄비활성 ${U.im.at(-1).disabled}건에서 하방0줄과본매수동일 확인(본주문차0). 세금강제매도 등의 원본 소수주규약은 그대로이며 전부정수체결이라고 과장하지 않는다. 0계좌/새90%꼬리를 삭제하지 않고 세 판 모두 각창 집계했다.`,
'- 조사 한계: 겹친5년창/12창블록은 독립실전검증이 아니며, 다중검정·희소위기·합성지수/레버리지비용 가정은 남는다. 듀얼afterTax는 가상단위차감규약이며 실세금현금출금 모형과 다르다(포트폴리오 앞 회차의출금감사와 구분). 로테이션은 동일 native종가체결이고 장중손절을 검증한 것이 아니다. 이번에 실주문/실계좌잔고검증/무매전환연도합산세를 했다고 하지 않는다.',
'- 예약 실제조회: 08:37 운영 최신상태no_update, 11:37 포트폴리오는12:19~12:49KST 약30분뒤failed. 저장소의오늘포트폴리오완료기록은 별도후속수행결과이며 예약정상완료의근거로바꾸지않는다. 두예약prompt를 업데이트해 기존공개원문/교차재현/실투자권유조건을유지하고 단계별결과보존·20분내저장/보고마감·다음회차미완료재개·NO_UPDATE금지를추가했다. 일정/활성상태는그대로08:37/11:37KST. 플랫폼실행성공을보장한다고말하지않는다.',
'- 실투자 판단: 새로 바꿀 검증근거 없음. 현재 L9(듀얼v1.1 5/6·섀넌USD1/6·월210$듀얼·무매1만$사이클종료전환)을 유지한다는 기존결정을 갱신할 근거가 없다는 뜻이며 수익보장이 아니다. 이미 승인된공포모드와 신규탈락전략을같은발견으로세지않는다. 다음은 VR 첫native기준선/미시험규칙, 포트폴리오는 무매종료전환연도통합세금 연결. 공개매매법 다음후보는 원문/실행지원/중복제외부터 다시검토하며 오늘결과를본뒤새파라미터탐색으로통과를만들지않는다. 통과후보가나오면당일재현요청, 교차확인뒤비중·시작금액·최악손실·중단/재검토조건을포함한권유안을제시한다.', '',
'재실행(현재브랜치의전체앱과동일API자료를사용):', '```bash',
'cd research/im_plan && ./fetch.sh && node synsplit.js && ./planrule/fetch.sh',
'cd ../..',
'node research/gpt/channel-research-20261113_byGPT.cjs dual /tmp/jkq-channel-dual-20261113.json',
'node research/gpt/channel-research-20261113_byGPT.cjs rotation /tmp/jkq-channel-rotation-20261113.json',
'node research/gpt/channel-research-20261113_byGPT.cjs im /tmp/jkq-channel-im-20261113.json',
'node research/gpt/audit-channel-20261113_byGPT.cjs /tmp/jkq-channel-audit-20261113.json',
'node research/gpt/record-channel-20261113_byGPT.cjs', '```', '', '입력 SHA256(재수집 자료변경을 확인하기 위함):', '');
for(const[f,h]of Object.entries(U.hashes))L.push(`- \`${f}\`: \`${h}\``);
L.push('','- 변경범위: 상세정본은이로그, 자체도구3개는research/gpt/, 공유표는새통과후보가없으므로변경0. 앱/원본엔진/클로드기록수동수정0, main푸시/PR/배포/실주문/무매외부게시0. 연구브랜치원격보존여부는실제fetch/ref대조뒤별도로확인한다.','');
const header='### 2026-11-13 · 운영 심층 보충 결과 — 실행 완료·세 갈래 탈락·새 실투자 권유 없음';
if(fs.readFileSync(log,'utf8').includes(header))throw Error('already recorded');
fs.appendFileSync(log,L.join('\n'));
console.log(JSON.stringify({recorded:true,lines:L.length,log}));
