(function(g){
'use strict';

const DEFAULTS={
  5:{teclWeight:.70,guardWeight:.30,ivsLook:20,ivsS0:.55,ivsBand:.10,guardMA:225,guardBand:.01},
  10:{trendMA:250,bullWeight:.80,dipWeights:[0,.20,.40,.60],rsi:[40,35,30],dd:[-.12,-.22,-.32]},
  15:{center:.60,lo:.40,hi:.80},
  20:{winnerWeight:.40,m9Weight:.30,m12Weight:.70}
};
const FEE_RATE=.001;
/* 5년 플랜 규칙 벌 — 플랜 화면(renderAlphaPlan)과 모의 재생(replay)이 같은 alphaDecide 로 판정한다 (같은 걸 두 군데서 세지 않는다).
   base: 공식(지금) 규칙. exp1: '실험적 확장'(2026-11 연구 · 공식 규칙 아님 · 켤 때만) —
     Guard 끄기 −1% → −3% · TECL 슬리브 밴드 10%p 대칭 → 줄일 때 1%p(전체 0.7%p)·늘릴 때 15%p(전체 10.5%p) ·
     TQQQ 를 Guard 바뀔 때만이 아니라 해마다 첫 거래일에도 30% 와 2%p 넘게 벌어졌으면 30% 로.
   연구값(2011~ 앱 조건 1만$): 30.4/48.4 → 30.8/41.6 · 합성 2000~ 13.5/82.3 → 14.4/77.6 (research/im_plan/RESEARCH_LOG.md '앱 반영안'). */
const ALPHA_RULES={
  base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:false},
  exp1:{key:'exp1',name:'새 규칙 (실험적 확장)',guardOn:.01,guardOff:.03,bandDn:.01,bandUp:.15,tqReb:.02,exp:true}
};
function alphaRules(key){return ALPHA_RULES[String(key||'')]||ALPHA_RULES.base;}
/* 다음 거래일(평일 기준)이 해가 바뀐 첫 거래일인가 — 1월 1일은 휴장이라 평일로 넘겨도 새해 첫 거래일은 1월 안에 있다. */
function yearDoneAt(dateStr){
  const d=new Date(String(dateStr||'')+'T00:00:00Z');if(isNaN(d))return false;const y=d.getUTCFullYear();
  do{d.setUTCDate(d.getUTCDate()+1);}while(d.getUTCDay()===0||d.getUTCDay()===6);
  return d.getUTCFullYear()!==y;
}
/* 5년 플랜 하루 판정 — 전일 확정값만 받는다.
   a={rules, w(목표 슬리브 비율), sleeveNow, teclQty, tqqqQty, tqqqClose, sma, tqqqWeight(전체 대비 TQQQ 비중), guardWeight, yearStart}
   반환 {rules, teclHit, guard, guardFlip, tqReb, upper, lower} — tqReb: 해 첫 거래일 TQQQ 30% 맞춤(exp1 · Guard ON 유지 중일 때만) */
function alphaDecide(a){
  const R=alphaRules(a.rules&&a.rules.key||a.rules);
  const teclHit=!(a.teclQty>0)||(a.sleeveNow-a.w>R.bandDn)||(a.w-a.sleeveNow>R.bandUp);
  const upper=a.sma*(1+R.guardOn),lower=a.sma*(1-R.guardOff),posOn=a.tqqqQty>0;
  const guard=a.tqqqClose>upper?'ON':a.tqqqClose<lower?'OFF':(posOn?'ON':'OFF'),guardFlip=(guard==='ON')!==posOn;
  const tqReb=R.tqReb>0&&!!a.yearStart&&guard==='ON'&&!guardFlip&&Math.abs((+a.tqqqWeight||0)-(+a.guardWeight||0))>R.tqReb;
  return {rules:R,teclHit,guard,guardFlip,tqReb,upper,lower};
}

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
/* 날짜 축은 TECL·TQQQ 둘 다 있는 날이다. SGOV 는 날짜를 자르지 않는다.
   예전엔 SGOV(2020-06 상장)까지 교집합에 넣어 그 앞 이력이 통째로 잘렸다 — SMA225·변동성·모멘텀 예열이
   2020-06 부터 다시 시작해 2021-04 까지 신호가 없었고, 그 전에 시작한 세션은 1년 넘게 현금만 들었다
   (2020-01 시작 5년 플랜: 2020년 수익 0% · 앞 16개월 무거래). 신호는 두 종목의 전 이력으로 예열한다.
   SGOV 가 아직 없는 날은 null — 그날 남는 돈은 현금(이자 0)으로 둔다. 상장 뒤 빠진 날은 직전 값으로 잇는다. */
function commonSeries(tecl,tqqq,sgov,endDate){
  const tm=mapRows(tecl),qm=mapRows(tqqq),sm=mapRows(sgov);
  const dates=[...(tqqq||[])].map(x=>String(x.date||'')).filter(d=>d&&tm.has(d)&&qm.has(d)&&(!endDate||d<=endDate)).sort();
  let lastS=null;
  return {dates,tecl:dates.map(d=>tm.get(d)),tqqq:dates.map(d=>qm.get(d)),sgov:dates.map(d=>{if(sm.has(d))lastS=sm.get(d);return lastS;})};
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
    if(dq<0&&px[sym]>0){
      const q=-dq,p=px[sym],f=alphaFee(q,p),gross=q*p;
      avail+=gross-f;pos[sym]-=q;nTrade++;addTrade(ledger,date,'sell',sym,q,p,f,n++,signalDate);
    }
  }
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=(target[sym]||0)-(pos[sym]||0);
    if(dq>0&&px[sym]>0){
      const p=px[sym],max=Math.floor(avail/(p*(1+FEE_RATE))),q=Math.max(0,Math.min(dq,max));
      if(q>0){const f=alphaFee(q,p),gross=q*p;avail-=gross+f;pos[sym]+=q;nTrade++;addTrade(ledger,date,'buy',sym,q,p,f,n++,signalDate);}
    }
  }
  return {cash:avail,nTrade,seq:n};
}
function replay(opt){
  opt=opt||{};
  const horizon=[5,10,15,20].includes(+opt.horizon)?+opt.horizon:5;
  const RULES=alphaRules(opt.rules);   // 5년 규칙 벌(base 기본 · exp1 실험적 확장) — 안 주면 예전과 같다
  const start=String(opt.startDate||''),end=String(opt.endDate||'');
  const principal=Math.max(0,+opt.principal||0),monthlyAdd=Math.max(0,+opt.monthlyAdd||0);
  if(!start||!(principal>0))return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 또는 원금 없음'};
  const S=commonSeries(opt.tecl,opt.tqqq,opt.sgov,end);
  if(!S.dates.length)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'공통 시세 없음'};
  const startIdx=S.dates.findIndex(d=>d>=start);
  if(startIdx<0)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 이후 시세 없음'};

  const tma225=sma(S.tqqq,225),tma250=sma(S.tqqq,250),trsi=rsi(S.tqqq,14);
  const teclRows=S.dates.map((d,k)=>({date:d,close:S.tecl[k]})),tqqqRows=S.dates.map((d,k)=>({date:d,close:S.tqqq[k]}));
  const div={TECL:mapDiv(opt.teclDiv),TQQQ:mapDiv(opt.tqqqDiv),SGOV:mapDiv(opt.sgovDiv)};
  const ledger=initialLedger(start,principal),pos={TECL:0,TQQQ:0,SGOV:0};
  let cash=principal,inflow=principal,nTrade=0,seq=1,lastMonth=start.slice(0,7),lastDecision=null;
  const nav=[];

  for(let i=startIdx;i<S.dates.length;i++){
    const date=S.dates[i],month=date.slice(0,7);let force=false;
    // 확정 종가 p로 미리 주문 수량을 결정하고, i일 종가는 체결·평가에만 사용한다.
    // 리밸런싱 신호는 미확정 i일 가격을 읽지 않는다.
    if(month!==lastMonth&&monthlyAdd>0){
      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;
    }else if(month!==lastMonth)lastMonth=month;

    const dc=pos.TECL*(div.TECL.get(date)||0)+pos.TQQQ*(div.TQQQ.get(date)||0)+pos.SGOV*(div.SGOV.get(date)||0);
    if(dc>0){cash+=dc;addCash(ledger,date,'div',dc,seq++);}

    const p=i-1;
    if(p>=0){
      const sp={TECL:S.tecl[p],TQQQ:S.tqqq[p],SGOV:S.sgov[p]};
      const ep={TECL:S.tecl[i],TQQQ:S.tqqq[i],SGOV:S.sgov[i]};
      let total=pos.TECL*sp.TECL+pos.TQQQ*sp.TQQQ+pos.SGOV*(sp.SGOV||0)+cash;
      if(!(total>0))total=inflow;
      let need=false,targetShares={...pos},meta={horizon};
      // 남는 돈 → SGOV 주수. 상장 전(시세 null)이면 0 — 현금으로 둔다.
      const sgQty=rest=>sp.SGOV>0?Math.max(0,Math.floor(Math.max(0,rest)/sp.SGOV)):0;
      // SGOV 가 막 상장한 날(전일 확정 기준): 그동안 현금으로 둔 돈을 한 번 SGOV 로 옮긴다.
      const sgNew=sp.SGOV>0&&!(p>0&&S.sgov[p-1]>0)&&cash>0;

      if(horizon===5){
        const D=DEFAULTS[5],sigma=realizedVol(S.tecl,p,D.ivsLook),mv=tma225[p];
        if(sigma>0&&mv>0){
          const w=Math.min(1,(D.ivsS0*D.ivsS0)/(sigma*sigma));
          const sleeveNow=((pos.TECL*sp.TECL)/Math.max(total,1))/Math.max(D.teclWeight,1e-9);
          // 판정은 공용 alphaDecide (플랜 화면과 같은 글자). 해 첫 거래일 = 체결일 i 와 신호일 p 의 해가 다름.
          const dec=alphaDecide({rules:RULES,w,sleeveNow,teclQty:pos.TECL,tqqqQty:pos.TQQQ,tqqqClose:sp.TQQQ,sma:mv,
            tqqqWeight:(pos.TQQQ*sp.TQQQ)/Math.max(total,1),guardWeight:D.guardWeight,yearStart:date.slice(0,4)!==S.dates[p].slice(0,4)});
          const {teclHit,guard,guardFlip,tqReb}=dec;
          const first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
          need=teclHit||guardFlip||tqReb||force||first||sgNew;
          if(need){
            const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;
            const tq=(guardFlip||tqReb||force||first)?(guard==='ON'?Math.max(0,Math.floor(total*D.guardWeight/sp.TQQQ)):0):pos.TQQQ;
            const ts=sgQty(total-tt*sp.TECL-tq*sp.TQQQ);
            targetShares={TECL:tt,TQQQ:tq,SGOV:ts};
          }
          meta={horizon,rules:RULES.key,sigma,w,sleeveNow,guard,teclHit,guardFlip,tqReb};
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
        need=pos.TECL>0||Math.abs(curQ-risk)>.05||force||first||sgNew;
        if(need){
          const tq=Math.max(0,Math.floor(total*risk/sp.TQQQ));
          const ts=sgQty(total-tq*sp.TQQQ);
          targetShares={TECL:0,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,bull,stage,risk,sma:mv,rsi:trsi[p],ath};
      }else if(horizon===15){
        const D=DEFAULTS[15],cur=pos.TQQQ*sp.TQQQ/Math.max(total,1),first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=pos.TECL>0||cur<D.lo||cur>D.hi||force||first||sgNew;
        if(need){
          const tq=Math.max(0,Math.floor(total*D.center/sp.TQQQ));
          const ts=sgQty(total-tq*sp.TQQQ);
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
        need=force||first||sgNew||(winner==='TECL'?(pos.TQQQ>0||Math.abs(curT-D.winnerWeight)>.05):(winner==='TQQQ'?(pos.TECL>0||Math.abs(curQ-D.winnerWeight)>.05):(pos.TECL>0||pos.TQQQ>0)));
        if(need){
          const tt=winner==='TECL'?Math.max(0,Math.floor(total*D.winnerWeight/sp.TECL)):0;
          const tq=winner==='TQQQ'?Math.max(0,Math.floor(total*D.winnerWeight/sp.TQQQ)):0;
          const ts=sgQty(total-tt*sp.TECL-tq*sp.TQQQ);
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

    const total=pos.TECL*S.tecl[i]+pos.TQQQ*S.tqqq[i]+pos.SGOV*(S.sgov[i]||0)+cash;
    nav.push({date,total,inflow,cash,tecl:pos.TECL,tqqq:pos.TQQQ,sgov:pos.SGOV,teclPx:S.tecl[i],tqqqPx:S.tqqq[i],sgovPx:S.sgov[i]});
  }

  return {horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,stats:stats(nav,nTrade),lastDecision,last:nav[nav.length-1]||null,error:''};
}

g.JKPlanSessionEngine={VERSION:2,ORDER_SIZING_BASIS:'previous-settled-close',DEFAULTS,ALPHA_RULES,alphaRules,alphaDecide,yearDoneAt,FEE_RATE,alphaFee,replay,stats};
})(typeof window!=='undefined'?window:globalThis);
