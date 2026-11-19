'use strict';
// Independently reproduce R-20261119-1 with application replay and paired windows.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {quant, boot, starts, taxCurve} = require('./operating-20261110.cjs');
const {afterTax} = require('../im_plan/planrule/aftertax');

const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'research/im_plan');
const end = '2026-11-18';
const signalEnd = '2026-11-17';
const historical = process.env.ENGINE === 'historical';
const oldRef = 'f003d0a';
const price = (symbol, real = false) => {
  const quotes = JSON.parse(fs.readFileSync(path.join(folder, real ? 'planrule/data' : 'data', symbol + '.json')));
  const bars = (real ? quotes.ohlcTrade : quotes.series).filter(b => b.date <= end && b.close > 0)
    .map(b => ({date:b.date, close:+b.close}));
  return {bars, dividends: real ? (quotes.dividends || []).filter(d => d.date <= end) : []};
};
function fred(symbol) {
  const raw = fs.readFileSync(path.join(folder, 'data', symbol + '.csv'), 'utf8').trim();
  return raw.split(/\r?\n/).slice(1).map(line => line.split(','))
    .filter(([date, value]) => date <= signalEnd && value && value !== '.' && Number.isFinite(+value))
    .map(([date, value]) => ({date, value:+value}));
}
const breakeven = fred('T10YIE');
const realYield = new Map(fred('DFII10').map(row => [row.date, row.value]));
const proxy = fred('DGS10').filter(row => realYield.has(row.date))
  .map(row => ({date:row.date, value:Math.round(100*(row.value-realYield.get(row.date)))/100}));
if (!breakeven.length || !proxy.length) throw Error('FRED source missing');
const settings = {
  check:{high:Infinity,low:-Infinity}, I1:{high:2.5,low:1.75},
  a:{high:2.4,low:1.85}, b:{high:2.6,low:1.65}, c:{high:2.5,low:-Infinity}, d:{high:Infinity,low:1.75},
  delayed:{high:2.5,low:1.75,lag:1}, placebo:{high:2.5,low:1.75,lag:252},
  proxy:{high:2.5,low:1.75,rows:proxy}
};
function observation(rows, day, lag = 0) {
  let first=0, last=rows.length;
  while (first<last) {
    const i=(first+last)>>>1;
    if (rows[i].date<=day) first=i+1;
    else last=i;
  }
  return rows[first-1-lag];
}
function target(name, day) {
  const {high,low,rows=breakeven,lag} = settings[name];
  const row = observation(rows,day,lag);
  if (!row) return null;
  if (row.date>day) throw Error('FRED date beyond signal');
  if (row.value>=high) return .50;
  if (row.value<=low) return .60;
  return null;
}
function engine(source, changed) {
  if (changed) {
    const patch = (from,to) => {
      if (source.split(from).length!==2) throw Error('Replay hook changed: '+from);
      source=source.replace(from,()=>to);
    };
    patch("const k=String(key&&key.key||key||'');return k==='panic'?",
      "const k=String(key&&key.key||key||'');if(__names.includes(k))return {...ALPHA_RULES.panic,key:k,gptI1:k};return k==='panic'?");
    patch('const s0=D.ivsS0,sigUse=pm?pm.sigma:sigma,',
      'const s0=(RULES.gptI1?__signal(RULES.gptI1,S.dates[p]):null)??D.ivsS0,sigUse=pm?pm.sigma:sigma,');
  }
  const context={__names:Object.keys(settings),__signal:target};
  vm.runInNewContext(source,context);
  return context.JKPlanSessionEngine;
}
const source = historical ? execFileSync('git',['show',oldRef+':plan-session-engine.js'],{cwd:root,encoding:'utf8'})
  : fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8');
const baseline=engine(source,false), cases=engine(source,true);
const vix=price('VIX').bars, vxn=price('VXN').bars;
const studies = {
  real:{symbols:['TECL','TQQQ','SGOV'],from:'2011-04-01',half:'2016-04-01',real:true},
  syn:{symbols:['SYNTECL','SYNTQQQ','SYNBIL'],from:'2000-06-01',half:'2011-01-01'},
  oos:{symbols:['SYNTECLN','SYNTQQQ','SYNBIL_L'],from:'1990-06-01',half:'1995-01-01',lastStart:'1999-12-01'}
};
const sizes = {lump10:[10000,0],lump100:[100000,0],user25:[25000,210],paper:[69244,69.24]};
const audit={original:0,inactive:0,tax:0,trade:0,maxTaxError:0};
const names=Object.keys(settings).filter(k=>k!=='check');
const output={end,signalEnd,historical,fee:baseline.FEE_RATE,
  fred:{first:breakeven[0],last:breakeven.at(-1),proxyLast:proxy.at(-1),overlapDiff:0,thresholdDiff:0},audit,studies:{}};
const matched=new Map(breakeven.map(row=>[row.date,row.value]));
const regime=x=>x>=2.5?.50:x<=1.75?.60:.55;
for (const row of proxy) if (matched.has(row.date)) {
  const v=matched.get(row.date);
  if (Math.abs(v-row.value)>1e-9) output.fred.overlapDiff++;
  if (regime(v)!==regime(row.value)) output.fred.thresholdDiff++;
}
function rescale(bars,start,finish) {
  const i=bars.findIndex(b=>b.date>=start);
  if (i<0) throw Error('Synthetic price anchor missing');
  const multiplier=100/bars[i].close;
  return bars.slice(Math.max(i-330,0)).filter(b=>b.date<=finish)
    .map(b=>({date:b.date,close:b.close*multiplier}));
}
function measure(replay, check) {
  if (!replay.stats || !replay.nav.length) throw Error(replay.error || 'Replay returned no stats');
  const tax=afterTax(replay), nav=replay.nav.at(-1), trades=replay.ledger.events.filter(e=>e.type==='trade');
  if (check) {
    const independent=taxCurve(replay);
    const error=Math.abs(independent.final-tax.final);
    if (error>1e-6) throw Error('Independent tax discrepancy: '+error);
    audit.tax++;
    audit.maxTaxError=Math.max(audit.maxTaxError,error);
    for (const trade of trades) {
      if (!Number.isInteger(trade.qty) || (trade.signalDate && trade.signalDate>=trade.date)) throw Error('Replay timing/quantity');
      audit.trade++;
    }
  }
  return {annual:100*Math.expm1(Math.log(Math.max(1e-12,tax.final)/nav.inflow)/replay.stats.yrs),
    final:tax.final,mdd:replay.stats.mdd,tax:tax.tax,fees:trades.reduce((a,e)=>a+e.fee,0),inflow:nav.inflow,
    trades:trades.length};
}
function summarize(rows,name,half) {
  const changes=rows.map(row=>row.values[name].annual-row.values.panic.annual);
  const mdds=rows.map(row=>row.values[name].mdd-row.values.panic.mdd);
  const pick=(scope)=>quant(changes.filter((_,i)=>(rows[i].start<half)===scope));
  const abs=k=>rows.map(row=>row.values[name][k]);
  const del=k=>quant(rows.map(row=>row.values[name][k]-row.values.panic[k]));
  const maxMdd=Math.max(...abs('mdd'));
  const worstIndex=changes.indexOf(Math.min(...changes));
  return {n:rows.length,nActive:rows.filter(row=>row.active[name]>0).length,annual:quant(changes),ci:boot(changes),
    front:pick(true),back:pick(false),wins:changes.filter(x=>x>1e-9).length,
    minAnn:changes[worstIndex],minStart:rows[worstIndex].start,final:quant(abs('final')),deltaFinal:del('final'),
    ratio:quant(rows.map(row=>row.values[name].final/row.values.panic.final)),
    annAbsolute:quant(abs('annual')),mdd:quant(abs('mdd')),maxMdd,deltaMdd:quant(mdds),
    deltaMaxMdd:maxMdd-Math.max(...rows.map(r=>r.values.panic.mdd)),worstPairMdd:Math.max(...mdds),
    feeDelta:del('fees'),taxDelta:del('tax'),tradesDelta:del('trades'),
    newTail:rows.filter(row=>row.values[name].mdd>=90&&row.values.panic.mdd<90).length,
    zero:rows.filter(row=>row.values[name].final<=.01).length};
}
for (const scope of (process.env.DS || Object.keys(studies).join(',')).split(',')) {
  const study=studies[scope], q=study.symbols.map(s=>price(s,study.real));
  const windows=starts(study.from,q[0].bars.at(-1).date,+study.from.slice(0,4))
    .filter(([start])=>!study.lastStart||start<=study.lastStart);
  const out=output.studies[scope]={};
  for (const name of (process.env.SETS || Object.keys(sizes).join(',')).split(',')) {
    const [principal,monthlyAdd]=sizes[name], rows=[];
    for (const [start,finish] of windows) {
      const options={horizon:5,startDate:start,endDate:finish,principal,monthlyAdd,vix,vxn};
      ['tecl','tqqq','sgov'].forEach((sym,i)=>{
        options[sym]=study.real?q[i].bars:rescale(q[i].bars,start,finish);
        options[sym+'Div']=q[i].dividends;
      });
      const b=cases.replay({...options,rules:'panic'});
      if (!rows.length) {
        if (JSON.stringify(b)!==JSON.stringify(baseline.replay({...options,rules:'panic'}))) throw Error('Original replay parity');
        const c=cases.replay({...options,rules:'check'});
        if (JSON.stringify(b.nav)!==JSON.stringify(c.nav)||JSON.stringify(b.ledger)!==JSON.stringify(c.ledger)) throw Error('Inactive replay parity');
        audit.original++;
      }
      const values={panic:measure(b,false)}, active={};
      const dates=b.nav.map(n=>n.date);
      const preceding=options.tecl.findLast(row=>row.date<dates[0]);
      if (preceding) dates.unshift(preceding.date);
      for (const k of names) {
        active[k]=dates.filter(date=>target(k,date)!=null).length;
        if (!active[k]) {
          if (!rows.length) {
            const r=cases.replay({...options,rules:k});
            if (JSON.stringify(r.nav)!==JSON.stringify(b.nav)||JSON.stringify(r.ledger)!==JSON.stringify(b.ledger)) throw Error('Inactive signal affects replay');
            audit.inactive++;
          }
          values[k]=values.panic;
        } else {
          values[k]=measure(cases.replay({...options,rules:k}),k==='I1');
        }
        if (values[k].inflow!==values.panic.inflow) throw Error('Unmatched contributions');
      }
      rows.push({start,finish,values,active});
    }
    const summary=Object.fromEntries(['panic',...names].map(k=>[k,summarize(rows,k,study.half)]));
    out[name]={rows,summary};
    fs.writeFileSync(process.argv[2],JSON.stringify(output));
    console.log(scope,name,JSON.stringify(Object.fromEntries(names.map(k=>[k,[summary[k].annual,summary[k].deltaMaxMdd,summary[k].nActive]]))));
  }
}
