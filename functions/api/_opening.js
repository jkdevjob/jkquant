// 시초가 눌림→재돌파 서버 공용 규칙
// 기준전략과 연구용 shadow 전략이 같은 엔진을 사용한다.
// shadow는 실제 주문/기준 Telegram 알림에 영향을 주지 않고 비교 기록만 남긴다.

export const OPENING_BASE_PARAMS=Object.freeze({
  obs:3,
  gapMin:2,
  gapMax:7,
  minRise:.5,
  pbMin:.3,
  pbMax:1.0,
  volMult:1.0,
  amountMult:1.2,
  entryCutoff:930,
  stop:1,
  takeProfit:1.5,
  fee:.25,
  finalExit:930,
});

// 2026-09-22 첫 실측 결과에서 나온 가설.
// 하루 결과로 기준전략을 바꾸지 않고, 장중에는 그림자 신호로만 병렬 기록한다.
export const SHADOW_VARIANTS=Object.freeze([
  {
    name:"today_combo_v1",
    label:"오늘 개선안 v1",
    description:"눌림≤0.5% + 거래대금≥1.5배 + 09:15 이전 진입",
    params:{pbMax:.5,amountMult:1.5,entryCutoff:915},
  },
  {
    name:"pb_max_0.5",
    label:"눌림≤0.5%",
    description:"눌림 상한만 0.5%로 강화",
    params:{pbMax:.5},
  },
  {
    name:"amount_1.5",
    label:"거래대금≥1.5배",
    description:"재돌파 추정 거래대금 배수만 강화",
    params:{amountMult:1.5},
  },
  {
    name:"entry_by_0915",
    label:"09:15 이전",
    description:"재돌파 진입 시각을 09:15까지로 제한",
    params:{entryCutoff:915},
  },
]);

export function minuteVolume(rows) {
  const a=(rows||[]).map(x=>({...x})).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")));
  let prevDay="",prevCum=0;
  for(const x of a){
    const d=String(x.t||"").slice(0,10),cum=Math.max(0,+x.vol||0);
    x.vol=d===prevDay?Math.max(0,cum-prevCum):cum;
    prevDay=d;prevCum=cum;
  }
  return a;
}

export function dailyMeta(daily,date){
  const a=(daily&&daily.ohlc)||[],i=a.findIndex(x=>x.date===date);
  if(i<0)return null;
  const cur=a[i],prev=i>0?a[i-1]:null;
  if(!cur||!prev||!(+cur.open>0)||!(+prev.close>0))return null;
  return {open:+cur.open,prevClose:+prev.close};
}

const hmOf=t=>+String(t||"").slice(11,13)*100 + +String(t||"").slice(14,16);

export function rebreakTrade(rows,meta,cutoffHm=930,overrides={}){
  const p={...OPENING_BASE_PARAMS,...(overrides||{})};
  if(!Array.isArray(rows)||rows.length<p.obs+3||!meta)return null;

  const gap=(meta.open/meta.prevClose-1)*100;
  if(gap<p.gapMin||gap>p.gapMax)return null;

  // cutoffHm은 현재까지 확인 가능한 완료봉 범위다.
  // entryCutoff은 신규 진입 허용 시각이며, 그 뒤 봉은 기존 포지션의 청산 판단에만 사용한다.
  const a=rows.filter(x=>{
    const hm=hmOf(x.t);
    return hm>=900&&hm<=Math.min(930,cutoffHm);
  }).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")))
    .map(x=>({t:x.t,hm:hmOf(x.t),close:+x.close||0,high:+(x.high??x.close)||0,vol:+x.vol||0}));

  if(a.length<p.obs+3)return null;
  const open=+meta.open,firstHigh=Math.max(...a.slice(0,p.obs).map(x=>x.high||x.close));

  let bi=-1;
  for(let i=p.obs;i<a.length-2;i++){
    const x=a[i],px=x.close;
    if(x.hm>p.entryCutoff)break;
    if((x.high||px)>firstHigh&&px>=open&&(px/open-1)*100>=p.minRise){bi=i;break;}
  }
  if(bi<0)return null;

  let peak=a[bi].high||a[bi].close,peakI=bi;
  for(let i=bi+1;i<a.length-1;i++){
    const x=a[i],px=x.close;
    if((x.high||px)>peak){peak=x.high||px;peakI=i;continue;}
    const dd=(peak-px)/peak*100;
    if(dd<p.pbMin||dd>p.pbMax||px<open)continue;

    const pull=a.slice(peakI+1,i+1);
    if(!pull.length)continue;
    const baseVol=pull.reduce((s,z)=>s+z.vol,0)/pull.length;
    const baseAmt=pull.reduce((s,z)=>s+z.close*z.vol,0)/pull.length;

    for(let j=i+1;j<a.length;j++){
      const y=a[j];
      if(y.hm>p.entryCutoff)break;
      const jp=y.close,jv=y.vol,ja=jp*jv;
      const volRatio=jv/Math.max(1,baseVol),amountRatio=ja/Math.max(1,baseAmt);
      if(jp>peak&&volRatio>=p.volMult&&amountRatio>=p.amountMult){
        const tr={
          gap,firstHigh,peak,pullbackPct:dd,
          entryTime:y.hm,entryPrice:jp,volRatio,amountRatio,estAmount:ja,
          exitTime:null,exitPrice:null,reason:null,pnl:null,
        };

        for(let k=j+1;k<a.length;k++){
          const r=(a[k].close/jp-1)*100;
          if(r<=-p.stop){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="손절";break;}
          if(r>=p.takeProfit){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="익절";break;}
        }
        if(tr.exitTime==null&&cutoffHm>=p.finalExit){
          const b=a.filter(x=>x.hm<=p.finalExit).slice(-1)[0];
          if(b){tr.exitTime=b.hm;tr.exitPrice=b.close;tr.reason="09:30 청산";}
        }
        if(tr.exitPrice!=null)tr.pnl=(tr.exitPrice/tr.entryPrice-1)*100-p.fee;
        return tr;
      }
    }
    break;
  }
  return null;
}
