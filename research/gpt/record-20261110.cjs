'use strict';
// Render measured results into the sole canonical research log, not extra reports.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {quant,boot}=require('./operating-20261110.cjs');const D=path.resolve(__dirname,'../im_plan');
const read=f=>JSON.parse(fs.readFileSync('/tmp/'+f,'utf8')),r=read('jkq-r1.json'),px=read('jkq-r1-proxy.json'),pf=read('jkq-pf-harvest.json'),base=read('jkq-pf-base.json'),im=read('jkq-im-1110.json'),dg=read('jkq-dual-1110.json'),asap=read('jkq-asap-1110.json'),env=read('jkq-firstday-1110.json');
const f=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'미실행',pct=x=>f(100*x,1),ci=(a,n=2)=>a.map(x=>f(x,n)).join('~');let a=[];const put=x=>a.push(x);
put('\n\n### 2026-11-10 · 교차 재현 결과 — R-20261110-1 공포 모드 G35S30\n');
put('- **재현 확인(요청의 사전 기준 ①~⑤)**. 새 운영 후보보다 먼저 요청 자료 끝 2026-11-06로 replay를 처음부터 다시 실행했고, 11-09 최신 끝 날짜도 별도로 실행했다. 기준선 replay 전체 반환 필드가 수정 없는 앱 원문과 동일. 세후 장부와 짝 창 통계는 research/gpt/에서 다시 계산했다. engine_panic의 후보 고리는 읽어 사용했고 앱 파일은 고치지 않았다.');
put('- 실행: `node research/gpt/replicate-panic-20261110.cjs /tmp/jkq-r1.json` · `node research/gpt/panic-proxy-20261110.cjs /tmp/jkq-r1-proxy.json`. 요청 엔진 b30b709의 backtest.html/plan-session-engine.js와 현재 연구 브랜치 해당 두 파일은 diff 없음. 다른 파일의 새 main 커밋을 이 시험의 엔진 교체로 간주하지 않는다.\n');
put('| 규모 | 기준→후보 연 중앙(%) | 짝 Δ연 중앙 [12창 5~95%](%p) | MDD 분포 중앙 기준→후보(%) | 짝 ΔMDD 중앙 / 최악MDD 차(%p) | 앞/뒤 Δ연(%p) | 둘 다 나음:나쁨 |');
put('|---|---:|---:|---:|---:|---:|---:|');
const label={'10k':'1만$','100k':'10만$','25kMonthly':'2.5만$+월210$','paper':'1억원+월10만원'};
for(const[k,s]of Object.entries(r.ends['2026-11-06'])){const b=s.summary.base,x=s.summary.G35S30;put(`| ${label[k]} | ${f(b.ann)}→${f(x.ann)} | ${f(x.deltaAnn)} [${ci(x.ci)}] | ${f(b.mdd)}→${f(x.mdd)} | ${f(x.deltaMdd,4)} / ${f(x.deltaMaxMdd,4)} | ${f(x.front)}/${f(x.back)} | ${x.both}:${x.worse} |`);}
put('\n- **MDD 표현 주의**: 분포 중앙끼리의 차이(약 −1.5~−2.3%p)는 짝 차 중앙이 아니다. 실제 짝 ΔMDD 중앙은 네 규모 모두 0.0000%p다. 수익이 낮은 창은 5/128씩 남는다(무조건 우월 아님). 0계좌 없음. 최악 창 수익은 1만$ 17.30→17.07%, 10만$ 15.80→15.44%로 조금 낮아진다. 요청은 최악 수익 비악화를 통과 조건으로 두지 않았지만 이 차이는 보존한다.');
put('- 11-09 최신 자료에서도 5년 창은 동일한 128개(마지막 시작 2021-11-01, 끝 2026-11-01)라 위 짝 값은 동일. 전 기간 끝값만 변화:');
for(const[k,s]of Object.entries(r.ends['2026-11-09']))put(`  - ${label[k]} 전 구간 세후 연/MDD: ${f(s.full.base.ann)}/${f(s.full.base.mdd,4)} → ${f(s.full.G35S30.ann)}/${f(s.full.G35S30.mdd,4)}. 전체 MDD의 미세한 +0.0005~0.0035%p는 반올림해서 '정확히 감소'라고 쓰지 않는다.`);
put('- 이웃(동일 128창, 1만/10만$/실제/모의의 짝 Δ연 중앙):');
for(const k of ['lo30','k28','band1','band3'])put(`  - ${k}: ${Object.values(r.ends['2026-11-06']).map(s=>f(s.summary[k].deltaAnn)).join(' / ')}%p.`);
put(`- lo30의 사용자/모의 뒤 절반은 ${f(r.ends['2026-11-06']['25kMonthly'].summary.lo30.back)}/${f(r.ends['2026-11-06'].paper.summary.lo30.back)}%p로 음수. 이웃의 전체 짝 방향은 양수라 요청 ⑤는 충족하지만, 모든 이웃이 모든 하위구간에서 개선된다는 뜻은 아니다.`);
put('\n| 합성 px 자료 끝 | 원금 | 창 수 | 연 분포 중앙 기준→후보(%) | 짝 Δ연 [12창 5~95%](%p) | 2000~05 / 2006~10 시작 짝 Δ연(%p) |');put('|---|---:|---:|---:|---:|---:|');
for(const end of ['2026-10-19','2026-11-09'])for(const cap of [10000,100000]){const s=px.sets[`${end}_syn_${cap}`],b=s.base,x=s.G35S30;put(`| ${end} | ${cap} | ${x.windows} | ${f(b.annMedian)}→${f(x.annMedian)} | ${f(x.delta)} [${ci(x.ci)}] | ${f(x.lowEarly)}/${f(x.mid)} |`);}
put('- 합성 이웃(lo30·k2.8·밴드1/3%)도 두 원금의 롤링 중앙 및 전체 짝 방향이 양수다. 이 검사는 요청이 지정한 **px 조정가·소수주 대용**이며, 앱 정수주 합성 재현이라고 부르지 않는다.');
put('- 1987~99 표본 밖도 실행했다. 요청의 기존 planoos.js 원문은 전일 신호지만 주수 산정 `sizePrev`를 전달하지 않는다. 이를 명시해 원문 그대로 다시 실행한 값:');
put('```text\n'+fs.readFileSync('/tmp/jkq-r1-oos-original.txt','utf8').trim()+'\n```');
put('- 별도 전일 주수(sizePrev=true) 대용 검산에서도 표본 밖 96창 짝 Δ연 중앙 0·MDD 동일, 전체 CAGR은 1만/10만$ −0.141/−0.140%p였다. 즉 표본 밖 개선 근거는 없으며 소폭 손해다. 원문/검산의 수익률 수준 차이는 주수 산정 시점 차이이므로 섞지 않는다. 요청 사전 기준 ④는 합성 롤링 중앙 비악화이며 표본 밖 전체 CAGR 엄격 우위를 요구하지 않았다. 그 기준을 재현 뒤 바꾸어 통과/실패를 고르지 않았다.');
put('- **해석/한계**: 클로드의 반올림된 핵심 값(+2.06/+2.18/+1.73/+1.96, 둘 다 나음:나쁨) 재현. 실제 이득은 2020·2025, 합성은 2009 사건 집중. 겹치는 128/262창과 블록 구간은 독립 사건 수가 많음을 뜻하지 않는다. SMA 길이 민감성과 세금의 가상 단위 차감 근사는 남는다. 이 결과는 클로드 후보의 재현 확인이며 지피티가 새 후보를 찾았다는 뜻이 아니다. 앱 반영·사용자 승인 요청·배포 없음. 공유 문서에는 기존 클로드 행을 덮지 않고 지피티 결과 행/상세만 덧붙인다.');
put('\n### 2026-11-10 · 포트폴리오 결과 — L9:PLAN 연말 손실 수확\n');
put('- 실행: `node research/gpt/run.cjs research/im_plan/pf_app.js /tmp/jkq-pf-base.json`(기존 도구 재현) → `node research/gpt/portfolio-20261110.cjs /tmp/jkq-pf-harvest.json`(연말손실5%, 이웃2.5/10%). 앱 전체 backtest.html + 원본 runIVS, 듀얼 원본 replay에 연구용 연말 주문만 끼움. 원본 엔진/클로드 파일 변경 없음.');
put('- **5/6:1/6 방향 재현 확인**(5/6 ÷ 2/3, 실제 43창, 세후 평가액):');
for(const cap of [10000,30000,100000]){const b=base[cap]['2/3'],c=base[cap]['5/6'],rat=c.map((x,i)=>x.fv/b[i].fv);put(`  - ${cap}$+월210$: 짝 비 중앙 ×${f(quant(rat),5)}, 이긴 창 ${rat.filter(x=>x>1).length}/43 (${f(100*rat.filter(x=>x>1).length/43,1)}%), 블록구간 ×${ci(boot(rat),5)}. 원금 3만$ 방향 뒤집힘 없음.`);}
put('- 내 기준선 세후 최종값은 기존 pf_app 결과 129개 창 모두 일치(최대 오차 $1.17e−10), 원본 runIVS 최종/세금/MDD와 probe가 정확히 같고, 듀얼 옵션 OFF의 NAV/ledger는 원본과 정확히 같다. pf_app의 혼합 TWR/MDD는 아래 판정에서 제외했다.\n');
put('| 원금+월210$ | 수확÷기준 평가액 짝 비 [12창 5~95%] | 이긴 창 | 앞/뒤 비 | 세후 MDD 분포 중앙 기준→후보(%) | 짝 ΔMDD 중앙 / 최악 차(%p) |');put('|---|---:|---:|---:|---:|---:|');
for(const[cap,s]of Object.entries(pf.sets)){const b=s.summary.base,x=s.summary.h5;put(`| ${cap} | ×${f(x.ratio,6)} [${ci(x.ratioCI,6)}] | ${x.higher}/43 | ${f(x.front,6)}/${f(x.back,6)} | ${f(b.mdd)}→${f(x.mdd)} | ${f(x.deltaMdd,4)} / ${f(x.deltaMaxMdd,4)} |`);}
put('- 분포(기준/후보 세후 평가액 중앙·하10·최악 $):');for(const[cap,s]of Object.entries(pf.sets)){const b=s.summary.base,x=s.summary.h5;put(`  - ${cap}: ${f(b.final)}/${f(x.final)} · ${f(b.final10)}/${f(x.final10)} · ${f(b.finalMin)}/${f(x.finalMin)}. 원금 미달/반토막 창 둘 다 0.`);}
put('- **탈락 — L9:PLAN 유지**: 실제 1만$ 짝 비 1.000000, 승률 15/43(34.9%)라 사전 수익 기준을 못 넘는다. 3만$ +0.1346%(24/43), 10만$ +0.2806%(25/43)로 작다. 이웃 2.5/5/10%는 이번 관측에서 같은 결과(문턱 사이 식별 정보 없음). 짝 MDD 중앙은 모두 0이므로 분포 중앙의 감소를 창마다 낙폭 개선이라고 주장하지 않는다.');
put('- 원인/비용: 실제 수확 실행이 있는 창 18/26/27개(1만/3만/10만$), 대부분 창에 1회. 2014-01 시작은 비용 뒤 평가액이 약 −0.03%, 2015~17 시작은 +0.5~0.6% 수준. 10만$ 왕복 추가수수료 중앙 $49.62. 세금은 수확 당시 절감되지만 재취득 원가 하락으로 미래 세금이 늘 수 있어 전 기간 세금합 중앙 차는 0. 한두 손실 사건/연말 달력에 의존한다.');
put('- **세금/체결 감사**: 수량은 전일 확정 장부·전일 가격으로 정하고, 현재가로 정하는 것은 체결·현금 한도뿐. 매도와 재매수 동수·정수주, 양방향 0.1% 비용, 연말 날짜는 거래 달력이며 미래 가격 미사용. 배당과 월 입금은 replay 원문 한 번만, 섀넌 배당/이자도 원문 한 번만. 개인 공제는 듀얼5/6+섀넌1/6=1로 중복 없음. 그러나 다리별 공제배분/손익상계 근사이고 듀얼은 가상 세후/마지막 청산세 포함, 섀넌은 엔진 실현세 방식이다. **법정 사람 단위 완전 손익상계의 정확 재현까지 끝났다고 주장하지 않는다.**');
put('- 세후 일별곡선 둘을 합쳐 입금을 제거한 단위곡선으로 MDD를 다시 쟀다(세전 듀얼+세후 섀넌 혼합값 사용 안 함). 실제 1만$ 단계에서 실패하여 합성·합성 표본 밖은 미실행이다. 정수주 합성 replay·완전 통합 세금은 미완료이며, 해당 미완료가 있어도 발견으로 승격하지 않는다. 후보 재현 요청 없음.');
put('\n### 2026-11-10 · 운영 메뉴 결과 — 사전등록 세 작업의 계속\n');
put('- 기존 첫날 기준선 재현: 최신 SOXL 4,193봉(2010-03-11~2026-11-09), SHA256 `'+env.quote.sha256+'`. runIM 원본 대 imh 최종자산 차 두 원금 모두 $0, 사이클 일치. 1만$ 최종 '+f(env.rows[0].final)+'$·112사이클·CAGR '+f(env.rows[0].cagr)+'%·MDD '+f(env.rows[0].mdd)+'%, 10만$ '+f(env.rows[1].final)+'$·113사이클·'+f(env.rows[1].cagr)+'/'+f(env.rows[1].mdd)+'%. 11-06의 503,411.23$와 다른 이유는 11-09 SOXL +22.3% 봉 추가다(엔진 불일치가 아님).');
put('- 듀얼 후보6 제한형 실행: `node research/gpt/operating-20261110.cjs dual /tmp/jkq-dual-1110.json`. 순수 입금일 부족분1%p 초과에만 투입금 배분(0/2%p 이웃). 각 128창, 거치1만/10만은 완전히 같음.\n');
put('| 규모 | 짝 Δ연 중앙 [12창 5~95%](%p) | 평가액 비 | 짝 ΔMDD 중앙(%p) | 앞/뒤 Δ연(%p) |');put('|---|---:|---:|---:|---:|');
for(const name of ['dep10','dep100','user25','paper']){const s=dg.sets[name],x=s.summary.under1.pair;put(`| ${s.P}$+월${s.M}$ | ${f(x.ann)} [${ci(x.annCI)}] | ×${f(x.ratio,5)} | ${f(x.mdd)} | ${f(x.front)}/${f(x.back)} |`);}
put('- 듀얼 **탈락**: 실제/모의 사용자 규모 +0.052/+0.146%p로 +0.3%p 미달, 앞 절반 음수. 실제 계좌 이웃0/1/2%p의 짝 연 +0.173/+0.052/−0.008로 같은 방향 아님. 기존 전체 맞춤 유지. 새 대부분손실/0계좌 없음. 합성/1987~99는 실제 gate 실패로 미실행. 원문 replay에는 split 이벤트 옵션이 없고 합성 비분할 종가는 과도하게 높아 정수주를 소수주로 몰래 바꿔 통과시키지 않았다.');
put('- 무매 후보12 실행: `node research/gpt/operating-20261110.cjs im /tmp/jkq-im-1110.json`(원금×0.99/1/1.01을 각 창에서 평균한 뒤 짝). 원본 runIM baseline은 네 자료×두 원금에서 정확히 일치. 쿼터1/8·이웃1/6,1/10은 익절/LOC 물량과 T감산을 함께 맞췄다.\n');
put('| 자료 | 원금 | 창 수 | 1/8 전체 ΔCAGR / ΔMDD(%p) | 짝 ΔCAGR [12창 5~95%](%p) | 짝 ΔMDD(%p) | 앞/뒤 짝 ΔCAGR |');put('|---|---:|---:|---:|---:|---:|---:|');
for(const[ds,s]of Object.entries(im.sets))for(const cap of [10000,100000]){const x=s.summary[cap].q8;put(`| ${ds} | ${cap} | ${s.starts.length} | ${f(x.fullDelta.ann)}/${f(x.fullDelta.mdd)} | ${f(x.pair.ann)} [${ci(x.pair.annCI)}] | ${f(x.pair.mdd)} | ${f(x.pair.front)}/${f(x.pair.back)} |`);}
put('- **무매 탈락**: 실제 1만/10만$ 짝 수익 −2.49/−0.94%p, 전체 CAGR −5.73/−4.35%p. 1만$ 2021-12-27→2022-10-14 MDD 약80.53%(10만81.24%)로 기존 주된 코로나 낙폭과 다른 새 대부분손실 길을 만든다. 최악 창 MDD도 +22.33/+19.12%p. 단순 90% 초과 보조 카운터가 0이어도 80%대 새 꼬리를 안전하다고 부르지 않는다.');
for(const cap of [10000,100000]){const x=im.sets.syn.summary[cap].q8.oos;put(`- 합성 SOXL 1995~2004 시작(120창) ${cap}$는 짝 Δ연 ${f(x.ann)}[${ci(x.annCI)}], 전체 합성323창은 ${f(im.sets.syn.summary[cap].q8.pair.ann)}로 방향이 갈린다. 이웃1/6·1/10 실제 짝 Δ연은 ${f(im.sets.real.summary[cap].q6.pair.ann)}/${f(im.sets.real.summary[cap].q10.pair.ann)}이지만 최악 MDD가 모두 크게 늘어 고르지 않는다.`);}
put('- 합성 TQQQ에서 1/8의 90%초과 새 낙폭 창 21/47개(1만/10만$), 1/10은45/45개. 정확히 0인 계좌는 없지만 장기 합성은 기준·후보 모두 MDD99%대인 길이 있어 사실상 소진 위험을 숨기지 않는다. TQQQ는 SOXL 규칙의 다른 기초자산 대용이며 본래 TQQQ 공식15/15로 바꾼 시험이 아니다.');
put('- ASAP 첫 기준선 실행: `node research/gpt/operating-20261110.cjs asap /tmp/jkq-asap-1110.json`. 앱 runASAP 원문만 호출, 실제 전체 2010-03-11~·합성 전체1994-05~(5년 창은1995~), 끝11-09. 기본 적립형과 startCash 거치형 분리.\n');
put('| 자료/형식 | 전체 납입→평가액($) | 전체 IRR 또는 CAGR(%) / MDD(%) | 5년 창 수 | 창 IRR 또는 CAGR 중앙 / 하10 / 최악(%) | 창 MDD 중앙 / 최악(%) |');put('|---|---:|---:|---:|---:|---:|');
for(const[ds,s]of Object.entries(asap.sets))for(const x of s.rows){const w=x.summary;put(`| ${ds} / ${x.cap?x.cap+'$ startCash':'기본적립'} | ${f(x.full.invested)}→${f(x.full.final)} | ${f(x.full.ann)}/${f(x.full.mdd)} | ${w.n} | ${f(w.ann)}/${f(w.ann10)}/${f(w.annMin)} | ${f(w.mdd)}/${f(w.mddMax)} |`);}
put('- ASAP는 새 개선 후보가 아니라 기준선이다. 기본 적립은 초기원금이 없으므로 1만/10만$에 임의 정규화하지 않았다. **코드 감사**: runASAP는 buyQty(...,false), 즉 소수주를 쓰며 정수주 전략이 아니다(원본 주수 규약은 바꾸지 않음). 매수만 하므로 실현양도세0/마지막 가상 전량매도세 없음, 리저브는 앱 연도별 국채 이자 근사. 위 거치 baseline을 정수주 세후 liquidation 전략으로 해석하지 않는다. 정수주 동등성 확인은 미완료이며 앱 수정 안 함. 합성 거치 MDD 약100%/최종 원금−96%여서 안전한 장기 대안으로 추천하지 않는다. 다음 차례는 적립·거치 첫 기준선.');
put('\n### 2026-11-10 · 보존·경계·다음 회차\n');
put('- 이번에 실제 시험한 새 규칙: 듀얼 순수입금 부족분매수1개(이웃2개)·무매 쿼터1/8(이웃2개)·L9 연말손실수확(이웃2개). 모두 탈락, ASAP는 기준선. 별도로 클로드 R-20261110-1을 재현 확인했다. 새 지피티 발견 후보/재현 요청은 없다.');
put('- 자료 갱신: 두 회차 모두 지정 fetch/synsplit/planrule를 실행했고 포트폴리오 회차 USD/GLDM도 같은 API로 다시 받았다. GC=F 원본에는11-10 미확정 봉이 있었으나 이번 시험엔 금 다리를 사용하지 않았다. 실사용 전 전체 자료 날짜/가격 역할을 고정할 필요는 계속 남는다. 관리자 개인 Firebase 덮어쓰기는 이 실행에서 조회하지 못했으며 연구는 사용자 지시서의 명시 파라미터/앱 소스 기준이다.');
put('- 보존 대상은 이 로그·research/gpt/의 자체 스크립트·REPLICATION.md의 새 지피티 결과 행/상세뿐. 시작부터 있던 다른 작업의 미추적 data/tenbagger/gpt 파일은 손대지 않는다. main·앱·클로드 로그·기존 연구도구 수정, PR·배포·실주문·외부 무매 게시 없음.');
put('- 푸시 절차: 내 파일만 커밋한 뒤 git pull --rebase=merges origin research/daily를 수행한다. Git CLI push는 인증 부재 시 오류를 사실대로 남기고, 이미 쓰기가 검증된 연결된 GitHub Git objects/ref를 이용해 research/daily만 업데이트한다(force 사용 안 함). 원격 fetch/SHA/내용 일치는 후속 실제 검증으로 확인한다. 권한이 없어 실패한 것이 아니므로 권한 없음이라고 오보고하지 않는다.');
put('- 다음: 클로드는 R-20261110-1 지피티 결과를 읽고 한계(희소사건·표본밖 효과없음·최악수익 하락)를 함께 검토. 포트폴리오는 연말 다리별 근사를 사람 단위 완전 손익상계로 검산하거나 현금흐름을 뺀 연1회 맞춤을 별도 사전등록. 듀얼6 제한형/쿼터1/8은 반복하지 않고 다음 미시험 후보·적립·거치 첫 baseline으로 간다. 이번 탈락 후보의 합성 추가·정수주 ASAP 변형은 **미실행/미완료**로 남기며 통과로 포장하지 않는다.');
put('- 실행 엔진 SHA256: `'+r.files['backtest.html']+'` (backtest.html), `'+r.files['plan-session-engine.js']+'` (plan-session-engine.js). 임시 상세 배열은 재실행 가능하고 수치·실패·한계의 영속 정본은 이 로그다.');
const file=path.join(D,'RESEARCH_LOG_GPT.md'),old=fs.readFileSync(file,'utf8');if(old.includes('### 2026-11-10 · 교차 재현 결과 — R-20261110-1'))throw Error('already recorded');fs.appendFileSync(file,a.join('\n')+'\n');
console.log('Recorded measured results in RESEARCH_LOG_GPT.md');
