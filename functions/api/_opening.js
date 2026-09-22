// 시초가 눌림→재돌파 서버 공용 규칙
// 브라우저 백테스트(runPullbackRebreak)의 핵심 규칙을 서버 감시/이력에서 같이 쓴다.

export function minuteVolume(rows) {
  const a=(rows||[]).map(x=>({...x})).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")));
  let prevDay="", prevCum=0;
  for(const x of a){
    const d=String(x.t||"").slice(0,10), cum=Math.max(0,+x.vol||0);
    x.vol=d===prevDay?Math.max(0,cum-prevCum):cum;
    prevDay=d; prevCum=cum;
  }
  return a;
}

export function dailyMeta(daily,date){
  const a=(daily&&daily.ohlc)||[], i=a.findIndex(x=>x.date===date);
  if(i<0) return null;
  const cur=a[i], prev=i>0?a[i-1]:null;
  if(!cur||!prev||!(+cur.open>0)||!(+prev.close>0)) return null;
  return {open:+cur.open,prevClose:+prev.close};
}

const hmOf=t=>+String(t||"").slice(11,13)*100 + +String(t||"").slice(14,16);

export function rebreakTrade(rows,meta,cutoffHm=930){
  const obs=3,gmin=2,gmax=7,minRise=.5,pbMin=.3,pbMax=1.0,volMult=1.0,amountMult=1.2,stop=1,tp=1.5,fee=.25;
  if(!Array.isArray(rows)||rows.length<obs+3||!meta)return null;
  const gap=(meta.open/meta.prevClose-1)*100;
  if(gap<gmin||gap>gmax)return null;

  const a=rows.filter(x=>{
    const hm=hmOf(x.t);
    return hm>=900&&hm<=Math.min(930,cutoffHm);
  }).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")))
    .map(x=>({t:x.t,hm:hmOf(x.t),close:+x.close||0,high:+(x.high??x.close)||0,vol:+x.vol||0}));

  if(a.length<obs+3)return null;
  const open=+meta.open, firstHigh=Math.max(...a.slice(0,obs).map(x=>x.high||x.close));
  let bi=-1;
  for(let i=obs;i<a.length-2;i++){
    const px=a[i].close;
    if((a[i].high||px)>firstHigh&&px>=open&&(px/open-1)*100>=minRise){bi=i;break;}
  }
  if(bi<0)return null;

  let peak=a[bi].high||a[bi].close,peakI=bi;
  for(let i=bi+1;i<a.length-1;i++){
    const px=a[i].close;
    if((a[i].high||px)>peak){peak=a[i].high||px;peakI=i;continue;}
    const dd=(peak-px)/peak*100;
    if(dd<pbMin||dd>pbMax||px<open)continue;

    const pull=a.slice(peakI+1,i+1);
    if(!pull.length)continue;
    const baseVol=pull.reduce((s,x)=>s+x.vol,0)/pull.length;
    const baseAmt=pull.reduce((s,x)=>s+x.close*x.vol,0)/pull.length;

    for(let j=i+1;j<a.length;j++){
      const jp=a[j].close,jv=a[j].vol,ja=jp*jv;
      const volRatio=jv/Math.max(1,baseVol), amountRatio=ja/Math.max(1,baseAmt);
      if(jp>peak&&volRatio>=volMult&&amountRatio>=amountMult){
        const tr={
          gap,firstHigh,peak,pullbackPct:dd,
          entryTime:a[j].hm,entryPrice:jp,volRatio,amountRatio,estAmount:ja,
          exitTime:null,exitPrice:null,reason:null,pnl:null
        };
        for(let k=j+1;k<a.length;k++){
          const r=(a[k].close/jp-1)*100;
          if(r<=-stop){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="손절";break;}
          if(r>=tp){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="익절";break;}
        }
        if(tr.exitTime==null&&cutoffHm>=930){
          const b=a.filter(x=>x.hm<=930).slice(-1)[0];
          if(b){tr.exitTime=b.hm;tr.exitPrice=b.close;tr.reason="09:30 청산";}
        }
        if(tr.exitPrice!=null) tr.pnl=(tr.exitPrice/tr.entryPrice-1)*100-fee;
        return tr;
      }
    }
    break;
  }
  return null;
}
