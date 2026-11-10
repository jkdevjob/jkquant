'use strict';
// Preserve the measured results in the GPT log only. Raw execution artifacts
// remain temporary; rerun the research script with freshly fetched data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {quant,boot}=require('./operating-20261110.cjs');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan');
const j=JSON.parse(fs.readFileSync(process.argv[2]||'/tmp/jkq-pf-contribution.json','utf8'));
const native=JSON.parse(fs.readFileSync(process.argv[3]||'/tmp/jkq-pf-base-current.json','utf8'));
const file=path.join(D,'RESEARCH_LOG_GPT.md'),marker='### 2026-11-10 · 포트폴리오 후속 회차 · 연초 납입 배분 결과';
if(fs.readFileSync(file,'utf8').includes(marker))throw Error('Result section already recorded');
const f=(x,n=4)=>Number(x).toFixed(n),sg=(x,n=4)=>(x>=0?'+':'')+f(x,n);
const caps=[10000,30000,100000],label={10000:'1만$',30000:'사용자3만$',100000:'10만$'};
let maxNativeDelta=0;
const lines=['',marker,'',
'- **판정: 탈락 — L9:PLAN 유지.** 사전등록 `86c893e` 뒤 규칙 변경 후보1개(목표1/6)·이웃2개(15%/18⅓%)·원리 통제1개(첫해 이후 월175/35$)를 실제 앱 엔진으로 실행했다. 세 규모 모두 월210$·실제 분기 시작 짝5년43창(2011-04~2021-10 시작). 자료 끝2026-11-09. 기간 끝은 각 시작일+5년의 마지막 포함 거래일이므로 최근 시세 추가가 모든 창 끝을 바꾸는 것은 아니다.',
'- 포트폴리오 신규 클로드 재현 대기는 없었다. 기존 R-20261110-1의 지피티 재현확인 결과는 보존했으며 이번 회차의 새 발견으로 세지 않는다. 섀넌 USD200설정 격자·입금 주기·내 앞선 손실수확 시험을 반복하지 않았다.',
'- 실행: `node research/gpt/portfolio-contribution-20261110.cjs /tmp/jkq-pf-contribution.json` · 기준 배분 방향 재현 `node research/gpt/run.cjs research/im_plan/pf_app.js /tmp/jkq-pf-base-current.json`. 첫 도구는 whole backtest.html의 runIVS와 원본 plan-session-engine replay에 외부 납입 고리만 사용한다. 기존 pf_app은 실행만 했으며 혼합 TWR/MDD는 판정에 쓰지 않았다.',
'',
'**주 후보: 세후 평가액과 위험(모든 차이는 같은 창의 후보−L9, 단위는 별도 표시)**','',
'| 원금(+월210$) | 평가액 짝 비 중앙 | 수익 차 % | 12창 블록5~95% 비 | 이긴 창 | 짝 ΔMDD 중앙 %p | 분포 최악MDD 차 %p | 짝 Δ평가액 중앙 $ |',
'|---|---:|---:|---|---:|---:|---:|---:|'];
for(const cap of caps){const s=j.sets[cap],a=s.summary.annual,pd=s.rows.map(x=>x.v.annual.final-x.v.base.final);
 lines.push(`| ${label[cap]} | ${f(a.ratio,6)} | ${sg((a.ratio-1)*100,4)} | ${a.ratioCI.map(x=>f(x,6)).join('~')} | ${a.win}/43 (${f(a.win/43*100,1)}%) | ${sg(a.deltaMdd)} | ${sg(a.deltaMaxMdd)} | ${sg(quant(pd),2)} |`);
}
lines.push('', '- 수익 차는 `중앙(후보÷기준)−1`이며 연율이나 원금 대비 수익률 차가 아니다. MDD는 두 다리 세후 일별 평가액을 합친 뒤 그날의 두 납입액 합을 빼서 단위를 이어 계산했다. 가상 끝 청산세도 마지막 곡선에 포함한다. **분포 중앙끼리의 차이와 짝 차 중앙을 혼동하지 않는다.** 2,000회·길이12창 원형 블록·고정seed20261110의 부트스트랩이며 겹친 창43개가 독립43표본이라는 주장은 하지 않는다.', '',
'| 원금 | 기준→후보 평가액 분포 중앙 $ | 기준→후보 하위10% $ | 기준→후보 최저 $ | MDD 분포 중앙 % | 최악MDD % | 앞19창 짝 비(승) | 뒤24창 짝 비(승) |',
'|---|---|---|---|---|---|---|---|');
for(const cap of caps){const s=j.sets[cap].summary,b=s.base,a=s.annual;lines.push(`| ${label[cap]} | ${f(b.final,2)}→${f(a.final,2)} | ${f(b.p10,2)}→${f(a.p10,2)} | ${f(b.min,2)}→${f(a.min,2)} | ${f(b.mdd,3)}→${f(a.mdd,3)} | ${f(b.maxMdd,3)}→${f(a.maxMdd,3)} | ${f(a.front.ratio,6)} (${a.front.win}/19) | ${f(a.back.ratio,6)} (${a.back.win}/24) |`);}
lines.push('', '**이웃·통제와 원리 분해**','',
'| 후보 | 1만$ 짝 비(승) | 3만$ 짝 비(승) | 10만$ 짝 비(승) |',
'|---|---|---|---|');
for(const [key,name]of [['low','목표15%'],['annual','목표1/6'],['high','목표18⅓%'],['proportional','고정175/35$ 통제']])lines.push(`| ${name} | ${caps.map(cap=>{const s=j.sets[cap].summary[key];return `${f(s.ratio,6)} (${s.win}/43)`;}).join(' | ')} |`);
lines.push('');
for(const cap of caps){const s=j.sets[cap],a=s.summary.annual,rows=s.rows.map(x=>({s:x.s,ratio:x.v.annual.final/x.v.base.final,dm:x.v.annual.mdd-x.v.base.mdd,delta:x.v.annual.final-x.v.base.final,usd:x.v.annual.usdDeposits,decisions:x.v.annual.decisions})).sort((a,b)=>a.ratio-b.ratio),dec=rows.flatMap(x=>x.decisions);
 if(!dec.every(x=>x.signalDate<x.date))throw Error('Lookahead in annual routing');
 lines.push(`- ${label[cap]}: 5년 섀넌 신규납입 중앙 ${f(a.usdDeposits,2)}$; 매매수/수수료/세금 짝 차 중앙 ${sg(a.tradesDelta,0)}회/${sg(a.feesDelta,2)}$/${sg(a.taxDelta,2)}$. 평가액 짝 비 최저/10%/90%/최고 ${f(rows[0].ratio,6)}/${f(quant(rows.map(x=>x.ratio),.1),6)}/${f(quant(rows.map(x=>x.ratio),.9),6)}/${f(rows.at(-1).ratio,6)}. 짝 MDD 최악 악화 ${sg(Math.max(...rows.map(x=>x.dm)),4)}%p(분포 최악 차와 별도). 최저 비 ${rows[0].s} 시작(${sg(rows[0].delta,2)}$), 최고 비 ${rows.at(-1).s} 시작(${sg(rows.at(-1).delta,2)}$). 연초 결정205개 중 섀넌0$/전액210$=${dec.filter(x=>x.perS===0).length}/${dec.filter(x=>x.perS===210).length}.`);
}
lines.push('- 원리: 고정175/35 통제는 세 규모 모두 짝 비<1이다. 부족액을 다시 재는 후보는 큰 원금에서 섀넌에 월210$ 전액을 보내는 해가 많아지고, 그해 듀얼에 입금이 없어져 입금에 따른 전체 맞춤도 줄어든다. 그래서 단순 비례 적립 효과만으로 해석하지 않는다. 10만$ 최고 창(2017-01 시작)은2018~21년 섀넌에 전액210$를 보낸 사례다. 3만$ 최악 창(2018-07 시작)은2021년 전액210$가 섀넌으로 갔고 5년 끝 기준보다4035.60$ 낮았다. 수수료는 줄지만10만$ 세금 중앙은 오히려 증가한다. 세금절감만의 수익이라고 결론내리지 않는다.', '', '**감사·기준선 재현**', '');
for(const cap of caps){const A=native[cap]['5/6'],B=native[cap]['2/3'],ratio=A.map((x,i)=>x.fv/B[i].fv);for(const x of j.sets[cap].rows){const y=A.find(t=>t.s===x.s);maxNativeDelta=Math.max(maxNativeDelta,Math.abs(x.v.base.final-y.fv));}
 lines.push(`- 배분5/6÷2/3 ${label[cap]} 앱 원본 재실행: 짝 비 ${f(quant(ratio),6)}, 이긴 창${ratio.filter(x=>x>1).length}/43, 블록비 ${boot(ratio).map(x=>f(x,6)).join('~')}. 전체 창 방향은 유지되어 사용자 경고 조건인 방향 뒤집힘은 없었다. 다만 CI 하한<1이므로 이 재현이 통계적으로 확정된 새 우월성을 뜻하지 않는다.`);
}
lines.push(`- 납입 고리 기준선은 원본 replay의 전43창×3규모 **일별NAV·전체장부가 정확히 같음**. 섀넌 입금0 고리는 원본 runIVS 최종/세금/수수료 정확히 같음. 직전 기준 결과와 새 whole-app pf_app 재실행의 L9 최종값 최대 절대차 각각 ${j.baseline.expectedPortfolioFinalMaxDifference}/${maxNativeDelta}$ (부동소수점 오차).`);
lines.push('- 각 월 두 납입액 합210$·총납입=입금월수×210$를 코드에서 강제검사했다. 초기 원금은5/6+1/6, 납입은 달 첫 거래일만, 첫해는 전액듀얼이다. 연초205결정/규모 모두 signalDate<결정일. 이전 연말까지만 두 엔진을 다시 돌려 결정하고 미래 날짜의 배분만 수정했다. 가상2,520$ 선입금·계좌 간 매도이동·원금/입금 이중계산 없음. 섀넌 신호/정수 매매·연간 세금·이자/배당 처리는 원본을 유지(원본 세금 부족분 강제매도 규약도 그대로).',
'- 계획시점 듀얼은 taxCurve의 final+terminalTax로 가상 끝 청산세를 제거하고, 섀넌은 계획 probe에서 마지막 임의 기간말 _settle만 생략한다. 달력해 전환의 실제 _settle은 그대로다. 따라서 다음1월에 아직 내지 않은 직전해 세금을12월말에 이미 냈다고 간주하지 않는다.',
'- 3규모×기준/후보/이웃/통제의 원금미달·반토막·0계좌 끝값은 전부0창. 기준에 없던 새 반토막 꼬리는 실제 창에서 관측되지 않았다. 짝 최대MDD 악화는10만$ 일부창 +2.4105%p도 있어 평균 위험 감소로 포장하지 않는다.',
'- 사람 단위 공제는 기존 L9와 같은 고정비중5/6+1/6=1로만 배분(총250만원). **실제 사람 단위 합산 손익상계·공제 최적배분은 미완료**다. 듀얼 virtual-unit 세금 차감과 섀넌 실제 현금 차감 차이, 듀얼 끝 미실현세 포함/섀넌 원본 마지막 실현세 정산 차이도 기존 비교 규약을 유지한다. 완전히 동일한 청산세 기준의 실제 세금 모형이라고 주장하지 않는다. 이 한계가 있는 결과로 채택하지 않는다.', '',
'**고정 기준 판정·미완료·다음**', '',
'- 1만$: 주 후보 짝 비<1·승16/43·앞/뒤 모두<1, CI하한<1로 실패. 이웃 두 개도 같은 실패 방향이다. 사용자3만$: 짝 비>1·승24/43이나 뒤 기간<1·CI하한<1로 실패. 10만$: 수익 기준은 개선되나 앞 두 규모가 실패하므로 전 규모 통과 조건을 못 넘는다. 수익·MDD를 함께 보아 전체 후보 탈락이다. 사용자3만$에서 좋아 보이는 이웃18⅓%를 사후 주 후보로 바꾸지 않는다.',
'- 사전등록대로 실제 단계 실패 후 **합성2000~·표본밖2000~05/2006~10·완전 통합세금 경로는 미실행/미완료**. 통과했다고 대체 기입하지 않는다. ★ 발견 후보 없음·새 교차 재현 요청 없음·승인 요청 없음. 진행한 것은 후보 실제 시험+기준선 재현이며 앱 변경은 없다.',
'- 다음 포트폴리오 회차: 클로드 최신 전환시험과 겹치지 않는지 먼저 읽고, 연1회 다리 맞춤의 허용 밴드 또는 전환 시점 후보를 하나 사전등록한다. 새 후보가 실제 관문을 통과하면 합성·표본밖·사람 단위 합산세금을 먼저 완성한 뒤 교차 재현 요청한다. 운영 메뉴의 다음 차례 전략은 앞 회차 기록대로 적립·거치 기준선이며 이번 포트폴리오 회차 완료로 처리하지 않는다.', '',
'**자료·환경·보존**', '',
'- 이번 회차 Node v24.22.1·실제 Chromium138.0.7204.0(@sparticuz/chromium138.0.2) 실행 성공. 지정SOXL API·fetch.sh·synsplit·planrule/fetch·USD/GLDM 별도 동일 API·synusd/mkdca 갱신 성공. 최신 종가 SOXL56.20/USD56.72/GLDM81.91(모두11-09), 듀얼 Guard OFF. TLS·프록시 변경 없음. GitHub 연결 push/admin=true·사전등록 실제 저장으로 쓰기 검증했다.',
'- Git CLI 인증 Username 부재는 연결된 GitHub 권한 부재와 다르다. 최종 보존은 먼저 pull --rebase=merges 및 실제 git push를 실행하고, CLI 인증 실패 시 검증된 연결의 Git objects/ref로 research/daily만 force=false·expected SHA 조건으로 저장한다. 아래 실제 확인 행에서 성공 여부를 확정한다. main/앱/클로드 기록/기존 연구도구 수정·PR·배포·실제 주문 없음.',
'- 엔진 SHA256: '+Object.entries(j.files).map(([p,h])=>`${p}=${h}`).join(' · ')+'.');
const inputs=['data/SOXL.json','data/USD.json','data/IRX.json','planrule/data/TECL.json','planrule/data/TQQQ.json','planrule/data/SGOV.json'];
lines.push('- 이번 입력 SHA256: '+inputs.map(p=>p+'='+crypto.createHash('sha256').update(fs.readFileSync(path.join(D,p))).digest('hex')).join(' · ')+'.');
fs.appendFileSync(file,lines.join('\n')+'\n');console.log(JSON.stringify({appended:marker,maxNativeDelta,lines:lines.length}));
