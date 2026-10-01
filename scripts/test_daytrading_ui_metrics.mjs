#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','scalping.html'),'utf8');

function extractFn(text,marker){
  const i=text.indexOf(marker);
  if(i<0)throw new Error('missing '+marker);
  let j=text.indexOf('{',i),d=0,k=j;
  for(;k<text.length;k++){
    if(text[k]==='{')d++;
    else if(text[k]==='}'){d--;if(!d)break;}
  }
  return text.slice(i,k+1);
}
function build(fnText){
  return new Function(fnText+'\nreturn dayTradingTodayMetrics;')();
}
function near(a,b){return Math.abs(a-b)<1e-12;}
function probe(fnText){
  try{
    const fn=build(fnText);
    const trades=[{pnl:-1.25},{pnl:1.75},{pnl:1.75}];
    const m=fn({daily:[{date:'2026-10-01',returnPct:0.75}]},trades,'2026-10-01');
    const fallback=fn({daily:[]},trades,'2026-10-01');
    return m.trades===3&&near(m.accountReturnPct,0.75)&&near(m.tradeSumPct,2.25)&&near(fallback.accountReturnPct,0.75);
  }catch(e){return false;}
}

const fnText=extractFn(src,'function dayTradingTodayMetrics(');
if(!probe(fnText)){
  console.error('✗ production daytrading today metrics failed');
  process.exit(1);
}
for(const label of ['오늘 계좌수익률','개별 매매 수익률 합계','계좌수익률 아님']){
  if(!src.includes(label)){console.error('✗ UI label missing: '+label);process.exit(1);}
}

const muts=[
  ['account return must use daily portfolio return',x=>x.replace('? Number(day.returnPct)', '? tradeSumPct')],
  ['trade sum must remain raw sum',x=>x.replace('const tradeSumPct=vals.reduce((a,b)=>a+b,0);','const tradeSumPct=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);')]
];
let fail=0;
for(const [name,mutate] of muts){
  const m=mutate(fnText);
  if(probe(m)){console.error('✗ mutation survived: '+name);fail++;}
  else console.log('✓ mutation killed: '+name);
}
if(fail)process.exit(1);
console.log('✓ daytrading UI metrics: account +0.75%, trade sum +2.25%');
