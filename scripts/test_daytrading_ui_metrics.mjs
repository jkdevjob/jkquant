#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const src=fs.readFileSync(path.join(__dirname,'..','scalping.html'),'utf8');

function extractFn(text,marker){
  const i=text.indexOf(marker);
  if(i<0)throw new Error('missing '+marker);
  let j=text.indexOf('{',i),d=0,k=j;
  for(;k<text.length;k++){
    if(text[k]==='{')d++;
    else if(text[k]==='}'){d--;if(!d)break;}
  }
  return text.slice(i,k+1);
}
function build(fnText){
  return new Function(fnText+'\nreturn dayTradingTodayMetrics;')();
}
function near(a,b){return Math.abs(a-b)<1e-12;}
function probe(fnText){
  try{
    const fn=build(fnText);
    const trades=[{pnl:-1.25},{pnl:1.75},{pnl:1.75}];
    const m=fn({daily:[{date:'2026-10-01',returnPct:0.75}]},trades,'2026-10-01');
    const fallback=fn({daily:[]},trades,'2026-10-01');
    return m.trades===3&&near(m.accountReturnPct,0.75)&&near(m.tradeSumPct,2.25)&&near(fallback.accountReturnPct,0.75);
  }catch(e){return false;}
}

const fnText=extractFn(src,'function dayTradingTodayMetrics(');
if(!probe(fnText)){
  console.error('✗ production daytrading today metrics failed');
  process.exit(1);
}
for(const label of ['오늘 계좌수익률','개별 매매 수익률 합계','계좌수익률 아님']){
  if(!src.includes(label)){console.error('✗ UI label missing: '+label);process.exit(1);}
}

const muts=[
  ['account return must use daily portfolio return',x=>x.replace('? Number(day.returnPct)', '? tradeSumPct')],
  ['trade sum must remain raw sum',x=>x.replace('const tradeSumPct=vals.reduce((a,b)=>a+b,0);','const tradeSumPct=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);')]
];
let fail=0;
for(const [name,mutate] of muts){
  const m=mutate(fnText);
  if(probe(m)){console.error('✗ mutation survived: '+name);fail++;}
  else console.log('✓ mutation killed: '+name);
}
if(fail)process.exit(1);
console.log('✓ daytrading UI metrics: account +0.75%, trade sum +2.25%');


function intradayPaperUiProbe(text){
  const titleCount=(text.match(/<h3><span class="dot"><\/span>📒 오늘 장중 모의 매매이력/g)||[]).length;
  let auto='',opening='';
  try{
    auto=extractFn(text,'function startOpeningPaperAuto(');
    opening=extractFn(text,'async function loadServerOpeningHistory(');
  }catch(e){return false;}
  const autoMinute=auto.includes('loadServerOpeningHistory(true)')&&auto.includes('},60000);');
  const boxes=opening.indexOf("let baseHtml='<div class=\"out\"");
  const zero=opening.indexOf('if(!trades.length)');
  const boxesOnZero=boxes>=0&&zero>=0&&boxes<zero;
  return titleCount===4&&autoMinute&&boxesOnZero;
}
if(!intradayPaperUiProbe(src)){
  console.error('✗ four strategy tabs must expose unified intraday paper history');
  process.exit(1);
}
const uiMuts=[
  ['opening paper title must match other tabs',x=>x.replace('📒 오늘 장중 모의 매매이력','📒 오늘 서버 매매 이력')],
  ['opening paper must auto refresh silently every minute',x=>x.replace('loadServerOpeningHistory(true)','loadServerOpeningHistory(false)')]
];
for(const [name,mutate] of uiMuts){
  if(intradayPaperUiProbe(mutate(src))){
    console.error('✗ UI mutation survived: '+name);
    process.exit(1);
  }else console.log('✓ UI mutation killed: '+name);
}
console.log('✓ opening/daytrading/crypto/SOXL have unified today paper-history UI');


function strategyCockpitProbe(text){
  const must=[
    "const STRATEGY_UI_META={",
    "function renderStrategyCockpit(name)",
    "['today','📒 오늘 모의매매 · 손익']",
    "['review','🧪 그림자 · 매일 검증 · 개선']",
    "['history','📚 누적 모의매매 이력']",
    "필터·손절·익절은 목표 맞추려고 자동 완화하지 않음",
    "그림자 prospective",
    "데이터 최신성"
  ];
  if(must.some(x=>!text.includes(x)))return false;
  const cfg=text.slice(text.indexOf('const cfg={'),text.indexOf('Object.keys(cfg)',text.indexOf('const cfg={')));
  for(const name of ['opening','daytrading','crypto','soxl']){
    if(!cfg.includes(name+':'))return false;
    if(!cfg.includes("today:['📒 오늘 장중 모의 매매이력']"))return false;
  }
  if(!cfg.includes("opening:{strategy:[],search:['🔥 실시간 시초가 돌파 감시']"))return false;
  if(!text.includes("📖 기준전략 요약"))return false;
  return true;
}
if(!strategyCockpitProbe(src)){
  console.error('✗ strategy cockpit / decision-first flow missing');
  process.exit(1);
}
const cockpitMuts=[
  ['today paper history must have its own flow step',x=>x.replace("['today','📒 오늘 모의매매 · 손익']", "['today','기타']")],
  ['filters must not be loosened to chase target',x=>x.replace('필터·손절·익절은 목표 맞추려고 자동 완화하지 않음','')]
];
for(const [name,mutate] of cockpitMuts){
  if(strategyCockpitProbe(mutate(src))){
    console.error('✗ cockpit mutation survived: '+name);
    process.exit(1);
  }else console.log('✓ cockpit mutation killed: '+name);
}
console.log('✓ strategy cockpit covers rules / today / shadow / validation / history / freshness');
