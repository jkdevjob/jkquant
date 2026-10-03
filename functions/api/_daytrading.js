// 데이트레이딩 서버 공용 신호 규칙.
// 실시간 Naver 1분 데이터와 장마감 KIS 재구성을 최대한 같은 관측정보로 맞춘다.
// 실전 주문은 하지 않는다.

export const DAY_BASE_PARAMS=Object.freeze({
  startHm:1000,
  entryCutoff:1430,
  lookback:20,
  slopeN:10,
  minSessionRet:1.0,
  maxSessionRet:8.0,
  minVwapSlope:0.10,
  volMult:1.5,
});

const STATIC_DAY_SHADOW_VARIANTS=[
  {name:"vol_2.0",label:"거래량≥2.0배",params:{volMult:2.0}},
  {name:"lookback_30",label:"직전30분 고점",params:{lookback:30}},
  {name:"vwap_slope_0.2",label:"VWAP기울기≥0.2%",params:{minVwapSlope:0.20}},
  {name:"entry_by_1400",label:"14:00 이전",params:{entryCutoff:1400}},
  {name:"session_min_2",label:"세션상승≥2%",params:{minSessionRet:2.0}},
  {name:"stop_0.8",label:"손절0.8%",params:{stopPct:0.8}},
  {name:"tp_1.5",label:"익절1.5%",params:{takeProfitPct:1.5}},
  {name:"vol_1.2",label:"거래량≥1.2배",params:{volMult:1.2}},
  {name:"lookback_10",label:"직전10분 고점",params:{lookback:10}},
  {name:"max_trades_1",label:"하루 최대1건",params:{maxTrades:1}},
  {name:"vwap_slope_0.15",label:"VWAP기울기≥0.15%",params:{minVwapSlope:0.15}},
  {name:"session_min_1.5",label:"세션상승≥1.5%",params:{minSessionRet:1.5}},
  {name:"entry_by_1330",label:"13:30 이전",params:{entryCutoff:1330}},
  {name:"stop_0.8_tp_1.6",label:"손절0.8%·익절1.6%",params:{stopPct:0.8,takeProfitPct:1.6}},
];

const FACTORY_EPOCH_MS=Date.UTC(2026,9,3),FACTORY_CYCLE_MS=28*86400000;
function factoryIndex(ms=Date.now()){return Math.max(0,Math.floor((ms-FACTORY_EPOCH_MS)/FACTORY_CYCLE_MS));}
function enc10(x){return Math.round(Number(x)*10);}
export function dayFactoryVariants(ms=Date.now()){
  const k=factoryIndex(ms),out=[];
  const vols=[1.1,1.3,1.7,1.9],looks=[12,15,25,35],slopes=[.05,.12,.18,.25],
        rets=[.5,1.5,2.5],cuts=[1300,1400],stops=[.7,.9,1.1],tps=[1.6,1.8,2.2],maxes=[2,3];
  for(let j=0;j<4;j++){
    const z=k*4+j;
    const vol=vols[z%vols.length],look=looks[(z*3+1)%looks.length],slope=slopes[(z*5+2)%slopes.length],
          ret=rets[(z*7+1)%rets.length],cut=cuts[z%cuts.length],stop=stops[(z*11+1)%stops.length],
          tp=tps[(z*13+2)%tps.length],max=maxes[(z*17)%maxes.length];
    const name=`gen_d_v${enc10(vol)}_l${look}_s${Math.round(slope*100)}_r${enc10(ret)}_e${cut}_sl${enc10(stop)}_tp${enc10(tp)}_m${max}`;
    out.push({name,label:"자동생성 "+(j+1),designedFrom:["candidate-factory-cycle-"+k],
      params:{volMult:vol,lookback:look,minVwapSlope:slope,minSessionRet:ret,entryCutoff:cut,stopPct:stop,takeProfitPct:tp,maxTrades:max},
      factory:true,factoryCycle:k});
  }
  return out;
}
export const DAY_SHADOW_VARIANTS=Object.freeze([...STATIC_DAY_SHADOW_VARIANTS,...dayFactoryVariants()]);
export function parseGeneratedDayVariant(name){
  const m=/^gen_d_v(\d+)_l(\d+)_s(\d+)_r(\d+)_e(\d+)_sl(\d+)_tp(\d+)_m(\d+)$/.exec(String(name||""));
  if(!m)return null;
  return {name:String(name),label:"자동생성 전략",factory:true,params:{
    volMult:+m[1]/10,lookback:+m[2],minVwapSlope:+m[3]/100,minSessionRet:+m[4]/10,
    entryCutoff:+m[5],stopPct:+m[6]/10,takeProfitPct:+m[7]/10,maxTrades:+m[8]
  }};
}
export function dayVariant(name){
  return DAY_SHADOW_VARIANTS.find(x=>x.name===name)||parseGeneratedDayVariant(name);
}

const hmOf=t=>+String(t||"").slice(11,13)*100 + +String(t||"").slice(14,16);

export function minuteVolume(rows){
  const a=(rows||[]).map(x=>({...x})).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")));
  let prevDay="",prevCum=0;
  for(const x of a){
    const d=String(x.t||"").slice(0,10),cum=Math.max(0,+x.vol||0);
    x.vol=d===prevDay?Math.max(0,cum-prevCum):cum;
    prevDay=d;prevCum=cum;
  }
  return a;
}

export function daySignal(rows,cutoffHm=1430,overrides={}){
  const p={...DAY_BASE_PARAMS,...(overrides||{})};
  const a=(rows||[]).filter(x=>{
    const hm=hmOf(x.t);
    return hm>=900&&hm<=Math.min(cutoffHm,p.entryCutoff);
  }).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")))
    .map(x=>({t:x.t,hm:hmOf(x.t),c:+x.close||0,v:+x.vol||0}))
    .filter(x=>x.c>0);

  if(a.length<Math.max(p.lookback,p.slopeN)+2)return null;

  // 실시간 Naver에는 O/H/L이 없으므로 신호용 세션 기준가는 09:00 1분 종가다.
  const sessionBase=a[0].c;
  if(!(sessionBase>0))return null;

  const vwap=[];let pv=0,vv=0;
  for(const x of a){
    pv+=x.c*x.v;vv+=x.v;
    vwap.push(pv/Math.max(1,vv));
  }

  const start=Math.max(p.startHm,+overrides.snapshotHm+5||p.startHm);
  for(let i=Math.max(p.lookback,p.slopeN);i<a.length;i++){
    const x=a[i];
    if(x.hm<start)continue;
    if(x.hm>p.entryCutoff)break;
    const prev=a.slice(i-p.lookback,i);
    const priorHigh=Math.max(...prev.map(z=>z.c));
    const avgVol=prev.reduce((s,z)=>s+z.v,0)/prev.length;
    const volRatio=x.v/Math.max(1,avgVol);
    const vw=vwap[i],old=vwap[i-p.slopeN];
    const slope=old>0?(vw/old-1)*100:-999;
    const sessionRet=(x.c/sessionBase-1)*100;
    if(sessionRet<p.minSessionRet||sessionRet>p.maxSessionRet)continue;
    if(!(x.c>vw&&slope>=p.minVwapSlope))continue;
    if(!(x.c>priorHigh&&volRatio>=p.volMult))continue;
    const breakoutPct=(x.c/priorHigh-1)*100;
    return {
      strategyVersion:"daytrading_vwap_breakout_v1",
      signalTime:x.hm,signalPrice:x.c,sessionBase,sessionRet,vwap:vw,vwapSlope:slope,
      priorHigh,breakoutPct,volRatio,
      evidence:{
        source:"Naver 1m close/volume",
        sessionBase,sessionRet,minSessionRet:p.minSessionRet,maxSessionRet:p.maxSessionRet,
        vwap:vw,vwapSlope:slope,minVwapSlope:p.minVwapSlope,
        priorHigh,lookback:p.lookback,breakoutPct,
        volumeRatio:volRatio,requiredVolumeRatio:p.volMult,
        entryCutoff:p.entryCutoff
      },
      score:volRatio*Math.max(.01,breakoutPct+.05)*Math.max(.01,slope+.05),
    };
  }
  return null;
}
