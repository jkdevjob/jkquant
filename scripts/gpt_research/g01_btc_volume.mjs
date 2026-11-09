// Runs the deployed Worker functions themselves; no copied signal/exit engine.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let source=fs.readFileSync(path.join(root,'worker/global-intraday-scheduler/src/index.js'),'utf8');
globalThis.DurableObject=class {};
source=source.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;')
  .replaceAll('../../../functions/api/',pathToFileURL(path.join(root,'functions/api/')).href);
const {btcTrade,btcNoTradeDecision}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const days=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const results=[];
for(const d of days){
  const date=d.sessionDateKst;
  const bars=d.bars.map(b=>{const time=b.tKst.slice(11,16);return {...b,date,time,hm:Number(time.replace(':','')),ms:Date.parse(b.tKst+'+09:00')};});
  const now=Date.parse(date+'T23:59:59+09:00')+600000;
  for(const [variant,volumeMult] of [['baseline',1.2],['vol_1.5',1.5]]){
    const t=btcTrade(bars,now,date,{volumeMult});
    let trade=null;
    if(t)trade={date,variant,status:t.waiting?'waiting':t.exit?'closed':'open',
      signalTimeKst:t.signal?.time,entryTimeKst:t.entry?.time,exitTimeKst:t.exit?.bar?.time,
      entryPrice:t.entryPrice??null,exitPrice:t.exit?.price??null,reason:t.exit?.reason??null,
      pnlPct:t.exit?((t.exit.price/t.entryPrice-1)*100-t.friction):null};
    results.push({date,variant,trade,decision:t?null:btcNoTradeDecision(bars,now,date,{volumeMult})});
  }
}
fs.writeFileSync(process.argv[3],JSON.stringify(results,null,2)+'\n');
