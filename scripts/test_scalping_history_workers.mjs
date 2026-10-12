import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dates=Array.from({length:82},(_,i)=>new Date(Date.UTC(2026,0,1)+86400000*i).toISOString().slice(0,10));
for(const name of ['global-intraday','daytrading']){
  const text=readFileSync(`worker/${name}-scheduler/src/index.js`,'utf8');
  const start=text.indexOf('async function readPaperHistory('),end=text.indexOf('\nasync function ',start+10);
  let fn=text.slice(start,end);
  if(process.env.SCALPING_WORKER_SERIAL_MUTATION==='1')fn=fn.replace(/i\+=6/g,'i+=1').replace(/i\+6/g,'i+1');
  let active=0,high=0,readCount=0;
  const read=async(...args)=>{
    const date=args.at(-1);active++;high=Math.max(high,active);readCount++;
    await new Promise(resolve=>queueMicrotask(resolve));active--;
    return {date,trades:[]};
  };
  const reader=new Function('readPaperDates','readPaper',fn+';return readPaperHistory;')(async()=>dates,read);
  const result=name==='global-intraday'?await reader({},'crypto',82):await reader({},82);
  assert.equal(readCount,82);assert.equal(result.ledgers.length,82);
  assert.deepEqual(result.ledgers.map(x=>x.date),dates.slice().reverse());
  assert.ok(high>1&&high<=6,`bounded concurrency required; observed ${high}`);
  readCount=0;
  const limited=name==='global-intraday'?await reader({},'crypto',9):await reader({},9);
  assert.equal(readCount,9);assert.equal(limited.ledgers.length,9);
  console.log(`PASS ${name}: complete ordered history, bounded concurrent reads, requested limit`);
}
