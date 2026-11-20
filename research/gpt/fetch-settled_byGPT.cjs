'use strict';
// Download historical inputs through the same app endpoint as fetch.sh.
// Call with an explicitly confirmed American trading date, before creating synthetic inputs.
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '../im_plan');
const endpoint = 'https://jkquant.pages.dev/api/quote';
const operatingSymbols = ('SOXL TQQQ TECL QQQ QLD SGOV BIL SOXX SMH ^SOX ^IRX ^NDX SPY XLK GLD '
  + 'TLT IEF ^TNX ^TYX ^FVX GC=F ^VIX ^VXN ^VIX3M ^VVIX USD GLDM KORU ^GSPC').split(' ');
const dailyFields = ['series','ohlc','ohlcTrade','closeTrade','dividends','splits','raw'];

async function fetchInput(directory, symbol, cutoff, period2, replay = false) {
  const query = new URLSearchParams(replay
    ? {symbol,range:'max',div:'1',intraday:'0'}
    : {symbol,range:'5y',period1:'0',period2:String(period2),div:'1'});
  const {stdout} = await run('curl', ['--fail','--silent','--show-error','--location',
    '--retry','2','--retry-all-errors','--connect-timeout','10','--max-time','25',`${endpoint}?${query}`],
  {maxBuffer:20*1024*1024});
  const input = JSON.parse(stdout);
  const sourceEnd = input.series?.at(-1)?.date;
  for (const field of dailyFields) {
    if (Array.isArray(input[field])) input[field] = input[field].filter(row => row.date && row.date <= cutoff);
  }
  const last = input.series?.at(-1);
  if (input.symbol !== symbol || !(input.series?.length > 100) || !(last?.close > 0)) {
    throw Error(`Invalid quote history ${symbol}: ${input.error || input.symbol}, ${sourceEnd}`);
  }
  if (replay || ['SOXL','USD','TQQQ','TECL','SGOV','QQQ','XLK','SMH','^VIX','^VXN'].includes(symbol)) {
    if (last.date !== cutoff || input.ohlcTrade?.at(-1)?.date !== cutoff || !Array.isArray(input.dividends)) {
      throw Error(`Required trade series missing or stale: ${symbol}, ${last.date}, ${input.ohlcTrade?.at(-1)?.date}`);
    }
  }
  input.last = last;
  input.price = last.close;
  input.marketState = null;
  delete input.intraday;
  const destination = path.join(directory, symbol.replace(/[\^=]/g,'' )+'.json');
  return {destination,input,info:{symbol,replay,source:input.src,sourceEnd,first:input.series[0].date,
    last:last.date,close:last.close,bars:input.series.length,dividends:input.dividends?.length}};
}

async function main() {
  const cutoff = process.argv[2];
  const date = new Date(`${cutoff}T00:00:00Z`);
  if (!cutoff || Number.isNaN(+date) || date.toISOString().slice(0,10) !== cutoff
      || date.getUTCDay() === 0 || date.getUTCDay() === 6 || +date >= Date.now()) {
    throw Error('Pass the last confirmed U.S. session as YYYY-MM-DD');
  }
  const period2 = +date/1000 + 86400;
  const jobs = [
    ...operatingSymbols.map(symbol => [path.join(root,'data'),symbol,cutoff,period2]),
    ...['TECL','TQQQ','SGOV'].map(symbol => [path.join(root,'planrule/data'),symbol,cutoff,period2,true])
  ];
  const results = [];
  for (let i=0; i<jobs.length; i+=6) {
    const batch = await Promise.allSettled(jobs.slice(i,i+6).map(args=>fetchInput(...args)));
    const failures = batch.filter(x=>x.status==='rejected');
    if (failures.length) throw new AggregateError(failures.map(x=>x.reason), `No input written after quote batch ${i}`);
    results.push(...batch.map(x=>x.value));
  }
  for (const {destination,input} of results) {
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary,JSON.stringify(input));
    await fs.rename(temporary,destination);
  }
  console.log(JSON.stringify({cutoff,period2,inputs:results.map(x=>x.info)}));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
