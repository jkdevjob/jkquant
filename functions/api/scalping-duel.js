import {DUEL_START,DUEL_TABS,COSTS,buildDuel,normalizeClaudeEvents,normalizeTrades} from "./_scalping_duel.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const REPO="jkdevjob/jkquant",BRANCH="scalping-data";
const RAW="https://raw.githubusercontent.com/"+REPO+"/"+BRANCH+"/data/";
const UA={"Accept":"application/vnd.github+json","User-Agent":"jkquant-scalping-duel/1.0"};
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
async function text(path){
  const r=await fetch(RAW+path+"?t="+Date.now(),{headers:{"User-Agent":"jkquant-scalping-duel/1.0"}});
  if(r.status===404)return ""; if(!r.ok)throw new Error(path+" HTTP "+r.status); return r.text();
}
async function rawJson(path){const s=await text(path);return s?JSON.parse(s):null;}
function csv(src){
  if(!src.trim())return [];
  const rows=[];let row=[],v="",q=false;
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(q){if(ch==='"'&&src[i+1]==='"'){v+='"';i++;}else if(ch==='"')q=false;else v+=ch;}
    else if(ch==='"')q=true;
    else if(ch===","){row.push(v);v="";}
    else if(ch==="\n"){row.push(v.replace(/\r$/,""));rows.push(row);row=[];v="";}
    else v+=ch;
  }
  if(v.length||row.length){row.push(v.replace(/\r$/,""));rows.push(row);}
  const h=rows.shift()||[];
  return rows.filter(r=>r.some(x=>x!=="")).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function tree(){
  const b=await fetch("https://api.github.com/repos/"+REPO+"/branches/"+BRANCH,{headers:UA});
  if(!b.ok)throw new Error("branch tree HTTP "+b.status);
  const bj=await b.json(),sha=bj&&bj.commit&&bj.commit.sha;
  const r=await fetch("https://api.github.com/repos/"+REPO+"/git/trees/"+sha+"?recursive=1",{headers:UA});
  if(!r.ok)throw new Error("git tree HTTP "+r.status);
  const j=await r.json();return (j.tree||[]).map(x=>x.path);
}
function gptTrades(rows){
  const m=new Map();
  for(const r of rows){
    const d=String(r.date||"");if(!d)continue;
    const t=normalizeTrades([{name:r.name||r.code,code:r.code,entryPrice:r.entryPrice,exitPrice:r.exitPrice,reason:r.reason}]);
    if(t.length){if(!m.has(d))m.set(d,[]);m.get(d).push(t[0]);}
  }
  return m;
}
function datesFromCsv(rows){return new Set(rows.map(r=>String(r.date||"")).filter(Boolean));}
export function closingComparison(claudeFiles,report){
  const cr=new Map();
  for(const file of claudeFiles)for(const e of file?.ledger?.events||[]){
    if(e.id!=='close:close30'||e.payload?.status!=='closed')continue;
    const p=e.payload;cr.set(p.date||file.date,{trades:normalizeTrades(p.trades)});
  }
  const sessions=report?.operationalSessions||[],gc=new Set(sessions.map(x=>x.date)),gb=new Map(sessions.map(x=>[x.date,normalizeTrades(x.trades).map(t=>({...t,slot:1/3}))]));
  return buildDuel({claudeRecords:{closing30:cr},gptTrades:{closing30:gb},gptCoverage:{closing30:gc},
    compareTabs:['closing30'],aggregateTabs:['closing30'],costTable:{gpt:{closing30:.25},claude:{closing30:.15}}}).tabs.closing30;
}
async function loadReport(){
  const paths=await tree();
  const claudePaths=paths.filter(p=>/^data\/claude-live\/20\d\d-\d\d-\d\d\.json$/.test(p)&&p.slice(-15,-5)>=DUEL_START);
  const claudeFiles=[];
  for(const p of claudePaths){const j=await rawJson(p.slice(5));if(j)claudeFiles.push(j);}
  const claudeRecords=normalizeClaudeEvents(claudeFiles);

  const [opCsv,dayCsv,crCsv,sxCsv,crDec,sxDec]=await Promise.all([
    text("opening-history/baseline-trades.csv"),text("daytrading-research/baseline-trades.csv"),
    text("crypto-research/baseline-trades.csv"),text("soxl-research/baseline-trades.csv"),
    text("crypto-research/baseline-decisions.csv"),text("soxl-research/baseline-decisions.csv")
  ]);
  const gptTradesBy={
    opening:gptTrades(csv(opCsv)),daytrading:gptTrades(csv(dayCsv)),
    crypto:gptTrades(csv(crCsv)),soxl:gptTrades(csv(sxCsv))
  };
  const openingCoverage=new Set(paths.filter(p=>/^data\/opening-history\/20\d\d-\d\d-\d\d\.json$/.test(p)).map(p=>p.slice(-15,-5)));
  const dayCoverage=new Set(paths.filter(p=>/^data\/daytrading-research\/20\d\d-\d\d-\d\d\.json$/.test(p)).map(p=>p.slice(-15,-5)));
  const gptCoverage={opening:openingCoverage,daytrading:dayCoverage,crypto:datesFromCsv(csv(crDec)),soxl:datesFromCsv(csv(sxDec))};
  const report=buildDuel({claudeRecords,gptTrades:gptTradesBy,gptCoverage,start:DUEL_START});
  try{report.tabs.closing30=closingComparison(claudeFiles,await rawJson('nightly-research/closing30.json'));}
  catch(e){report.tabs.closing30={days:[],pending:[],sourceWarning:String(e.message||e)};}
  return {...report,closingComparisonRule:'종가 30분은 독립 비교 · 기존 4탭 25% 합계 유지 · 같은 날짜 완료 원본만',generatedAt:new Date().toISOString(),sources:{
    gpt:"scalping-data baseline live/paper archives",claude:"scalping-data data/claude-live close:* ledgers"
  }};
}
function p(v){return v==null||!Number.isFinite(Number(v))?"—":(Number(v)>=0?"+":"")+Number(v).toFixed(2)+"%";}
function winKo(w){return w==="gpt"?"GPT 승":w==="claude"?"클로드 승":"무";}
function lastOf(a){return a&&a.length?a[a.length-1]:null;}
function message(date,d){
  const total=d.total||{},last=(total.days||[]).find(x=>x.date===date)||lastOf(total.days||[]);
  const rec=total.record||{},L=["🆚 [GPT vs 클로드] "+date+" 대결"];
  if(!last){L.push("아직 같은 날 기록 없음 — 10/5부터 비교");return L.join("\n");}
  L.push("합계(4탭 25%씩) "+last.date+": GPT "+p(last.gptPct)+" vs 클로드 "+p(last.claudePct)+" → "+winKo(last.winner));
  L.push("누적 GPT "+p((total.gpt||{}).totalPct)+" vs 클로드 "+p((total.claude||{}).totalPct)+" · GPT 기준 "+(rec.gpt||0)+"승 "+(rec.claude||0)+"패 "+(rec.draw||0)+"무");
  const nm={opening:"① 시초가",daytrading:"② 데이트레이딩",crypto:"③ 비트코인",soxl:"④ SOXL"};
  for(const k of DUEL_TABS){
    const t=d.tabs[k]||{},r=(t.days||[]).find(x=>x.date===date)||lastOf(t.days||[]);
    L.push(nm[k]+": "+(r?(r.date.slice(5)+" GPT "+p(r.gpt.pnlPct)+" vs 클로드 "+p(r.claude.pnlPct)+" "+winKo(r.winner)):"기록 대기")+" · 누적 GPT "+p((t.gpt||{}).totalPct)+" vs 클로드 "+p((t.claude||{}).totalPct));
  }
  L.push("실시간 모의매매 기록끼리 · 시작 2026-10-05 · 같은 비용표");
  L.push("자세히: jkquant.pages.dev/scalping → 🆚 클로드 대결");
  return L.join("\n");
}
export async function onRequestGet(){
  try{return json({ok:true,report:await loadReport()});}catch(e){return json({ok:false,error:String(e.message||e)},502);}
}
export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  try{
    const b=await request.json(),date=String(b.date||"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<DUEL_START)return json({ok:true,pending:true,reason:"before_start"});
    const report=await loadReport();
    const row=(report.total.days||[]).find(x=>x.date===date);
    if(!row)return json({ok:true,pending:true,reason:"same_day_record_wait",date});
    // 사용자 요청(2026-10-13): 텔레그램은 실제 매수 · 매도 때만 — 대결 요약은 보내지 않는다(화면 GET 보고서는 그대로).
    return json({ok:true,date,skipped:"buy_sell_only"});
  }catch(e){return json({ok:false,error:String(e.message||e)},500);}
}
export {loadReport,message,csv};
