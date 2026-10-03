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
  finalExit:930,
});

// 2026-09-22 첫 실측 결과에서 나온 가설.
// 하루 결과로 기준전략을 바꾸지 않고, 장중에는 그림자 신호로만 병렬 기록한다.
export const SHADOW_VARIANTS=Object.freeze([
  {
    name:"hold_to_next_open",
    designedFrom:["2025-09-01/2026-09-30"],
    evaluationStart:"2026-10-01",
    label:"다음 거래일 시가 청산",
    description:"기준전략과 같은 진입 · 중간 손절/익절 없이 다음 거래일 시가까지 보유 · 연구 전용",
    params:{exitPolicy:"next_session_open"},
  },
  {
    name:"today_combo_v1",
    designedFrom:["2026-09-22"],
    label:"오늘 개선안 v1",
    description:"눌림≤0.5% + 거래대금≥1.5배 + 09:15 이전 진입",
    params:{pbMax:.5,amountMult:1.5,entryCutoff:915},
  },
  {
    name:"pb_max_0.5",
    designedFrom:["2026-09-22"],
    label:"눌림≤0.5%",
    description:"눌림 상한만 0.5%로 강화",
    params:{pbMax:.5},
  },
  {
    name:"amount_1.5",
    designedFrom:["2026-09-22"],
    label:"거래대금≥1.5배",
    description:"재돌파 추정 거래대금 배수만 강화",
    params:{amountMult:1.5},
  },
  {
    name:"entry_by_0915",
    designedFrom:["2026-09-22"],
    label:"09:15 이전",
    description:"재돌파 진입 시각을 09:15까지로 제한",
    params:{entryCutoff:915},
  },
  {
    name:"entry_by_0920",
    designedFrom:["parameter-sensitivity"],
    label:"09:20 이전",
    description:"기준 09:30보다 일찍 끊되 09:15보다 완화한 진입시간 민감도",
    params:{entryCutoff:920},
  },
  {
    name:"gap_3_6",
    designedFrom:["parameter-sensitivity"],
    label:"갭 3~6%",
    description:"기준 갭 2~7%보다 중앙 구간만 허용하는 민감도",
    params:{gapMin:3,gapMax:6},
  },
  {
    name:"vol_1.5",
    designedFrom:["parameter-sensitivity"],
    label:"거래량≥1.5배",
    description:"재돌파 1분 거래량 배수를 1.5배로 강화",
    params:{volMult:1.5},
  },
  {
    name:"stop_0.7",
    designedFrom:["parameter-sensitivity"],
    label:"손절 0.7%",
    description:"기준 손절 1.0%보다 빠른 손절 민감도",
    params:{stop:.7},
  },
  {
    name:"tp_1.0",
    designedFrom:["parameter-sensitivity"],
    label:"익절 1.0%",
    description:"기준 익절 1.5%보다 빠른 이익실현 민감도",
    params:{takeProfit:1.0},
  },
  {
    name:"pb_max_0.7",
    designedFrom:["candidate-factory-v1"],
    label:"눌림≤0.7%",
    description:"0.5%와 기준 1.0% 사이의 중간 눌림 민감도",
    params:{pbMax:.7},
  },
  {
    name:"amount_1.8",
    designedFrom:["candidate-factory-v1"],
    label:"거래대금≥1.8배",
    description:"강한 재돌파만 남기는 거래대금 강화 후보",
    params:{amountMult:1.8},
  },
  {
    name:"entry_by_0910",
    designedFrom:["candidate-factory-v1"],
    label:"09:10 이전",
    description:"초반 모멘텀만 허용하는 조기 진입 후보",
    params:{entryCutoff:910},
  },
  {
    name:"gap_2_5",
    designedFrom:["candidate-factory-v1"],
    label:"갭 2~5%",
    description:"과도한 갭을 제외하고 중간 갭만 허용",
    params:{gapMin:2,gapMax:5},
  },
  {
    name:"vol_1.8",
    designedFrom:["candidate-factory-v1"],
    label:"거래량≥1.8배",
    description:"재돌파 거래량 강도를 더 높인 후보",
    params:{volMult:1.8},
  },
  {name:"combo_pb07_amt15",designedFrom:["candidate-factory-v1"],label:"눌림0.7%+대금1.5배",description:"중간 눌림과 강한 거래대금 결합",params:{pbMax:.7,amountMult:1.5}},
  {name:"combo_e0920_vol15",designedFrom:["candidate-factory-v1"],label:"09:20+거래량1.5배",description:"조기 진입과 거래량 강화 결합",params:{entryCutoff:920,volMult:1.5}},
  {name:"gap_25_55",designedFrom:["candidate-factory-v1"],label:"갭2.5~5.5%",description:"갭 극단부를 줄인 중간 범위 후보",params:{gapMin:2.5,gapMax:5.5}},
  {name:"stop_0.9_tp_1.8",designedFrom:["candidate-factory-v1"],label:"손절0.9/익절1.8",description:"손익비를 높인 청산 후보",params:{stop:.9,takeProfit:1.8}},
  {name:"combo_pb05_e0920",designedFrom:["candidate-factory-v1"],label:"눌림0.5%+09:20",description:"얕은 눌림과 조기 진입 결합",params:{pbMax:.5,entryCutoff:920}},
]);

export const OPENING_FIXED_FRICTION_PCT=.23;
export const OPENING_VTS_MIN_MATCHES=30;
export const OPENING_FALLBACK_TICKS_PER_SIDE=2.5;

export function openingKrTickSize(price){
  const p=+price||0;
  if(p<2000)return 1;
  if(p<5000)return 5;
  if(p<20000)return 10;
  if(p<50000)return 50;
  if(p<200000)return 100;
  if(p<500000)return 500;
  return 1000;
}
export function openingFriction(entryPrice,calibration=null){
  const c=calibration||{},n=+c.completeMatches||0,obs=c.avgRoundTripSlippageCostPct;
  let slippagePct,source,tickSize=null;
  if(n>=OPENING_VTS_MIN_MATCHES&&obs!=null&&Number.isFinite(+obs)){
    slippagePct=Math.max(0,+obs);source="vts-observed";
  }else{
    tickSize=openingKrTickSize(entryPrice);
    slippagePct=(2*OPENING_FALLBACK_TICKS_PER_SIDE*tickSize/Math.max(+entryPrice||0,1e-9))*100;
    source="2.5tick-fallback";
  }
  return {
    fixedPct:OPENING_FIXED_FRICTION_PCT,slippagePct,
    totalPct:OPENING_FIXED_FRICTION_PCT+slippagePct,source,
    completeMatches:n,minMatches:OPENING_VTS_MIN_MATCHES,
    ticksPerSide:source==="2.5tick-fallback"?OPENING_FALLBACK_TICKS_PER_SIDE:null,
    tickSize
  };
}

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
  const extra={...(overrides||{})};
  const frictionCalibration=extra.frictionCalibration||null;
  delete extra.frictionCalibration;
  const p={...OPENING_BASE_PARAMS,...extra};
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
        const friction=openingFriction(jp,frictionCalibration);
        const tr={
          signalSchemaVersion:2,
          strategyVersion:"opening_rebreak_v1",
          strategyParams:{...p},
          decisionReason:"gap+first_breakout+pullback+rebreak+volume+amount_pass",
          gap,firstHigh,peak,pullbackPct:dd,
          entryTime:y.hm,entryPrice:jp,volRatio,amountRatio,estAmount:ja,
          evidence:{
            source:"Naver 1m close/volume + daily open/prevClose",
            gapPct:gap,gapMin:p.gapMin,gapMax:p.gapMax,
            firstHigh,peak,pullbackPct:dd,pullbackMin:p.pbMin,pullbackMax:p.pbMax,
            rebreakClose:jp,volumeRatio:volRatio,requiredVolumeRatio:p.volMult,
            amountRatio,requiredAmountRatio:p.amountMult,
            entryCutoff:p.entryCutoff,stopPct:p.stop,takeProfitPct:p.takeProfit,
            frictionPct:friction.totalPct,frictionModel:friction,finalExit:p.finalExit
          },
          exitTime:null,exitPrice:null,reason:null,pnl:null,
        };

        if(p.exitPolicy==="next_session_open"){
          tr.strategyVersion="opening_hold_to_next_open_v1";
          tr.evidence.exitPolicy="next_session_open";
          tr.evidence.stopPct=null;tr.evidence.takeProfitPct=null;tr.evidence.finalExit=null;
          tr.reason="다음 거래일 시가 대기";
          tr.outcomeStatus="pending_next_open";
          tr.friction=friction;
          return tr;
        }
        for(let k=j+1;k<a.length;k++){
          const r=(a[k].close/jp-1)*100;
          if(r<=-p.stop){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="손절";break;}
          if(r>=p.takeProfit){tr.exitTime=a[k].hm;tr.exitPrice=a[k].close;tr.reason="익절";break;}
        }
        if(tr.exitTime==null&&cutoffHm>=p.finalExit){
          const b=a.filter(x=>x.hm<=p.finalExit).slice(-1)[0];
          if(b){tr.exitTime=b.hm;tr.exitPrice=b.close;tr.reason="09:30 청산";}
        }
        if(tr.exitPrice!=null){
          tr.friction=friction;
          tr.pnl=(tr.exitPrice/tr.entryPrice-1)*100-friction.totalPct;
        }
        return tr;
      }
    }
    break;
  }
  return null;
}
