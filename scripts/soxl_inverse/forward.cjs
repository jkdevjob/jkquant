#!/usr/bin/env node
'use strict';
/* 연구(클로드) ⚡ SOXL 탭 — '인버스 거래대금 비율' 전향 시험 (2026-11-10 사용자: "그래 첫번째로 가자")
 * 규칙(고정 · strategyVersion 1.0.0): SOXS 거래대금 ÷ SOXL 거래대금 ≥ 70% 인 날이 나오면 다음 거래일 종가에 SOXL 을 사고,
 *   마지막 신호 뒤 120거래일을 들고 판다. 그 밖엔 현금. 수수료 0.1% · 현금 이자 0 · 세금 없음. 실주문 없음(모의 장부).
 * 근거·한계: research/daily research/im_plan/RESEARCH_LOG.md 2026-11-10 10·11번(매매 7번 · 낙폭 80% · 다른 짝에선 안 통함 — 약한 후보).
 * 자료: 거래대금 = Eastmoney 일봉의 실제 거래대금(없으면 같은 파일의 원 종가×원 거래량 · 그것도 없으면 Yahoo 종가×거래량) · 수익률 = Yahoo 수정 종가.
 *   Yahoo 의 분할 반영 거래량은 역분할이 잦은 인버스 ETF 의 옛날 값을 정수로 뭉갠다 — 과거 기록은 저장해 둔 씨앗(history-seed.json)을 쓰고 다시 받지 않는다.
 * 누적 원칙: 날마다 한 줄을 덧붙이고(출처 표시) 한 번 적은 줄은 고치지 않는다. 신호·매수·매도 기록에는 strategyVersion 과 파라미터를 같이 남긴다.
 *   등록(registeredDate) 전의 신호는 전향 장부에 넣지 않는다 — 과거 재생(backtest)은 따로 내보내 화면에서 섞이지 않게 한다. */
const fs=require('node:fs'),path=require('node:path');
const SCHEMA=1;

/* ── 순수 계산 ── rows: [{date,a(인버스 거래대금),b(롱 거래대금),src,ret(롱 그날 수익 · 수정 종가),px(롱 종가)}] 날짜순 */
const ratioOf=r=>(r&&r.b>0&&r.a>=0)?r.a/r.b:null;
/* 전일(i−1)까지의 신호로 오늘(i) 종가 비중을 정한다 — 룩어헤드 없음. from: 이 날짜부터의 신호만 센다 · start: 이 날짜 종가를 1 로 두고 곡선을 그린다(그날 신호는 센다) */
function simulate(rows,P,opt){
  opt=opt||{};const from=opt.from||'',start=opt.start||(rows[0]&&rows[0].date)||'';
  const s0=rows.findIndex(r=>r.date>=start);const ev=[],curve=[],trades=[];
  if(s0<0)return {events:ev,curve,trades,state:{pos:'cash',next:'cash',lastSignal:null,sellIn:null,boughtDate:null,boughtPx:null,openRet:null},eq:1,bh:1,mdd:0};
  let eq=1,bh=1,pk=1,mdd=0,pos=0,last=-1,ent=null;
  for(let i=s0;i<rows.length;i++){
    const r=rows[i];
    if(i>s0){
      const ret=+r.ret||0;eq*=1+pos*ret;bh*=1+ret;
      const k=i-1,rk=ratioOf(rows[k]);
      if(rk!=null&&rk>=P.threshold&&rows[k].date>=from&&k>=s0){ if(last!==k){last=k;} }
      const want=(last>=0&&(k-last)<P.hold)?1:0;
      if(want!==pos){ eq*=1-P.fee;
        if(want===1){ent={date:r.date,px:r.px,eq};ev.push({type:'buy',date:r.date,price:r.px,signalDate:rows[last].date,ratio:ratioOf(rows[last])});}
        else{const t={in:ent.date,out:r.date,ret:eq/ent.eq-1,inPx:ent.px,outPx:r.px};trades.push(t);ev.push({type:'sell',date:r.date,price:r.px,ret:t.ret,boughtDate:ent.date,lastSignalDate:rows[last].date});ent=null;}
        pos=want; }
    }
    const rr=ratioOf(r);
    if(rr!=null&&rr>=P.threshold&&r.date>=from)ev.push({type:'signal',date:r.date,ratio:rr,inverseAmount:r.a,longAmount:r.b,src:r.src});
    pk=Math.max(pk,eq);mdd=Math.max(mdd,1-eq/pk);curve.push({date:r.date,eq,bh,pos});
  }
  /* 지금 상태 — 마지막 줄까지 본 뒤 '다음 거래일' 비중과 남은 날 */
  const n=rows.length,k=n-1,rk=ratioOf(rows[k]);let lastN=last;if(rk!=null&&rk>=P.threshold&&rows[k].date>=from&&k>=s0)lastN=k;
  const wantN=(lastN>=0&&(k-lastN)<P.hold)?1:0;
  const state={pos:pos?'hold':'cash',next:wantN?'hold':'cash',lastSignal:lastN>=0?rows[lastN].date:null,
    sellIn:(pos||wantN)?P.hold+1-(k-lastN):null,   // 마지막 줄에서 세어 몇 거래일 뒤 종가에 파는가(신호 날 = hold+1 · 1 = 다음 거래일 종가에 판다)
    boughtDate:ent?ent.date:null,boughtPx:ent?ent.px:null,openRet:ent?eq/ent.eq-1:null};
  return {events:ev,curve,trades,state,eq,bh,mdd};
}
function years(a,b){return (Date.parse(b)-Date.parse(a))/(365.25*864e5);}
function summary(rows,P,start){
  const S=simulate(rows,P,{start});const c=S.curve;if(c.length<2)return null;
  const y=years(c[0].date,c[c.length-1].date);let pk=1,bm=0;c.forEach(x=>{pk=Math.max(pk,x.bh);bm=Math.max(bm,1-x.bh/pk);});
  return {from:c[0].date,to:c[c.length-1].date,years:+y.toFixed(2),mult:+S.eq.toFixed(2),cagr:+((Math.pow(S.eq,1/y)-1)*100).toFixed(1),mdd:+(S.mdd*100).toFixed(1),
    bhMult:+S.bh.toFixed(2),bhCagr:+((Math.pow(S.bh,1/y)-1)*100).toFixed(1),bhMdd:+(bm*100).toFixed(1),
    heldPct:+(c.filter(x=>x.pos).length/c.length*100).toFixed(0),
    trades:S.trades.map(t=>({in:t.in,out:t.out,ret:+(t.ret*100).toFixed(1)})),open:S.state.pos==='hold'?{in:S.state.boughtDate,ret:+(S.state.openRet*100).toFixed(1)}:null};
}
/* 씨앗·덧붙인 줄(배열 꼴 [date,a,b,src,ret,px]) ↔ 객체 */
const unpack=a=>({date:a[0],a:a[1],b:a[2],src:a[3],ret:a[4],px:a[5]});
const pack=r=>[r.date,Math.round(r.a),Math.round(r.b),r.src,r.ret==null?null:+(+r.ret).toFixed(6),r.px==null?null:+(+r.px).toFixed(4)];
/* 새로 받은 줄을 덧붙인다 — 이미 있는 날짜는 건드리지 않는다(나중에 받은 값이 달라도 처음 적은 줄이 원본이다) */
function appendRows(have,fresh){
  const lastD=have.length?have[have.length-1].date:'';const add=fresh.filter(r=>r.date>lastD&&r.a>0&&r.b>0&&r.ret!=null).sort((x,y)=>x.date<y.date?-1:1);
  return {rows:have.concat(add),added:add};
}
/* 미국 정규장이 끝난 날짜까지만 쓴다 — 장중에 돌면 그날 봉은 미완성이다. now(UTC ms) → 뉴욕 날짜 · 16:20 전이면 전날까지 */
function settledThrough(now){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(now));
  const g=k=>p.find(x=>x.type===k).value,d=`${g('year')}-${g('month')}-${g('day')}`,hm=(+g('hour')%24)*60+(+g('minute'));
  if(hm>=16*60+20)return d;const t=new Date(Date.parse(d+'T00:00:00Z')-864e5);return t.toISOString().slice(0,10);
}
/* 받은 원자료 → 날짜별 줄. em: {SOXS:Map(date→{c,v,a}), SOXL:Map} · yh: {SOXS:[{date,c,v,ac}], SOXL:[...]} */
function buildRows(em,yh,cutoff){
  const out=[],L=yh.SOXL||[],ys=new Map((yh.SOXS||[]).map(x=>[x.date,x]));
  for(let i=1;i<L.length;i++){const z=L[i],d=z.date;if(d>cutoff)continue;const p=L[i-1];if(!(z.ac>0&&p.ac>0))continue;
    const ea=em.SOXS&&em.SOXS.get(d),eb=em.SOXL&&em.SOXL.get(d),s=ys.get(d);let a=null,b=null,src=null;
    if(ea&&eb&&ea.a>0&&eb.a>0){a=ea.a;b=eb.a;src='em';}
    else if(ea&&eb&&ea.c>0&&ea.v>0&&eb.c>0&&eb.v>0){a=ea.c*ea.v;b=eb.c*eb.v;src='em-cv';}
    else if(s&&s.c>0&&s.v>0&&z.c>0&&z.v>0){a=s.c*s.v;b=z.c*z.v;src='yh';}
    if(a==null)continue;out.push({date:d,a,b,src,ret:z.ac/p.ac-1,px:z.c});}
  return out;
}
/* 이미 적은 마지막 날(prev) 다음 거래일부터 빠짐없이 이어지는가 — 빠진 날이 있으면 그날 수익이 장부에서 사라진다. 이어지면 '' · 아니면 까닭 */
function continuity(prev,added,longBars){
  let p=prev;for(const r of added){const i=longBars.findIndex(x=>x.date===r.date);if(i<1||longBars[i-1].date!==p)return '마지막 기록('+p+') 다음 거래일부터 이어지지 않습니다: 새 줄 '+r.date;p=r.date;}
  return '';
}
/* 화면용 묶음 */
function buildView(rows,M,now){
  const P=M.params,n=rows.length,last=rows[n-1];
  const fwd=simulate(rows,P,{from:M.registeredDate,start:M.seedThrough});
  const hist=rows.filter(r=>r.date<=M.seedThrough);
  const past=hist.filter(r=>ratioOf(r)>=P.threshold),lp=past[past.length-1];
  const rr=ratioOf(last);let pk=1,bm=0;fwd.curve.forEach(x=>{pk=Math.max(pk,x.bh);bm=Math.max(bm,1-x.bh/pk);});
  return {schemaVersion:SCHEMA,strategyVersion:M.strategyVersion,params:P,registeredDate:M.registeredDate,seedThrough:M.seedThrough,asOf:last.date,updatedAt:new Date(now).toISOString(),
    today:{date:last.date,ratio:rr,inverseAmount:last.a,longAmount:last.b,src:last.src,gap:rr==null?null:P.threshold-rr},
    recent:rows.slice(-60).map(r=>({date:r.date,ratio:ratioOf(r),src:r.src})),
    state:fwd.state,lastPastSignal:lp?{date:lp.date,ratio:ratioOf(lp)}:null,
    forward:{days:fwd.curve.length-1,ret:+((fwd.eq-1)*100).toFixed(2),bhRet:+((fwd.bh-1)*100).toFixed(2),mdd:+(fwd.mdd*100).toFixed(2),bhMdd:+(bm*100).toFixed(2),
      events:fwd.events.map(e=>Object.assign({},e)),curve:fwd.curve.map(x=>({date:x.date,eq:+x.eq.toFixed(5),bh:+x.bh.toFixed(5),pos:x.pos}))},
    backtest:Object.assign({note:'등록 전 과거 재생 — 전향 성과가 아니다(세전 · 수수료 0.1% · 현금 이자 0)'},summary(hist,P,hist[0].date)),
    counts:{days:hist.length,ge50:hist.filter(r=>ratioOf(r)>=.5).length,ge70:hist.filter(r=>ratioOf(r)>=.7).length,gt100:hist.filter(r=>ratioOf(r)>1).length}};
}

/* ── 받기 ── */
async function getJson(url,tries){let err;for(let t=0;t<(tries||3);t++){try{const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),40000);
    const r=await fetch(url,{signal:ac.signal,headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});clearTimeout(tm);if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
  catch(e){err=e;await new Promise(z=>setTimeout(z,2000*(t+1)));}}throw err;}
async function fetchEastmoney(sym){
  for(const mk of [107,105,106]){try{const j=await getJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mk}.${sym}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=0&end=20500101&lmt=400`,2);
      const k=(j&&j.data&&j.data.klines)||[];if(k.length<5)continue;const m=new Map();k.forEach(l=>{const p=l.split(',');m.set(p[0],{c:+p[2],v:+p[5],a:+p[6]});});return m;}catch(e){}}
  return null;
}
async function fetchYahoo(sym,now){
  const p2=Math.floor(now/1000)+86400,p1=p2-400*86400;
  let j=null,err;for(const host of ['query1','query2']){try{j=await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`,3);break;}catch(e){err=e;}}
  if(!j||!j.chart||!j.chart.result||!j.chart.result[0])throw new Error('Yahoo '+sym+' 일봉을 못 받았습니다: '+String(err&&err.message||err||'빈 응답'));
  const r=j.chart.result[0],q=r.indicators.quote[0],adj=((r.indicators.adjclose||[{}])[0].adjclose)||[],out=[];
  for(let i=0;i<r.timestamp.length;i++){const c=q.close[i];if(!(c>0))continue;out.push({date:new Date((r.timestamp[i]+r.meta.gmtoffset)*1000).toISOString().slice(0,10),c,v:q.volume[i]||0,ac:adj[i]>0?adj[i]:c});}
  return out;
}

async function main(argv){
  const arg=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:null;};
  const app=arg('--app')||path.join(__dirname,'..','..'),out=arg('--out');if(!out)throw new Error('--out 필요');
  const now=arg('--now')?Date.parse(arg('--now')):Date.now();
  const M=JSON.parse(fs.readFileSync(path.join(app,'data','soxl-inverse','forward-model-1.0.0.json'),'utf8'));
  const seed=JSON.parse(fs.readFileSync(path.join(app,'data','soxl-inverse','history-seed.json'),'utf8')).rows.map(unpack);
  fs.mkdirSync(out,{recursive:true});
  const hp=path.join(out,'history.json'),ep=path.join(out,'events.jsonl'),lp=path.join(out,'latest.json');
  const have=fs.existsSync(hp)?JSON.parse(fs.readFileSync(hp,'utf8')).rows.map(unpack):[];
  const [yS,yL,eS,eL]=await Promise.all([fetchYahoo('SOXS',now),fetchYahoo('SOXL',now),fetchEastmoney('SOXS'),fetchEastmoney('SOXL')]);
  const fresh=buildRows({SOXS:eS,SOXL:eL},{SOXS:yS,SOXL:yL},settledThrough(now)).filter(r=>r.date>M.seedThrough);
  const ap=appendRows(have,fresh),rows=seed.concat(ap.rows);
  /* 씨앗과 새 줄 사이에 빈 거래일이 있으면(오래 안 돌았을 때) 수익률이 끊긴다 — Yahoo 는 400일치를 주므로 보통 다 메워진다. 못 메우면 멈춘다. */
  const gap=continuity(have.length?have[have.length-1].date:M.seedThrough,ap.added,yL);if(gap)throw new Error(gap);
  if(ap.added.length||!fs.existsSync(hp))fs.writeFileSync(hp,JSON.stringify({schemaVersion:SCHEMA,note:'씨앗('+M.seedThrough+') 뒤로 날마다 덧붙인 줄 [date, 인버스 거래대금, 롱 거래대금, 출처, 롱 그날 수익, 롱 종가] — 고치지 않는다',rows:ap.rows.map(pack)})+'\n');
  const view=buildView(rows,M,now);
  const seen=new Set(fs.existsSync(ep)?fs.readFileSync(ep,'utf8').split('\n').filter(Boolean).map(l=>{const e=JSON.parse(l);return e.type+'|'+e.date;}):[]);
  const fresh_ev=view.forward.events.filter(e=>!seen.has(e.type+'|'+e.date));
  if(fresh_ev.length)fs.appendFileSync(ep,fresh_ev.map(e=>JSON.stringify(Object.assign({},e,{strategyVersion:M.strategyVersion,params:M.params,recordedAt:new Date(now).toISOString()}))).join('\n')+'\n');
  /* 같은 자료로 다시 돌았으면(보완 실행) 파일을 건드리지 않는다 — 기록 시각만 바뀐 저장을 만들지 않는다 */
  const same=v=>JSON.stringify(Object.assign({},v,{updatedAt:''}));let old=null;try{old=JSON.parse(fs.readFileSync(lp,'utf8'));}catch(e){}
  if(!old||same(old)!==same(view))fs.writeFileSync(lp,JSON.stringify(view)+'\n');
  console.log(`자료 ${view.asOf} · 비율 ${(view.today.ratio*100).toFixed(1)}%(${view.today.src}) · 상태 ${view.state.pos}→${view.state.next} · 새 줄 ${ap.added.length} · 새 기록 ${fresh_ev.length} · 출처 Eastmoney ${eS&&eL?'OK':'실패(대체)'}`);
  return {view,added:ap.added,events:fresh_ev};
}
module.exports={SCHEMA,ratioOf,simulate,summary,appendRows,continuity,settledThrough,buildRows,buildView,unpack,pack,main};
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e);process.exit(1);});
