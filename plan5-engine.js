/* JKQuant 5년 플랜 공용 엔진
   운영(plan.html)과 모의성과(index.html)가 같은 신호·목표수량·수수료 규칙을 쓴다. */
(function(g){
'use strict';
const CONFIG=Object.freeze({
  teclWeight:.70, guardWeight:.30, ivsLook:20, ivsS0:.55, ivsBand:.10,
  guardMA:225, guardBand:.01, feeRate:.001, divTaxRate:.154
});
const n=v=>Number(v)||0;
function fee(q,p){
  const gross=Math.max(0,n(q)*n(p));
  return gross<=10?0:Math.floor(gross*CONFIG.feeRate*100)/100;
}
function realizedVol(rows,nDay=CONFIG.ivsLook){
  if(!rows||rows.length<nDay+1)return null;
  const r=[];
  for(let i=rows.length-nDay;i<rows.length;i++){
    const a=n(rows[i-1]&&rows[i-1].close),b=n(rows[i]&&rows[i].close);
    if(a>0&&b>0)r.push(b/a-1);
  }
  if(r.length!==nDay)return null;
  const m=r.reduce((x,y)=>x+y,0)/nDay;
  const v=r.reduce((x,y)=>x+(y-m)*(y-m),0)/nDay;
  return Math.sqrt(Math.max(v,0)*252);
}
function smaLast(rows,nDay=CONFIG.guardMA){
  if(!rows||rows.length<nDay)return null;
  let s=0;
  for(let i=rows.length-nDay;i<rows.length;i++)s+=n(rows[i]&&rows[i].close);
  return s/nDay;
}
function signalPlan(o){
  const D=o.config||CONFIG,tr=o.teclRows||[],qr=o.tqqqRows||[],pos=o.pos||{};
  const ts=n(o.signalPrices&&o.signalPrices.TECL)||n(tr[tr.length-1]&&tr[tr.length-1].close);
  const qs=n(o.signalPrices&&o.signalPrices.TQQQ)||n(qr[qr.length-1]&&qr[qr.length-1].close);
  const ss=n(o.signalPrices&&o.signalPrices.SGOV);
  const tq=Math.max(0,Math.floor(n(pos.TECL))),qq=Math.max(0,Math.floor(n(pos.TQQQ))),sq=Math.max(0,Math.floor(n(pos.SGOV)));
  const cash=n(o.cash),startCapital=Math.max(1,n(o.startCapital)||1);
  const sigma=realizedVol(tr,D.ivsLook),sma=smaLast(qr,D.guardMA);
  if(!(sigma>0)||!(sma>0)||!(ts>0)||!(qs>0)||!(ss>0))
    return {ready:false,sigma,sma,signalTotal:0};
  let signalTotal=tq*ts+qq*qs+sq*ss+cash;
  if(!(signalTotal>0))signalTotal=startCapital;
  const w=Math.min(1,(D.ivsS0*D.ivsS0)/(sigma*sigma));
  const curTeclW=(tq*ts)/signalTotal;
  const sleeveNow=curTeclW/Math.max(D.teclWeight,1e-9);
  const gap=Math.abs(w-sleeveNow);
  const teclHit=tq===0||gap>D.ivsBand;
  const upper=sma*(1+D.guardBand),lower=sma*(1-D.guardBand),posOn=qq>0;
  const guard=qs>upper?'ON':qs<lower?'OFF':(posOn?'ON':'OFF');
  const guardFlip=(guard==='ON')!==posOn;
  const force=!!o.force,empty=!tq&&!qq&&!sq;
  return {ready:true,sigma,sma,ts,qs,ss,signalTotal,w,curTeclW,sleeveNow,gap,
          bandLo:Math.max(0,w-D.ivsBand),bandHi:Math.min(1,w+D.ivsBand),
          teclHit,upper,lower,guard,posOn,guardFlip,need:teclHit||guardFlip||force||empty};
}
function orderPlan(o){
  const D=o.config||CONFIG,sig=signalPlan(o);
  if(!sig.ready)return {...sig,targets:{TECL:0,TQQQ:0,SGOV:0},orders:[]};
  const pos=o.pos||{},tq=Math.max(0,Math.floor(n(pos.TECL))),qq=Math.max(0,Math.floor(n(pos.TQQQ))),sq=Math.max(0,Math.floor(n(pos.SGOV)));
  const ep=o.execPrices||{},tp=n(ep.TECL),qp=n(ep.TQQQ),sp=n(ep.SGOV);
  if(!(tp>0&&qp>0&&sp>0))return {...sig,ready:false,targets:{TECL:tq,TQQQ:qq,SGOV:sq},orders:[]};
  const force=!!o.force;
  const targetTq=(sig.teclHit||force)?Math.max(0,Math.floor(sig.signalTotal*D.teclWeight*sig.w/tp)):tq;
  const targetQq=(sig.guardFlip||force)?(sig.guard==='ON'?Math.max(0,Math.floor(sig.signalTotal*D.guardWeight/qp)):0):qq;
  const targetSq=sig.need?Math.max(0,Math.floor(Math.max(0,sig.signalTotal-targetTq*tp-targetQq*qp)/sp)):sq;
  const targets={TECL:targetTq,TQQQ:targetQq,SGOV:targetSq},pxs={TECL:tp,TQQQ:qp,SGOV:sp};
  const cur={TECL:tq,TQQQ:qq,SGOV:sq},orders=[];let avail=Math.max(0,n(o.cash));
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=targets[sym]-cur[sym];
    if(dq<0){const q=-dq,p=pxs[sym],f=fee(q,p);avail+=q*p-f;orders.push({side:'sell',sym,qty:q,price:p,fee:f});}
  }
  const feeRate=(D.feeRate!=null)?D.feeRate:CONFIG.feeRate;
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=targets[sym]-cur[sym];
    if(dq>0){
      const p=pxs[sym],q=Math.min(dq,Math.floor(avail/(p*(1+feeRate))));
      if(q>0){const f=fee(q,p);avail-=q*p+f;orders.push({side:'buy',sym,qty:q,price:p,fee:f});}
    }
  }
  return {...sig,targets,orders,avail};
}
function divMap(a){
  const m={};(a||[]).forEach(x=>{const d=String(x&&x.date||''),v=n(x&&x.amount);if(d&&v>0)m[d]=(m[d]||0)+v;});return m;
}
function commonDates(tecl,tqqq,sgov,endDate){
  const q=new Set((tqqq||[]).filter(x=>x&&x.close>0&&(!endDate||x.date<=endDate)).map(x=>x.date));
  const s=new Set((sgov||[]).filter(x=>x&&x.close>0&&(!endDate||x.date<=endDate)).map(x=>x.date));
  return (tecl||[]).filter(x=>x&&x.close>0&&(!endDate||x.date<=endDate)&&q.has(x.date)&&s.has(x.date)).map(x=>x.date);
}
function simulate(o){
  const D=o.config||CONFIG,start=String(o.startDate||''),capital=n(o.capital),monthly=Math.max(0,n(o.monthlyAdd));
  if(!start||!(capital>0))return null;
  const tr=(o.teclRows||[]).filter(x=>x&&x.close>0),qr=(o.tqqqRows||[]).filter(x=>x&&x.close>0),sr=(o.sgovRows||[]).filter(x=>x&&x.close>0);
  const endDate=o.endDate||null,dates=commonDates(tr,qr,sr,endDate),run=dates.filter(d=>d>=start);
  if(!run.length)return null;
  const dateIndex=Object.fromEntries(dates.map((d,i)=>[d,i]));
  const tm=Object.fromEntries(tr.map(x=>[x.date,n(x.close)])),qm=Object.fromEntries(qr.map(x=>[x.date,n(x.close)])),sm=Object.fromEntries(sr.map(x=>[x.date,n(x.close)]));
  const dm={TECL:divMap(o.teclDividends),TQQQ:divMap(o.tqqqDividends),SGOV:divMap(o.sgovDividends)};
  const pos={TECL:0,TQQQ:0,SGOV:0};let cash=capital,inflow=capital,units=capital,prevNav=1,peak=1,mdd=0,nMonthly=0,divCash=0;
  let lastFlowMonth=start.slice(0,7);const hist=[],snap=[];
  for(const date of run){
    const month=date.slice(0,7);
    if(month!==lastFlowMonth){
      if(monthly>0){cash+=monthly;inflow+=monthly;units+=monthly/Math.max(prevNav,1e-12);nMonthly++;}
      lastFlowMonth=month;
    }
    for(const sym of ['TECL','TQQQ','SGOV']){
      const a=(dm[sym]&&dm[sym][date])||0;
      if(a>0&&pos[sym]>0){const v=pos[sym]*a*(1-D.divTaxRate);cash+=v;divCash+=v;hist.push({date,type:'div',sym,amount:v});}
    }
    const di=dateIndex[date];if(di<=0)continue;
    const prev=dates[di-1],tRows=tr.filter(x=>x.date<=prev),qRows=qr.filter(x=>x.date<=prev);
    const p=orderPlan({config:D,teclRows:tRows,tqqqRows:qRows,
      signalPrices:{TECL:tm[prev],TQQQ:qm[prev],SGOV:sm[prev]},
      execPrices:{TECL:tm[date],TQQQ:qm[date],SGOV:sm[date]},
      pos,cash,startCapital:capital,force:false});
    if(p.ready){
      for(const od of p.orders){
        const gross=od.qty*od.price,f=od.fee!=null?od.fee:fee(od.qty,od.price);
        if(od.side==='sell'){pos[od.sym]=Math.max(0,pos[od.sym]-od.qty);cash+=gross-f;}
        else {const need=gross+f;if(need<=cash+1e-8){pos[od.sym]+=od.qty;cash-=need;}else continue;}
        hist.push({date,type:od.side,sym:od.sym,qty:od.qty,price:od.price,fee:f});
      }
    }
    const total=cash+pos.TECL*tm[date]+pos.TQQQ*qm[date]+pos.SGOV*sm[date];
    if(!(total>=0))continue;
    const nav=units>0?total/units:1;prevNav=nav;
    if(nav>peak)peak=nav;else if(peak>0)mdd=Math.max(mdd,(peak-nav)/peak);
    snap.push({date,total,nav,inflow,cash,TECL:pos.TECL,TQQQ:pos.TQQQ,SGOV:pos.SGOV});
  }
  if(!snap.length)return null;
  const last=snap[snap.length-1],from=start,to=last.date;
  const spanDays=Math.max(1,Math.round((new Date(to+'T00:00:00Z')-new Date(from+'T00:00:00Z'))/864e5));
  const yrs=Math.max(.05,spanDays/365.25),ret=(last.total/inflow-1)*100;
  const cagr=(Math.pow(Math.max(last.nav,1e-12),1/yrs)-1)*100;
  return {from,to,spanDays,yrs,total:last.total,inflow,ret,cagr,mdd:mdd*100,nTrade:hist.filter(x=>x.type==='buy'||x.type==='sell').length,
          nMonthly,divCash,hist,snap,positions:{...pos},cash:last.cash,nav:last.nav};
}
g.JKPlan5={CONFIG,fee,realizedVol,smaLast,signalPlan,orderPlan,simulate};
})(typeof window!=='undefined'?window:globalThis);
