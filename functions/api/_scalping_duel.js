// GPT 단타 ↔ 클로드 단타 대결 공용 계산기.
// 실시간으로 남은 장부만 입력으로 받고, 백테스트/사후 재구성 값은 이 모듈이 만들지 않는다.
export const DUEL_START="2026-10-05";
export const DUEL_TABS=["opening","daytrading","crypto","soxl"];
export const COSTS={
  gpt:{opening:0.25,daytrading:0.25,crypto:0.14,soxl:0.20},
  claude:{opening:0.25,daytrading:0.15,crypto:0.14,soxl:0.20}
};
export const TOTAL_WEIGHT=0.25;
export const WIN_EDGE_PCT=0.01;

export function grossPct(entry,exit){
  const e=Number(entry),x=Number(exit);
  return e>0&&x>0?(x/e-1)*100:null;
}
export function normalizeTrades(trades,{cryptoHalf=false}={}){
  const out=[];
  for(const t of Array.isArray(trades)?trades:[]){
    const gross=grossPct(t&&t.entryPrice,t&&t.exitPrice);
    if(gross==null)continue;
    out.push({
      name:String(t.name||t.code||""),
      entry:Number(t.entryPrice),exit:Number(t.exitPrice),
      reason:String(t.reason||t.exitReason||""),
      gross,
      slot:cryptoHalf?0.5:null
    });
  }
  return out;
}
export function normalizeClaudeEvents(files){
  const out=Object.fromEntries(DUEL_TABS.map(t=>[t,new Map()]));
  for(const file of Array.isArray(files)?files:[]){
    const fallback=String(file&&file.date||"");
    const events=(((file||{}).ledger||{}).events)||[];
    for(const e of events){
      const id=String(e&&e.id||"");
      const tab=id.startsWith("close:")?id.slice(6):"";
      if(!DUEL_TABS.includes(tab)||!e.payload)continue;
      const p=e.payload,date=String(p.date||fallback);
      if(p.status!=="closed"||date<DUEL_START)continue; // holiday/open/pending 제외
      out[tab].set(date,{
        date,status:"closed",
        trades:normalizeTrades(p.trades,{cryptoHalf:tab==="crypto"})
      });
    }
  }
  return out;
}
export function sideDay(trades,cost){
  const a=Array.isArray(trades)?trades:[];
  if(!a.length)return 0;
  const net=a.map(t=>({v:Number(t.gross)-Number(cost),slot:t.slot}));
  if(net.every(x=>x.slot!=null&&Number.isFinite(Number(x.slot))))return net.reduce((s,x)=>s+x.v*Number(x.slot),0);
  return net.reduce((s,x)=>s+x.v,0)/net.length;
}
export function winner(gpt,claude){
  const d=Number(gpt)-Number(claude);
  return d>WIN_EDGE_PCT?"gpt":d<-WIN_EDGE_PCT?"claude":"draw";
}
export function metrics(daily){
  const rows=(Array.isArray(daily)?daily:[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  let eq=1,peak=1,mdd=0,plus1=0,worst=null;
  for(const r of rows){
    const v=Number(r.pnlPct)||0;
    eq*=1+v/100; peak=Math.max(peak,eq); mdd=Math.min(mdd,eq/peak-1);
    if(v>=1)plus1++; worst=worst==null?v:Math.min(worst,v);
  }
  return {totalPct:(eq-1)*100,plus1Days:plus1,worstDayPct:worst,mddPct:mdd*100};
}
function tradeStats(days,by,cost){
  const trades=[];
  for(const d of days)for(const t of (by.get(d)||[]))trades.push(t);
  const nets=trades.map(t=>Number(t.gross)-Number(cost));
  const wins=nets.filter(v=>v>0).length;
  const daily=days.map(date=>({date,pnlPct:sideDay(by.get(date)||[],cost)}));
  return {...metrics(daily),trades:trades.length,wins,losses:nets.length-wins,winRate:nets.length?wins/nets.length*100:null};
}
export function buildDuel({claudeRecords,gptTrades,gptCoverage,start=DUEL_START}){
  const tabs={};
  for(const tab of DUEL_TABS){
    const cr=claudeRecords[tab]||new Map();
    const cb=new Map([...cr.entries()].filter(([d])=>d>=start).map(([d,r])=>[d,r.trades||[]]));
    const gb=gptTrades[tab]||new Map();
    const gc=new Set([...(gptCoverage[tab]||[])].filter(d=>d>=start));
    for(const d of gb.keys())if(d>=start)gc.add(d);
    const cs=new Set(cb.keys());
    const days=[...cs].filter(d=>gc.has(d)).sort();
    const pending=[...new Set([...cs,...gc])].filter(d=>!days.includes(d)).sort().map(date=>({date,missing:cs.has(date)?"GPT":"클로드"}));
    let cg=1,cc=1,gw=0,cw=0,draw=0;
    const rows=days.map(date=>{
      const gp=sideDay(gb.get(date)||[],COSTS.gpt[tab]);
      const cp=sideDay(cb.get(date)||[],COSTS.claude[tab]);
      cg*=1+gp/100; cc*=1+cp/100;
      const w=winner(gp,cp); if(w==="gpt")gw++; else if(w==="claude")cw++; else draw++;
      return {
        date,winner:w,cumGptPct:(cg-1)*100,cumClaudePct:(cc-1)*100,
        gpt:{pnlPct:gp,entries:(gb.get(date)||[]).length},
        claude:{pnlPct:cp,entries:(cb.get(date)||[]).length}
      };
    });
    tabs[tab]={
      days:rows,pending:pending.slice(-20),
      record:{gpt:gw,claude:cw,draw},
      gpt:tradeStats(days,gb,COSTS.gpt[tab]),
      claude:tradeStats(days,cb,COSTS.claude[tab]),
      costPct:{gpt:COSTS.gpt[tab],claude:COSTS.claude[tab]}
    };
  }

  const dates=[...new Set(DUEL_TABS.flatMap(t=>tabs[t].days.map(r=>r.date)))].sort();
  const maps=Object.fromEntries(DUEL_TABS.map(t=>[t,new Map(tabs[t].days.map(r=>[r.date,r]))]));
  let eg=1,ec=1,gw=0,cw=0,draw=0;
  const totalDays=dates.map(date=>{
    let gp=0,cp=0;
    for(const tab of DUEL_TABS){
      const r=maps[tab].get(date);
      if(r){gp+=TOTAL_WEIGHT*r.gpt.pnlPct;cp+=TOTAL_WEIGHT*r.claude.pnlPct;}
    }
    eg*=1+gp/100;ec*=1+cp/100;
    const w=winner(gp,cp);if(w==="gpt")gw++;else if(w==="claude")cw++;else draw++;
    return {date,gptPct:gp,claudePct:cp,winner:w,cumGptPct:(eg-1)*100,cumClaudePct:(ec-1)*100};
  });
  const gm=metrics(totalDays.map(r=>({date:r.date,pnlPct:r.gptPct})));
  const cm=metrics(totalDays.map(r=>({date:r.date,pnlPct:r.claudePct})));
  return {
    start,rulesVersion:1,
    costs:COSTS,totalWeight:TOTAL_WEIGHT,winEdgePct:WIN_EDGE_PCT,
    tabs,
    total:{days:totalDays,record:{gpt:gw,claude:cw,draw},gpt:gm,claude:cm},
    latest:dates.length?dates[dates.length-1]:null
  };
}
