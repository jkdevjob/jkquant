// Read-only KIS VTS reconciliation.
// It compares internally reconstructed paper trades with fills that already exist in
// the user's KIS mock account. It never submits, modifies, or cancels an order.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function json(o,s=200){return new Response(JSON.stringify(o,null,2),{status:s,headers:JH});}
function kstDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function timeParts(t){
  const s=String(t||"").replace(/\D/g,"").padStart(6,"0").slice(-6);
  if(!/^\d{6}$/.test(s))return null;
  const hh=+s.slice(0,2),mm=+s.slice(2,4),ss=+s.slice(4,6);
  if(hh>23||mm>59||ss>59)return null;
  return {hh,mm,ss,sec:hh*3600+mm*60+ss,hm:hh*100+mm};
}
function hmOfOrder(t){const p=timeParts(t);return p?p.hm:-1;}
function refMinuteSec(hm){
  const n=+hm||0,hh=Math.floor(n/100),mm=n%100;
  return hh*3600+mm*60;
}
function signedLagSec(orderTime,refHm){
  const p=timeParts(orderTime);if(!p||!refHm)return null;
  return p.sec-refMinuteSec(refHm);
}
function brokerNotifyLagSec(orderTime,notifyTime){
  const a=timeParts(orderTime),b=timeParts(notifyTime);
  if(!a||!b)return null;
  let d=b.sec-a.sec;
  if(d<0)d+=24*3600;
  return d;
}
function sideIs(x,want){
  const n=String(x.side||"").toLowerCase(),c=String(x.sideCode||"");
  return want==="buy"?(c==="02"||/매수|buy/.test(n)):(c==="01"||/매도|sell/.test(n));
}
async function fetchJson(url,headers={}){
  const r=await fetch(url,{headers});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
  return j;
}
function authHeaders(request){
  const auth=request.headers.get("Authorization")||"";
  const key=request.headers.get("x-monitor-key")||request.headers.get("x-autotrade-key")||"";
  const h={"Accept":"application/json"};
  if(auth)h.Authorization=auth;
  if(key)h["x-autotrade-key"]=key;
  return h;
}
async function internalTrades(strategy,date){
  const base="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
  let u;
  if(strategy==="opening")u=base+"opening-history/"+date+".json";
  else u=base+"daytrading-research/"+date+".json";
  const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-vts-reconcile/1.0"},cf:{cacheTtl:30}});
  if(r.status===404)return [];
  if(!r.ok)throw new Error("internal history HTTP "+r.status);
  const j=await r.json();
  return strategy==="opening"?(j.trades||[]):(j.latestDayTrades||[]);
}
function nearest(list,trade,side,used,refHm){
  const a=list.filter(x=>x.code===trade.code&&sideIs(x,side)&&+x.fillQty>0&&!used.has(x.orderNo))
    .map(x=>({x,d:Math.abs(hmOfOrder(x.orderTime)-refHm)}))
    .sort((p,q)=>p.d-q.d);
  const hit=a[0];
  if(!hit||hit.d>5)return null;
  used.add(hit.x.orderNo);
  return hit.x;
}
async function exactCosts(origin,headers,date,row){
  if(!row||!row.orderNo)return 0;
  await sleep(650);
  const u=origin+"/api/kis?op=orders&env=vts&market=kr&date="+encodeURIComponent(date.replace(/-/g,""))+
    "&code="+encodeURIComponent(row.code||"")+"&odno="+encodeURIComponent(row.orderNo);
  const j=await fetchJson(u,headers);
  return +((j.summary||{}).estimatedCosts)||0;
}
export async function onRequestGet({request}){
  const url=new URL(request.url),strategy=String(url.searchParams.get("strategy")||"opening");
  const date=String(url.searchParams.get("date")||kstDate());
  if(!["opening","daytrading"].includes(strategy))return json({ok:false,error:"strategy must be opening/daytrading"},400);
  const headers=authHeaders(request);
  if(!headers.Authorization&&!headers["x-autotrade-key"])return json({ok:false,error:"unauthorized"},401);

  try{
    const [internal,kis]=await Promise.all([
      internalTrades(strategy,date),
      fetchJson(url.origin+"/api/kis?op=orders&env=vts&market=kr&date="+encodeURIComponent(date.replace(/-/g,"")),headers)
    ]);
    if(kis.env!=="vts")return json({ok:false,error:"VTS only"},400);

    const used=new Set(),matches=[];
    for(const t of internal){
      const buy=nearest(kis.orders||[],t,"buy",used,+t.entryTime||0);
      const sell=t.exitTime==null?null:nearest(kis.orders||[],t,"sell",used,+t.exitTime||0);
      const entryRef=+t.entryPrice||0,exitRef=+t.exitPrice||0;
      let buyCost=0,sellCost=0;
      if(buy)buyCost=await exactCosts(url.origin,headers,date,buy);
      if(sell)sellCost=await exactCosts(url.origin,headers,date,sell);

      const buyPx=buy?+buy.fillPrice||0:0,sellPx=sell?+sell.fillPrice||0:0;
      const entryOrderLag=buy?signedLagSec(buy.orderTime,+t.entryTime||0):null;
      const exitOrderLag=sell?signedLagSec(sell.orderTime,+t.exitTime||0):null;
      const buyNotifyLag=buy?brokerNotifyLagSec(buy.orderTime,buy.notifyTime):null;
      const sellNotifyLag=sell?brokerNotifyLagSec(sell.orderTime,sell.notifyTime):null;
      const qty=buy&&sell?Math.min(+buy.fillQty||0,+sell.fillQty||0):(+buy?.fillQty||0);
      const gross=buyPx>0&&sellPx>0?(sellPx/buyPx-1)*100:null;
      const costWon=buyCost+sellCost;
      const brokerCostRate=buyPx>0&&qty>0?costWon/(buyPx*qty)*100:null;
      const entrySlip=buyPx>0&&entryRef>0?(buyPx/entryRef-1)*100:null;
      const exitSlip=sellPx>0&&exitRef>0?(exitRef/sellPx-1)*100:null;
      const observedDrag=buy&&sell&&brokerCostRate!=null?(+entrySlip||0)+(+exitSlip||0)+brokerCostRate:null;
      const net=buyPx>0&&sellPx>0&&qty>0?((sellPx-buyPx)*qty-costWon)/(buyPx*qty)*100:null;
      matches.push({
        code:t.code,name:t.name||t.code,internalEntryTime:t.entryTime,internalEntryPrice:entryRef,
        internalExitTime:t.exitTime,internalExitPrice:exitRef,internalReason:t.reason||"",
        internalPnl:t.pnl,
        vtsBuy:buy?{orderTime:buy.orderTime,notifyTime:buy.notifyTime,fillQty:buy.fillQty,fillPrice:buy.fillPrice,fillAmount:buy.fillAmount,estimatedCosts:buyCost}:null,
        vtsSell:sell?{orderTime:sell.orderTime,notifyTime:sell.notifyTime,fillQty:sell.fillQty,fillPrice:sell.fillPrice,fillAmount:sell.fillAmount,estimatedCosts:sellCost}:null,
        entryOrderLagSecApprox:entryOrderLag,exitOrderLagSecApprox:exitOrderLag,
        entryBrokerNotifyLagSec:buyNotifyLag,exitBrokerNotifyLagSec:sellNotifyLag,
        entrySlippageCostPct:entrySlip,
        exitSlippageCostPct:exitSlip,
        vtsGrossPnlPct:gross,vtsNetPnlPct:net,vtsBrokerEstimatedCosts:costWon,
        vtsBrokerCostRatePct:brokerCostRate,observedExecutionDragPct:observedDrag,
        matched:!!buy&&(t.exitTime==null||!!sell)
      });
    }
    const unmatched=(kis.orders||[]).filter(x=>!used.has(x.orderNo)).map(x=>({
      code:x.code,name:x.name,side:x.side,orderTime:x.orderTime,fillQty:x.fillQty,fillPrice:x.fillPrice,orderType:x.orderType
    }));
    const complete=matches.filter(x=>x.matched);
    const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
    const entrySlip=matches.map(x=>x.entrySlippageCostPct).filter(Number.isFinite);
    const exitSlip=matches.map(x=>x.exitSlippageCostPct).filter(Number.isFinite);
    const net=complete.map(x=>x.vtsNetPnlPct).filter(Number.isFinite);
    const internalPnl=complete.map(x=>x.internalPnl).filter(Number.isFinite);
    const brokerRates=complete.map(x=>x.vtsBrokerCostRatePct).filter(Number.isFinite);
    const observedDrag=complete.map(x=>x.observedExecutionDragPct).filter(Number.isFinite);
    const entryLag=matches.map(x=>x.entryOrderLagSecApprox).filter(Number.isFinite);
    const exitLag=matches.map(x=>x.exitOrderLagSecApprox).filter(Number.isFinite);
    const notifyLag=matches.flatMap(x=>[x.entryBrokerNotifyLagSec,x.exitBrokerNotifyLagSec]).filter(Number.isFinite);
    const avgDrag=avg(observedDrag);
    return json({ok:true,mode:"read-only",env:"vts",strategy,date,
      note:"KIS VTS existing fills are only compared; no broker order is submitted by this endpoint.",
      internalTrades:internal.length,kisOrders:(kis.orders||[]).length,matches,unmatched,
      dailyBrokerEstimatedCosts:+((kis.summary||{}).estimatedCosts)||0,
      summary:{
        completeMatches:complete.length,
        matchRatePct:internal.length?complete.length/internal.length*100:0,
        avgEntrySlippageCostPct:avg(entrySlip),
        avgExitSlippageCostPct:avg(exitSlip),
        avgRoundTripSlippageCostPct:complete.length?avg(complete.map(x=>(+x.entrySlippageCostPct||0)+(+x.exitSlippageCostPct||0))):null,
        avgInternalPnlPct:avg(internalPnl),
        avgVtsNetPnlPct:avg(net),
        avgBrokerCostRatePct:avg(brokerRates),
        avgObservedExecutionDragPct:avgDrag,
        avgEntryOrderLagSecApprox:avg(entryLag),
        avgExitOrderLagSecApprox:avg(exitLag),
        avgBrokerNotifyLagSec:avg(notifyLag),
        delayNote:"order lag is approximate from the internal reference minute start to KIS order time; broker notify lag uses KIS ord_tmd→infm_tmd and is not exact exchange fill latency.",
        frictionGapVsInternal025Pct:avgDrag==null?null:avgDrag-0.25,
        calibrationStatus:complete.length>=20?"reviewable":"collecting",
        calibrationMatches:complete.length,
        totalBrokerEstimatedCostsWon:complete.reduce((s,x)=>s+(+x.vtsBrokerEstimatedCosts||0),0)
      }});
  }catch(e){
    return json({ok:false,error:String(e.message||e),mode:"read-only",env:"vts"},500);
  }
}
