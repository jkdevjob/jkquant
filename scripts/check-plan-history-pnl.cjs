'use strict';
// Run the page's real ledger and renderer; no separate accounting implementation.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'../plan.html'),'utf8');
function fn(marker){
  const start=html.indexOf(marker);assert(start>=0,marker);
  let i=html.indexOf('{',start),depth=0;
  for(;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&!--depth)return html.slice(start,i+1);}
  throw Error(marker);
}
function page(ledger,capital=10000){
  const els={alphaLedgerBody:{innerHTML:''}},c=vm.createContext({alphaLedger:ledger,liveQuotes:{},
    $:id=>els[id]||null,num:()=>capital,usd2:v=>'$'+Number(v).toFixed(2)});
  vm.runInContext(['function alphaEventList(ledger=alphaLedger)','function alphaLedgerCalc(ledger=alphaLedger)',
    'function alphaSyncInputs()','function alphaAvgText(q,avg)','function renderAlphaLedger()'].map(fn).join('\n'),c);
  c.renderAlphaLedger();
  return {state:c.alphaLedgerCalc(),body:els.alphaLedgerBody.innerHTML};
}
const trade=(id,date,side,qty,price,fee=0,symbol='TECL')=>({id,date,type:'trade',side,qty,price,fee,symbol});
const ledger={base:{date:'2026-01-01',cash:9000,tecl:10,avgTecl:100},events:[
  trade('gain','2026-01-03','sell',5,130,.65),
  trade('buy','2026-01-02','buy',10,120,1.2),
  {id:'deposit',date:'2026-01-02',type:'cash',kind:'dep',amount:2000},
  trade('loss','2026-01-04','sell',15,90,1.35),
  trade('rebuy','2026-01-05','buy',3,70,.21),
  trade('flat','2026-01-05','sell',3,70,.21)
]};
const original=JSON.stringify(ledger),a=page(ledger);
assert.equal(a.state.tradePnl[0].profit,100); // weighted average $110, not final/null average
assert.equal(a.state.tradePnl[3].profit,-300);
assert.equal(a.state.tradePnl[5].profit,0);
assert.equal(a.state.tradePnl[1],undefined);
assert.equal(a.state.tecl,0);assert.equal(a.state.avgTecl,null);
assert(Math.abs(a.state.cash-11796.38)<1e-8); // cash still deducts every recorded fee
assert.equal(a.state.netFlow,2000);assert.equal(JSON.stringify(ledger),original);
console.log('PASS plan sale PnL uses chronological weighted average; full sale/rebuy, fees and source ledger preserved');

const rows=a.body.match(/<tr>[\s\S]*?<\/tr>/g)||[];
const row=id=>rows.find(x=>x.includes('data-aedit="'+id+'"'));
assert(row('gain').includes('<td class="pos">+1.00%</td><td class="pos">+$100.00</td>'));
assert(row('loss').includes('<td class="neg">-3.00%</td><td class="neg">$-300.00</td>'));
assert(row('flat').includes('<td class="pos">+0.00%</td><td class="pos">+$0.00</td>'));
assert(row('buy').includes('<td class="">—</td><td class="">—</td>'));
assert(a.body.indexOf('data-aedit="flat"')<a.body.indexOf('data-aedit="gain"'));
assert.equal((html.match(/<table class="alpha-ledger-table">[\s\S]*?<\/thead>/)||[''])[0].match(/<th>/g).length,10);
for(const r of rows){
  const n=[...r.matchAll(/<td(?:\s[^>]*)?>/g)].reduce((sum,m)=>sum+(Number((m[0].match(/colspan="(\d+)"/)||[])[1])||1),0);
  assert.equal(n,10,r);
}
console.log('PASS plan history renders signed amounts and starting-capital percentages, correct colors, zero and 10-column alignment');

const unknown=page({base:{cash:1000,tecl:2,avgTecl:null},events:[trade('unknown','2026-01-02','sell',2,120)]});
assert.equal(unknown.state.tradePnl[0].profit,null);
assert(unknown.body.includes('<td class="">—</td><td class="">평단 미등록</td>'));
const bad=page({base:{cash:1000,tecl:2,avgTecl:100},events:[trade('bad','2026-01-02','sell',3,120)]});
assert.equal(bad.state.invalid,true);assert.equal(bad.state.tradePnl[0].profit,null);
assert(bad.body.includes('<td class="">—</td><td class="">이력 오류</td>'));
const noCapital=page(ledger,0);
assert(noCapital.body.includes('<td class="pos">—</td><td class="pos">+$100.00</td>'));
console.log('PASS missing cost, oversold history and missing capital never produce invented or nonfinite returns');

const reconciled=page({base:{cash:1000,tecl:2,avgTecl:100},events:[
  {id:'adjust',type:'reconcile',date:'2026-01-02',snapshot:{tecl:4,avgTecl:80,cash:1500}},
  trade('same-id','2026-01-03','sell',1,90),
  trade('same-id','2026-01-03','buy',1,120),
  trade('same-id','2026-01-03','sell',4,100),
  trade('tqqq-buy','2026-01-04','buy',2,50,0,'TQQQ'),
  trade('tqqq-sell','2026-01-05','sell',1,45,0,'TQQQ'),
  trade('sgov-buy','2026-01-04','buy',2,100,0,'SGOV'),
  trade('sgov-sell','2026-01-05','sell',1,101,0,'SGOV')
]});
assert.equal(reconciled.state.tradePnl[1].profit,10);
assert.equal(reconciled.state.tradePnl[3].profit,40);
assert.equal(reconciled.state.tradePnl[5].profit,-5);
assert.equal(reconciled.state.tradePnl[7].profit,1);
assert(reconciled.body.includes('<td colspan="6">TECL 4'));
const edited=JSON.parse(original);edited.events[1].price=100;
assert.equal(page(edited).state.tradePnl[0].profit,150);
console.log('PASS reconciliation, same-day order, duplicate IDs, all three symbols and edited past fills recalculate sale PnL');
