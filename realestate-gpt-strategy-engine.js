(function(){
"use strict";
const API="/api/realestate-gpt-history";
const LAWDS={
  daejeon:["30110","30140","30170","30200","30230"],
  sejong:["36110"]
};
const LAWD_NAME={
  "30110":"대전 동구","30140":"대전 중구","30170":"대전 서구",
  "30200":"대전 유성구","30230":"대전 대덕구","36110":"세종"
};
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function median(a){const b=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function ymFromDate(d){return String(d||"").slice(0,7)}
function ymAdd(ym,k){
  const [y,m]=ym.split("-").map(Number),d=new Date(Date.UTC(y,m-1+k,1));
  return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
}
function ymDiff(a,b){
  const [ay,am]=a.split("-").map(Number),[by,bm]=b.split("-").map(Number);
  return (by-ay)*12+(bm-am);
}
function monthEnd(ym){const [y,m]=ym.split("-").map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)}
function monthList(startYear,endYear){
  const out=[];for(let y=startYear;y<=endYear;y++)for(let m=1;m<=12;m++)out.push(y+"-"+String(m).padStart(2,"0"));return out
}
function areaBand(a){
  a=Number(a);if(a>=56&&a<63)return 59;if(a>=71&&a<78)return 74;if(a>=80&&a<90)return 84;
  if(a>=97&&a<107)return 101;if(a>=110&&a<120)return 114;return Math.round(a);
}
function cityOfLawd(lawd){return lawd==="36110"?"세종":"대전"}
function cleanTrade(t){
  const area=n(t.area),price=n(t.price);
  if(!t||!t.apt||!area||!price||!t.date)return null;
  return {...t,area,price,city:cityOfLawd(String(t.lawd||t.sggCd||"")),areaBand:areaBand(area),ym:ymFromDate(t.date)}
}
async function jfetch(url){
  const r=await fetch(url,{cache:"no-store"}),j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));return j
}
async function status(){return jfetch(API+"?kind=status")}
async function loadHistory(startYear,endYear,onProgress){
  startYear=Math.max(2006,Number(startYear)||2016);
  endYear=Math.min(new Date().getFullYear(),Number(endYear)||new Date().getFullYear());
  const groups=[["30110","30140","30170"],["30200","30230","36110"]];
  const total=(endYear-startYear+1)*groups.length;let done=0,trades=[];
  for(let y=startYear;y<=endYear;y++){
    for(const lawds of groups){
      const q=new URLSearchParams({kind:"year",year:String(y),lawds:lawds.join(",")});
      const j=await jfetch(API+"?"+q.toString());
      trades.push(...(j.trades||[]).map(cleanTrade).filter(Boolean));
      done++;if(onProgress)onProgress({done,total,year:y,lawds,count:trades.length});
    }
  }
  trades.sort((a,b)=>a.date.localeCompare(b.date)||a.apt.localeCompare(b.apt));
  return trades
}
function groupTrades(trades){
  const map=new Map();
  for(const t of trades){
    const key=[t.lawd,t.umd||"",t.apt,t.areaBand].join("|");
    let g=map.get(key);
    if(!g){g={key,lawd:t.lawd,region:LAWD_NAME[t.lawd]||t.city,city:t.city,umd:t.umd||"",apt:t.apt,areaBand:t.areaBand,trades:[]};map.set(key,g)}
    g.trades.push(t);
  }
  for(const g of map.values()){
    g.trades.sort((a,b)=>a.date.localeCompare(b.date));
    const mm=new Map();
    for(const t of g.trades){let a=mm.get(t.ym);if(!a){a=[];mm.set(t.ym,a)}a.push(t.price)}
    g.monthly=[...mm.entries()].map(([ym,prices])=>({ym,price:median(prices),n:prices.length})).sort((a,b)=>a.ym.localeCompare(b.ym));
  }
  return [...map.values()]
}
function lastLE(a,ym){
  let z=null;for(const x of a){if(x.ym<=ym)z=x;else break}return z
}
function candidateStats(g,ym){
  const end=monthEnd(ym),start12=ymAdd(ym,-11),start24=ymAdd(ym,-23);
  const pastTrades=g.trades.filter(t=>t.date<=end);
  if(!pastTrades.length)return null;
  const latest=lastLE(g.monthly,ym);if(!latest)return null;
  const recency=ymDiff(latest.ym,ym);if(recency>2)return null;
  const count12=pastTrades.filter(t=>t.ym>=start12).length;
  if(count12<4)return null;
  const old6=lastLE(g.monthly,ymAdd(ym,-6)),old12=lastLE(g.monthly,ymAdd(ym,-12));
  const mom6=old6&&old6.price?latest.price/old6.price-1:null;
  const mom12=old12&&old12.price?latest.price/old12.price-1:null;
  const p24=g.monthly.filter(x=>x.ym>=start24&&x.ym<=ym).map(x=>x.price);
  const hi24=p24.length?Math.max(...p24):null,dd24=hi24?latest.price/hi24-1:null;
  let score=Math.min(30,count12*2.5);
  if(Number.isFinite(mom6))score+=clamp(mom6*100,-10,20);
  if(Number.isFinite(mom12))score+=clamp(mom12*50,-8,15);
  if(Number.isFinite(dd24)&&dd24<=0&&dd24>=-.15)score+=10;
  if(g.areaBand===84)score+=5;
  return {count12,latestPrice:latest.price,latestYm:latest.ym,mom6,mom12,dd24,score}
}
function marketRow(data,city){return city==="대전"?data&&data.daejeon:data&&data.sejong}
function marketAt(row,ym){
  if(!row||!Array.isArray(row.points))return null;
  const p=row.points.filter(x=>x.date<=ym);if(p.length<13)return null;
  const v=p.map(x=>x.value),last=v[v.length-1];
  const r=k=>v.length>k&&v[v.length-1-k]?last/v[v.length-1-k]-1:null;
  const hi=Math.max(...v.slice(-36));
  return {date:p[p.length-1].date,last,m3:r(3),m12:r(12),dd36:hi?last/hi-1:null}
}
function buyMarket(m){return !!(m&&m.m12>0&&m.m3>0&&m.dd36<=0&&m.dd36>=-.20)}
function sellMarket(m){return !!(m&&m.m12<0&&m.m3<0)}
function firstTradeAfter(g,date,maxDays=120){
  const t0=Date.parse(date+"T00:00:00Z"),max=t0+maxDays*86400000;
  return g.trades.find(t=>{const x=Date.parse(t.date+"T00:00:00Z");return x>t0&&x<=max})||null
}
function latestTradeBefore(g,date){
  let z=null;for(const t of g.trades){if(t.date<=date)z=t;else break}return z
}
function eventsAt(events,date,city){
  const when=Date.parse(date+"T00:00:00Z"),near=[];
  let latestRate=null;
  for(const e of events||[]){
    const t=Date.parse(e.date+"T00:00:00Z");if(!Number.isFinite(t)||t>when)continue;
    if(e.type==="금리"&&(!latestRate||e.date>latestRate.date))latestRate=e;
    if((e.region===city||e.region==="전국")&&when-t<=365*86400000)near.push(e);
  }
  near.sort((a,b)=>b.date.localeCompare(a.date));
  const out=near.filter(e=>e.type!=="금리").slice(0,2);
  if(latestRate)out.push(latestRate);
  return out
}
function eventText(es){return es&&es.length?es.map(e=>e.date+" "+e.title).join(" · "):"연결된 공식 이벤트 없음"}
function reasonBuy(city,m,s){
  const p=x=>Number.isFinite(x)?(x*100).toFixed(1)+"%":"-";
  return city+" 시장 3M "+p(m&&m.m3)+", 12M "+p(m&&m.m12)+", 36M 고점대비 "+p(m&&m.dd36)+
    "; 단지 최근12개월 거래 "+s.count12+"건, 6M "+p(s.mom6)+", 12M "+p(s.mom12)
}
function reasonSell(city,m,s,localStop){
  const p=x=>Number.isFinite(x)?(x*100).toFixed(1)+"%":"-";
  return localStop?
    "단지 6M 가격모멘텀 "+p(s&&s.mom6)+"로 약화":
    city+" 시장 3M "+p(m&&m.m3)+", 12M "+p(m&&m.m12)+"로 동반 약세"
}
function run(trades,marketData,events,opt={}){
  const startYear=Number(opt.startYear)||2016,endYear=Number(opt.endYear)||new Date().getFullYear();
  const minHold=Number.isFinite(+opt.minHold)?+opt.minHold:12;
  const buyCost=Number.isFinite(+opt.buyCost)?+opt.buyCost:.015,sellCost=Number.isFinite(+opt.sellCost)?+opt.sellCost:.01;
  const groups=groupTrades(trades),months=monthList(startYear,endYear);
  let holding=null;const closed=[];const prevBuy={대전:false,세종:false};const signals=[];
  for(const ym of months){
    if(holding){
      const m=marketAt(marketRow(marketData,holding.group.city),ym);
      const s=candidateStats(holding.group,ym);
      const holdMonths=ymDiff(holding.buyTrade.ym,ym);
      const localStop=!!(s&&Number.isFinite(s.mom6)&&s.mom6<-.08);
      const exit=holdMonths>=minHold&&(sellMarket(m)||localStop);
      if(exit){
        const signalDate=monthEnd(ym),sell=firstTradeAfter(holding.group,signalDate,180);
        if(sell){
          const gross=sell.price/holding.buyTrade.price-1;
          const net=sell.price*(1-sellCost)/(holding.buyTrade.price*(1+buyCost))-1;
          const es=eventsAt(events,signalDate,holding.group.city);
          closed.push({
            apartment:holding.group.apt,region:holding.group.region,city:holding.group.city,umd:holding.group.umd,
            area:holding.group.areaBand,buySignalDate:holding.signalDate,buyDate:holding.buyTrade.date,
            buyPrice:holding.buyTrade.price,buyFloor:holding.buyTrade.floor,buyReason:holding.buyReason,
            buyEvents:holding.buyEvents,buyEvent:eventText(holding.buyEvents),
            sellSignalDate:signalDate,sellDate:sell.date,sellPrice:sell.price,sellFloor:sell.floor,
            sellReason:reasonSell(holding.group.city,m,s,localStop),sellEvents:es,sellEvent:eventText(es),
            grossReturn:gross,netReturn:net,holdMonths:ymDiff(holding.buyTrade.ym,sell.ym),
            buyCost,sellCost,selectionScore:holding.selectionScore
          });
          signals.push({date:signalDate,side:"SELL",apt:holding.group.apt,reason:closed[closed.length-1].sellReason});
          holding=null;
        }
      }
    }
    if(!holding){
      const candidates=[];
      for(const city of ["대전","세종"]){
        const m=marketAt(marketRow(marketData,city),ym),on=buyMarket(m),trigger=on&&!prevBuy[city];
        if(trigger){
          for(const g of groups){
            if(g.city!==city)continue;
            const s=candidateStats(g,ym);if(!s)continue;
            candidates.push({g,s,m,city});
          }
        }
      }
      candidates.sort((a,b)=>b.s.score-a.s.score);
      for(const c of candidates){
        const signalDate=monthEnd(ym),buy=firstTradeAfter(c.g,signalDate,120);
        if(!buy)continue;
        const es=eventsAt(events,signalDate,c.city);
        holding={
          group:c.g,signalDate,buyTrade:buy,selectionScore:c.s.score,
          buyReason:reasonBuy(c.city,c.m,c.s),buyEvents:es
        };
        signals.push({date:signalDate,side:"BUY",apt:c.g.apt,reason:holding.buyReason});
        break;
      }
    }
    for(const city of ["대전","세종"]){
      prevBuy[city]=buyMarket(marketAt(marketRow(marketData,city),ym));
    }
  }
  let open=null;
  if(holding){
    const lastDate=endYear+"-12-31",mark=latestTradeBefore(holding.group,lastDate)||holding.buyTrade;
    const gross=mark.price/holding.buyTrade.price-1;
    open={
      apartment:holding.group.apt,region:holding.group.region,city:holding.group.city,umd:holding.group.umd,
      area:holding.group.areaBand,buySignalDate:holding.signalDate,buyDate:holding.buyTrade.date,
      buyPrice:holding.buyTrade.price,buyFloor:holding.buyTrade.floor,buyReason:holding.buyReason,
      buyEvents:holding.buyEvents,buyEvent:eventText(holding.buyEvents),
      markDate:mark.date,markPrice:mark.price,grossReturn:gross,
      netIfSold:mark.price*(1-sellCost)/(holding.buyTrade.price*(1+buyCost))-1
    };
  }
  const rets=closed.map(x=>x.netReturn),wins=rets.filter(x=>x>0).length;
  const multiple=rets.reduce((a,r)=>a*(1+r),1);
  const first=closed[0]&&closed[0].buyDate,last=closed[closed.length-1]&&closed[closed.length-1].sellDate;
  const years=first&&last?Math.max(1,(Date.parse(last)-Date.parse(first))/(365.25*86400000)):null;
  return {
    closed,open,signals,tradeCount:closed.length,winRate:closed.length?wins/closed.length:null,
    avgReturn:closed.length?rets.reduce((a,b)=>a+b,0)/closed.length:null,
    cumulativeReturn:multiple-1,cagr:years?Math.pow(multiple,1/years)-1:null,
    sourceTradeCount:trades.length,groupCount:groups.length,
    assumptions:{minHold,buyCost,sellCost,execution:"신호월 종료 후 120일(매도 180일) 내 동일 단지·면적군 첫 실제 신고거래"}
  }
}
window.RESTRAT={status,loadHistory,run,groupTrades,candidateStats,marketAt,buyMarket,sellMarket,eventsAt,LAWDS,LAWD_NAME};
})();