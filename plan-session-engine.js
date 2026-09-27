(function(g){
'use strict';

const DEFAULTS={
  5:{teclWeight:.70,guardWeight:.30,ivsLook:20,ivsS0:.55,ivsBand:.10,guardMA:225,guardBand:.01},
  10:{trendMA:250,bullWeight:.80,dipWeights:[0,.20,.40,.60],rsi:[40,35,30],dd:[-.12,-.22,-.32]},
  15:{center:.60,lo:.40,hi:.80},
  20:{winnerWeight:.40,m9Weight:.30,m12Weight:.70}
};
const FEE_RATE=.001;

function alphaFee(q,p){
  const gross=Math.max(0,(+q||0)*(+p||0));
  return gross<=10?0:Math.floor(gross*FEE_RATE*100)/100;
}
function sma(a,n){
  const out=Array(a.length).fill(null);let s=0;
  for(let i=0;i<a.length;i++){s+=+a[i]||0;if(i>=n)s-=+a[i-n]||0;if(i>=n-1)out[i]=s/n;}
  return out;
}
function rsi(a,n){
  const out=Array(a.length).fill(null);let ag=0,al=0;
  for(let i=1;i<a.length;i++){
    const z=a[i]-a[i-1],gg=Math.max(z,0),ll=Math.max(-z,0);
    if(i<=n){ag+=gg;al+=ll;if(i===n){ag/=n;al/=n;out[i]=100-100/(1+(al===0?100:ag/al));}}
    else{ag=(ag*(n-1)+gg)/n;al=(al*(n-1)+ll)/n;out[i]=100-100/(1+(al===0?100:ag/al));}
  }
  return out;
}
function realizedVol(a,idx,n){
  if(idx<n)return null;const r=[];
  for(let i=idx-n+1;i<=idx;i++){const p=+a[i-1],c=+a[i];if(!(p>0&&c>0))return null;r.push(c/p-1);}
  const m=r.reduce((x,y)=>x+y,0)/r.length,v=r.reduce((x,y)=>x+(y-m)*(y-m),0)/r.length;
  return Math.sqrt(Math.max(v,0)*252);
}
function monthDoneAt(dateStr){
  const d=new Date(String(dateStr||'')+'T00:00:00Z');if(isNaN(d))return false;const m=d.getUTCMonth();
  do{d.setUTCDate(d.getUTCDate()+1);}while(d.getUTCDay()===0||d.getUTCDay()===6);
  return d.getUTCMonth()!==m;
}
function latestCompletedMonthIndex(rows,upto){
  let i=upto;if(i<0)return -1;
  const settled=String(rows[i].date||'');
  if(monthDoneAt(settled))return i;
  const cur=settled.slice(0,7);
  while(i>=0&&String(rows[i].date||'').slice(0,7)===cur)i--;
  return i;
}
function momentumPoint(rows,closes,idx){
  if(idx<252)return null;
  const p=+closes[idx],p189=+closes[idx-189],p252=+closes[idx-252];
  if(!(p>0&&p189>0&&p252>0))return null;
  const m9=p/p189-1,m12=p/p252-1,score=.3*m9+.7*m12;
  return {date:rows[idx].date,p,m9,m12,score,ok:m12>0};
}
function mapRows(rows){
  const m=new Map();
  for(const x of rows||[])if(x&&x.date&&+x.close>0)m.set(String(x.date),+x.close);
  return m;
}
function mapDiv(rows){
  const m=new Map();
  for(const x of rows||[]){if(!x||!x.date)continue;const a=+x.amount||+x.dividend||0;if(a>0)m.set(String(x.date),(m.get(String(x.date))||0)+a);}
  return m;
}
function commonSeries(tecl,tqqq,sgov,endDate){
  const tm=mapRows(tecl),qm=mapRows(tqqq),sm=mapRows(sgov);
  const dates=[...(tqqq||[])].map(x=>String(x.date||'')).filter(d=>d&&tm.has(d)&&qm.has(d)&&sm.has(d)&&(!endDate||d<=endDate)).sort();
  return {dates,tecl:dates.map(d=>tm.get(d)),tqqq:dates.map(d=>qm.get(d)),sgov:dates.map(d=>sm.get(d))};
}
function initialLedger(start,principal){
  return {base:{date:start,tecl:0,tqqq:0,sgov:0,cash:principal,avgTecl:null,avgTqqq:null,avgSgov:null},events:[],feeModel:'toss-us-0.1-v1'};
}
function evtId(date,n){return 'planpaper_'+String(date).replace(/-/g,'')+'_'+n;}
function addCash(ledger,date,kind,amount,n){
  if(!(amount>0))return;
  ledger.events.push({id:evtId(date,n),date,type:'cash',kind,amount:+amount});
}
function addTrade(ledger,date,side,sym,qty,price,fee,n,signalDate){
  ledger.events.push({id:evtId(date,n),date,type:'trade',side,symbol:sym,qty,price,fee,feeRate:FEE_RATE,signalDate,sim:true});
}
function stats(nav,nTrade){
  if(!nav.length)return null;
  let peak=-Infinity,mdd=0,n=0;
  for(const x of nav){
    if(!(x.inflow>0&&x.total>0))continue;
    const u=x.total/x.inflow;if(!isFinite(u)||u<=0)continue;n++;
    if(u>peak)peak=u;else if(peak>0)mdd=Math.max(mdd,(peak-u)/peak);
  }
  const a=nav[0],z=nav[nav.length-1];
  const span=Math.max(1,Math.round((new Date(z.date+'T00:00:00Z')-new Date(a.date+'T00:00:00Z'))/864e5));
  const yrs=Math.max(.05,span/365.25),base=Math.max(1,z.inflow),total=z.total;
  return {from:a.date,to:z.date,spanDays:span,yrs,inflow:base,total,ret:(total/base-1)*100,
    cagr:(Math.pow(Math.max(total,1)/base,1/yrs)-1)*100,mdd:mdd*100,nDay:n,nTrade:nTrade||0};
}
function targetOrders(target,pos,px,cash,date,signalDate,ledger,seq){
  let nTrade=0,avail=Math.max(0,cash),n=seq;
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=(target[sym]||0)-(pos[sym]||0);
    if(dq<0){
      const q=-dq,p=px[sym],f=alphaFee(q,p),gross=q*p;
      avail+=gross-f;pos[sym]-=q;nTrade++;addTrade(ledger,date,'sell',sym,q,p,f,n++,signalDate);
    }
  }
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=(target[sym]||0)-(pos[sym]||0);
    if(dq>0){
      const p=px[sym],max=Math.floor(avail/(p*(1+FEE_RATE))),q=Math.max(0,Math.min(dq,max));
      if(q>0){const f=alphaFee(q,p),gross=q*p;avail-=gross+f;pos[sym]+=q;nTrade++;addTrade(ledger,date,'buy',sym,q,p,f,n++,signalDate);}
    }
  }
  return {cash:avail,nTrade,seq:n};
}
function replay(opt){
  opt=opt||{};
  const horizon=[5,10,15,20].includes(+opt.horizon)?+opt.horizon:5;
  const start=String(opt.startDate||''),end=String(opt.endDate||'');
  const principal=Math.max(0,+opt.principal||0),monthlyAdd=Math.max(0,+opt.monthlyAdd||0);
  if(!start||!(principal>0))return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 또는 원금 없음'};
  const S=commonSeries(opt.tecl,opt.tqqq,opt.sgov,end);
  if(!S.dates.length)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'공통 시세 없음'};
  const startIdx=S.dates.findIndex(d=>d>=start);
  if(startIdx<0)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 이후 시세 없음'};

  const tma225=sma(S.tqqq,225),tma250=sma(S.tqqq,250),trsi=rsi(S.tqqq,14);\n  const teclRows=S.dates.map((d,k)=>({date:d,close:S.tecl[k]})),tqqqRows=S.dates.map((d,k)=>({date:d,close:S.tqqq[k]}));
  const div={TECL:mapDiv(opt.teclDiv),TQQQ:mapDiv(opt.tqqqDiv),SGOV:mapDiv(opt.sgovDiv)};
  const ledger=initialLedger(start,principal),pos={TECL:0,TQQQ:0,SGOV:0};
  let cash=principal,inflow=principal,nTrade=0,seq=1,lastMonth=start.slice(0,7),lastDecision=null;
  const nav=[];

  for(let i=startIdx;i<S.dates.length;i++){
    const date=S.dates[i],month=date.slice(0,7);let force=false;
    if(month!==lastMonth&&monthlyAdd>0){
      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;
    }else if(month!==lastMonth)lastMonth=month;

    const dc=pos.TECL*(div.TECL.get(date)||0)+pos.TQQQ*(div.TQQQ.get(date)||0)+pos.SGOV*(div.SGOV.get(date)||0);
    if(dc>0){cash+=dc;addCash(ledger,date,'div',dc,seq++);}

    const p=i-1;
    if(p>=0){
      const sp={TECL:S.tecl[p],TQQQ:S.tqqq[p],SGOV:S.sgov[p]};
      const ep={TECL:S.tecl[i],TQQQ:S.tqqq[i],SGOV:S.sgov[i]};
      let total=pos.TECL*sp.TECL+pos.TQQQ*sp.TQQQ+pos.SGOV*sp.SGOV+cash;
      if(!(total>0))total=inflow;
      let need=false,targetShares={...pos},meta={horizon};

      if(horizon===5){
        const D=DEFAULTS[5],sigma=realizedVol(S.tecl,p,D.ivsLook),mv=tma225[p];
        if(sigma>0&&mv>0){
          const w=Math.min(1,(D.ivsS0*D.ivsS0)/(sigma*sigma));
          const sleeveNow=((pos.TECL*sp.TECL)/Math.max(total,1))/Math.max(D.teclWeight,1e-9);
          const teclHit=pos.TECL===0||Math.abs(w-sleeveNow)>D.ivsBand;
          const up=mv*(1+D.guardBand),dn=mv*(1-D.guardBand),posOn=pos.TQQQ>0;
          const guard=sp.TQQQ>up?'ON':sp.TQQQ<dn?'OFF':(posOn?'ON':'OFF'),guardFlip=(guard==='ON')!==posOn;
          const first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
          need=teclHit||guardFlip||force||first;
          if(need){
            const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/ep.TECL)):pos.TECL;
            const tq=(guardFlip||force||first)?(guard==='ON'?Math.max(0,Math.floor(total*D.guardWeight/ep.TQQQ)):0):pos.TQQQ;
            const ts=Math.max(0,Math.floor(Math.max(0,total-tt*ep.TECL-tq*ep.TQQQ)/ep.SGOV));
            targetShares={TECL:tt,TQQQ:tq,SGOV:ts};
          }
          meta={horizon,sigma,w,sleeveNow,guard,teclHit,guardFlip};
        }
      }else if(horizon===10){
        const D=DEFAULTS[10],mv=tma250[p],bull=mv>0&&sp.TQQQ>=mv;
        let bearStart=-1,stage=0,ath=-Infinity;
        for(let k=0;k<=p;k++){
          ath=Math.max(ath,S.tqqq[k]);
          if(k>0&&tma250[k]!=null&&tma250[k-1]!=null&&S.tqqq[k]<tma250[k]&&S.tqqq[k-1]>=tma250[k-1]){bearStart=k;stage=0;}
        }
        if(!bull&&bearStart>=0){
          let mx=-Infinity;for(let k=0;k<bearStart;k++)mx=Math.max(mx,S.tqqq[k]);
          for(let k=bearStart;k<=p;k++){
            mx=Math.max(mx,S.tqqq[k]);const dd=S.tqqq[k]/mx-1,r=trsi[k];
            if(r!=null&&r<=D.rsi[0]&&dd<=D.dd[0])stage=Math.max(stage,1);
            if(r!=null&&r<=D.rsi[1]&&dd<=D.dd[1])stage=Math.max(stage,2);
            if(r!=null&&r<=D.rsi[2]&&dd<=D.dd[2])stage=Math.max(stage,3);
          }
        }
        const risk=bull?D.bullWeight:D.dipWeights[stage],curQ=pos.TQQQ*sp.TQQQ/Math.max(total,1),first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=pos.TECL>0||Math.abs(curQ-risk)>.05||force||first;
        if(need){
          const tq=Math.max(0,Math.floor(total*risk/ep.TQQQ));
          const ts=Math.max(0,Math.floor(Math.max(0,total-tq*ep.TQQQ)/ep.SGOV));
          targetShares={TECL:0,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,bull,stage,risk,sma:mv,rsi:trsi[p],ath};
      }else if(horizon===15){
        const D=DEFAULTS[15],cur=pos.TQQQ*sp.TQQQ/Math.max(total,1),first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=pos.TECL>0||cur<D.lo||cur>D.hi||force||first;
        if(need){
          const tq=Math.max(0,Math.floor(total*D.center/ep.TQQQ));
          const ts=Math.max(0,Math.floor(Math.max(0,total-tq*ep.TQQQ)/ep.SGOV));
          targetShares={TECL:0,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,current:cur,center:D.center,lo:D.lo,hi:D.hi};
      }else{
        const D=DEFAULTS[20];
        /* 공통 거래일 배열로 월말·모멘텀을 계산한다. */
        const mi=latestCompletedMonthIndex(teclRows,p),tm=momentumPoint(teclRows,S.tecl,mi),qm=momentumPoint(tqqqRows,S.tqqq,mi);
        let winner='SGOV';
        if(tm&&tm.ok&&qm&&qm.ok)winner=tm.score>=qm.score?'TECL':'TQQQ';else if(tm&&tm.ok)winner='TECL';else if(qm&&qm.ok)winner='TQQQ';
        const curT=pos.TECL*sp.TECL/Math.max(total,1),curQ=pos.TQQQ*sp.TQQQ/Math.max(total,1),first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=force||first||(winner==='TECL'?(pos.TQQQ>0||Math.abs(curT-D.winnerWeight)>.05):(winner==='TQQQ'?(pos.TECL>0||Math.abs(curQ-D.winnerWeight)>.05):(pos.TECL>0||pos.TQQQ>0)));
        if(need){
          const tt=winner==='TECL'?Math.max(0,Math.floor(total*D.winnerWeight/ep.TECL)):0;
          const tq=winner==='TQQQ'?Math.max(0,Math.floor(total*D.winnerWeight/ep.TQQQ)):0;
          const ts=Math.max(0,Math.floor(Math.max(0,total-tt*ep.TECL-tq*ep.TQQQ)/ep.SGOV));
          targetShares={TECL:tt,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,winner,tecl:tm,tqqq:qm};
      }

      if(need){
        const r=targetOrders(targetShares,pos,ep,cash,date,S.dates[p],ledger,seq);
        cash=r.cash;nTrade+=r.nTrade;seq=r.seq;
      }
      lastDecision={date,signalDate:S.dates[p],need,meta,target:{...targetShares}};
    }

    const total=pos.TECL*S.tecl[i]+pos.TQQQ*S.tqqq[i]+pos.SGOV*S.sgov[i]+cash;
    nav.push({date,total,inflow,cash,tecl:pos.TECL,tqqq:pos.TQQQ,sgov:pos.SGOV,teclPx:S.tecl[i],tqqqPx:S.tqqq[i],sgovPx:S.sgov[i]});
  }

  return {horizon,ledger,nav,stats:stats(nav,nTrade),lastDecision,last:nav[nav.length-1]||null,error:''};
}

g.JKPlanSessionEngine={VERSION:1,DEFAULTS,FEE_RATE,alphaFee,replay,stats};
})(typeof window!=='undefined'?window:globalThis);
