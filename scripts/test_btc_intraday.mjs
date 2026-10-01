import fs from "node:fs";

const src=fs.readFileSync("worker/global-intraday-scheduler/src/index.js","utf8");
const mod=await import("data:text/javascript;base64,"+Buffer.from(src).toString("base64"));
const {btcTrade,BTC_OPEN_HM,BTC_LAST_SIGNAL_HM,BTC_LAST_ENTRY_HM,BTC_EXIT_TRACK_END_HM,BTC_STRATEGY_VERSION}=mod;

function hmText(hm){
  const h=Math.floor(hm/100),m=hm%100;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}
function bar(hm,{o=99,h=99.5,l=98.5,c=99,v=100}={}){
  const t=hmText(hm);
  return {ms:Date.parse("2026-10-01T"+t+":00+09:00"),date:"2026-10-01",hm,time:t,o,h,l,c,v};
}
const now=Date.parse("2026-10-02T00:10:00+09:00");

if(BTC_OPEN_HM!==0||BTC_LAST_SIGNAL_HM!==2155||BTC_LAST_ENTRY_HM!==2200||BTC_EXIT_TRACK_END_HM!==2305)throw new Error("BTC window constants mismatch");
if(BTC_STRATEGY_VERSION!=="btc_midnight_orb_v2")throw new Error("BTC strategy version mismatch");

const early=[
  bar(0,{o:95,h:100,l:94,c:95,v:100}),
  bar(5,{o:95,h:99.5,l:94,c:99,v:90}),
  bar(10,{o:99,h:101.2,l:98.8,c:101,v:150}),
  bar(15,{o:101,h:102.2,l:100.8,c:102,v:110}),
  bar(20,{o:102,h:102.1,l:101.5,c:101.8,v:100})
];
const t1=btcTrade(early,now,"2026-10-01");
if(!t1||t1.entry.hm!==15||t1.signal.hm!==10)throw new Error("midnight ORB early signal failed");

const lastAllowed=[
  bar(0,{o:95,h:100,l:94,c:95,v:100}),
  bar(2150,{o:99,h:99.5,l:98.5,c:99,v:90}),
  bar(2155,{o:99,h:101.2,l:98.8,c:101,v:150}),
  bar(2200,{o:101,h:102.2,l:100.8,c:102,v:110}),
  bar(2205,{o:102,h:102.1,l:101.5,c:101.8,v:100})
];
const t2=btcTrade(lastAllowed,now,"2026-10-01");
if(!t2||t2.signal.hm!==2155||t2.entry.hm!==2200)throw new Error("21:55 signal -> 22:00 entry boundary failed");

const tooLate=[
  bar(0,{o:95,h:100,l:94,c:95,v:100}),
  bar(2155,{o:99,h:99.5,l:98.5,c:99,v:90}),
  bar(2200,{o:99,h:101.2,l:98.8,c:101,v:150}),
  bar(2205,{o:101,h:102.2,l:100.8,c:102,v:110})
];
if(btcTrade(tooLate,now,"2026-10-01")!==null)throw new Error("22:00 signal must not create 22:05 entry");

console.log("✓ BTC live 00:00 ORB / 22:00 entry boundary");
