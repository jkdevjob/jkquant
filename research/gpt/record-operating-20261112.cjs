'use strict';
// Read completed outputs, check paired aggregation, emit an apply_patch patch.
// This script never edits the canonical log itself.
const fs=require('node:fs'),path=require('node:path');
const rd=n=>JSON.parse(fs.readFileSync('/tmp/jkq-20261112-'+n+'.json','utf8'));
const I=rd('im'),D=rd('dual'),O=rd('dual-oos8799'),S=rd('shannon'),A=rd('audit'),M=rd('source'),R=rd('ivs-reference');
for(const k of['real','syn','tq','tqsyn'])if(!I.sets[k])throw Error('IM incomplete '+k);
for(const k of['real','syn','oos'])if(Object.keys(D.sets[k]||{}).length!==4)throw Error('Dual incomplete '+k);
if(Object.keys(O.sets.oos8799||{}).length!==4||!O.details)throw Error('Strict OOS incomplete');
const med=a=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)/2)],f=(x,n=3)=>x==null?'미측정':Number(x).toFixed(n),sg=x=>(x>=0?'+':'')+f(x),ci=a=>'['+a.map(x=>sg(x)).join('~')+']';
let pairedChecks=0,referenceRows=0;
for(const ds of Object.keys(I.sets))for(const cap of[10000,100000]){
 const t=I.sets[ds],b=t.rows.find(x=>x.cap===cap&&x.v==='base');if(b.win.length!==t.starts.length)throw Error('IM window mapping');
 for(const v of Object.keys(I.V).filter(x=>x!=='base')){const a=t.rows.find(x=>x.cap===cap&&x.v===v),d=a.win.map((x,i)=>x.ann-b.win[i].ann),m=a.win.map((x,i)=>x.mdd-b.win[i].mdd),r=t.summary[cap][v].pair;
  if(d.some(x=>!Number.isFinite(x))||Math.abs(med(d)-r.ann)>1e-10||Math.abs(med(m)-r.mdd)>1e-10)throw Error('Independent IM pair mismatch');pairedChecks++;}
}
for(const[ds,T]of Object.entries(S.sets))for(const cap of[10000,100000]){const a=T.caps[cap],b=R.sets[ds].caps[cap];if(a.win.length!==b.win.length)throw Error('IVS windows');
 for(let i=0;i<a.win.length;i++){if(Math.abs(a.win[i].ann-b.win[i].c)>1e-10||Math.abs(a.win[i].mdd-b.win[i].mdd)>1e-10||Math.abs(a.win[i].rebPerYear-b.win[i].reb)>1e-10)throw Error('IVS reference differs');referenceRows++;}}
const body=[];const add=x=>body.push(x);const table=(h,r)=>{if(body.at(-1)!=='')add('');add('| '+h.join(' | ')+' |');add('|'+h.map(()=>'---').join('|')+'|');for(const a of r)add('| '+a.join(' | ')+' |');add('');};
add('### 2026-11-12 · 운영 메뉴 심층 결과 — 재현 확인(R2 수치) / 신규 두 갈래 탈락 / 섀넌 기준선 완료');add('');
add('- **판정: R-20261111-2의 실제 수익 수치는 최신 엔진에서도 재현 확인. 새 듀얼 S10K25와 무매 첫 매수 확대는 탈락, 새 ★ 발견 후보 없음.** 사전등록101f5c4 및 원격 b12ae7324f925339a7e48031f1867a730bcb84c7 이후 결과를 확정했다. 일회 측정으로 끝내지 않고 듀얼6판·무매5판+위약을 실제 시험했다. 승인·앱 반영·실주문은 하지 않았다. 현재 사용자 v1.1을 대체할 근거가 생기지 않았다.');add('');
add('**1. 환경·자료·원문 재현**');add('');
add('- 실제 git fetch→research fast-forward→origin/main 합침, GitHub push/admin=true, '+M.node+'·실제 Chromium'+M.browser.version+'·SOXL 지정 API 확인. fetch.sh→synsplit, planrule/fetch, USD/GLDM 별도 API(period1=0/실제period2)→synusd→mkdca를 실행했다. 최신 확정 사용일11-11, API에 섞인11-12 VIX·금 선물 봉은 성과/신호에서 제외했다. TLS·프록시 변경 없음.');
add('- 시장11-11 확정: SOXL66.03$·USD59.99$·TECL152.62$·TQQQ60.44$·VIX17.49·VXN26.74. 이하 Δ연/ΔMDD의 단위는%p, 대괄호는12창 블록부트스트랩5~95%(90%구간)이다.');
add('- 분석 main '+M.main+'. plan-session-engine.js 전체 hash는 바뀌었지만 R2 요청 엔진15c2f61 대비 replay/panicStep/alphaDecide 함수 글자는 셋 다 정확히 같다(추가는 모의 저장·캐시). backtest.html도 전일과 동일. native SOXL 기준선은 다음과 같다. 최신 끝값 증가는 새11-11 봉 때문이며 비용/세금/사이클 정의 변경이 아니다.');
table(['원금','끝날','native 최종$','사이클','MDD%'],M.cutoffs.map(x=>[x.cap,x.end,f(x.final,2),x.cycles,f(x.mdd)]));
add('- 11-06 끝 1만$ 503411.2349062924/112사이클로 가이드503411.23$와 센트까지 같다. 각 cutoff native와 연구하네스 final/mdd/fees/tax/cycles 6계좌 차0. 추가 무매32계좌(4자료×2원금×4기간) 같은5필드 차0. 첫 주문 예산·T·정수주·현금 보존·이후 주문 불변96건 통과. 독립 짝 집계'+pairedChecks+'벌 일치.');add('');
add('**2. 우선 재현 R-20261111-2 — 동일11-10 끝 / 최신11-11 끝**');add('');
table(['실제128창','A3h Δ연 [12창5~95%]','n25 Δ연 [구간]','A3h/n25 최악MDD 차'],Object.entries(D.replication).map(([k,x])=>{const a=x.summary.A3h,b=x.summary.n25;return[k,sg(a.ann)+' '+ci(a.annCI),sg(b.ann)+' '+ci(b.annCI),sg(a.maxMddDiff)+' / '+sg(b.maxMddDiff)];}));
add('- 네 규모의 수치는11-11 독립 결과와 일치한다. 최신11-11에도 완성된5년창은 같은128개라 짝 결과는 같고 전체기간만 바뀐다. 원요청①~⑤ 재현 확인은 유지하되 오늘 합성/이웃 R2를 새로 전부 돌렸다고 쓰지 않는다(그 부분은11-11 완료 기록). 1만$ A3h 최악MDD+0.843%p와 어제 합성의 증가 때문에 엄격 비악화 전략 승격은 여전히 보류. v1.0 개선을 현재 v1.1 위 추가 이득으로 옮겨 쓰지 않는다.');add('');
add('**3. 듀얼 새 후보 S10K25 — 회복 추세 확인 뒤에만 슬리브 복귀 가속**');add('');
add('- 정의는 사전등록 그대로: v1.1 빠른 슬리브 진행 중 SMA50이10거래일 전보다 상승하면 그날만 k3.0→2.5. 원래3.0 기준 상태 종료는 유지. sigma 고리만 메모리에 주입, 거래·입금·정수주·배당·신호 날짜는 native replay 그대로. Δ연은 세후끝값/누적입금의 등가연율(적립 IRR 아님), MDD는 native 세전NAV/누적입금 기준으로 서로 구분한다.');
const dr=[];for(const ds of['real','syn'])for(const[k,x]of Object.entries(D.sets[ds])){const a=x.summary.S10K25;dr.push([ds+' '+k,a.n,sg(a.ann)+' '+ci(a.annCI),sg(a.annMean),sg(a.mdd),sg(a.maxMddDiff),sg(a.worstPairMdd),sg(a.front)+' / '+sg(a.back)]);}
table(['자료/규모','창','짝 Δ연 [구간]','Δ연 평균','짝ΔMDD','최악MDD 차','개별창 최대ΔMDD','앞/뒤 Δ연'],dr);
table(['이웃/대조','실제1만 Δ연','10만','사용자2.5만+210','모의69244+69.24'],Object.keys(D.variants).map(v=>[v,...Object.values(D.sets.real).map(x=>sg(x.summary[v].ann))]));
add('- 합성은SYNTECL/SYNTQQQ와 IRX 국채를 시작가100으로 맞춘 **정수주 대용 시나리오**다. native replay가 split-event 인자를 받지 않아 실제 분할 경로 동일성을 주장하지 않는다. 가격 배율에 따른 정수주 왜곡을 숨기지 않는다. 실제 자료는 API ohlcTrade·배당을 그대로 사용했다.');
add('- 표본밖1987~1999의96개 완성5년창×4규모는 S10K25 Δ연/MDD 모두0, 개선 근거 없음. 보조1990~99 시작(끝2004)의120창도0. 1987~89 VIX 자료가 없어 그 시기는 공포 조건 검증이 불가능하다. 합성/표본밖은 실제보다 나쁘지 않다는 문턱만0으로 넘으며 추가수익 증거가 아니다.');
add('- 원인 분해: 사용자 전체기간에 가속 조건이 맞은 전일 신호는 S10K25 **2020년4일뿐**, S5K25는2020년2일·2025년2일. 비조건UK25는2011년12일·2020년11일·2025년29일이다. SMA50 상승을 기다리는 조건은 공포 뒤 이른 회복 대부분을 놓치고, 늦은 며칠의 위험만 늘린다. 실제 사용자/모의 뒤 절반 −0.611/−0.705%p, 10만$ 최악MDD+0.054%p여서 사전① 수익+0.3·③ 앞뒤·엄격MDD에서 탈락. 이웃 S5가 일부 양수여도 그 값을 뒤늦게 채택하지 않는다.');
add('- 기본/공포 원문 replay24계좌 전체필드 일치. 독립 세후 장부와 공용 aftertax '+(D.audit.taxMatches+O.audit.taxMatches)+'계좌 최대차$'+Math.max(D.audit.maxTaxDiff,O.audit.maxTaxDiff).toExponential(3)+'. 신호일<체결일·정수주 검사 통과. 새90%꼬리0건만으로 개선이라 판정하지 않았다.');add('');
add('**4. 무매 후보11 첫 매수 예산 확대 — 두 원금에서 함께 좋아지는 판 없음**');add('');
add('- F125/F15/F20은 첫 사이클 주문 예산1.25/1.5/2배와 T 같은배수, F15B/F20B는 전일종가>SMA200 때만. 이후20분할, LOC상한·하방3줄·자동익절·비용·세금·원금 그대로. PL3은 원금1.003배만 바꾼 위약이며 CAGR 분모도 바뀐 실제원금이다. 각 창 원금0.99/1/1.01을 먼저 평균한 후 같은창끼리 비교했다.');
const ir=[];for(const[ds,T]of Object.entries(I.sets))for(const cap of[10000,100000])ir.push([ds,cap,T.starts.length,...['F125','F15','F20','F15B','F20B','PL3'].map(v=>sg(T.summary[cap][v].pair.ann))]);
table(['자료','원금','창','F125 Δ연','F15','F20','F15B','F20B','PL3'],ir);
const detail=[];for(const[ds,T]of Object.entries(I.sets))for(const cap of[10000,100000]){const a=T.summary[cap].F15,p=a.pair;detail.push([ds,cap,sg(p.ann)+' '+ci(p.annCI),sg(p.mdd),sg(p.worstPairMdd),sg(a.dd90),sg(p.front)+' / '+sg(p.back),a.oos?sg(a.oos.ann):'해당없음']);}
table(['F15','원금','Δ연 [구간]','짝ΔMDD','최대 짝ΔMDD','상10%ΔMDD','앞/뒤 Δ연','2005 전 시작 Δ연'],detail);
add('- 실제 F15 1만/10만$ 짝 Δ연 −1.268/−0.620%p(90%구간 전부 음수), ΔMDD 중앙 +0.780/+0.475%p. F15B는10만$ +0.365지만1만$ −0.286으로 공통 개선 실패. F20은1만$ MDD차 중앙+3.171%p의 공격형이며 수익도 감소. TQQQ에서 일부 F20이 좋아도 SOXL 공통기준 실패를 덮지 못한다.');
add('- 새 큰낙폭은 경로 잡음보다 큼: F15 실제 최대 짝ΔMDD +13.419/+10.074%p, 상10% +10.758/+8.538. PL3 최대 +6.759/+0.684, 상10% '+sg(I.sets.real.summary[10000].PL3.dd90)+'/'+sg(I.sets.real.summary[100000].PL3.dd90)+'%p. 90%선을 새로 넘은 창만 세면 이 문제를 놓친다. 모든 자료/원금/변형에서 zero(끝값 또는 일별평가액≤0.01$)0건, 표본을 삭제하지 않았다.');
add('- 실제2018-10~2023-10 F15 1만$ 평균 MDD46.936→60.355%(+13.419), 2020 급락을 더 큰/다른 사이클로 통과한다. 감사한 정확1만$ 계좌의 첫 T는1→1.5로 정의와 같고 외부 현금추가는0이다. 원금3벌의 peak/trough·수수료·세금·사이클은 감사 스크립트로 재현한다. **첫 매수 확대 전 갈래 탈락**.');add('');
add('- 같은 창 정확1만$ 반례: 첫날3주/T1→4주/T1.5, 최종49647.80→40906.12$, 사이클46→38, MDD46.7895→60.0759%. 두 판의 낙폭 고점/바닥은 모두2020-02-19→2020-03-20으로 같다. 수수료4773.24→4247.53$·세금9036.79→7099.11$로 줄었는데도 최종자산은 더 적다. 적게 매매한 효과를 수익개선으로 착각하지 않는다.');add('');
add('**5. 차례 섀넌 — 앱 기본값의 독립 재현과 청산 기준 분리**');add('');
add('- TQQQ/USD·합성 두 자료, 1만/10만$, iv/s0.55/N40/밴드.15/단기국채/비용ON. native runIVS와 청산진단고리OFF의 JSON 전체'+S.audit.nativeExact+'계좌 차0. 기존 ivs_base.js도 새 실행하여 '+referenceRows+'창+전체8계좌 CAGR/MDD/리밸런싱 수 일치(차0). USD200설정 격자는 반복하지 않았다.');
const sr=[];for(const[ds,T]of Object.entries(S.sets))for(const[cap,x]of Object.entries(T.caps)){const n=x.summary.native,l=x.summary.liquidated;sr.push([ds,cap,n.n,f(n.ann)+' / '+f(l.ann),f(n.annMin)+' / '+f(l.annMin),f(n.mdd)+' / '+f(n.mddMax),sg(x.summary.netAnnDelta)]);}
table(['자료','원금','창','native/마지막청산 CAGR 중앙','최악CAGR native/청산','native MDD 중앙/최악','짝 청산CAGR차 중앙'],sr);
add('- native final은 보유분을 남기고 마지막해 실현세만 정산한다. 별도 진단에서만 같은 native _sell/_settle를 마지막 종가에 호출했다. 마지막청산이 있어도 그 전 곡선이 날마다 청산세를 뺀 NAV로 바뀌는 것은 아니다. 표의MDD는 native경로로 명시했다. 공제는 각 독립 기준선의 사람1명몫이며 실제사용자의3다리 합산세후 검증이 아니다.');
add('- 실제USD native CAGR중앙27.782/26.253→마지막청산25.520/24.444%, TQQQ30.708/30.100→28.543/27.568%. 중앙값끼리 빼지 않고 짝 청산차를 따로 적었다. 반대로 USD 전체기간은21.471→21.588%(1만$): 마지막평가손을 실현해 그해 이익과 상계하면 세금이 줄 수도 있다. 그러므로 누락을 항상 같은 부호의 세금으로 단순 차감하지 않는다. **기준선 완료, 신규전략 채택 판정 없음**.');add('');
add('**6. 다음·한계·재실행**');add('');
add('- 오늘 완료: R2 실제 재현, 새 듀얼·무매 후보 및 주변값·원금벌·합성·표본밖, 섀넌 native/청산 기준선, 독립 현금/주문/짝 집계. 다음 차례는 로테이션 첫 native기준선. 무매는 하단 미시험 후보7②(하방1주줄을 전일 TQQQ Guard OFF 동안만 끄기)를 우선하며 이미 끝난 첫매수/쿼터 시험은 반복하지 않는다. 듀얼은 상승확인 지연을 더 최적화하기보다 금리변화 등 독립 정보의 회복 신호를 사전등록 후 검증한다.');
add('- 미완료/제한: 사용자3만$ 전체의 전환연도 공제잔액·계좌간 손익상계와 실제주문 검증은 이번 운영회차에서 수행하지 않았다. 원본 연단위 parkRate도 앱 규약 그대로이며 새 시장예측으로 해석하지 않는다. 겹치는5년창을 독립 사건 수로 세지 않는다. 모든 통계가 좋아도 먼저 재현대기 요청이 필요하며 오늘은 새 요청 대상이 없다.');
add('- 가설·판정기준을 결과 전에 먼저 commit했다. audit 재사용을 위해 첫매수 고리의 firstSetup만 함수로 분리했으며 성과계산 고리는 동일하다. 표본밖1987~99는 추가실행파일로 별도 확인했다. 코드 수정·중단·숫자 없는 항목을 성공으로 부르지 않는다.');
add('```bash');
add('node research/gpt/run.cjs --environment');
add('node research/gpt/dual-slope-20261112.cjs /tmp/jkq-20261112-dual.json');
add('DS=oos8799 SKIP_REPLICATION=1 DETAIL=1 node research/gpt/dual-slope-20261112.cjs /tmp/jkq-20261112-dual-oos8799.json');
add('node research/gpt/im-first-20261112.cjs /tmp/jkq-20261112-im.json');
add('node research/gpt/shannon-base-20261112.cjs /tmp/jkq-20261112-shannon.json');
add('node research/gpt/run.cjs research/im_plan/ivs_base.js /tmp/jkq-20261112-ivs-reference.json');
add('node research/gpt/audit-operating-20261112.cjs');
add('node research/gpt/source-check-20261112.cjs');
add('```');add('');
add('- source/data SHA256:');for(const[p,h]of Object.entries({...M.sourceHashes,...M.dataHashes}))add('  - `'+p+'`: `'+h+'`');add('');
add('- 앱코드·main·클로드기록 수동수정 없음. 결과는 이 파일, 자체도구는research/gpt/, 공유표는 내R2 결과행 보충만이다. main푸시·PR·배포·실주문·무매 외부게시 없음. 전체앱회귀를 실행했다고 주장하지 않는다. research/daily 저장 성공 여부는 실제 ref/tree 조회 뒤 확인한다.');
const text=body.join('\n')+'\n',file=path.resolve(__dirname,'../im_plan/RESEARCH_LOG_GPT.md'),prior=fs.readFileSync(file,'utf8');if(prior.includes('### 2026-11-12 · 운영 메뉴 심층 결과'))throw Error('Results already recorded');
const anchor=prior.trimEnd().split('\n').at(-1),patch='*** Begin Patch\n*** Update File: '+file+'\n@@\n '+anchor+'\n+\n'+text.trimEnd().split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch';
if(process.argv[2]==='preview')process.stdout.write(text);else process.stdout.write(JSON.stringify({patch,pairedChecks,referenceRows,characters:text.length}));
