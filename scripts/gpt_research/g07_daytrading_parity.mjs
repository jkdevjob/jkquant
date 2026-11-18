// Run actual server signal and Worker fill functions on frozen minute archives.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {daySignal,dayVariant}=await import(pathToFileURL(path.join(root,'functions/api/_daytrading.js')));
let source=fs.readFileSync(path.join(root,'worker/daytrading-scheduler/src/index.js'),'utf8');
globalThis.DurableObject=class {};
source=source.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;')
  .replaceAll('../../../functions/api/',pathToFileURL(path.join(root,'functions/api/')).href);
source+='\nexport {blankTrade};\n';
const {blankTrade,applyBars}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const bundle=path.resolve(process.argv[2]);
const registered=JSON.parse(fs.readFileSync(path.join(bundle,'result.json'),'utf8'));
const python=JSON.parse(fs.readFileSync(path.join(bundle,'all-signals-selected-and-unselected.json'),'utf8'));
const expected=new Map(python.map(x=>[[x.date,x.variant,x.code].join(':'),x]));
const signalDiffs=[],tradeDiffs=[],records=[];let comparisons=0;
for(const input of registered.sourceFiles){
  if(!registered.eligibleDates.includes(input.date))continue;
  const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(bundle,'raw',input.path))));
  for(const p of registered.params){
    const chosen=[];
    for(const row of d.universe){
      if(Number(row.rank||999999)>p.top_n)continue;
      const rows=(row.bars||[]).map(b=>{const t=String(b.t);return {t:t.length===14?t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)+' '+t.slice(8,10)+':'+t.slice(10,12)+':'+t.slice(12,14):t,close:b.c,vol:b.v};});
      const sig=daySignal(rows,p.entry_cutoff,{...(dayVariant(p.name)?.params||{}),snapshotHm:d.snapshotHm});
      const key=[d.date,p.name,row.code].join(':');const original=expected.get(key);comparisons++;
      if(Boolean(sig)!==Boolean(original)){signalDiffs.push({key,js:!!sig,python:!!original});continue;}
      if(!sig)continue;
      for(const f of ['signalTime','sessionRet','vwapSlope','volRatio','priorHigh','score']){
        if(Math.abs(sig[f]-original[f])>1e-9)signalDiffs.push({key,field:f,js:sig[f],python:original[f]});
      }
      const rawBars=(row.bars||[]).map(b=>({...b,t:String(b.t)}));
      const paper=applyBars(blankTrade({...sig,code:row.code,name:row.name,rank:row.rank,mainVariant:p.name},d.date),rawBars,1510);
      for(const f of ['entryTime','entryPrice','exitTime','exitPrice','reason','pnl']){
        const a=paper[f]??null,b=original[f]??null;
        if(typeof a==='number'&&typeof b==='number'?Math.abs(a-b)>1e-9:a!==b)tradeDiffs.push({key,field:f,js:a,python:b});
      }
      chosen.push({...paper,score:sig.score,signalTime:sig.signalTime});
      records.push({key,signal:sig,paper,pythonSelected:original.selected});
    }
    chosen.sort((a,b)=>a.signalTime-b.signalTime||b.score-a.score||String(a.code).localeCompare(String(b.code)));
    const jsSelected=chosen.slice(0,3).map(x=>x.code).sort();
    const pySelected=python.filter(x=>x.date===d.date&&x.variant===p.name&&x.selected).map(x=>x.code).sort();
    if(JSON.stringify(jsSelected)!==JSON.stringify(pySelected))signalDiffs.push({date:d.date,variant:p.name,field:'selected',js:jsSelected,python:pySelected});
  }
}
const report={study:registered.study,comparisons,signals:records.length,signalDifferences:signalDiffs.length,tradeDifferences:tradeDiffs.length,signalDiffs,tradeDiffs,passed:!signalDiffs.length&&!tradeDiffs.length,records};
fs.writeFileSync(path.join(bundle,'operational-parity.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({study:report.study,comparisons,signals:report.signals,signalDifferences:report.signalDifferences,tradeDifferences:report.tradeDifferences,passed:report.passed}));
// Divergence is research evidence; keep it without silently changing engines.
