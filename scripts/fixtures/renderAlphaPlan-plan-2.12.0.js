/* 고치기 전 plan.html v2.12.0 의 renderAlphaPlan 원문(2026-11-11 · main 7932f8e) — scripts/check-plan-bg-strip.cjs 가 새 함수(화면 모드)와 결과를 맞춰 본다. 고치지 말 것. */
function renderAlphaPlan(qTecl,qTqqq,qSgov){
  if(!qTecl||!qTqqq||!qSgov||!qTecl.settled||!qTqqq.settled||!qSgov.settled)return;
  const D=PATH_DEFAULTS.alpha,tr=qTecl.rows.filter(x=>x.date<=qTecl.settled.date),qr=qTqqq.rows.filter(x=>x.date<=qTqqq.settled.date);
  const sigma=realizedVol(tr,D.ivsLook),ma=indicatorSeries(qr.map(x=>x.close),D.guardMA),sma=ma[ma.length-1];
  // 신호·밴드 판정은 마지막 확정 종가만 사용한다. 오늘 장중 가격을 신호에 섞지 않는다.
  const ts=+qTecl.settled.close,qs=+qTqqq.settled.close,ss=+qSgov.settled.close;
  // 주문 수량만 현재가(없으면 확정종가)로 추정한다. 다음 체결가가 달라지면 수량도 다시 계산한다.
  const tp=(+qTecl.price>0?+qTecl.price:ts),qp=(+qTqqq.price>0?+qTqqq.price:qs),sp=(+qSgov.price>0?+qSgov.price:ss);
  if(!(sigma>0)||!(sma>0)||!(ts>0)||!(qs>0)||!(ss>0)||!(tp>0)||!(qp>0)||!(sp>0)){if($('alphaMeta'))$('alphaMeta').textContent='지표 계산에 필요한 이력이 부족합니다.';return;}
  const tq=Math.max(0,Math.floor(num('aTeclQty'))),qq=Math.max(0,Math.floor(num('aTqqqQty'))),sq=Math.max(0,Math.floor(num('aSgovQty'))),cash=num('aCash');
  const startCap=Math.max(1,num('startCapital',20000));
  if($('alphaStartState'))$('alphaStartState').textContent=(tq===0&&qq===0&&sq===0&&Math.abs(cash-startCap)<1?'신규 시작 상태 · 현금 '+usd(startCap)+'에서 오늘 주문을 계산합니다.':'운용 중 · 현재 보유수량/현금을 기준으로 필요한 주문만 표시합니다.');
  let signalTotal=tq*ts+qq*qs+sq*ss+cash;if(!(signalTotal>0)){signalTotal=startCap;$('aCash').value=startCap;}
  const PX=alphaPanicNext(qTecl.settled.date,qq>0);   // 공포 모드 세션(모의 · 운영)만 — 그 밖에는 null
  renderLivePanic(PX);
  if(PX&&PX.error){alphaPanicBlocked(PX.error);return;}   // 운영 공포 모드인데 판정 불가 — 기본 규칙 주문을 대신 보이지 않는다
  const sigW=alphaPanicApply(PX,sigma,'').sigma;   // TECL 목표의 σ — 공포 모드 재가속 중이면 엔진 σ
  const AR=alphaRuleSet(),E=window.JKPlanSessionEngine,S0=D.ivsS0,w=Math.min(1,(S0*S0)/(sigW*sigW)),curTeclW=(tq*ts)/signalTotal,sleeveNow=curTeclW/Math.max(D.teclWeight,1e-9);
  // 판정은 모의 엔진과 같은 alphaDecide (규칙은 기본 하나 — 새 규칙·공격형 2026-11-08 폐지).
  if(!E||!E.alphaDecide){if($('alphaMeta'))$('alphaMeta').textContent='듀얼가드 엔진(plan-session-engine.js)을 불러오지 못했습니다 — 새로고침하세요.';return;}
  const yearStart=!!(E.yearDoneAt&&E.yearDoneAt(qTqqq.settled.date));
  const dec=E.alphaDecide({rules:AR,w,sleeveNow,teclQty:tq,tqqqQty:qq,tqqqClose:qs,sma,tqqqWeight:(qq*qs)/signalTotal,guardWeight:D.guardWeight,yearStart});
  const PA=alphaPanicApply(PX,sigma,dec.guard),guard=PA.guard,teclHit=dec.teclHit,upper=dec.upper,lower=dec.lower,tqReb=dec.tqReb,guardFlip=PA.own?(guard==='ON')!==(qq>0):dec.guardFlip;
  const panicNote=PX?(PA.fast?' · 공포 모드 빠른 Guard(SMA'+PX.params.ma+' ±'+(PX.params.band*100).toFixed(0)+'%)':'')+(PA.sleeve?' · 공포 모드 TECL 재가속(σ '+(sigma*100).toFixed(0)+'% → '+(sigW*100).toFixed(0)+'%)':''):'';
  const dep=alphaDepositPending(),force=!!dep;   // 입금 맞춤 — 모의 엔진의 force(입금일 전체 맞춤)와 같은 규칙
  const needRebalance=teclHit||guardFlip||tqReb||force||horizonRebalancePending||(!tq&&!qq&&!sq);

  // 사용자가 주문 판단 근거를 직접 검증할 수 있도록 계산값과 그래프를 함께 노출한다.
  const gap=Math.abs(w-sleeveNow),bandLo=Math.max(0,w-D.ivsBand),bandHi=Math.min(1,w+D.ivsBand);
  const bLo=Math.max(0,w-AR.bandUp),bHi=Math.min(1,w+AR.bandDn),teclBandNow=sleeveNow>w?AR.bandDn:AR.bandUp;   // 유지 구간: 목표보다 bandUp 아래 ~ bandDn 위 (기본 규칙은 ±10%p 로 bandLo·bandHi 와 같다)
  if($('alphaSigma'))$('alphaSigma').textContent=(sigma*100).toFixed(1)+'%';
  if($('alphaTargetW'))$('alphaTargetW').textContent=(w*100).toFixed(1)+'%';
  if($('alphaCurrentW'))$('alphaCurrentW').textContent=(sleeveNow*100).toFixed(1)+'%';
  if($('alphaWeightGap'))$('alphaWeightGap').textContent='전체 자산의 '+(curTeclW*100).toFixed(1)+'% · 목표와 '+(gap*100).toFixed(1)+'%p 차이 · '+((D.ivsBand*100).toFixed(1)+'%p 초과 시 조정');
  if($('alphaGuardState'))$('alphaGuardState').textContent=guard;
  const guardDist=(qs/sma-1)*100;
  if($('alphaGuardGap'))$('alphaGuardGap').textContent='종가 '+usd(qs)+' · SMA'+D.guardMA+' 대비 '+(guardDist>=0?'+':'')+guardDist.toFixed(2)+'%';
  if($('alphaTeclBandText'))$('alphaTeclBandText').textContent='목표 '+(w*100).toFixed(1)+'% · 실제 판정경계 '+((w-AR.bandUp)*100).toFixed(1)+'~'+((w+AR.bandDn)*100).toFixed(1)+'% · 현재 '+(sleeveNow*100).toFixed(1)+'%'+(w+AR.bandDn>1?' (막대는 100%까지 표시)':'');
  const band=$('alphaTeclBand'),tm=$('alphaTeclTargetMark'),cm=$('alphaTeclCurrentMark');
  if(band){band.style.left=(bLo*100)+'%';band.style.width=((bHi-bLo)*100)+'%';}
  if(tm)tm.style.left=(Math.max(0,Math.min(1,w))*100)+'%';
  if(cm)cm.style.left=(Math.max(0,Math.min(1,sleeveNow))*100)+'%';
  const wh=alphaWeightHistory(tr,D,60,S0);
  if($('alphaWeightChart'))$('alphaWeightChart').innerHTML=alphaSvg([{values:wh,color:'#8b8cf0',width:2.2}],{label:'최근 TECL 역분산 목표비중'});
  const tailStart=Math.max(0,qr.length-120),guardClose=[],guardMa=[],guardUp=[],guardDn=[];
  for(let i=tailStart;i<qr.length;i++){const mv=ma[i];if(!(mv>0))continue;guardClose.push(+qr[i].close);guardMa.push(mv);guardUp.push(mv*(1+AR.guardOn));guardDn.push(mv*(1-AR.guardOff));}
  if($('alphaGuardChart'))$('alphaGuardChart').innerHTML=alphaSvg([
    {values:guardClose,color:'#8b8cf0',width:2.2},{values:guardMa,color:'#f5c451',width:1.8},
    {values:guardUp,color:'#36d399',width:1.1,kind:'dash'},{values:guardDn,color:'#f87b8c',width:1.1,kind:'dash'}
  ],{label:'TQQQ 종가와 SMA'+D.guardMA+' Guard 경계'});
  if($('alphaGuardLevels'))$('alphaGuardLevels').textContent='종가 '+usd(qs)+' · SMA'+D.guardMA+' '+usd(sma)+' · ON '+usd(upper)+' 초과 · OFF '+usd(lower)+' 미만';
  const teclReason=tq===0
    ? 'TECL 첫 진입이라 목표비중으로 맞춥니다.'
    : teclHit
      ? 'TECL 슬리브 현재 '+(sleeveNow*100).toFixed(1)+'%와 목표 '+(w*100).toFixed(1)+'%의 차이 '+(gap*100).toFixed(1)+'%p가 기준 '+(teclBandNow*100).toFixed(1)+'%p를 넘었습니다.'
      : 'TECL 차이 '+(gap*100).toFixed(1)+'%p가 기준 '+(teclBandNow*100).toFixed(1)+'%p 안'+(force?'이지만 입금 맞춤으로 목표에 맞춥니다.':'이라 유지합니다.');
  const guardReason=guardFlip
    ? (guard==='ON'
        ? 'TQQQ 종가 '+usd(qs)+'가 ON 경계 '+usd(upper)+'를 넘어 Guard ON으로 전환합니다.'
        : 'TQQQ 종가 '+usd(qs)+'가 OFF 경계 '+usd(lower)+' 아래라 Guard OFF로 대피합니다.')
    : 'TQQQ Guard '+guard+' 유지 · 종가 '+usd(qs)+' / SMA'+D.guardMA+' '+usd(sma)+(force?' · 입금 맞춤으로 '+(guard==='ON'?(D.guardWeight*100).toFixed(0)+'%':'0%')+' 목표에 맞춥니다':'')+'.';
  const depReason=force?'입금('+dep.date+') '+usd2(dep.amount)+' 뒤 체결 기록이 없어 전체를 목표 비중으로 맞춥니다 — 모의 계산과 같은 규칙.':'';
  if($('alphaDecision')){
    $('alphaDecision').className='alpha-decision'+(needRebalance?' go':'');
    $('alphaDecision').innerHTML='<b>오늘 판단: '+(needRebalance?'리밸런싱/상태조정':'유지')+'</b><br>'+teclReason+'<br>'+guardReason+(force?'<br>'+depReason:'')+'<br><span class="sub">판정일 '+qTecl.settled.date+' 확정종가 기준 · 장중가격은 신호가 아니라 주문수량 추정에만 사용'+panicNote+'</span>';
  }

  // 확정종가로 목표 주수를 미리 계산한다. 다음 거래일 체결가는 주문 시점에는 알 수 없다.
  const targetTq=(teclHit||force||horizonRebalancePending)?Math.max(0,Math.floor(signalTotal*D.teclWeight*w/ts)):tq;
  const targetQq=(guardFlip||tqReb||force||horizonRebalancePending)?(guard==='ON'?Math.max(0,Math.floor(signalTotal*D.guardWeight/qs)):0):qq;
  const targetSq=needRebalance?Math.max(0,Math.floor(Math.max(0,signalTotal-targetTq*ts-targetQq*qs)/ss)):sq;

  // 수수료까지 예약해 '화면 수량 그대로' 넣었을 때 현금 부족 주문이 되지 않게 매도→위험자산 매수→SGOV 순서로 제한한다.
  const F=ALPHA_FEE_RATE, orders=[];let avail=Math.max(0,cash);
  const pos={TECL:tq,TQQQ:qq,SGOV:sq},pxs={TECL:tp,TQQQ:qp,SGOV:sp},targets={TECL:targetTq,TQQQ:targetQq,SGOV:targetSq};
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=targets[sym]-pos[sym];if(dq<0){const q=-dq,p=pxs[sym];avail+=q*p-alphaFee(q,p);orders.push({side:'sell',sym,qty:q,price:p,note:sym==='TECL'?'역분산 목표':sym==='TQQQ'?'Guard '+guard:'잔여 대피자산'});}
  }
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=targets[sym]-pos[sym];if(dq>0){const p=pxs[sym],q=Math.min(dq,Math.floor(avail/(p*(1+F))));if(q>0){avail-=q*p+alphaFee(q,p);orders.push({side:'buy',sym,qty:q,price:p,note:sym==='TECL'?'역분산 목표':sym==='TQQQ'?'Guard '+guard:'잔여 대피자산'});}}
  }
  $('alphaMeta').textContent='신호 '+qTecl.settled.date+' 확정종가 · TECL σ'+D.ivsLook+' '+(sigma*100).toFixed(1)+'% → 목표 '+(w*100).toFixed(1)+'% ('+(D.teclWeight*100).toFixed(0)+'% 슬리브 내) · TQQQ '+usd(qs)+' / SMA'+D.guardMA+' '+usd(sma)+' · Guard '+guard+' · '+planStrategyLabelOf(activeAssetSession());
  if($('alphaRefreshTime'))$('alphaRefreshTime').textContent='시세 자동 갱신 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  pendingAlphaOrders=orders.map(o=>({...o}));alphaOrderHold='';
  if($('alphaRecordFill')){$('alphaRecordFill').disabled=!orders.length;$('alphaRecordFill').textContent='이대로 기록';}   // 기록 창(📌 오늘의 추천)의 단추
  if(!orders.length)alphaCloseFillEditor();
  $('alphaActions').innerHTML=orders.length?orders.map(x=>alphaOrderHtml(x.side,x.sym,x.qty,x.price,x.note)).join(''):waitHtml('오늘 주문 없음','TECL 밴드와 TQQQ Guard 모두 유지 구간입니다.');
  const teclAmt=targetTq*tp,tqqqAmt=targetQq*qp,sgovAmt=targetSq*sp;
  const tw=teclAmt/signalTotal*100,qw=tqqqAmt/signalTotal*100,sw=Math.max(0,100-tw-qw);
  const buyMap={TECL:0,TQQQ:0,SGOV:0},buyFee={TECL:0,TQQQ:0,SGOV:0};
  for(const o of orders){if(o.side==='buy'){const g=o.qty*o.price;buyMap[o.sym]=(buyMap[o.sym]||0)+g;buyFee[o.sym]=(buyFee[o.sym]||0)+alphaFee(o.qty,o.price);}}
  const totalBuy=buyMap.TECL+buyMap.TQQQ+buyMap.SGOV,totalNeed=totalBuy+buyFee.TECL+buyFee.TQQQ+buyFee.SGOV;
  $('alphaSummary').innerHTML=
    '<b>목표 보유금액:</b> TECL '+usd(teclAmt)+' · TQQQ '+usd(tqqqAmt)+' · SGOV '+usd(sgovAmt)+' · 잔여현금 약 '+usd(Math.max(0,signalTotal-teclAmt-tqqqAmt-sgovAmt))+
    '<br><b>목표비중:</b> TECL '+tw.toFixed(1)+'% · TQQQ '+qw.toFixed(1)+'% · SGOV/현금 '+sw.toFixed(1)+'% · 신호기준 평가액 '+usd(signalTotal)+
    '<br><b>오늘 매수금액:</b> TECL '+usd(buyMap.TECL)+' · TQQQ '+usd(buyMap.TQQQ)+' · SGOV '+usd(buyMap.SGOV)+' · 합계 '+usd(totalBuy)+' · <b>수수료 포함 필요현금 약 '+usd(totalNeed)+'</b>'+
    '<br><b>트리거:</b> TECL '+(teclHit?'리밸런싱':'유지')+' · TQQQ '+(guardFlip?'상태전환 '+guard:'유지 '+guard)+(force?' · 입금 맞춤 '+usd2(dep.amount):'')+
    '<br><span class="sub">목표 주수는 전일 확정종가로 계산하며, 매수가능 주수와 거래금액은 현재가·수수료(0.1%)로 추정합니다. 실제 체결가가 달라지면 매수량이 감소할 수 있습니다.</span>';
  // 실제 매매결과를 바꾸지 않고, 확정 종가 기준 판단과 발주 가능 건수를 구분해 표시한다.
  const guide=$('alphaGuide');
  if(guide){
    const b=alphaExplainBounds(w,sleeveNow,D.ivsBand);
    const teclStatus=tq===0?'첫 진입 판정':teclHit?(sleeveNow<w?'비중 확대 조건 충족':'비중 축소 조건 충족'):'유지';
    const guardStatus=guardFlip?(guard==='ON'?'TQQQ 매수 전환':'TQQQ 매도 전환'):'Guard '+guard+' 유지';
    const guardNext=guard==='ON'?'다음 OFF: 확정 종가 '+usd(lower)+' 미만':'다음 ON: 확정 종가 '+usd(upper)+' 초과';
    const orderText=orders.length?'주문 '+orders.length+'건 · '+orders.map(o=>o.sym+' '+(o.side==='buy'?'매수 ':'매도 ')+o.qty+'주').join(' / '):
      needRebalance?'조건 충족 · 정수주수·현금 등을 반영한 실제 주문 0건':'주문 없음 · 기존 보유 유지';
    const difference=b.side==='부족'?'목표보다 부족':b.side==='초과'?'목표보다 초과':'목표와 일치';
    guide.hidden=false;
    guide.innerHTML='<div class="alpha-guide-title">📌 이번 판단과 다음 거래 조건</div>'
      +'<div class="alpha-guide-grid">'
      +'<div class="alpha-guide-item"><b>TECL · '+teclStatus+'</b>'
      +'전체 자산: 현재 '+(curTeclW*100).toFixed(1)+'% / 목표 '+(D.teclWeight*w*100).toFixed(1)+'%. '
      +'TECL 몫 기준 '+(b.gap*100).toFixed(1)+'%p '+difference+'.<br>'
      +'매수/매도 판정 경계: '+(b.low*100).toFixed(1)+'% 미만 또는 '+(b.high*100).toFixed(1)+'% 초과. '
      +(teclHit?'이번에 조정 조건 충족.':'경계까지 약 '+(b.distance*100).toFixed(1)+'%p 남음(목표 고정 가정).')
      +'<br>확정 종가 평가액: '+usd(tq*ts)+' / 목표액 '+usd(signalTotal*D.teclWeight*w)+'</div>'
      +'<div class="alpha-guide-item"><b>TQQQ · '+guardStatus+'</b>'
      +'종가 '+usd(qs)+' / SMA'+D.guardMA+' '+usd(sma)+' ('+(guardDist>=0?'+':'')+guardDist.toFixed(2)+'%).<br>'
      +guardNext+'. 이동평균이 매일 달라져 다음 거래일 경계도 변동합니다.<br>'
      +'ON이면 30% 목표로 진입, OFF이면 SGOV로 대피. 이미 ON/OFF 상태가 유지되면 비중 변화만으로는 재조정하지 않습니다.</div>'
      +'</div>'
      +'<div class="alpha-guide-foot"><b>실제 주문표:</b> '+orderText+'<br>'
      +'신호는 확정 종가, 주문 수량·금액은 현재가 추정입니다. SGOV는 남는 투자금을 보유하며 정수 주수·수수료에 따라 실제 주문이 달라집니다.</div>';
  }
  renderDualGuardStrip({orders:orders.length,orderText:orders.map(o=>o.sym+' '+(o.side==='buy'?'매수 ':'매도 ')+o.qty+'주').join(' · '),need:needRebalance,
    teclNow:curTeclW,teclTarget:D.teclWeight*w,teclHit,gap,band:D.ivsBand,guard,guardFlip,dist:guardDist,ma:D.guardMA,upper,lower,date:qTecl.settled.date,dep});
  if(horizonRebalancePending)horizonRebalancePending=false;
}
