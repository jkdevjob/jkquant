#!/usr/bin/env node
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const openingWr=read('worker/opening-scheduler/wrangler.jsonc');
const opening=read('worker/opening-scheduler/src/index.js');
const globalW=read('worker/global-intraday-scheduler/src/index.js');
const crypto=read('.github/workflows/crypto-research.yml');
const soxl=read('.github/workflows/soxl-research.yml');
const day=read('.github/workflows/daytrading-research.yml');
const nightly=read('.github/workflows/nightly-scalping-research.yml');
const gap=read('.github/workflows/opening-gapdown-research.yml');
const duel=read('.github/workflows/scalping-duel-summary.yml');
const vts=read('.github/workflows/vts-reconcile.yml');

function ok(v,msg){if(!v){console.error('✗ '+msg);process.exit(1);}console.log('✓ '+msg);}

const ow=JSON.parse(openingWr);
ok(ow.triggers?.crons?.length===1
  &&ow.triggers.crons[0]==='5-31,40,56 0,6,9,15,20,21,23 * * *',
  'opening worker keeps one Cloudflare cron and includes 18:10 KST duel slot');

ok(opening.includes('if(hm===1810)return "duel"')
  &&opening.includes('/api/scalping-duel')
  &&opening.includes('route==="duel"'),
  'daily GPT-vs-Claude duel is sent by Worker at 18:10 KST');

ok((crypto.match(/cron:/g)||[]).length===1
  &&crypto.includes('cron: "20 0 * * *"')
  &&!crypto.includes('cron: "20 * * * *"')
  &&!crypto.includes('/api/scalping-daily-summary?strategy=crypto'),
  'BTC GitHub research is once/day and cannot send Telegram');

ok(soxl.includes('cron: "15 21 * * 1-5"')
  &&!soxl.includes('/api/scalping-daily-summary?strategy=soxl'),
  'SOXL GitHub research cannot send Telegram');

ok((day.match(/cron:/g)||[]).length===2
  &&day.includes('cron: "30 1 * * 1-5"')
  &&day.includes('cron: "0 8 * * 1-5"')
  &&!day.includes('$BASE/api/daytrading-summary') && !day.includes('jkquant.pages.dev/api/daytrading-summary'),
  'daytrading GitHub research is 10:30/17:00 KST only and cannot send Telegram');

ok((vts.match(/cron:/g)||[]).length===2
  &&vts.includes('cron: "45 0 * * 1-5"')
  &&vts.includes('cron: "30 8 * * 1-5"')
  &&!vts.includes('$BASE/api/vts-summary') && !vts.includes('jkquant.pages.dev/api/vts-summary'),
  'VTS reconcile is 09:45/17:30 KST only and cannot send Telegram');

ok(nightly.includes('cron: "10 10 * * *"')
  &&nightly.includes('cron: "10 11 * * *"')
  &&nightly.includes('/api/scalping-auto-promotion')
  &&!nightly.includes('$BASE/api/nightly-research-summary') && !nightly.includes('jkquant.pages.dev/api/nightly-research-summary'),
  'nightly research keeps data/auto-promotion backups but cannot send Telegram');

ok(!gap.includes('클로드 vs GPT 매일 대결 요약 텔레그램')
  &&!gap.includes('api/claude-telegram'),
  'gapdown research no longer duplicates duel Telegram');

ok(!/^\s*schedule:/m.test(duel)
  &&/workflow_dispatch/.test(duel),
  'duel GitHub workflow is manual fallback only');

ok(globalW.includes('"⑤ 오늘 매매이력"')
  &&globalW.includes('"⑥ 검증·분석 기록 · 연구자료 기준 "')
  &&globalW.includes('if(k.hm===5)await sendCloseSummary(env,"crypto"')
  &&globalW.includes('if(n.hm===1605&&isNyseSessionDate(n.date))'),
  'BTC/SOXL ⑤⑥ are emitted by Worker at market close times');

ok(globalW.indexOf('const live=await Promise.allSettled([runBtc(env,now),runSoxl(env,now)])')
  < globalW.indexOf('await runCloseSummaries(env,now)'),
  'global close summary waits for the same-minute BTC/SOXL ledger update');

const forbidden=[
  ['crypto-research',crypto,'scalping-daily-summary'],
  ['soxl-research',soxl,'scalping-daily-summary'],
  ['daytrading-research',day,'$BASE/api/daytrading-summary'],
  ['nightly-scalping-research',nightly,'$BASE/api/nightly-research-summary'],
  ['opening-gapdown-research',gap,'claude-telegram'],
  ['vts-reconcile',vts,'$BASE/api/vts-summary']
];
for(const [name,txt,needle] of forbidden)ok(!txt.includes(needle),name+' has no scheduled user Telegram endpoint');

console.log('✓ scalping schedule policy: Worker realtime/close alerts, GitHub research only');
