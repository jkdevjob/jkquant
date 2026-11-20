'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {boot,starts,quant} = require('./operating-20261110.cjs');
const {loadCashEngine,setupSecondary,combineCash} = require('./portfolio-taxcash-20261113.cjs');

const root = path.resolve(__dirname,'../..');
const end = '2026-11-19';
const weight = 5/6;
const variants = {
  base:null, P50:{fraction:.5,side:0}, P25:{fraction:.25,side:0}, P75:{fraction:.75,side:0},
  B50:{fraction:.5,side:1}, S50:{fraction:.5,side:-1}
};
const sizes = {lump10:[10000,0],lump100:[100000,0],user:[30000,210]};
const scopes = {
  real:{replay:true,names:['TECL','TQQQ','SGOV'],ivs:'USD',start:'2011-04-01',partitions:['2016-04-01']},
  syn:{names:['SYNTECL','SYNTQQQ','SYNBIL'],ivs:'SYNUSD_S',start:'2000-06-01',partitions:['2006-01-01','2011-01-01']},
  oos:{names:['SYNTECLN','SYNTQQQ','SYNBIL_L'],ivs:'SYNUSD_S',start:'1994-08-01',last:'1999-12-01',partitions:['1997-03-01']}
};
const pricesDir = 'research/im_plan';
const replayFile = 'plan-session-engine.js';

function partialReplay(source) {
  const formula = 'tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;';
  const target = `const ${formula}`;
  if (source.split(target).length !== 2) throw Error('The native TECL target formula changed');
  return source.replace(target, `let ${formula}
          const partial=opt.gptPartialOrder;
          if(partial&&teclHit&&!guardFlip&&!tqReb&&!force&&!first&&!sgNew){
            const delta=tt-pos.TECL;
            if(delta!==0&&(!partial.side||Math.sign(delta)===partial.side)){
              const move=Math.sign(delta)*Math.max(1,Math.floor(Math.abs(delta)*partial.fraction));
              opt.gptPartialTrace.push({date,signalDate:S.dates[p],current:pos.TECL,full:tt,partial:pos.TECL+move});
              tt=pos.TECL+move;
            }
          }`);
}

function priceFile(name,replay=false) {
  return path.join(pricesDir,replay?'planrule/data':'data',name+'.json');
}

function prices(name,replay=false) {
  const q=JSON.parse(fs.readFileSync(path.join(root,priceFile(name,replay))));
  const bars=(replay?q.ohlcTrade:q.series).filter(x=>x.date<=end&&+x.close>0)
    .map(x=>({date:x.date,close:+x.close}));
  if(bars.at(-1)?.date!==end) throw Error(`Missing settled ${end} price for ${name}`);
  return {bars,dividends:replay?q.dividends.filter(x=>x.date<=end):[]};
}

function rescale(bars,start,finish) {
  const i=bars.findIndex(x=>x.date>=start);
  if (i<330) throw Error(`Less than 330 warmup dates at ${start}`);
  const multiplier=100/bars[i].close;
  return bars.slice(i-330).filter(x=>x.date<=finish).map(x=>({date:x.date,close:x.close*multiplier}));
}

function cashFlows(replay,cap,monthly) {
  const flows=[[replay.nav[0].date,cap]];
  let prior=cap*weight;
  for (const n of replay.nav) {
    const amount=n.inflow-prior;
    if (Math.abs(amount)>1e-8) {
      if(Math.abs(amount-monthly)>1e-8) throw Error(`Unexpected external flow at ${n.date}`);
      flows.push([n.date,amount]);
    }
    prior=n.inflow;
  }
  return flows;
}

function xirr(flows,finish,final) {
  const years=flows.map(([d,v])=>[v,(Date.parse(finish)-Date.parse(d))/(365.25*864e5)]);
  if (years.at(-1)[1]===0&&years.at(-1)[0]>=final) return -100;
  let low=-25,high=5;
  for(let i=0;i<68;i++) {
    const mid=(low+high)/2;
    const value=years.reduce((sum,[v,t])=>sum+v*Math.exp(mid*t),0);
    if(value>final) high=mid; else low=mid;
  }
  return Math.expm1((low+high)/2)*100;
}

function auditTradeLog(replay,trace,rule,engine) {
  const days=new Map(replay.nav.map((row,i)=>[row.date,i]));
  const depositDays=new Set(replay.ledger.events.filter(e=>e.type==='cash'&&e.kind==='dep').map(e=>e.date));
  let turnover=0;
  for(const e of replay.ledger.events){
    if(e.type!=='trade') continue;
    const i=days.get(e.date), n=replay.nav[i];
    const price=n?.[`${e.symbol.toLowerCase()}Px`];
    if(!price || e.price!==price || !Number.isInteger(e.qty) || e.qty<=0 ||
       e.fee!==engine.alphaFee(e.qty,e.price) || !(e.signalDate<e.date) ||
       (i>0 && e.signalDate!==replay.nav[i-1].date)) throw Error(`Native trade audit ${e.date} ${e.symbol}`);
    turnover+=e.price*e.qty;
  }
  let partialBuys=0, partialSells=0, unchanged=0;
  for(const item of trace){
    const i=days.get(item.date), delta=item.full-item.current;
    const intended=item.current+Math.sign(delta)*Math.max(1,Math.floor(Math.abs(delta)*rule.fraction));
    if(depositDays.has(item.date)||i===0||!delta||!Number.isInteger(item.partial)||item.partial!==intended||
       (rule.side&&Math.sign(delta)!==rule.side)||item.signalDate!==replay.nav[i-1].date) {
      throw Error(`Non-discretionary or invalid partial target at ${item.date}`);
    }
    if (item.partial===item.full) unchanged++;
    else if (delta>0) partialBuys++;
    else partialSells++;
  }
  return {turnover,partialBuys,partialSells,unchanged};
}

function probePreviousClose(engine,options,day) {
  const short={...options,endDate:day,gptPartialOrder:variants.P50,gptPartialTrace:[]};
  const mutated={...short,gptPartialTrace:[],tecl:short.tecl.map(p=>p.date===day?{...p,close:1.5*p.close}:p)};
  const a=engine.replay(short), b=engine.replay(mutated);
  if(a.lastDecision?.date!==day || b.last?.teclPx===a.last?.teclPx ||
     JSON.stringify(a.lastDecision)!==JSON.stringify(b.lastDecision) ||
     JSON.stringify(short.gptPartialTrace)!==JSON.stringify(mutated.gptPartialTrace)) {
    throw Error(`Today's execution quote changed the partial target at ${day}`);
  }
}

function summary(rows,variant,partitions) {
  const a=rows.map(x=>x.metrics[variant]), b=rows.map(x=>x.metrics.base);
  const diff=key=>a.map((x,i)=>x[key]-b[i][key]);
  const ratios=a.map((x,i)=>x.final/b[i].final), irr=diff('irr'), mdd=diff('mdd');
  const worst=ratios.indexOf(Math.min(...ratios)), worstDraw=mdd.indexOf(Math.max(...mdd));
  const boundaries=['',...partitions,'9999'];
  const groups=boundaries.slice(0,-1).map((start,i)=>{
    const limit=boundaries[i+1], indexes=rows.flatMap((r,j)=>r.start>=start&&r.start<limit?[j]:[]);
    return {start,limit,n:indexes.length,ratio:quant(indexes.map(j=>ratios[j])),deltaIrr:quant(indexes.map(j=>irr[j]))};
  });
  const keys=['final','return','irr','mdd','fees','tax','turnover','trades','teclWeight','partialBuys','partialSells','unchanged'];
  const levels=data=>Object.fromEntries(keys.map(k=>[k,quant(data.map(v=>v[k]))]));
  return {n:rows.length,base:levels(b),candidate:levels(a),delta:Object.fromEntries(keys.map(k=>[k,quant(diff(k))])),
    ratio:quant(ratios),ratioCI:boot(ratios),irrCI:boot(irr),groups,wins:ratios.filter(x=>x>1+1e-9).length,
    maxMddBase:Math.max(...b.map(x=>x.mdd)),maxMddCandidate:Math.max(...a.map(x=>x.mdd)),
    worstPairMdd:{start:rows[worstDraw].start,delta:mdd[worstDraw]},
    worstPair:{start:rows[worst].start,finish:rows[worst].lastTradingDay,ratio:ratios[worst],base:b[worst],candidate:a[worst]},
    newTail:a.filter((x,i)=>x.mdd>=90&&b[i].mdd<90).length,zero:a.filter(x=>x.final<=.01).length};
}

async function main() {
  const out=process.argv[2];
  if(!out) throw Error('Pass a result JSON path');
  const browser=await require('./run.cjs').prepareChromium();
  const {open}=require('../im_plan/imh');
  const source=fs.readFileSync(path.join(root,replayFile),'utf8');
  const vmContext={};
  vm.runInNewContext(source,vmContext);
  const original=vmContext.JKPlanSessionEngine, reference=loadCashEngine(), engine=loadCashEngine(partialReplay(source));
  if(original.FEE_RATE!==.0025) throw Error('Unexpected application default fee');
  const vix=prices('VIX').bars, vxn=prices('VXN').bars;
  const checksum=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  const files=['backtest.html',replayFile,'plan-tax-check.js','research/im_plan/imh.js',priceFile('VIX'),priceFile('VXN')];
  const results={end,variants,browser:browser.version,fee:original.FEE_RATE,
    files:Object.fromEntries(files.map(f=>[f,checksum(f)])),scopes:{}};
  const names=(process.env.DS||Object.keys(scopes).join(',')).split(',');
  for(const name of names){
    const scope=scopes[name], priceSeries=scope.names.map(symbol=>prices(symbol,scope.replay));
    const windows=starts(scope.start,end,+scope.start.slice(0,4)).filter(([s])=>!scope.last||s<=scope.last);
    const limit=+process.env.LIMIT;
    if(limit>0) windows.splice(limit);
    const {pg,close}=await open([{sym:'USD',file:scope.ivs}]);
    try {
      await pg.evaluate(setupSecondary);
      if(await pg.evaluate(()=>costOf('USD').fee)!==original.FEE_RATE) throw Error('Backtest/replay fee mismatch');
      const inputs=[...scope.names.map(s=>priceFile(s,scope.replay)),priceFile(scope.ivs)];
      const audit={originalReplay:0,cashReplay:0,originalIVS:0,previousClose:0,personTax:0,maxTaxError:0};
      const scopeResult={inputs:Object.fromEntries(inputs.map(p=>[p,checksum(p)])),audit,sizes:{}};
      results.scopes[name]=scopeResult;
      for(const [label,[cap,monthly]] of Object.entries(sizes)){
        let quoteProbed=false;
        async function runWindow(start,finish,check){
          const opts={rules:'panic',horizon:5,startDate:start,endDate:finish,principal:cap*weight,monthlyAdd:monthly,vix,vxn};
          for(const [i,symbol] of ['tecl','tqqq','sgov'].entries()){
            const {bars,dividends}=priceSeries[i];
            opts[symbol]=scope.replay?bars:rescale(bars,start,finish);
            opts[symbol+'Div']=dividends;
          }
          const ivs={tkr:'USD',cap:cap*(1-weight),w:1-weight,s:start,e:finish};
          const side=await pg.evaluate(o=>window.__getSecondary(o),{...ivs,close:true});
          const model={...opts,gptTax:{secondary:side,harvest:false,harvestDates:[]}};
          if(check){
            if(JSON.stringify(original.replay(opts))!==JSON.stringify(engine.replay(opts))) throw Error('Native replay parity');
            audit.originalReplay++;
            await pg.evaluate(o=>window.__getSecondary(o),{...ivs,close:false});
            audit.originalIVS++;
          }
          let firstFlows=null, firstShares=null, lastTradingDay=null;
          const metrics={};
          for(const [variant,rule] of Object.entries(variants)){
            const trace=[];
            const replay=engine.replay({...model,gptPartialOrder:rule,gptPartialTrace:trace});
            if(!replay.stats) throw Error(replay.error||'Missing replay stats');
            if(check&&variant==='base'){
              if(JSON.stringify(replay)!==JSON.stringify(reference.replay(model))) throw Error('Existing cash replay parity');
              audit.cashReplay++;
            }
            const flows=cashFlows(replay,cap,monthly), shares=['tecl','tqqq','sgov'].map(s=>replay.nav[0][s]);
            const facts=combineCash(replay,side,cap,weight);
            if(firstFlows&&JSON.stringify(firstFlows)!==JSON.stringify(flows)) throw Error('Unpaired contribution schedule');
            if(firstShares&&JSON.stringify(firstShares)!==JSON.stringify(shares)) throw Error('Initial order changed');
            if(Math.abs(facts.inflow-flows.reduce((s,x)=>s+x[1],0))>1e-7) throw Error('External cash conservation');
            firstFlows=flows;firstShares=shares;lastTradingDay=replay.last.date;
            audit.personTax++;audit.maxTaxError=Math.max(audit.maxTaxError,facts.taxError);
            const trade=auditTradeLog(replay,trace,rule,engine);
            const teclWeight=100*replay.nav.slice(0,-1).reduce((s,n)=>s+n.tecl*n.teclPx/n.total,0)/(replay.nav.length-1);
            metrics[variant]={final:facts.final,return:(facts.final/facts.inflow-1)*100,irr:xirr(flows,lastTradingDay,facts.final),
              mdd:facts.mdd,fees:facts.fees,tax:facts.tax,trades:facts.trades,teclWeight,...trade};
            if(variant==='P50'&&!quoteProbed&&trace.length){
              probePreviousClose(engine,opts,trace[0].date);
              quoteProbed=true;audit.previousClose++;
            }
          }
          return {start,finish,lastTradingDay,metrics};
        }
        const rows=[];
        for(const [start,finish] of windows){
          rows.push(await runWindow(start,finish,rows.length===0||rows.length===windows.length-1));
          if(rows.length%40===0) process.stderr.write(`${name} ${label} ${rows.length}/${windows.length}\n`);
        }
        const statistics=Object.fromEntries(Object.keys(variants).filter(x=>x!=='base')
          .map(key=>[key,summary(rows,key,scope.partitions)]));
        const recent=name==='real'&&!limit?await runWindow('2021-11-19',end,false):null;
        scopeResult.sizes[label]={cap,monthly,statistics,rows,recent};
        fs.writeFileSync(out,JSON.stringify(results));
        console.log(name,label,JSON.stringify(Object.fromEntries(Object.entries(statistics)
          .map(([key,s])=>[key,[s.ratio,s.delta.irr,s.delta.mdd,s.worstPairMdd.delta,s.wins,s.n]]))));
      }
    } finally { await close(); }
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
