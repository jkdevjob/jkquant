(function(g){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function hasLedgerActivity(ledger){
  const b=ledger&&ledger.base||{};
  return !!((ledger&&ledger.events||[]).length||+b.tecl||+b.tqqq||+b.sgov);
}
function validDate(s){
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
function update(session,input,options){
  const x=clone(session),o=options||{},paper=!!input.paper,st=x.settings||{};
  const cap=Number(input.capital),monthly=Number(input.monthly),target=Number(input.target),start=String(input.start||'');
  if(![cap,monthly,target].every(Number.isFinite)||cap<=0||target<=0||monthly<0)throw Error('시작자산·목표자산은 양수, 월 추가 투자는 0 이상으로 입력하세요.');
  if(!validDate(start)||start>o.today)throw Error('올바른 시작일을 입력하세요. 미래 날짜로 시작할 수 없습니다.');
  if(paper&&(!x.paper||start!==x.simStart)&&start<o.minStart)throw Error('새 모의 시작일은 최근 3년 안에서 골라주세요.');
  if(paper&&(!Number.isFinite(Number(o.fx))||!(Number(o.fx)>0)))throw Error('모의 시작일의 USD/KRW 환율을 불러오지 못했습니다. 다시 시도해 주세요.');
  if(!x.paper&&paper)x.liveSettings=clone(st);
  const restoring=x.paper&&!paper&&x.liveSettings;
  const liveBase=restoring?x.liveSettings:st;
  if(!paper&&hasLedgerActivity(x.ledger)&&!restoring&&(cap!==+st.startCapital||start!==st.startDate)){
    throw Error('거래 또는 보유내역이 있는 운영 세션의 시작자산·시작일은 거래이력의 시작잔고 수정에서 변경하세요.');
  }
  x.name=String(input.name||'').trim()||x.name||x.horizon+'년 세션';
  x.paper=paper;x.simStart=paper?start:'';
  x.settings={...st,startCapital:restoring?+liveBase.startCapital:cap,monthlyAdd:monthly,targetCapital:target,startDate:restoring?liveBase.startDate:start};
  const end=new Date(x.settings.startDate+'T00:00:00Z');end.setUTCFullYear(end.getUTCFullYear()+Number(x.horizon));
  x.settings.targetDate=end.toISOString().slice(0,10);
  if(paper)x.paperFxRate=Number(o.fx);
  else if(!restoring&&!hasLedgerActivity(x.ledger)){
    x.ledger={base:{date:start,tecl:0,tqqq:0,sgov:0,cash:cap,avgTecl:null,avgTqqq:null,avgSgov:null},events:[],feeModel:'toss-us-0.1-v1'};
  }
  if(restoring)delete x.liveSettings;
  x.updatedAt=Date.now();
  return x;
}
const api={update,hasLedgerActivity};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
g.JKPlanSessionSettings=api;
})(typeof globalThis!=='undefined'?globalThis:this);
