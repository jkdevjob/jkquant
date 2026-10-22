// Compact index of already archived immutable signal ledgers; no reconstruction.
// Run in the scalping-data checkout, using code from main.
import fs from 'node:fs';
import path from 'node:path';
const out='data/trade-history';fs.mkdirSync(out,{recursive:true});
for(const [kind,dir] of [['opening','data/opening-history'],['closing30','data/closing30']]){
  const ledgers=[];
  for(const file of fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>/^20\d\d-\d\d-\d\d\.json$/.test(x)).sort():[]){
    const source=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    const ledger=kind==='opening'?source.liveSignalLedger:source;
    if(!ledger?.date||!Array.isArray(ledger.events))continue;
    ledgers.push({date:ledger.date,mainVariant:ledger.mainVariant||'baseline',updatedAt:ledger.updatedAt,
      events:ledger.events.filter(e=>['signal','buy','sell'].includes(e?.stage))});
  }
  fs.writeFileSync(path.join(out,kind+'.json'),JSON.stringify({schema:1,generatedAt:new Date().toISOString(),source:'archived-original-signal-ledgers',ledgers}));
  console.log(kind+': archived original ledgers '+ledgers.length);
}
