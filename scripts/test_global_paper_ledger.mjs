import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
globalThis.DurableObject=class {};
let workerSrc=fs.readFileSync(path.join(__dirname,'..','worker/global-intraday-scheduler/src/index.js'),'utf8');
workerSrc=workerSrc.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;');
const mod=await import('data:text/javascript;base64,'+Buffer.from(workerSrc).toString('base64'));

function near(a,b,tol=1e-9){return Math.abs(Number(a)-Number(b))<=tol;}
let fail=0;
function ok(cond,msg){if(cond)console.log('✓ '+msg);else{console.error('✗ '+msg);fail++;}}

const cryptoClosed={
  signal:{time:'00:05'},entry:{time:'00:10',o:100,c:100},entryPrice:100,
  exit:{bar:{time:'00:15',c:101},price:101,reason:'take_profit'},friction:.14
};
const c=mod.paperLedger('crypto','2026-10-01',cryptoClosed,{currency:'KRW',timezone:'Asia/Seoul',version:'btc_midnight_orb_v2',friction:.14});
ok(c.trades.length===1&&c.trades[0].status==='closed','BTC closed paper trade persisted');
ok(near(c.trades[0].pnlPct,.86),'BTC net PnL subtracts 0.14% friction');
ok(near(c.summary.accountReturnPct,.86)&&near(c.summary.tradeSumPct,.86),'BTC 1-slot account return equals trade return');

const soxlOpen={
  signal:{time:'10:00'},entry:{time:'10:05',o:100,c:100},entryPrice:100,currentBar:{time:'10:20',c:102},exit:null,friction:.20
};
const s=mod.paperLedger('soxl','2026-10-01',soxlOpen,{currency:'USD',timezone:'America/New_York',version:'soxl_orb_v1',friction:.20});
ok(s.trades[0].status==='open','SOXL open paper trade retained');
ok(near(s.trades[0].pnlPct,1.8),'SOXL open paper PnL includes 0.20% friction');
ok(near(s.summary.accountReturnPct,1.8),'SOXL 1-slot current account return');

const none=mod.paperLedger('crypto','2026-10-01',null,{currency:'KRW',timezone:'Asia/Seoul',version:'btc_midnight_orb_v2',friction:.14,decision:{code:'no_fresh_breakout',reason:'OR 고점 신규 돌파 없음'}});
ok(none.trades.length===0&&near(none.summary.accountReturnPct,0),'no-signal day remains 0% / 0 trades');
ok(none.decision&&none.decision.code==='no_fresh_breakout','no-signal decision reason is persisted in durable ledger');

const csv=mod.parseCsvText('date,strategyVersion,action,decisionReason,entryTimeKst,exitTimeKst,entryPrice,exitPrice,exitReason,pnlPct\n2026-09-01,btc_midnight_orb_v2,trade,ok,00:10,01:00,100,101,time_exit,0.86\n2026-09-02,btc_midnight_orb_v2,no_trade,no_breakout,,,,,,');
ok(csv.length===2&&csv[0].date==='2026-09-01'&&csv[1].action==='no_trade','historical CSV parser reads decision rows');
const histTrade=mod.historicalLedger('crypto',csv[0]);
ok(histTrade.trades.length===1&&histTrade.trades[0].status==='closed'&&near(histTrade.trades[0].pnlPct,.86),'historical trade becomes closed durable ledger');
ok(mod.historicalParity(histTrade,csv[0]).ok,'historical imported trade passes full-row parity');
const histNone=mod.historicalLedger('crypto',csv[1]);
ok(histNone.trades.length===0&&mod.historicalParity(histNone,csv[1]).ok,'historical no-trade day becomes zero-trade durable ledger');
ok(!mod.historicalParity(histTrade,{...csv[0],pnlPct:'9.99'}).ok,'historical parity detects PnL mismatch');

const kst=(hh,mm)=>Date.parse(`2026-10-01T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+09:00`);
const noBreakBars=[
  {ms:kst(0,0),date:'2026-10-01',hm:0,time:'00:00',o:100,h:101,l:99,c:100,v:10},
  {ms:kst(0,5),date:'2026-10-01',hm:5,time:'00:05',o:100,h:100.5,l:99,c:100,v:15}
];
const why=mod.btcNoTradeDecision(noBreakBars,kst(0,20),'2026-10-01');
ok(why.code==='no_fresh_breakout'&&/OR 고점 신규 돌파/.test(why.reason),'BTC no-trade diagnostics identify missing fresh breakout');

const worker=fs.readFileSync(path.join(__dirname,'..','worker/global-intraday-scheduler/src/index.js'),'utf8');
const cfg=fs.readFileSync(path.join(__dirname,'..','worker/global-intraday-scheduler/wrangler.jsonc'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','scalping.html'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'..','functions/api/global-paper.js'),'utf8');
ok(worker.includes('import { DurableObject } from "cloudflare:workers";')&&worker.includes('class PaperStore extends DurableObject')&&worker.includes('writePaper(env,paperLedger("crypto"')&&worker.includes('writePaper(env,paperLedger("soxl"'),'global worker imports DurableObject and stores both live paper ledgers');
ok(worker.includes('u.pathname==="/paper-index"')&&worker.includes('u.pathname==="/paper-history"')&&worker.includes('rememberPaperDate(env,ledger.strategy,ledger.date)'),'global worker keeps a durable per-strategy paper-date index and history endpoint');
ok(worker.includes('backfillHistoryChunk(env,"crypto",20)')&&worker.includes('backfillHistoryChunk(env,"soxl",20)')&&worker.includes('u.pathname==="/paper-backfill-status"'),'global worker incrementally backfills BTC/SOXL historical decisions and exposes integrity status');
ok(cfg.includes('"PAPER_STORE"')&&cfg.includes('"new_sqlite_classes": ["PaperStore"]'),'global worker durable object binding/migration');
ok(ui.includes("loadGlobalPaper('crypto')")&&ui.includes("loadGlobalPaper('soxl')")&&ui.includes('오늘 계좌수익률')&&ui.includes('개별 매매 수익률 합계'),'all-tab UI exposes live paper metrics');
ok(ui.includes('l.decision&&l.decision.reason')&&ui.includes('<b>매매없음</b>'),'UI surfaces durable BTC no-trade decision reason');
ok(api.includes('ownerAuthorized')&&api.includes('x-monitor-key')&&!/op=order|\/v1\/orders|env=real/i.test(api),'global paper API is owner-only read proxy');

if(fail)process.exit(1);
console.log('✓ global live paper ledger/UI checks passed');
