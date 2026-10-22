// Owner-only all-tab history. Reads evidence; never submits orders or changes rules.
import {ownerAuthorized} from './global-paper.js';
import {historyFetch,parseCsv} from './scalping-history.js';
import {TRADE_STRATEGIES,variantValid,record,paperRecords,openingRecords,closingRecords,tenbaggerRecords,uniqueRecords,filterRecords,recordsCsv} from './_trade-history.js';
const RAW='https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/';
const WORKERS={opening:'https://jkquant-opening-scheduler.mumae4.workers.dev',daytrading:'https://jkquant-daytrading-scheduler.mumae4.workers.dev',global:'https://jkquant-global-intraday-scheduler.mumae4.workers.dev'};
const paths={opening:'opening-history',daytrading:'daytrading-research',crypto:'crypto-research',soxl:'soxl-research'};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers});
const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
async function source(url,init={}){const r=await historyFetch(url,init,12000);if(!r.ok)throw Error('source HTTP '+r.status);return r;}
export async function onRequestGet({request,env}){
  if(!await ownerAuthorized(request,env))return json({ok:false,error:'unauthorized'},401);
  const q=new URL(request.url).searchParams;
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),from=q.get('from')||new Date(Date.now()-30*86400000).toISOString().slice(0,10),to=q.get('to')||today;
  const strategy=q.get('strategy')||'all',variant=q.get('variant')||'all';
  if(!dateValid(from)||!dateValid(to)||from>to||to>today)return json({ok:false,error:'올바른 조회 기간을 지정해 주세요.'},400);
  if(!(strategy==='all'||TRADE_STRATEGIES[strategy])||!variantValid(variant)||!['all','pending','signal','open','closed','unverified'].includes(q.get('status')||'all')||!['all','paper','research','forward'].includes(q.get('origin')||'all'))return json({ok:false,error:'invalid filter'},400);
  q.set('from',from);q.set('to',to);
  const key=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'').trim();
  const workerHeaders={'x-monitor-key':key,accept:'application/json'},tasks=[];
  const add=(label,fn)=>tasks.push({label,run:fn()});
  const includes=s=>strategy==='all'||strategy===s;
  for(const [s,path] of Object.entries(paths))if(includes(s)){
    add(s+' 연구 원장',async()=>{
      const r=await source(RAW+path+'/variant-trades.csv',{headers:{accept:'text/csv'}});
      return parseCsv(await r.text()).map(x=>record(s,x,x.variant||'baseline','research-reconstructed'));
    });
    if(s!=='opening')add(s+' 서버 장부',async()=>{
      if(!key)throw Error('monitor key missing');
      const base=String(s==='daytrading'?(env.DAYTRADING_WORKER_URL||WORKERS.daytrading):(env.GLOBAL_INTRADAY_WORKER_URL||WORKERS.global)).replace(/\/$/,'');
      const p=new URLSearchParams({from,to,limit:'3650'});if(s!=='daytrading')p.set('strategy',s);
      const j=await (await source(base+'/paper-history?'+p,{headers:workerHeaders})).json();
      if(!j.ok)throw Error(j.error||'paper history unavailable');
      return {rows:(j.ledgers||[]).flatMap(l=>paperRecords(s,l)),warnings:j.sourceWarnings||[]};
    });
  }
  const eventKinds=[];if(includes('opening'))eventKinds.push('opening');if(includes('closing30')||includes('closing_bet'))eventKinds.push('closing30');
  for(const kind of eventKinds){
    add(kind+' 보관 원본',async()=>{
      const r=await historyFetch(RAW+'trade-history/'+kind+'.json',{},12000);
      if(r.status===404)return [];if(!r.ok)throw Error('archive HTTP '+r.status);
      const j=await r.json();return (j.ledgers||[]).flatMap(kind==='opening'?openingRecords:closingRecords);
    });
    add(kind+' 서버 원본',async()=>{
      if(!key)throw Error('monitor key missing');
      const base=String(env.OPENING_WORKER_URL||WORKERS.opening).replace(/\/$/,'');
      const p=new URLSearchParams({kind,from,to,limit:'3650'});
      const j=await (await source(base+'/event-history?'+p,{headers:workerHeaders})).json();
      if(!j.ok)throw Error(j.error||'event history unavailable');
      return {rows:(j.ledgers||[]).flatMap(kind==='opening'?openingRecords:closingRecords),warnings:j.sourceWarnings||[]};
    });
  }
  if(includes('tenbagger'))add('텐배거 순방향 기록',async()=>tenbaggerRecords(await (await source(RAW+'tenbagger-forward/latest.json')).json()));
  const results=await Promise.allSettled(tasks.map(x=>x.run)),warnings=[],all=[];
  results.forEach((r,i)=>{if(r.status==='fulfilled'){all.push(...(Array.isArray(r.value)?r.value:r.value.rows));if(r.value.warnings?.length)warnings.push(...r.value.warnings.map(w=>tasks[i].label+': '+w));}else warnings.push(tasks[i].label+': '+String(r.reason?.message||r.reason));});
  const unique=uniqueRecords(all),rows=filterRecords(unique,q);
  if(q.get('format')==='csv'){
    // Never silently export an incomplete collection as a complete file.
    if(warnings.length)return json({ok:false,error:'일부 원본 조회에 실패했습니다. 다시 조회한 뒤 내보내세요.',sourceWarnings:warnings},502);
    return new Response(recordsCsv(rows),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="jkquant-trades-'+from+'_'+to+'.csv"'}});
  }
  const page=Math.max(1,Math.floor(+q.get('page')||1)),pageSize=Math.max(1,Math.min(200,Math.floor(+q.get('pageSize')||50)));
  const closed=rows.filter(x=>x.status==='closed'&&Number.isFinite(x.pnl)),variants=[...new Set(unique.map(x=>x.variant))].sort();
  return json({ok:true,status:warnings.length?'degraded':unique.length?'ok':'collecting',from,to,strategy,variant,
    sourceWarnings:warnings,strategies:TRADE_STRATEGIES,variants,total:rows.length,page,pageSize,pages:Math.ceil(rows.length/pageSize),
    trades:rows.slice((page-1)*pageSize,page*pageSize),summary:{records:rows.length,closed:closed.length,
      open:rows.filter(x=>x.status==='open').length,unverified:rows.filter(x=>['signal','pending','unverified'].includes(x.status)).length},
    sourceRule:'원본 모의·순방향 연구·사후 연구 재구성을 구분합니다. 서로 다른 전략/그림자의 수익률을 계좌수익률로 합산하지 않습니다.'});
}
