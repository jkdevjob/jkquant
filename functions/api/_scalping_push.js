// 단타(지피티) 웹 알림 메시지 생성 — 실제 주문을 새로 만들지 않고 서버 모의장부의 진입/청산 시점만 읽는다.
// 입력은 /api/scalping-live 응답. 같은 event id 는 Worker 저장소에서 중복 제거한다.

const LABEL={opening:"시초가",daytrading:"데이트레이딩",crypto:"비트코인",soxl:"SOXL"};
const signed=v=>Number.isFinite(Number(v))?((+v>=0?"+":"")+Number(v).toFixed(2)+"%"):"";
const krPrice=v=>Number.isFinite(Number(v))?Math.round(Number(v)).toLocaleString("ko-KR")+"원":"";
const usPrice=v=>Number.isFinite(Number(v))?"$"+Number(v).toFixed(2):"";
const clock=v=>{
  if(v==null||v==="")return "";
  const s=String(v);
  if(/^\d{3,4}$/.test(s)){const z=s.padStart(4,"0");return z.slice(0,2)+":"+z.slice(2);}
  return s;
};
function priceOf(strategy,v){return strategy==="soxl"?usPrice(v):krPrice(v);}
function eventKey(strategy,date,x,side){
  const raw=x&&x.id?String(x.id):[
    x&&x.code||strategy,x&&x.signalTime||"",x&&x.entryTime||"",x&&x.exitTime||"",side
  ].join(":");
  return "gpt:"+strategy+":"+String(date||"")+":"+raw+":"+side;
}
function add(out,strategy,date,side,x,price,pnl){
  const buy=side==="buy",label=LABEL[strategy]||strategy,nm=x.name||x.code||label;
  const t=clock(buy?x.entryTime:x.exitTime);
  const bits=[nm,t,priceOf(strategy,price)].filter(Boolean);
  if(!buy&&pnl!=null&&Number.isFinite(Number(pnl)))bits.push(signed(pnl));
  if(!buy&&x.reason)bits.push(String(x.reason));
  out.push({
    id:eventKey(strategy,date,x,side),
    title:(buy?"🟢 ":"🔴 ")+"단타(지피티) "+label+" "+(buy?"매수":"매도")+" 타이밍",
    body:bits.join(" · ")+" · 서버 모의장부 기준",
    tag:"gpt-"+strategy+"-"+side,
    url:"/scalping",
    price:Number.isFinite(Number(price))?Number(price):null
  });
}
export function scalpingPushEvents(live){
  const out=[],T=live&&live.tabs||{};
  const opening=T.opening||{};
  for(const e of opening.events||[]){
    const s=e.signal||e,side=e.stage;
    if(side!=="buy"&&side!=="sell")continue;
    add(out,"opening",opening.date||e.date,side,
      {...s,id:e.id||s.id,name:e.name||s.name,code:e.code||s.code},
      side==="buy"?(s.entryPrice??s.price??s.signalPrice):(s.exitPrice??s.price),
      s.pnl??s.pnlPct);
  }
  for(const strategy of ["daytrading","crypto","soxl"]){
    const tab=T[strategy]||{},date=tab.date||"";
    for(const x of tab.trades||[]){
      if(x.entryPrice!=null&&Number.isFinite(Number(x.entryPrice))){
        add(out,strategy,date,"buy",x,x.entryPrice,null);
      }
      const pnl=strategy==="daytrading"?x.pnl:x.pnlPct;
      if(x.status==="closed"&&x.exitPrice!=null&&Number.isFinite(Number(x.exitPrice))){
        add(out,strategy,date,"sell",x,x.exitPrice,pnl);
      }
    }
  }
  return out;
}
