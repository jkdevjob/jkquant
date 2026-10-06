(function(){
"use strict";

const API="/api/realestate-gpt";
const SOURCE_LINKS={
  kb:"https://data.kbland.kr/",
  rtms:"https://rt.molit.go.kr/",
  rone:"https://www.reb.or.kr/r-one/portal/main/indexPage.do",
  molit:"https://stat.molit.go.kr/portal/main/portalMain.do"
};

function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function ym(s){s=String(s||"");return s.length>=6?s.slice(0,4)+"-"+s.slice(4,6):s}
function pct(v,d=1){return Number.isFinite(v)?(v*100).toFixed(d)+"%":"-"}
function mean(a){const b=a.filter(Number.isFinite);return b.length?b.reduce((x,y)=>x+y,0)/b.length:null}
function stdev(a){const b=a.filter(Number.isFinite);if(b.length<2)return null;const m=mean(b);return Math.sqrt(b.reduce((s,x)=>s+(x-m)*(x-m),0)/(b.length-1))}
function corr(x,y){
  const z=[];for(let i=0;i<Math.min(x.length,y.length);i++)if(Number.isFinite(x[i])&&Number.isFinite(y[i]))z.push([x[i],y[i]]);
  if(z.length<6)return null;
  const mx=mean(z.map(v=>v[0])),my=mean(z.map(v=>v[1]));
  let a=0,b=0,c=0;for(const [u,v] of z){const dx=u-mx,dy=v-my;a+=dx*dy;b+=dx*dx;c+=dy*dy}
  return b&&c?a/Math.sqrt(b*c):null
}
function maxDrawdown(values){
  let peak=-Infinity,mdd=0;for(const v of values){if(!Number.isFinite(v))continue;if(v>peak)peak=v;if(peak>0)mdd=Math.min(mdd,v/peak-1)}return mdd
}
function cagr(start,end,months){return start>0&&end>0&&months>0?Math.pow(end/start,12/months)-1:null}

async function jfetch(url){
  const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()
}
async function dataset(name,region){
  let url=API+"?dataset="+encodeURIComponent(name)+(region?"&region="+encodeURIComponent(region):"");
  try{
    const j=await jfetch(url);
    if(j&&j.ok&&j.payload)return {payload:j.payload,via:"proxy",fetchedAt:j.fetchedAt||null};
    throw new Error((j&&j.error)||"proxy failed");
  }catch(proxyErr){
    const q=new URLSearchParams();
    let direct="";
    if(name==="price"||name==="jeonse"){
      direct="https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/priceIndex";
      q.set("월간주간구분코드","01");q.set("매물종별구분","01");q.set("매매전세코드",name==="price"?"01":"02");
    }else if(name==="ratio"){
      direct="https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/dealCntstTnantRato";q.set("매물종별구분","01");
    }else if(name==="buyer"){
      direct="https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/maktTrnd";q.set("메뉴코드","01");q.set("월간주간구분코드","01");
    }else if(name==="movein"){
      direct="https://api.kbland.kr/land-extra/lots/v1/api/aptMovinCnt";q.set("기간구분","1");if(region)q.set("법정동코드",String(region).padEnd(10,"0"));
    }else throw proxyErr;
    if(region&&name!=="movein")q.set("지역코드",region);
    const r=await fetch(direct+"?"+q.toString(),{cache:"no-store"});if(!r.ok)throw proxyErr;
    return {payload:await r.json(),via:"direct",fetchedAt:null};
  }
}
function body(payload){return payload&&payload.dataBody&&payload.dataBody.data?payload.dataBody.data:null}

function normalizeWide(payload,valueKey){
  const d=body(payload);if(!d||!Array.isArray(d["날짜리스트"])||!Array.isArray(d["데이터리스트"]))return [];
  const dates=d["날짜리스트"];
  return d["데이터리스트"].map(row=>{
    const vals=Array.isArray(row.dataList)?row.dataList:[];
    const points=[];
    for(let i=0;i<Math.min(vals.length,dates.length);i++){
      let raw=vals[i],v=null;
      if(raw&&typeof raw==="object"&&valueKey)v=n(raw[valueKey]);
      else v=n(raw);
      if(v!==null)points.push({date:ym(dates[i]),value:v,raw});
    }
    return {code:String(row["지역코드"]||""),name:String(row["지역명"]||""),points};
  }).filter(x=>x.points.length);
}
function normalizePrice(payload){return normalizeWide(payload)}
function normalizeRatio(payload){return normalizeWide(payload)}
function normalizeBuyer(payload){
  const d=body(payload);if(!d||!Array.isArray(d["날짜리스트"])||!Array.isArray(d["데이터리스트"]))return [];
  const dates=d["날짜리스트"];
  return d["데이터리스트"].map(row=>{
    const vals=Array.isArray(row.dataList)?row.dataList:[];
    const points=[];
    for(let i=0;i<Math.min(vals.length,dates.length);i++){
      const raw=vals[i];
      const v=raw&&typeof raw==="object"?n(raw["매수우위지수"]):n(raw);
      if(v!==null)points.push({date:ym(dates[i]),value:v,raw});
    }
    return {code:String(row["지역코드"]||""),name:String(row["지역명"]||""),points};
  }).filter(x=>x.points.length);
}
function normalizeMovein(payload){
  const d=body(payload);if(!d)return {name:"",rows:[]};
  const rows=Array.isArray(d["차트데이터"])?d["차트데이터"]:[];
  return {name:String(d["지역명"]||""),rows:rows.map(x=>{
    let units=null;
    if(x&&x["합계"]&&typeof x["합계"]==="object")units=n(x["합계"]["세대수"]);
    if(units===null)units=n(x["합계.세대수"]);
    if(units===null)units=n(x["세대수"]);
    return {period:String(x["일정"]||x["기준년도"]||""),units};
  }).filter(x=>x.units!==null)};
}
function chooseCity(rows,prefix,needle){
  const c=rows.filter(r=>r.code.startsWith(prefix)||r.name.includes(needle));
  if(!c.length)return null;
  return c.slice().sort((a,b)=>{
    const ae=(a.name===needle||a.name===needle+"광역시"||a.name==="세종특별자치시")?0:1;
    const be=(b.name===needle||b.name===needle+"광역시"||b.name==="세종특별자치시")?0:1;
    if(ae!==be)return ae-be;
    return a.code.length-b.code.length;
  })[0];
}
function regionalRows(rows){
  return rows.filter(r=>r.code.startsWith("30")||r.code.startsWith("36")||r.name.includes("대전")||r.name.includes("세종"));
}
function returns(points){
  const out=[];for(let i=1;i<points.length;i++)out.push({date:points[i].date,value:points[i-1].value?points[i].value/points[i-1].value-1:null});
  return out;
}
function lookup(points){const m=new Map();for(const p of points)m.set(p.date,p.value);return m}
function metrics(points){
  if(!points||points.length<13)return null;
  const v=points.map(p=>p.value),last=v[v.length-1];
  const r=(k)=>v.length>k&&v[v.length-1-k]?last/v[v.length-1-k]-1:null;
  const hi=Math.max(...v.slice(-36));
  const rets=returns(points).slice(-12).map(x=>x.value);
  return {
    last, date:points[points.length-1].date,
    m3:r(3),m6:r(6),m12:r(12),m36:r(36),
    dd36:hi?last/hi-1:null,
    vol12:(stdev(rets)||0)*Math.sqrt(12),
    cagr:cagr(v[0],last,points.length-1),
    mdd:maxDrawdown(v)
  };
}
function score(m){
  if(!m)return 0;
  let s=50;
  if(Number.isFinite(m.m12))s+=Math.max(-18,Math.min(18,m.m12*180));
  if(Number.isFinite(m.m3))s+=Math.max(-12,Math.min(12,m.m3*240));
  if(Number.isFinite(m.dd36)){
    if(m.dd36<=-0.04&&m.dd36>=-0.18)s+=10;
    else if(m.dd36<-0.28)s-=10;
    else if(m.dd36>-0.01)s-=3;
  }
  if(Number.isFinite(m.vol12))s-=Math.max(0,(m.vol12-.06)*80);
  return Math.max(0,Math.min(100,s));
}
function phase(m){
  if(!m)return "데이터부족";
  if(m.m12>0.05&&m.m3>0.01)return "상승확산";
  if(m.m12>0&&m.m3>0)return "회복";
  if(m.m12<0&&m.m3>0)return "바닥탐색";
  if(m.m12<0&&m.m3<0)return "하락";
  return "중립";
}
function episodes(points){
  const out=[];let cur=null;
  for(let i=12;i<points.length;i++){
    const r=points[i].value/points[i-12].value-1;
    const state=r>0.05?"상승":r<-0.03?"하락":"정체";
    if(!cur||cur.state!==state){
      if(cur)out.push(cur);
      cur={state,start:points[i].date,end:points[i].date,startValue:points[i].value,endValue:points[i].value,months:1};
    }else{cur.end=points[i].date;cur.endValue=points[i].value;cur.months++}
  }
  if(cur)out.push(cur);
  return out.map(e=>({...e,ret:e.startValue?e.endValue/e.startValue-1:null})).filter(e=>e.months>=3);
}
function backtest(points,opt={}){
  const fee=Number.isFinite(opt.oneWayCost)?opt.oneWayCost:0.015;
  const minHold=Number.isFinite(opt.minHold)?opt.minHold:12;
  if(!points||points.length<50)return null;
  let cash=100,units=0,hold=0,trades=[],equity=[];
  for(let i=37;i<points.length;i++){
    const px=points[i].value;
    const past=points.slice(0,i);
    const m=metrics(past);
    const buy=m&&m.m12>0&&m.m3>0&&m.dd36<=0&&m.dd36>=-0.20;
    const sell=m&&m.m12<0&&m.m3<0&&hold>=minHold;
    if(!units&&buy){
      cash*=1-fee;units=cash/px;cash=0;hold=0;
      trades.push({date:points[i].date,side:"BUY",price:px});
    }else if(units&&sell){
      cash=units*px*(1-fee);units=0;
      trades.push({date:points[i].date,side:"SELL",price:px});
    }
    if(units)hold++;
    equity.push({date:points[i].date,value:units?units*px:cash});
  }
  const lastPx=points[points.length-1].value;
  const final=units?units*lastPx*(1-fee):cash;
  const bhStart=points[37].value,bhFinal=bhStart?100*(lastPx/bhStart)*(1-fee*2):null;
  const eqVals=equity.map(x=>x.value);
  return {
    start:points[37].date,end:points[points.length-1].date,final,
    total:final/100-1,cagr:cagr(100,final,equity.length-1),mdd:maxDrawdown(eqVals),
    trades,holding:!!units,buyHold:bhFinal,buyHoldReturn:bhFinal?bhFinal/100-1:null,
    equity
  };
}
function forwardCorrelation(pricePoints,factorPoints,lead=12){
  const pm=lookup(pricePoints),fm=lookup(factorPoints),x=[],y=[];
  const dates=pricePoints.map(p=>p.date);
  for(let i=0;i+lead<dates.length;i++){
    const d=dates[i],f=fm.get(d),p0=pm.get(d),p1=pm.get(dates[i+lead]);
    if(Number.isFinite(f)&&Number.isFinite(p0)&&Number.isFinite(p1)&&p0){x.push(f);y.push(p1/p0-1)}
  }
  return {corr:corr(x,y),n:x.length};
}
function ranking(rows){
  return regionalRows(rows).map(r=>({code:r.code,name:r.name,metrics:metrics(r.points),points:r.points}))
    .filter(x=>x.metrics).map(x=>({...x,score:score(x.metrics),phase:phase(x.metrics)}))
    .sort((a,b)=>b.score-a.score);
}
async function load(){
  const errors=[];
  const [pr,ra,bu,mvD,mvS]=await Promise.allSettled([
    dataset("price"),dataset("ratio"),dataset("buyer"),dataset("movein","30"),dataset("movein","36")
  ]);
  const get=(x,label,normalizer)=>{
    if(x.status==="fulfilled"){try{return {rows:normalizer(x.value.payload),via:x.value.via}}catch(e){errors.push(label+": "+e.message);return {rows:[],via:""}}}
    errors.push(label+": "+String(x.reason&&x.reason.message||x.reason));return {rows:[],via:""};
  };
  const price=get(pr,"가격지수",normalizePrice);
  const ratio=get(ra,"전세가율",normalizeRatio);
  const buyer=get(bu,"매수우위",normalizeBuyer);
  const moveD=mvD.status==="fulfilled"?normalizeMovein(mvD.value.payload):{name:"",rows:[]};
  const moveS=mvS.status==="fulfilled"?normalizeMovein(mvS.value.payload):{name:"",rows:[]};
  if(mvD.status!=="fulfilled")errors.push("대전 입주물량: "+String(mvD.reason&&mvD.reason.message||mvD.reason));
  if(mvS.status!=="fulfilled")errors.push("세종 입주물량: "+String(mvS.reason&&mvS.reason.message||mvS.reason));

  const daejeon=chooseCity(price.rows,"30","대전");
  const sejong=chooseCity(price.rows,"36","세종");
  const ratioD=chooseCity(ratio.rows,"30","대전"),ratioS=chooseCity(ratio.rows,"36","세종");
  const buyerD=chooseCity(buyer.rows,"30","대전"),buyerS=chooseCity(buyer.rows,"36","세종");

  const associations=[];
  for(const [city,p,r,b] of [["대전",daejeon,ratioD,buyerD],["세종",sejong,ratioS,buyerS]]){
    if(p&&r){const c=forwardCorrelation(p.points,r.points,12);associations.push({city,factor:"전세가율",...c})}
    if(p&&b){const c=forwardCorrelation(p.points,b.points,12);associations.push({city,factor:"매수우위지수",...c})}
  }

  return {
    priceRows:price.rows,daejeon,sejong,ratioD,ratioS,buyerD,buyerS,moveD,moveS,
    rank:ranking(price.rows),associations,errors,
    sourceVia:{price:price.via,ratio:ratio.via,buyer:buyer.via},
    links:SOURCE_LINKS
  };
}

window.REGPT={load,metrics,score,phase,episodes,backtest,forwardCorrelation,pct,SOURCE_LINKS};
})();