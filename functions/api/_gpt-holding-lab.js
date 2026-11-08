// Prospective holding-time cohorts. Consumes persisted operating entries and actual
// completed source bars; never discovers entries, changes the main, or creates orders.
export const HOLDING_VERSION='gpt_holding_forward_v1';
export const HOLDING_START='2026-11-09';
export const CLOSING_VERSION='closing30_1515_v2';
export const HOLDING_RULES=Object.freeze({
 opening:[{id:'main',label:'메인 · 09:30',reference:true},{id:'exit_1000',label:'같은 진입 · 10:00 청산',exitHm:1000}],
 daytrading:[{id:'main',label:'메인 · 15:10',reference:true},{id:'next_open',label:'다음 거래일 시가',nextOpen:true},{id:'no_time',label:'시간 제한 없음 · 손절/익절 유지'}],
 crypto:[{id:'main',label:'메인 · 기존 보유시간',reference:true},{id:'hold_120m',label:'최대 120분',minutes:120},{id:'hold_24h',label:'최대 24시간',minutes:1440},{id:'no_time',label:'시간 제한 없음 · 손절/익절 유지'}],
 soxl:[{id:'main',label:'메인 · 기존 보유시간',reference:true},{id:'hold_2sessions',label:'최대 2 미국 거래일',sessions:2},{id:'hold_5sessions',label:'최대 5 미국 거래일',sessions:5},{id:'no_time',label:'시간 제한 없음 · 손절/익절 유지'}]
});
export function mainHoldingParams(strategy,date,params){
 if(date<HOLDING_START||!['crypto','soxl'].includes(strategy))return {...params};
 return {...params,maxHoldBars:Math.min(+params.maxHoldBars||0,strategy==='crypto'?12:18),holdingPolicyVersion:HOLDING_VERSION};
}
export function holdingClock(ms,tz='Asia/Seoul'){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
 const g=k=>p.find(x=>x.type===k)?.value;
 return {date:[g('year'),g('month'),g('day')].join('-'),hm:+g('hour')*100+(+g('minute'))};
}
export const holdingMs=(date,hm)=>Date.parse(date+'T'+String(hm).padStart(4,'0').replace(/(..)(..)$/,'$1:$2')+':00+09:00');
const positive=x=>Number.isFinite(+x)&&+x>0;
const finite=x=>x!=null&&x!==''&&Number.isFinite(+x);
const clone=x=>JSON.parse(JSON.stringify(x));
export function emptyHoldingLab(strategy){
 const capital=strategy==='soxl'?10000:10000000;
 return {schema:1,version:HOLDING_VERSION,strategy,evaluationStart:HOLDING_START,paperOnly:true,autoPromotion:false,
  mode:'prospective-operating-entry-comparison-no-order',currency:strategy==='soxl'?'USD':'KRW',capital,
  sessionEnds:{},observedSessions:[],sizing:'독립 가상자본 · 동일 슬롯 · 비교용 소수수량(증권사 체결 아님)',sources:[],errors:[],seeds:{},daily:{},
  arms:Object.fromEntries((HOLDING_RULES[strategy]||[]).map(r=>[r.id,{...r,cash:capital,trades:[],skipped:[],equity:capital,peak:capital,mddPct:0}]))};
}
function pnl(t,price){return (price/t.entryPrice-1)*100-t.frictionPct;}
function equity(arm){return arm.cash+arm.trades.filter(t=>t.status!=='closed').reduce((s,t)=>s+t.units*(t.markPrice||t.entryPrice)-t.notional*t.frictionPct/200,0);}
function finish(arm,t,price,ms,reason){
 if(t.status==='closed')return;
 t.status='closed';t.exitPrice=price;t.exitMs=ms;t.exitReason=reason;t.pnlPct=pnl(t,price);
 t.markPrice=price;t.priceAt=new Date(ms).toISOString();
 arm.cash+=t.units*price-t.notional*t.frictionPct/200;
}
function sourceIdentity(s){return JSON.stringify([s.id,s.entryMs,s.entryPrice,s.strategyVersion,s.params,s.frictionPct,s.stopPct,s.takeProfitPct,s.slots,!!s.closeOnly]);}
function updateReference(arm,t,s){
 if(!s||!positive(s.exitPrice)||!finite(s.pnlPct)||!positive(s.exitMs)||s.exitUnverified)return;
 if(t.status==='closed'){
  if(t.exitPrice!==s.exitPrice||Math.abs(t.pnlPct-s.pnlPct)>1e-7)t.sourceRevision=true;
  return;
 }
 finish(arm,t,+s.exitPrice,+s.exitMs,'operating_main_record');
 // The original operating record is the reference, never a second backtest engine.
 arm.cash+=t.notional*(s.pnlPct-t.pnlPct)/100;t.pnlPct=+s.pnlPct;
}
function advanceTrade(st,arm,t,bySymbol,strategy,now){
   if(t.status==='closed')return;
   const bars=(bySymbol.get(t.code)||[]).filter(b=>b.ms+b.durationMs<=now);
   for(const b of bars){
    if(b.ms<t.entryMs||(t.closeOnly&&b.ms===t.entryMs)||(t.lastBarMs!=null&&b.ms<=t.lastBarMs))continue;
    const nextSession=t.lastSession&&b.date!==t.lastSession;
    const expectedOpen=strategy==='soxl'?930:strategy==='crypto'?0:900;
    if(!arm.reference&&nextSession&&strategy!=='crypto'&&t.lastBarMs!=null&&t.lastBarMs+b.durationMs!==st.sessionEnds[t.lastSession]){t.status='unverified';t.dataIssue='previous_session_close_missing';break;}
    if(!arm.reference&&t.lastBarMs==null&&b.ms>t.entryMs+(t.closeOnly?b.durationMs:0)){t.status='unverified';t.dataIssue='entry_path_missing';break;}
    if(!arm.reference&&t.lastBarMs!=null&&((!nextSession&&b.ms!==t.lastBarMs+b.durationMs&&!(strategy==='daytrading'&&b.hm===1530&&holdingClock(t.lastBarMs).hm===1519))||(nextSession&&strategy==='crypto'&&b.ms!==t.lastBarMs+b.durationMs)||(nextSession&&strategy!=='crypto'&&b.hm!==expectedOpen))){
     t.status='unverified';t.dataIssue='missing_bar_or_session_open';break;
    }
    if(!arm.reference&&arm.sessions&&nextSession&&t.sessions.length>=arm.sessions){t.status='unverified';t.dataIssue='session_deadline_exit_unconfirmed';break;}
    if(t.status==='unverified'){t.status='open';delete t.dataIssue;}
    if(!t.sessions.includes(b.date))t.sessions.push(b.date);
    t.lastBarMs=b.ms;t.lastSession=b.date;t.markPrice=b.c;t.priceAt=new Date(b.ms+b.durationMs).toISOString();
    t.mfePct=Math.max(t.mfePct,(b.c/t.entryPrice-1)*100);t.maePct=Math.min(t.maePct,(b.c/t.entryPrice-1)*100);
    if(arm.reference)continue;
    const due=arm.minutes?t.entryMs+arm.minutes*60_000:arm.exitHm?holdingMs(t.date,arm.exitHm):null;
    if(due&&b.ms>=due){t.status='unverified';t.dataIssue='deadline_bar_missing';break;}
    if(arm.nextOpen&&b.date>t.date){finish(arm,t,b.o||b.c,b.ms,'next_session_open');break;}
    const stop=t.entryPrice*(1-t.stopPct/100),tp=t.entryPrice*(1+t.takeProfitPct/100);
    const low=t.closeOnly?b.c:b.l,high=t.closeOnly?b.c:b.h;
    if(low<=stop){finish(arm,t,t.closeOnly?b.c:Math.min(stop,b.o||stop),b.ms+b.durationMs,'stop');break;}
    if(high>=tp){finish(arm,t,t.closeOnly?b.c:tp,b.ms+b.durationMs,'take_profit');break;}
    if(due&&b.ms+b.durationMs===due){finish(arm,t,b.c,due,'time_exit');break;}
    if(arm.sessions&&t.sessions.length>=arm.sessions&&b.ms+b.durationMs===st.sessionEnds[b.date]){finish(arm,t,b.c,st.sessionEnds[b.date],'session_limit');break;}
   }
   const deadline=arm.minutes?t.entryMs+arm.minutes*60000:arm.exitHm?holdingMs(t.date,arm.exitHm):null;
   if(!arm.reference&&t.status!=='closed'&&deadline&&now>deadline+1500){t.status='unverified';t.dataIssue='deadline_exit_unconfirmed';}
}
export function advanceHoldingLab(previous,input){
 const {strategy,now,sessionDate,sessionEndMs}=input;
 if(!HOLDING_RULES[strategy]||!Number.isFinite(now))throw Error('invalid holding input');
 const st=previous?clone(previous):emptyHoldingLab(strategy);
 if(st.strategy!==strategy||st.version!==HOLDING_VERSION)throw Error('holding version mismatch');
 st.updatedAt=new Date(now).toISOString();st.sources=input.sources||[];st.errors=input.errors||[];
 if(sessionDate<HOLDING_START)return st;
 st.sessionEnds=st.sessionEnds||{};if(positive(sessionEndMs))st.sessionEnds[sessionDate]=sessionEndMs;
 st.observedSessions=[...new Set([...(st.observedSessions||[]),...(input.sessionDates||[])])].filter(d=>d>=HOLDING_START).sort();
 const seeds=(input.seeds||[]).filter(s=>s&&s.date>=HOLDING_START&&positive(s.entryMs)&&positive(s.entryPrice)&&s.entryMs<=now&&s.strategyVersion&&s.sourceId).sort((a,b)=>a.entryMs-b.entryMs||a.sourceId.localeCompare(b.sourceId));
 const bySymbol=new Map();
 for(const b of input.bars||[]){
  if(!b||!positive(b.ms)||!positive(b.c)||!positive(b.durationMs)||b.ms+b.durationMs>now-1500)continue;
  if(!bySymbol.has(b.code))bySymbol.set(b.code,[]);bySymbol.get(b.code).push(b);
 }
 for(const xs of bySymbol.values())xs.sort((a,b)=>a.ms-b.ms);
 for(const arm of Object.values(st.arms)){
  for(const s of seeds){
   // Release capital only from price paths observed at or before this entry.
   for(const t of arm.trades)advanceTrade(st,arm,t,bySymbol,strategy,s.entryMs);
   const id=s.sourceId,existing=arm.trades.find(t=>t.sourceId===id);
   if(existing){
    if(existing.sourceIdentity!==sourceIdentity(s))existing.sourceRevision=true;
    if(arm.reference)updateReference(arm,existing,s);
    continue;
   }
   if(arm.skipped.some(x=>x.sourceId===id))continue;
   // No historical import or first-time seeding after seeing an old outcome.
   const reason=s.mode!=='live'||now-s.entryMs>10*60_000?'late_or_imported_entry':
    arm.lastSeedMs&&s.entryMs<arm.lastSeedMs?'out_of_order_entry':
    arm.trades.filter(t=>t.entryMs<=s.entryMs&&(!t.exitMs||t.exitMs>s.entryMs)).length>=(s.slots||1)?'capital_occupied':null;
   if(reason){arm.skipped.push({sourceId:id,reason,at:st.updatedAt});continue;}
   const fee=+s.frictionPct,stop=+s.stopPct,tp=+s.takeProfitPct;
   if(!Number.isFinite(fee)||fee<0||!(stop>0)||!(tp>0))continue;
   const cashAtEntry=st.capital+arm.trades.reduce((cash,t)=>cash-(t.entryMs<=s.entryMs?t.notional*(1+t.frictionPct/200):0)+(t.exitMs&&t.exitMs<=s.entryMs?t.units*t.exitPrice-t.notional*t.frictionPct/200:0),0);
   const allocation=Math.min(cashAtEntry/(1+fee/200),st.capital/(s.slots||1));
   if(!(allocation>0))continue;
   const t={sourceId:id,sourceIdentity:sourceIdentity(s),sourceVersion:s.strategyVersion,sourceParams:clone(s.params||{}),
    registeredAt:st.updatedAt,strategyVersion:HOLDING_VERSION+'@'+arm.id,holdingRule:{id:arm.id,minutes:arm.minutes||null,exitHm:arm.exitHm||null,nextOpen:!!arm.nextOpen,sessions:arm.sessions||null,reference:!!arm.reference},date:s.date,code:s.code,name:s.name||s.code,entryMs:s.entryMs,entryPrice:s.entryPrice,
    stopPct:stop,takeProfitPct:tp,frictionPct:fee,notional:allocation,units:allocation/s.entryPrice,
    markPrice:s.entryPrice,status:'open',lastBarMs:null,lastSession:s.date,sessions:[s.date],closeOnly:!!s.closeOnly,
    priceAt:new Date(s.entryMs).toISOString(),mfePct:0,maePct:0};
   arm.cash-=allocation*(1+fee/200);arm.trades.push(t);arm.lastSeedMs=s.entryMs;
   st.seeds[id]={strategyVersion:s.strategyVersion,date:s.date,registeredAt:st.updatedAt};
   if(arm.reference)updateReference(arm,t,s);
  }
  for(const t of arm.trades)advanceTrade(st,arm,t,bySymbol,strategy,now);
  arm.equity=equity(arm);arm.peak=Math.max(arm.peak,arm.equity);arm.mddPct=Math.min(arm.mddPct,(arm.equity/arm.peak-1)*100);
  if(positive(sessionEndMs)&&now>=sessionEndMs+1500&&input.sessionComplete&&!arm.trades.some(t=>t.status==='unverified')){
   const d=st.daily[sessionDate]||(st.daily[sessionDate]={});
   if(d[arm.id]==null)d[arm.id]=arm.equity; // preserve original end-of-session observation
  }
 }
 return st;
}
export function holdingPublic(st){
 if(!st)return null;
 const days=Object.keys(st.daily).sort();
 return {...st,arms:Object.values(st.arms).map(arm=>{
  const closed=arm.trades.filter(t=>t.status==='closed'),values=closed.map(t=>t.notional*t.pnlPct/100),gain=values.filter(v=>v>0).reduce((a,b)=>a+b,0),loss=-values.filter(v=>v<0).reduce((a,b)=>a+b,0);
  const missingDays=[];const daily=days.flatMap(date=>{
   const eq=st.daily[date][arm.id],sessions=st.observedSessions?.length?st.observedSessions:days,i=sessions.indexOf(date),previousDate=i>0?sessions[i-1]:null;
   const prior=previousDate?st.daily[previousDate]?.[arm.id]:st.capital;
   if(eq==null||prior==null){missingDays.push(date);return [];}return [{date,returnPct:(eq/prior-1)*100}];
  });
  return {...arm,summary:{closed:closed.length,open:arm.trades.filter(t=>t.status==='open').length,unverified:arm.trades.filter(t=>t.status==='unverified').length,
   skipped:arm.skipped.length,incompleteDays:missingDays.length,observedDays:daily.length,avgDailyReturnPct:daily.length?daily.reduce((s,x)=>s+x.returnPct,0)/daily.length:null,
   profitFactor:loss?gain/loss:null,noLossSample:!loss&&gain>0,mddPct:arm.trades.length?arm.mddPct:null,worstDay:daily.length?Math.min(...daily.map(x=>x.returnPct)):null,
   returnPct:arm.trades.length?(arm.equity/st.capital-1)*100:null,daily},trades:arm.trades.slice(-150).reverse()};
 })};
}
