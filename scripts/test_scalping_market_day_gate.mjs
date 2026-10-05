#!/usr/bin/env node
import fs from 'node:fs';

const kis=fs.readFileSync('functions/api/kis.js','utf8');
const opening=fs.readFileSync('worker/opening-scheduler/src/index.js','utf8');
const day=fs.readFileSync('worker/daytrading-scheduler/src/index.js','utf8');
const globalWorker=fs.readFileSync('worker/global-intraday-scheduler/src/index.js','utf8');
const daily=fs.readFileSync('functions/api/scalping-daily-results.js','utf8');
const ui=fs.readFileSync('scalping.html','utf8');

function ok(v,msg){if(!v){console.error('✗ '+msg);process.exit(1);}console.log('✓ '+msg);}

ok(kis.includes('/uapi/domestic-stock/v1/quotations/chk-holiday')
  &&kis.includes('tr_id: "CTCA0903R"')
  &&kis.includes('row.opnd_yn'),
  'KRX gate uses KIS official holiday API opnd_yn');

const oGate=opening.indexOf('if(krRoute){');
const oRun=opening.indexOf('else if(route==="opening")ctx.waitUntil(runMinute');
ok(oGate>=0&&oRun>oGate
  &&opening.includes('await krMarketOpen(env,date)')
  &&opening.includes('market_day_unknown_skip'),
  'opening/gapdown/Claude KR routes fail closed before strategy execution');

const dGate=day.indexOf('await krMarketOpen(env,sched.date)');
const dSnapshot=day.indexOf('if(sched.hm===955)');
const dScan=day.indexOf('const snapshot=await getOrCreateSnapshot(env,sched.date);',dSnapshot);
ok(dGate>=0&&dSnapshot>dGate&&dScan>dGate
  &&day.includes('market_closed_skip')
  &&day.includes('market_day_unknown_skip'),
  'daytrading checks KRX open day before snapshot/scan/summary');

const sGate=globalWorker.indexOf('if(!isNyseSessionDate(n.date))');
const sBars=globalWorker.indexOf('const bars=await fetchSoxl();',sGate);
const sTrade=globalWorker.indexOf('const t=soxlTrade(bars,now,n.date',sGate);
ok(sGate>=0&&sBars>sGate&&sTrade>sBars
  &&globalWorker.includes('hasSoxlSessionOpenBar(bars,n.date)')
  &&globalWorker.includes('09:30 ET bar missing'),
  'SOXL checks NYSE calendar and actual 09:30 session bar before strategy');

ok(globalWorker.includes('async function runBtc(env,now)')
  &&!globalWorker.slice(globalWorker.indexOf('async function runBtc(env,now)'),globalWorker.indexOf('async function runSoxl(env,now)')).includes('isNyseSessionDate'),
  'Bitcoin remains 24/7 and is not blocked by stock-market calendar');

function extract(name){
  const marker='function '+name+'(';
  const i=globalWorker.indexOf(marker);if(i<0)throw new Error('missing '+name);
  let j=globalWorker.indexOf('{',i),d=0,k=j;
  for(;k<globalWorker.length;k++){
    if(globalWorker[k]==='{')d++;
    else if(globalWorker[k]==='}'){d--;if(d===0)break;}
  }
  return globalWorker.slice(i,k+1);
}
const fnNames=['isoUtc','nthWeekday','lastWeekday','observedFixed','easterSunday','nyseHolidaySet','isNyseSessionDate'];
const calendar=new Function(fnNames.map(extract).join('\n')+'\nreturn isNyseSessionDate;')();
ok(calendar('2026-10-05')===true,'NYSE calendar keeps normal Monday open');
ok(calendar('2026-07-03')===false,'NYSE calendar blocks observed Independence Day');
ok(calendar('2026-11-26')===false,'NYSE calendar blocks Thanksgiving');
ok(calendar('2026-12-25')===false,'NYSE calendar blocks Christmas');

ok(daily.includes('krMarketDayStatus(request,kst.date)')
  &&daily.includes('marketClosed:true')
  &&daily.includes('marketDayUnknown:true'),
  'Today API exposes closed/unknown market-day status');
ok(ui.includes("if(x.marketClosed)")
  &&ui.includes('해당 시장 비개장일 · 전략 미실행')
  &&ui.includes('전략 실행 보류'),
  'Today UI shows 휴장 instead of 매매없음 and fails closed on unknown');

console.log('✓ non-BTC scalping market-day gates');
