// Common research history. Requests are scoped to the signed-in owner session.
let TRADE_HISTORY_CONTROLLER=null,TRADE_HISTORY_REQUEST=0;
const TRADE_HISTORY_LABELS={opening:'시초가',daytrading:'데이트레이딩',crypto:'비트코인',soxl:'SOXL',closing30:'종가 30분',closing_bet:'개별 종목 종가 베팅',tenbagger:'텐배거 연구'};
const TRADE_STATE_LABELS={signal:'신호 기록',pending:'진입 대기',open:'보유',closed:'청산',unverified:'체결/청산 확인 필요'};
const TRADE_ORIGIN_LABELS={'server-paper':'서버 모의장부','server-signal':'당시 신호 원본','research-import':'과거 연구 DB 이관','research-reconstructed':'사후 연구 재구성','forward-research':'순방향 연구'};
function tradeHistoryQuery(page=1){
  const q=new URLSearchParams({page:String(page),pageSize:'50'});
  for(const name of ['strategy','variant','from','to','symbol','status','origin']){
    const v=document.getElementById('trades_'+name)?.value;if(v)q.set(name,v);
  }
  return q;
}
function initTradeHistory(){
  const from=document.getElementById('trades_from'),to=document.getElementById('trades_to');
  const now=Date.now()+9*3600000;
  if(from&&!from.value)from.value=new Date(now-30*86400000).toISOString().slice(0,10);
  if(to&&!to.value)to.value=new Date(now).toISOString().slice(0,10);
}
function openTradeHistory(strategy='all'){
  const el=document.getElementById('trades_strategy');if(el)el.value=TRADE_HISTORY_LABELS[strategy]?strategy:'all';
  const variant=document.getElementById('trades_variant');if(variant)variant.value='all';
  showStrategy('trades');
}
function tradeHistoryTime(value,timezone){
  if(!value)return '—';
  if(String(value).includes('T')&&Number.isFinite(Date.parse(value)))return new Intl.DateTimeFormat('ko-KR',{timeZone:timezone||'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  return String(value);
}
function tradeHistoryRow(x){
  const e=esc,role=({main:'메인',shadow:'그림자',research:'연구'})[x.role]||'연구';
  const price=v=>histPrice(x.strategy==='soxl'?'soxl':'opening',v);
  const fields={strategyVersion:x.strategyVersion||'원본 미기록',strategyParams:x.strategyParams||'원본 미기록',recordedAt:x.recordedAt,evidence:x.evidence,events:x.events};
  return '<tr><td>'+e(x.date)+'</td><td>'+e(TRADE_HISTORY_LABELS[x.strategy]||x.strategy)+'<div class="sub">'+e(role+' · '+x.variant)+'</div></td>'+
    '<td><b>'+e(x.name||x.code)+'</b><div class="sub">'+e(x.code)+'</div></td><td>'+e(TRADE_STATE_LABELS[x.status]||x.status)+'</td>'+
    '<td>'+e(tradeHistoryTime(x.signalTime,x.timezone))+'</td><td>'+e(tradeHistoryTime(x.entryTime,x.timezone))+'<div class="sub">'+e(price(x.entryPrice))+'</div></td>'+
    '<td>'+e(tradeHistoryTime(x.exitTime,x.timezone))+'<div class="sub">'+e(price(x.exitPrice))+'</div></td><td>'+e(histPct(x.pnl))+
    (x.unrealizedPnl==null?'':'<div class="sub">평가 '+e(histPct(x.unrealizedPnl))+'</div>')+'</td>'+
    '<td>'+e(TRADE_ORIGIN_LABELS[x.recordOrigin]||x.recordOrigin)+'<div class="sub">'+e(x.timezone)+'</div><details><summary>조건·근거</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-width:360px">'+e(JSON.stringify(fields,null,2))+'</pre></details></td></tr>';
}
async function loadTradeHistory(page=1,exportCsv=false){
  initTradeHistory();if(!me)return;
  const seq=++TRADE_HISTORY_REQUEST,epoch=SCALPING_AUTH_EPOCH,user=me;
  TRADE_HISTORY_CONTROLLER?.abort();const controller=new AbortController();TRADE_HISTORY_CONTROLLER=controller;
  const msg=document.getElementById('trades_msg'),body=document.getElementById('trades_body'),pager=document.getElementById('trades_pager');
  const current=()=>me===user&&SCALPING_AUTH_EPOCH===epoch&&seq===TRADE_HISTORY_REQUEST;
  msg.textContent=exportCsv?'전체 CSV 준비 중…':'매매 원본 조회 중…';
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const q=tradeHistoryQuery(page);if(exportCsv)q.set('format','csv');
    const token=await user.getIdToken();if(!current())return;
    const r=await fetch('/api/trade-history?'+q,{cache:'no-store',headers:{Authorization:'Bearer '+token},signal:controller.signal});
    if(exportCsv&&r.ok){
      const blob=await r.blob();if(!current())return;
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jkquant-trades-'+q.get('from')+'_'+q.get('to')+'.csv';a.click();URL.revokeObjectURL(url);
      msg.textContent='선택한 조건의 전체 이력을 CSV로 내보냈습니다.';return;
    }
    const j=await r.json();if(!current())return;if(!r.ok||!j.ok)throw Error(j.error||'조회 실패');
    const selected=document.getElementById('trades_variant').value;
    document.getElementById('trades_variant').innerHTML='<option value="all">전체 메인·그림자·연구</option><option value="main">당시 운영 메인</option><option value="shadow">당시 그림자</option>'+
      (j.variants||[]).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
    document.getElementById('trades_variant').value=selected;
    msg.textContent='조회 '+j.total+'건 · 청산 '+j.summary.closed+' · 보유 '+j.summary.open+' · 신호/확인 필요 '+j.summary.unverified+(j.sourceWarnings.length?' · 일부 원본 조회 실패: '+j.sourceWarnings.join(' / '):'');
    body.innerHTML=j.trades.length?'<div class="htable-wrap"><table class="htable"><thead><tr><th>기준일</th><th>전략·변형</th><th>종목</th><th>상태</th><th>신호</th><th>매수</th><th>매도</th><th>개별 순손익</th><th>출처·조건</th></tr></thead><tbody>'+j.trades.map(tradeHistoryRow).join('')+'</tbody></table></div>':'<p class="sub">'+(j.sourceWarnings.length?'원본 조회 오류를 확인해 주세요.':'선택 조건으로 저장된 기록이 없습니다.')+'</p>';
    pager.innerHTML=(page>1?'<button class="ghostbtn sm" onclick="loadTradeHistory('+(page-1)+')">← 이전</button>':'')+'<span class="sub">'+(j.pages?page+' / '+j.pages:'0건')+'</span>'+(page<j.pages?'<button class="ghostbtn sm" onclick="loadTradeHistory('+(page+1)+')">다음 →</button>':'');
  }catch(error){if(current()){msg.textContent=error.name==='AbortError'?'조회 시간이 초과됐습니다. 다시 조회해 주세요.':String(error.message||error);if(!exportCsv){body.innerHTML='';pager.innerHTML='';}}}
  finally{clearTimeout(timer);if(TRADE_HISTORY_CONTROLLER===controller)TRADE_HISTORY_CONTROLLER=null;}
}
