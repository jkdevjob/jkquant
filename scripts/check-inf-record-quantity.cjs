'use strict';
// 실제 운영 함수를 그대로 실행한다. 가격 하락으로 제출하지 않은 수량을 만들어선 안 된다.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'../index.html'),'utf8');
function fn(src,name){
  const start=src.indexOf('function '+name+'('); assert(start>=0,'missing '+name);
  let i=src.indexOf('{',start), n=0;
  for(;i<src.length;i++){ if(src[i]==='{')n++; else if(src[i]==='}'&&!--n)return src.slice(start,i+1); }
  throw Error('unterminated '+name);
}
function scope(src){
  // 1회분 655.2755…는 화면에서 $655.28로 표시된다(하방 호가는 내림).
  const e={settings:{ticker:'SOXL',div:20,target:10,principal:104*96.94+1474.37,rows:3,big:20},
    hist:[{date:'2026-11-04',kind:'1회매수',price:96.94,qty:104,tManual:17.75}]};
  const quote={symbol:'SOXL',price:999,days:[{date:'2026-11-04',close:94},{date:'2026-11-05',close:40.87}]};
  const elements={};
  const ctx=vm.createContext({console,curStrat:()=>e,quoteOf:()=>quote,
    infSettledLast:()=>quote.days[quote.days.length-1],curOf:()=>'usd',inputNum:()=>0,
    curCurrency:()=>'usd',sheetTprev:()=>{},nfix:(v,n)=>(+v).toFixed(n),SETTLE_LAG_MIN:30,
    document:{querySelectorAll:()=>[]},
    $:id=>elements[id]||(elements[id]={value:id==='sh_date'?'2026-11-05':'',style:{},innerHTML:'',scrollIntoView(){}}),
    wn:v=>'$'+(+v).toFixed(2)});
  const names=['computeInf','infRecordState','infRecordBuy','infSuggest','sheetInfHTML','sheetSelInf','fieldPriceQty','kindOptHTML','fmtT',
    'imBuy1','imBuyOrders','imBigPct','imRowsOf','imTickRound','vrTick','vrTickDn','imStarPx','imBuyPx',
    'starPct','reverseT','isBuy','isSell','isAmtKind','imCycleEnds','imDayOpenAfter','revSupported','revEnabled','imRevBuyQty'];
  const at=src.indexOf('const KIND_T=');
  vm.runInContext(src.slice(at,src.indexOf('};',at)+2)+'\n'+
    'const REV_DIVS=[20,40], IM_BIG_DEFAULT=20, IM_ROWS_DEFAULT=3; let _infReplayAsOf="", _infResume=null;\n'+
    'const isCx=k=>k.includes("+");\n'+names.map(n=>fn(src,n)).join('\n'),ctx);
  return {ctx,e,quote,run:k=>ctx.infSuggest(k), buy:(c,p,v)=>ctx.infRecordBuy(c,p,v)};
}
function checks(src){
  const a=scope(src), g=a.run('1회매수');
  assert.equal(g.price,40.87); assert.equal(g.qty,10); assert.equal(g.buyFill.mainQty,7); assert.equal(g.buyFill.extraQty,3);
  assert.equal(g.buyFill.plan.map(o=>o.q).join(','),'7,1,1,1');
  assert.equal(g.buyFill.plan.map(o=>o.price.toFixed(2)).join(','),'89.42,81.90,72.80,65.52');
  assert.equal(a.run('지정가매도+1회매수').buy.qty,10);
  const h=a.ctx.sheetInfHTML('2026-11-05');
  assert.match(h,/본 주문 7 \+ 하방 3/); assert.match(h,/sheetPickInf\('1회매수',40.87,10\)/);
  a.ctx.sheetSelInf('1회매수');
  assert.equal(a.ctx.$('sh_qty').value,10,'actual input field');
  assert.equal(a.ctx.$('sh_price').value,'40.87');
  assert.match(a.ctx.$('sh_autonote').innerHTML,/본 주문 7주 \+ 하방 3주 = 10주/);
  const c=a.ctx.infRecordState('2026-11-05');
  // 각 LOC 경계는 같으면 체결. 종가가 낮아져도 본 주문 7주는 늘지 않는다.
  for(const [px,qty] of [[89.43,0],[89.42,7],[81.91,7],[81.90,8],[72.81,8],[72.80,9],[65.53,9],[65.52,10],[1,10]])
    assert.equal(a.buy(c,px,94).qty,qty,'LOC close '+px);
  a.e.settings.rows=0; assert.equal(a.run('1회매수').qty,7); a.e.settings.rows=3;
  const original=a.e.hist, json=JSON.stringify(original);
  a.e.hist.push({date:'2026-11-05',kind:'쿼터매도',price:100,qty:26});
  assert.equal(a.run('1회매수').qty,10,'same-day sell must not resize morning orders');
  assert.strictEqual(a.e.hist,original); assert.equal(a.e.hist.length,2);
  a.e.hist.pop(); assert.equal(JSON.stringify(a.e.hist),json);
  // 계산 실패에도 원장 참조·재생 cutoff·이어계산 캐시를 복구한다.
  vm.runInContext('globalThis.keepCompute=computeInf; _infReplayAsOf="sentinel"; _infResume={sentinel:1}; computeInf=()=>{throw Error("test");};',a.ctx);
  assert.throws(()=>a.ctx.infRecordState('2026-11-05'),/test/);
  assert.strictEqual(a.e.hist,original);
  assert.equal(vm.runInContext('_infReplayAsOf',a.ctx),'sentinel');
  assert.equal(vm.runInContext('_infResume.sentinel',a.ctx),1);
  vm.runInContext('computeInf=keepCompute;',a.ctx);
  // 전반전: 별지점만 체결 = 절반, 두 본 주문 체결 = 1회. 하방 수량도 같은 회차에 포함.
  const half={st:{ticker:'SOXL',div:20,rows:3,big:20},avg:100,T:2,tp:20,bal:9000,qty:50};
  const partial=a.buy(half,105,100), full=a.buy(half,99,100);
  assert.equal(partial.qty,2); assert.equal(partial.kind,'절반매수');
  assert.equal(full.qty,5); assert.equal(full.kind,'1회매수');
  assert.equal(a.buy(half,125,100).qty,0);
  // 첫 매수: 전일 종가로 주문수량을 고정한다. 전일 봉이 없으면 추정 주문을 만들지 않는다.
  const first={st:{ticker:'SOXL',div:20,rows:3,big:20},avg:0,T:0,tp:20,bal:10000,qty:0};
  assert.equal(a.buy(first,40,100).qty,7);
  assert.equal(a.buy(first,40,0).qty,0);
  const low={...c,bal:100}, lowBuy=a.buy(low,1,94);
  assert(lowBuy.plan.reduce((s,o)=>s+o.price*o.q,0)<=100,'reserved order value stays within cash');
  assert.equal(a.buy({...c,T:19.5},1,94).qty,0);
  return true;
}
checks(source);
console.log('PASS LOC 기록: 7+1+1+1=10 · 가격/하방 경계 · 추천/복합 · 전반전/첫 매수 · 소진/잔금 · 원장/실패 복구');
const mutations=[
  ['종가로 수량 재계산(기존 버그)',s=>s.replace("qty:k===buyFill.kind?buyFill.qty:0","qty:Math.floor((k==='절반매수'?buy1/2:buy1)/close)")],
  ['LOC 체결 조건 무시',s=>s.replace('plan.filter(o=>close<=o.price)','plan.filter(o=>true)')],
  ['체결 후 장부로 아침 주문 재계산',s=>s.replace('const c=infRecordState(closeDate), st=c.st;','const c=computeInf(), st=c.st;')],
];
for(const [name,mutate] of mutations){
  const changed=mutate(source); assert.notEqual(changed,source,'mutation applied: '+name);
  assert.throws(()=>checks(changed),'mutation detected: '+name); console.log('PASS 변이 차단: '+name);
}
