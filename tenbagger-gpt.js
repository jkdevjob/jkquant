(function(){
  'use strict';
  const ROOT='/data/tenbagger/gpt/';
  const state={summary:null,cases:[],evidence:null,forward:null,forwardError:'',forwardLoading:false,view:document.getElementById('tbg-root')?.dataset?.defaultView||'overview',market:'ALL',query:'',sort:'multiple',page:0,caseCode:null,loading:false};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d}):'미확인';
  const pct=v=>Number.isFinite(v)?(v>0?'+':'')+n(v)+'%':'미확인';
  const color=v=>Number.isFinite(v)?(v>=0?'good':'bad'):'';
  const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'?esc(u.href):'#';}catch{return '#';}};
  const metric=(title,value,detail)=>`<div class="metric"><small>${esc(title)}</small><b>${esc(value)}</b><span>${esc(detail)}</span></div>`;
  const notice=()=>'<div class="notice"><strong>과거 연구 · 현재 매수 신호 아님</strong><br>10배는 원금 10배(+900%)입니다. 저점→고점은 미래를 아는 사후 상한이며, 아래 규칙 검증은 신호 다음 시가·비용을 적용했습니다. 누락된 상장폐지 가격과 소급 조정 시세의 한계를 함께 확인하세요.</div>';
  const table=(headers,rows)=>`<p class="horizontal-note">표를 좌우로 밀어 확인하세요</p><div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  function selected(){return state.summary.strategies.find(x=>x.id===state.summary.selectedRule);}
  function filters(cases,market,query,sort){
    const q=String(query||'').toLocaleLowerCase();
    return cases.filter(c=>(market==='ALL'||c.market===market)&&(!q||[c.name,c.code,c.sector].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>sort==='recent'?b.sellDate.localeCompare(a.sellDate):sort==='retained'?b.endpointMultiple-a.endpointMultiple:b.multiple-a.multiple);
  }
  function overview(){
    const s=state.summary,c=s.collection,h=s.horizons.find(x=>x.years===5),r=selected(),test=r?.test;
    const retention=h.touch10N?100*h.finish10N/h.touch10N:0;
    const exclusion=c.requested-c.usable;
    let inference='학습에서 고른 안은 검증 표본이 충분하지 않아 결론을 보류합니다.';
    if(test?.n)inference=(test.meanLogGrowth<0||test.medianReturnPct<0)?`학습에서 고른 안도 검증에서 중앙 수익 ${pct(test.medianReturnPct)}와 평균 로그 성장률 ${n(test.meanLogGrowth,3)}을 기록했습니다. 같은 진입일 5년 보유 대비 중앙 차이는 ${pct(test.medianExcessPct)}지만, 안정적인 수익 규칙으로 채택할 근거는 부족해 보류합니다.`:test.medianExcessPct>0?`학습에서 고른 안의 검증 중앙 수익은 ${pct(test.medianReturnPct)}입니다. 같은 진입일의 5년 보유 대비 중앙 차이는 ${pct(test.medianExcessPct)}였지만, 누락 가격·기업행동·포트폴리오 운용 검증이 남아 있습니다.`:`학습에서 고른 안의 검증 중앙 수익은 ${pct(test.medianReturnPct)}이며, 같은 진입일의 5년 보유 대비 중앙 차이는 ${pct(test.medianExcessPct)}입니다. 이 결과로 “최대 수익 전략”을 확정하지 않습니다.`;
    return notice()+`<div class="cards">${metric('가격 품질 통과 종목',n(c.usable,0)+'개',`요청 ${n(c.requested,0)}개 / 제외 ${n(exclusion,0)}개`)}${metric('과거 10배 상승 사례',n(s.tenbaggerStocks,0)+'개',`5년 안에 10배인 종목 ${n(s.fastFiveYearStocks,0)}개`)}${metric('연초 매수 → 5년 내 10배',n(s.baselineTest.ratePct)+'%','검증 코호트 진입 2016~2020')}${metric('10배 도달 후 5년 끝에도 10배',n(retention)+'%','전체 연초 코호트 · 정산 미확인 상폐는 0원 가정')}</div>
    <div class="box"><h3>분석에서 구분해야 할 세 가지</h3><div class="steps"><div class="step"><b>① 저점에서 최고점까지 오른 배수</b><p>종목별 최대 구간과 첫 2배·10배 날짜를 보여 줍니다. 이 날짜는 사후에만 확정할 수 있습니다.</p></div><div class="step"><b>② 상승 전 조건의 성공 확률</b><p>성공 종목과 실패 종목을 같은 연초 조건으로 비교합니다. 같은 조건을 충족한 종목 전체가 분모이며, 1·3·5년 도달과 종료 수익을 나눕니다.</p></div><div class="step"><b>③ 당시 실행 가능한 매매 규칙</b><p>4개 진입 × 6개 청산을 비교했습니다. 2001~2010 진입으로 선택하고 2016~2020 진입을 2025년까지 추적했습니다. 고정 익절이 큰 추세를 끊는지, 느린 청산이 수익을 반납하는지 함께 봅니다.</p></div></div></div>
    <div class="box"><h3>10배 상승을 버티는 과정</h3><p>10배가 된 종목들의 해당 상승 중 최대 낙폭 중앙값은 <strong class="bad">${pct(s.caseRisk.medianRiseMddPct)}</strong>였습니다. 최고점 뒤 관측 기간 내 최대 하락 중앙값은 <strong class="bad">${pct(s.caseRisk.medianPostPeakDrawdownPct)}</strong>입니다. 큰 추세를 보유하는 과정과 수익을 남기는 청산은 별도로 검증해야 합니다.</p><p class="fine">사후 성공 종목을 고른 기술 통계입니다. 이 낙폭을 감수하면 미래에도 10배가 된다는 의미는 아닙니다.</p></div>
    <div class="box"><h3>시장별 연초 코호트</h3>${table(['현재/최종 시장','검증 코호트','5년 내 10배 성공','확률'],Object.entries(s.marketCohorts).map(([market,a])=>`<tr><td>${market}</td><td>${n(a.n,0)}</td><td>${n(a.successN,0)}</td><td>${n(a.ratePct)}%</td></tr>`))}<p class="fine">과거 시장 이전을 복원한 시점별 시장 분류는 아닙니다.</p></div>
    <div class="box"><h3>학습에서 선택한 규칙</h3><p><strong>${esc(r?r.entry+' → '+r.exit:'선택 없음')}</strong></p><p>${esc(inference)}</p><p class="fine">선택 기준: 학습 거래의 평균 로그 성장률, 완료·5년 대조 가능 거래 100건 이상. 서로 다른 보유기간의 거래 평균이므로 포트폴리오의 복리 수익률을 뜻하지 않습니다.</p><button class="action" data-open="rules">매수·매도 검증 보기 →</button></div>
    <div class="box"><h3>10배 도달과 최종 수익은 다릅니다</h3>${table(['기간','연초 코호트','기간 중 10배 도달','기간 종료 10배 유지'],s.horizons.map(x=>`<tr><td>${x.years}년</td><td class="num">${n(x.n,0)}</td><td class="num">${n(x.touch10N,0)} (${n(x.touch10N/x.n*100)}%)</td><td class="num">${n(x.finish10N,0)} (${n(x.finish10N/x.n*100)}%)</td></tr>`))}<p class="fine">종목별 최저가를 골라 시작한 표본이 아닙니다. 전년도까지 253봉 이상 있는 종목을 매년 첫 거래일 시가에 매수한 코호트입니다. 공시 재무와 실제 정산 수익은 아직 결합하지 못했습니다.</p></div>`;
  }
  function patterns(){
    const s=state.summary,base=s.baselineTest.ratePct;
    return notice()+`<div class="box"><h3>상승 전에 보였던 가격·거래량 조건</h3><p>첫 거래일 전날까지의 정보만 사용했습니다. 조건이 참인 종목 중 5년 안에 종가 10배를 찍은 비율입니다. 조건별 표본이 겹치므로 확률을 더하거나 서로 독립이라고 해석할 수 없습니다.</p><p class="fine">학습 기준 확률 ${n(s.baselineTrain.ratePct)}% · 검증 기준 확률 ${n(base)}% · 아래 구간은 종목 단위 200회 재표집입니다.</p>${table(['매수 전 조건','학습 성공 확률','검증 성공 / 전체','검증 성공 확률','검증 기준 대비','95% 구간'],s.features.map(f=>`<tr><td>${esc(f.label)}</td><td class="num">${n(f.train.ratePct)}%</td><td class="num">${n(f.test.successN,0)} / ${n(f.test.n,0)}</td><td class="num">${n(f.test.ratePct)}%</td><td class="num">${base?n(f.test.ratePct/base,2)+'배':'미확인'}</td><td class="num">${(f.test.stockCluster95||[]).map(x=>n(x)).join('~')}%</td></tr>`))}<p class="fine">같은 종목·연도 간 수익 구간이 겹칩니다. 작은 확률 차이는 업종·시장 국면·현재 확보된 표본의 편향일 수 있습니다. 정량 조건은 전 종목의 공시 접수시각에 맞춘 재무 검증을 대체하지 않습니다.</p></div>
    <div class="box"><h3>사업 특징은 원문으로 따로 확인했습니다</h3><p>사업의 성장 원인은 가격 패턴만으로 증명할 수 없습니다. 아래 자료는 일부 기업 사례의 설명이며 전체 텐배거의 공통 특성으로 통계 검증한 결과는 아닙니다. 자료 공개일 이전의 신호에 소급 적용하지 않았습니다.</p>${evidence()}</div>
    <div class="box"><h3>실제 후보를 볼 때 확인할 것</h3><div class="steps"><div class="step"><b>매출 증가의 반복성</b><p>최근 공시의 분기 매출·영업이익·영업현금흐름, 전년 동기와 전분기 성장, 일회성 기술료와 본업 매출을 구분합니다. 이 항목은 현재 분석의 자동 선별 신호가 아닙니다.</p></div><div class="step"><b>성장을 매출로 바꾸는 능력</b><p>수주잔고·가동률·수출·생산능력·가격 인상과 증설 지출을 함께 봅니다. “큰 시장”이라는 설명만으로 재무 개선이 확인되지는 않습니다.</p></div><div class="step"><b>주당 이익과 기업행동</b><p>유상증자·전환사채·주식 분할·분사, 계약금과 조건부 마일스톤을 확인합니다. 총 계약액이나 시가총액 증가를 주당 실현 수익과 같게 취급하지 않습니다.</p></div></div></div>`;
  }
  function rules(){
    const s=state.summary;
    return notice()+`<div class="box"><h3>진입과 청산 규칙 24개 비교</h3><p>★는 <strong>학습 구간만으로 선택한 안</strong>입니다. 검증 순위가 높은 안으로 바꾸어 다시 검증했다고 주장하지 않습니다. 수익은 개별 거래의 비용 후 결과이며, 동시 투자·자금 배분을 포함한 포트폴리오 수익은 아닙니다.</p><p class="fine">학습 진입 2001~2010 / 최대 5년 추적 · 검증 진입 2016~2020 / 최대 5년 추적(~2025) · 한쪽 비용 0.5%</p>${table(['진입 → 매도','학습 중앙 수익','검증 거래 / 종목','검증 중앙 수익','검증 평균 수익','하위 10% 수익','보유 중 최악 낙폭','5년 보유보다 이긴 비율','중앙 보유일'],s.strategies.map(r=>`<tr class="${r.selectedOnTrain?'selected':''}"><td>${r.selectedOnTrain?'★ ':''}${esc(r.entry)}<span class="rule-note">${esc(r.exit)}</span></td><td class="num">${pct(r.train.medianReturnPct)}</td><td class="num">${n(r.test.n,0)} / ${n(r.test.stocks,0)}</td><td class="num ${color(r.test.medianReturnPct)}">${pct(r.test.medianReturnPct)}</td><td class="num">${pct(r.test.meanReturnPct)}</td><td class="num bad">${pct(r.test.p10ReturnPct)}</td><td class="num bad">${pct(r.test.worstMddPct)}</td><td class="num">${n(r.test.beatMatchedHoldPct)}%</td><td class="num">${n(r.test.medianHoldingDays,0)}</td></tr>`))}<p class="fine">수익 분포의 극단값·상장폐지 전액손실 스트레스가 평균을 크게 바꿉니다. 보유 중 낙폭은 종가 기준으로 장중 저가 낙폭보다 작을 수 있습니다. 완전한 5년 대조가 없는 거래는 표에서 제외했습니다.</p></div>
    <div class="box"><h3>거래비용에 얼마나 민감할까?</h3>${table(['규칙','한쪽 0.1%','한쪽 0.5%','한쪽 1.0%'],s.strategies.filter(r=>r.selectedOnTrain||r.id==='breakout252__hold5'||r.id==='breakout252__profit100'||r.id==='breakout252__trail25').map(r=>`<tr><td>${r.selectedOnTrain?'★ ':''}${esc(r.entry)}<span class="rule-note">${esc(r.exit)}</span></td>${r.costSensitivity.map(c=>`<td class="num">${pct(c.testMedianReturnPct)}</td>`).join('')}</tr>`))}<p class="fine">동일 체결 시가에 비용 가정만 변경한 민감도입니다. 실제 세율·호가 단위·정수주·시장 충격·매수 가능 수량을 복원한 실계좌 성과가 아닙니다.</p></div>
    <div class="box"><h3>주문 시점을 명확히 했습니다</h3><div class="steps"><div class="step"><b>매수</b><p>거래일 종가로 조건을 확정하고 바로 다음 봉 시가로 진입합니다. 다음 거래일 봉이 누락됐거나 거래정지·가격제한 근처 시가이면 그 신호는 버립니다. 당일 고저가·종가를 미리 보고 시가 진입을 골라내지 않습니다. 급등한 다음 날 더 비싸게 사는 갭도 반영합니다.</p></div><div class="step"><b>매도</b><p>손절·추세 이탈·익절은 종가 신호 다음 체결 가능한 시가입니다. -12% 손절 신호가 나도 다음 시가가 급락하면 손실은 -12%를 넘습니다. 거래정지·가격제한 근처 시가는 체결 가능한 다음 시가까지 기다립니다. 대기열과 호가 자료가 없는 보수적 가정입니다.</p></div><div class="step"><b>5년 대조</b><p>매수 시점부터 정해진 5년 기한의 체결 가능한 첫 시가에 매도합니다. 상장폐지 정산액을 모르는 경우 0원 손실 가정을 표시하고, 관측 종료의 미청산 평가는 확정 수익에 넣지 않습니다.</p></div></div></div>`;
  }
  function chart(c){
    const points=c.chart||[];if(points.length<2)return '<p class="fine">그래프 데이터가 없습니다.</p>';
    const w=850,h=270,l=65,r=20,t=16,b=42, min=Math.min(...points.map(x=>x[1])),max=Math.max(...points.map(x=>x[1]));
    const first=Date.parse(points[0][0]),last=Date.parse(points.at(-1)[0]);
    const x=date=>l+(Date.parse(date)-first)/(last-first||1)*(w-l-r);
    const y=price=>t+(Math.log(max)-Math.log(price))/(Math.log(max)-Math.log(min)||1)*(h-t-b);
    const line=points.map((p,i)=>(i?'L':'M')+x(p[0]).toFixed(1)+','+y(p[1]).toFixed(1)).join(' ');
    const markers=[[c.buyDate,c.buyClose,'사후 저점','#f5c451'],[c.sellDate,c.sellClose,'사후 최고점','#36d399']];
    const levels=[min,Math.sqrt(min*max),max];
    return `<svg class="case-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(c.name)} 소급 조정 종가 로그 그래프"><title>${esc(c.name)} 월말 종가와 정확한 사후 저점·최고점. 세로축 로그 눈금.</title>${levels.map(v=>`<line x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}" stroke="#2a3354"/><text x="${l-6}" y="${y(v)+4}" text-anchor="end" fill="#9aa6c9" font-size="11">${n(v,0)}</text>`).join('')}<path d="${line}" fill="none" stroke="#8b8cf0" stroke-width="2"/>${markers.map(([date,price,label,clr])=>`<circle cx="${x(date)}" cy="${y(price)}" r="5" fill="${clr}"><title>${esc(label+' '+date+' '+n(price,0)+'원')}</title></circle>`).join('')}<text x="${l}" y="${h-10}" fill="#9aa6c9" font-size="11">${esc(points[0][0])}</text><text x="${w-r}" y="${h-10}" text-anchor="end" fill="#9aa6c9" font-size="11">${esc(points.at(-1)[0])}</text></svg><div class="legend"><span>보라: 월말·특정 날짜 종가</span><span class="gold">● 사후 저점</span><span class="good">● 사후 최고점</span><span>세로축 로그 / 원</span></div>`;
  }
  function caseDetail(c){
    if(!c)return '';
    const executions=c.executions||[];
    return `<div class="box" id="tb-case-detail"><div class="case-head"><h3>${esc(c.name)} <span class="fine">${esc(c.code)} · ${esc(c.market)}</span></h3><span class="pill">사후 ${n(c.multiple)}배</span></div><p class="fine">${esc(c.sector)} · ${c.delistingDate?'상장폐지 이력 '+esc(c.delistingDate):'현재 상장 목록에 포함'}</p>${chart(c)}<div class="timeline"><div><span>사후 저점 → 최고점</span><strong>${esc(c.buyDate)} → ${esc(c.sellDate)}</strong></div><div><span>5년 안의 최대 상승</span><span>${n(c.fastFiveYear?.multiple)}배</span></div><div><span>조정 종가 기준</span><span>${n(c.buyClose,0)}원 → ${n(c.sellClose,0)}원</span></div><div><span>처음 2배 / 처음 10배</span><span>${esc(c.first2xDate||'없음')} / ${esc(c.first10xDate||'없음')}</span></div><div><span>상승 중 최대 종가 낙폭</span><span class="bad">${pct(c.riseMddPct)}</span></div><div><span>최고점 뒤 최저 종가까지 낙폭</span><span class="bad">${pct(c.postPeakDrawdownPct)}</span></div><div><span>관측 마지막 조정 종가 / 저점</span><span>${n(c.endpointMultiple)}배</span></div></div><h3>저점 대비 처음 2배가 된 날의 상태</h3>${table(['당시 지표','관측값'],[['직전 63일 수익률',pct((c.featuresAt2x?.ret63??NaN)*100)],['직전 126일 수익률',pct((c.featuresAt2x?.ret126??NaN)*100)],['200일선의 20일 변화',pct((c.featuresAt2x?.slope200??NaN)*100)],['거래량 / 직전 20일 평균',n(c.featuresAt2x?.volumeRatio)+'배'],['직전 252일 고점과 거리',pct((c.featuresAt2x?.distanceHigh??NaN)*100)],['60일 종가 범위',pct((c.featuresAt2x?.range60??NaN)*100)]].map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`))}<p class="fine">저점을 기준으로 첫 2배 날짜를 고른 사후 기술 통계입니다. 그날의 지표는 당시까지의 봉으로 계산했지만, 이 표를 미래 텐배거를 선별하는 검증된 신호로 취급하지 않습니다.</p><p class="fine">저점·최고점은 확보한 전체 기간에서 후행 순서를 지키며 계산한 사후 날짜입니다. 5년 최대 상승 배수는 별도로 계산했습니다. 마지막 배수는 관측 마지막 가격일 뿐, 상장폐지 정산 수익이나 실제 체결 수익이 아닙니다. 기업행동·과거 분할 조정을 포함한 원시 거래가는 별도 대조가 필요합니다.</p>${executions.length?`<h3>이 상승 구간에서 규칙으로 매매했다면</h3>${table(['진입 → 청산','신호 → 매수','매도 / 마지막 관측','비용 후 수익','상태'],executions.map(t=>`<tr><td>${esc(state.summary.strategies.find(r=>r.id===t.rule)?.entry||t.rule)}<span class="rule-note">${esc(state.summary.strategies.find(r=>r.id===t.rule)?.exit||'')}</span></td><td>${esc(t.signalDate)}<span class="rule-note">→ ${esc(t.buyDate)} / ${n(t.buyPrice,0)}원</span></td><td>${esc(t.sellDate)}<span class="rule-note">${n(t.sellPrice,0)}원</span></td><td class="num ${color(t.returnPct)}">${pct(t.returnPct)}</td><td>${t.terminalStress?'정산 미확인 손실 가정':t.completed?'청산':'미청산 평가'}<span class="rule-note">${esc(t.reason||'')}</span></td></tr>`))}<p class="fine">예시 거래는 이 상승 구간과 겹친 거래 중 사후 수익이 큰 거래를 고른 시연입니다. 규칙 선택·전체 검증 성과에 이 사후 선별 결과를 넣지 않았습니다.</p>`:'<p class="fine">이 종목에는 사후 구간·가격 그래프가 제공됩니다. 개별 규칙 거래 시연은 대표 기업에만 계산했으며, 전체 규칙 검증은 매수·매도 탭에 있습니다.</p>'}<a target="_blank" rel="noopener noreferrer" href="https://finance.naver.com/item/main.naver?code=${encodeURIComponent(c.code)}">종목 원천 정보 보기 ↗</a></div>`;
  }
  function casesView(){
    const items=filters(state.cases,state.market,state.query,state.sort);state.page=Math.max(0,Math.min(state.page,Math.ceil(items.length/20)-1));
    const page=items.slice(state.page*20,state.page*20+20),picked=items.find(c=>c.code===state.caseCode)||items[0]||null;state.caseCode=picked?.code||null;
    return notice()+`<div class="box"><h3>과거 텐배거 종목 찾기</h3><div class="filter"><input id="tb-query" type="search" placeholder="종목명 · 코드 · 업종 검색" aria-label="종목 검색" value="${esc(state.query)}"><select id="tb-market" aria-label="시장"><option value="ALL">전체 시장</option><option value="KOSPI" ${state.market==='KOSPI'?'selected':''}>코스피</option><option value="KOSDAQ" ${state.market==='KOSDAQ'?'selected':''}>코스닥</option></select><select id="tb-sort" aria-label="정렬"><option value="multiple">사후 상승 배수</option><option value="recent" ${state.sort==='recent'?'selected':''}>최고점 최신순</option><option value="retained" ${state.sort==='retained'?'selected':''}>마지막 가격 배수</option></select></div><p class="case-count">${n(items.length,0)}개 · 종목명을 누르면 매수·매도 날짜와 상승 중 낙폭을 확인할 수 있습니다.</p>${table(['종목','시장','사후 전체 기간 배수','저점 → 최고점','상승 중 최대 낙폭','최고점 후 최대 하락'],page.map(c=>`<tr><td><button data-case="${esc(c.code)}">${esc(c.name)}<span class="rule-note">${esc(c.code)}</span></button></td><td>${esc(c.market)}</td><td class="num">${n(c.multiple)}배</td><td>${esc(c.buyDate)}<span class="rule-note">→ ${esc(c.sellDate)}</span></td><td class="num bad">${pct(c.riseMddPct)}</td><td class="num bad">${pct(c.postPeakDrawdownPct)}</td></tr>`))}<div class="pager"><button id="tb-prev" ${state.page===0?'disabled':''}>이전</button><span class="fine">${items.length?state.page+1:0} / ${Math.ceil(items.length/20)}</span><button id="tb-next" ${(state.page+1)*20>=items.length?'disabled':''}>다음</button></div><p class="fine">원천 가격이 없거나 조정 OHLC 오류·36% 초과 급변이 있는 종목은 이 목록에서 제외했습니다. 누락·제외 종목은 검증·출처에서 확인할 수 있습니다.</p></div>${caseDetail(picked)}`;
  }
  function evidence(){
    return `<div class="sources">${(state.evidence?.cases||[]).map(e=>`<article><a href="${safeUrl(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.company)} · ${esc(e.title)} ↗</a><div class="fine">${esc(e.publishedDate)} 공개 · ${esc(e.type)}</div><p>${esc(e.fact)}</p><p><strong>해석:</strong> ${esc(e.inference)}</p><p class="fine">${esc(e.limit)}</p></article>`).join('')}</div>`;
  }
  const qualityNames={'no_price_history':'과거 가격 없음','source_failed':'가격 원천 요청 실패','less_than_253_bars':'253봉 미만','price_jump_over_36pct':'조정 종가 일간 36% 초과 급변','inconsistent_adjusted_ohlc':'조정 OHLC 불일치','duplicate_dates':'중복 날짜','delisting_terminal_history_gap':'상장폐지 직전 가격 31일 이상 누락'};
  function method(){
    const s=state.summary,c=s.collection,m=s.method;
    return `<div class="notice"><strong>분석은 완료했지만 전수·인과·실계좌 성과 검증과는 다릅니다.</strong><br>현재 확보할 수 있는 가격에서 과거 특징과 규칙 성과를 계산했습니다. 아래 빠진 범위가 결과에 영향을 줄 수 있습니다.</div><div class="cards">${metric('요청한 현재 상장 종목',n(c.listedRequested,0)+'개',`가격 품질 통과 ${n(c.listedUsable,0)}개`)}${metric('요청한 상장폐지 이력',n(c.delistedRequested,0)+'개',`가격 품질 통과 ${n(c.delistedUsable,0)}개`)}${metric('분석에서 제외된 종목',n(c.requested-c.usable,0)+'개','누락·짧은 이력·품질 문제')}${metric('연초 5년 코호트',n(s.cohortN,0)+'건','같은 종목의 연도별 구간이 겹침')}</div><div class="box"><h3>품질 때문에 제외한 범위</h3>${table(['제외 사유','건수 (사유 간 중복 가능)'],Object.entries(c.qualityExclusions).map(([k,v])=>`<tr><td>${esc(qualityNames[k]||k)}</td><td>${n(v,0)}</td></tr>`))}<p class="fine">36% 초과 급변은 오류 확정이 아니라 기업행동·장기 거래정지·분할 조정 여부를 추가 확인해야 하는 격리 기준입니다. 해당 종목이 텐배거가 아니었다는 뜻이 아닙니다. 스팩·리츠·다중 상장폐지·현재 코드 충돌은 모집단 구성 단계에서 별도 제외했습니다.</p><p><a href="${ROOT}universe.json" target="_blank" rel="noopener">종목별 요청·누락·제외·원천 해시 전체 보기 (JSON) ↗</a></p></div><div class="box"><h3>정의와 재현 조건</h3><dl class="method-list">${Object.entries(m).map(([k,v])=>`<div><dt>${esc(({oracle:'사후 최대 수익 구간',train:'학습 구간',test:'검증 구간',cost:'거래비용',execution:'체결',limitZone:'가격 제한 근처 체결 가정',terminal:'상장폐지 정산',inference:'표본과 확률',returnUnit:'성과 단위',priceBasis:'가격 기준',marketBasis:'시장·업종 분류',fundamentals:'재무 정보'})[k]||k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><details><summary>데이터 기준일과 해시</summary><p class="fine">시세 ${esc(s.analysisStart)}~${esc(s.analysisEnd)}<br>생성 ${esc(s.generatedAt)}<br>상장폐지 목록 ${esc(c.delistingSnapshot)}<br>입력 명세 SHA256 ${esc(c.inputManifestSha256)}</p></details></div><div class="box"><h3>원천 자료</h3><div class="sources">${(state.evidence?.sources||[]).map(e=>`<article><a href="${safeUrl(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)} ↗</a><p>${esc(e.description)}</p></article>`).join('')}</div></div><div class="box"><h3>현재 투자 후보로 연결하기 전 남은 검증</h3><p>상장폐지·합병 정산과 과거 종목 정체성, 거래 당시 원시 가격·분할·증자·배당·주식수, 공시 접수시각 기준 재무 패널, 시장별 상대강도와 업종·시장 국면, 거래대금·시장 충격·가격 제한의 체결 가능성, 동시 보유와 자금 배분을 포함한 포트폴리오 및 전향적 모의 검증이 필요합니다.</p><p class="fine">이번 결과에서 과거 구간의 사후 최고 수익은 계산할 수 있지만, 미래 최대 수익의 매수·매도 시점을 확정하거나 현재 종목별 매수 점수를 생성할 근거는 아직 충분하지 않습니다.</p></div>`;
  }
  function forward(){
    const f=state.forward;
    if(!f)return '<div class="notice">'+esc(state.forwardError||'전향 모의 검증 자료를 불러오는 중…')+'</div><button class="action" id="tb-forward-refresh">다시 조회</button>';
    const names=f.rules?.patterns||{};
    const records=f.records||[];
    const rows=records.slice().reverse().slice(0,100).map(r=>`<tr><td>${esc(r.name)}<span class="rule-note">${esc(r.code)} · ${esc(r.market)}</span></td><td>${esc(names[r.pattern]||r.pattern)}</td><td>${esc(r.signalDate)}<span class="rule-note">등록 ${esc(r.registeredDate)}</span></td><td>${esc(r.entryDate||'다음 세션 대기')}</td><td class="num">${n(r.sessions,0)}</td><td class="num">${pct(r.netMarkPct)}</td><td>${esc(r.dataStatus)}${r.revisionDates?.length?'<span class="rule-note">원천 수정 감지 · 기존 기록 보존</span>':''}</td></tr>`);
    return `<div class="notice"><strong>미래 후보를 테스트하는 연구 · 자동주문 없음</strong><br>과거에 정의한 세 가격 패턴을 고정했습니다. 텐배거 예측력과 수익성은 아직 미검증입니다. 신호·등록일 모두 지난 다음 거래 가능한 KRX 종가부터 관찰하며, 과거 결과를 소급해서 모의 수익으로 넣지 않습니다.</div>
      <div class="cards">${metric('시세 기준일',f.asOf||'대기','KRX 정규장 종가 / 마감·발표 지연 반영')}${metric('이번 조건 통과',n(f.candidates?.length||0,0)+'신호','한 종목에 여러 패턴 가능 / 매수 추천 아님')}${metric('누적 실험 등록',n(records.length,0)+'건','같은 종목·패턴의 활성 실험은 중복 등록 안 함')}${metric('관찰 시작 / 청산군',n(f.entered||0,0)+' / '+n(f.closedArms||0,0),'청산 미확인은 확정 0%가 아님')}</div>
      <div class="box"><h3>고정한 탐색 가설 v${esc(f.strategyVersion)}</h3>${table(['패턴','등록 조건'],[
        '<tr><td>상승 200일선 재돌파</td><td>종가가 200일선 위로 재진입 + 200일선의 20일 변화 양수</td></tr>',
        '<tr><td>252일 신고가·거래량</td><td>직전 252일 종가 고점 돌파 + 상승 200일선 + 직전 20일 평균 대비 거래량 1.5배 이상</td></tr>',
        '<tr><td>상승 추세·50일선 재돌파</td><td>상승 200일선 위 + 50일선 재진입 + 직전 252일 고점 대비 −30%~−5%</td></tr>'
      ])}<p class="fine">공통: KOSPI·KOSDAQ 보통주 / 관리·환기·스팩·리츠 등 제외 / 253봉 이상 연속 이력 / 직전 20일 평균 거래대금 10억원 이상. 재무 성장·공시·시장지수 대조는 미포함이며, 과거 분석의 최적 전략이라고 선택한 것이 아닙니다.</p>
      <p>등록 후 동일 기준에서 <b>1260거래일 보유</b>와 <b>종가 −12% 손절·고점 대비 −35% 추적 청산</b> 두 군을 비교합니다. 청산 신호 다음 거래 가능 종가를 기록하므로 손실이 −12%를 넘을 수 있습니다. 20·60·120·252·756·1260거래일 관찰과 2·5·10배 최초 도달을 보존합니다.</p></div>
      <div class="box"><h3>앞으로 쌓이는 후보·실패 기록</h3><button class="action" id="tb-forward-refresh">최신 연구 조회</button><p class="fine">${esc(f.generatedAt)} · 등록 시작 ${esc(f.registeredAt)} · ${esc(f.coverage?.examined??'미확인')}종목 조건 검사</p>${state.forwardError?'<p class="bad">'+esc(state.forwardError)+' · 이전 자료 유지</p>':''}${rows.length?table(['종목','패턴','신호 / 등록','관찰 진입일','경과 세션','비용 가정 평가','자료 상태'],rows):'<p>조건 통과 실험이 아직 없습니다. 신호가 없다고 조건을 완화하지 않습니다.</p>'}<p class="fine">최근 100건 표시 · <a href="/api/tenbagger-research" target="_blank" rel="noopener">전체 기록 JSON ↗</a>. 손익은 종목별 관찰 평가이며 계좌·포트폴리오 수익률이 아닙니다.</p></div>
      <div class="box"><h3>현재 후보 ${n(f.candidates?.length||0,0)}신호</h3>${table(['종목','패턴','직전 거래대금','거래량 배수'],(f.candidates||[]).map(c=>`<tr><td>${esc(c.name)} · ${esc(c.code)}</td><td>${esc(names[c.pattern]||c.pattern)}</td><td class="num">${n((c.features?.prior20AmountWon||0)/1e8)}억원</td><td class="num">${n(c.features?.volumeRatio)}배</td></tr>`))}</div>
      <div class="box"><h3>패턴별 앞으로의 검증 결과</h3>${table(['패턴','등록 / 종목','관찰 시작','20봉 중앙 / 표본','60봉 중앙 / 표본','보유군 청산','손절·추적군 청산'],(f.patternStats||[]).map(p=>`<tr><td>${esc(names[p.pattern]||p.pattern)}</td><td>${n(p.registrations,0)} / ${n(p.uniqueStocks,0)}</td><td>${n(p.entered,0)}</td><td>${pct(p.horizons?.['20']?.medianNetPct)} / ${n(p.horizons?.['20']?.n||0,0)}</td><td>${pct(p.horizons?.['60']?.medianNetPct)} / ${n(p.horizons?.['60']?.n||0,0)}</td><td>${pct(p.arms?.hold1260?.medianNetPct)} / ${n(p.arms?.hold1260?.closedN||0,0)}</td><td>${pct(p.arms?.stop12_trail35?.medianNetPct)} / ${n(p.arms?.stop12_trail35?.closedN||0,0)}</td></tr>`))}<p class="fine">표본이 없으면 미확인입니다. 청산된 거래만의 비교에는 보유기간·미청산 편향이 있으며, 시장지수 대비 초과성과나 최적 매도 규칙이 입증된 것은 아닙니다. 120·252·756·1260봉 및 종목별 두 청산군 상세는 전체 JSON에 보존합니다.</p></div>
      <div class="box"><h3>검증 상태와 알림</h3><p>과거 관찰에서 매매 규칙의 성과는 충분히 안정적이지 않았습니다. 이번 조건은 별도로 새 자료를 모으는 실험이며, 좋은 종목만 남기거나 기준을 뒤늦게 바꾸지 않습니다.</p><ul>${(f.warnings||[]).map(w=>'<li>'+esc(w)+'</li>').join('')}</ul><p><a href="/settings">설정 → 연구 결과 알림</a>을 켠 기기에만 일일 요약을 보냅니다. 실체결·기기 수신·미래 수익은 별도 확인 대상입니다.</p><details><summary>고정 규칙·수집 범위·원천 해시</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify({rulesSha256:f.rulesSha256,coverage:f.coverage,source:f.source},null,2))}</pre></details></div>`;
  }
  async function bootForward(force=false){
    if(state.forwardLoading||state.forward&&!force)return;
    state.forwardLoading=true;
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);
    try{
      const r=await fetch('/api/tenbagger-research',{signal:ac.signal,cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok||j.schemaVersion!==1||!Array.isArray(j.records)||!Array.isArray(j.candidates))throw new Error(j.error||'전향 자료 형식/응답 오류');
      state.forward=j;state.forwardError='';
    }catch(e){state.forwardError='전향 연구 조회 실패: '+(e.message||e);}finally{clearTimeout(timer);state.forwardLoading=false;if(state.view==='forward')render();}
  }
  function render(){
    if(state.view!=='forward'&&!state.summary)return;
    document.querySelectorAll('#tbg-root [data-view]').forEach(b=>{const active=b.dataset.view===state.view;b.classList.toggle('on',active);b.setAttribute('aria-selected',String(active));});
    const content=document.getElementById('tb-content');content.innerHTML=({forward,overview,patterns,rules,cases:casesView,method})[state.view]();
    const refresh=document.getElementById('tb-forward-refresh');if(refresh)refresh.onclick=()=>bootForward(true);
    content.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{state.view=b.dataset.open;render();});
    content.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{state.caseCode=b.dataset.case;render();document.getElementById('tb-case-detail')?.scrollIntoView({behavior:'smooth',block:'start'});});
    const q=document.getElementById('tb-query');if(q)q.oninput=()=>{const pos=q.selectionStart;state.query=q.value;state.page=0;render();const next=document.getElementById('tb-query');next.focus();next.setSelectionRange(pos,pos);};
    const market=document.getElementById('tb-market');if(market)market.onchange=()=>{state.market=market.value;state.page=0;render();};
    const sort=document.getElementById('tb-sort');if(sort)sort.onchange=()=>{state.sort=sort.value;state.page=0;render();};
    const prev=document.getElementById('tb-prev');if(prev)prev.onclick=()=>{state.page--;render();};
    const next=document.getElementById('tb-next');if(next)next.onclick=()=>{state.page++;render();};
  }
  async function get(file){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);try{const r=await fetch(ROOT+file,{signal:ac.signal,cache:'no-cache'});if(!r.ok)throw new Error(file+' HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}}
  async function boot(){
    if(state.view==='forward'){render();return bootForward();}
    if(state.summary||state.loading)return;
    state.loading=true;
    const status=document.getElementById('tb-status');
    try{
      const [s,c,e]=await Promise.all([get('summary.json'),get('cases.json'),get('evidence.json')]);
      if(s.version!=='1.0.0'||!Array.isArray(c)||!Array.isArray(s.strategies))throw new Error('분석 버전 또는 자료 형식 불일치');
      state.summary=s;state.cases=c;state.evidence=e;state.caseCode=(c.find(x=>x.code==='003230')||c[0])?.code||null;
      document.getElementById('tb-period').textContent=`${s.analysisStart}~${s.analysisEnd} · 과거 가격 연구 ${s.version} · 코스피 ${n(s.byMarket.KOSPI||0,0)} / 코스닥 ${n(s.byMarket.KOSDAQ||0,0)} 사례`;
      status.textContent='';render();
    }catch(e){status.textContent='분석 자료를 불러오지 못했습니다: '+(e.message||e);const b=document.createElement('button');b.className='action';b.textContent='다시 불러오기';b.onclick=boot;status.appendChild(b);}finally{state.loading=false;}
  }
  window.TenbaggerResearch={esc,safeUrl,filters,chart,caseDetail,casesView,overview,patterns,rules,method,forward,state,render,boot,bootForward};
  document.querySelectorAll('#tbg-root [data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;boot();render();});
  function start(){
    document.getElementById('tabs')?.addEventListener('click',e=>{if(e.target.closest('[data-tab="gpt"]'))boot();});
    if(document.getElementById('tbg-root')?.dataset?.host==='research'){
      if(document.getElementById('strategy_tenbagger')?.classList?.contains('on'))boot();
      return;
    }
    if(!document.getElementById('pane-gpt')?.hidden)boot();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
