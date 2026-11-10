// Guard OFF 사건 해부(11-11 · 사용자 "판 게 손해인 경우가 훨씬 많다 · 급반등 때 늦게 되사는 것 — 최대한 개선하게 심도있게 분석")
// ① 실제 2011-04~ : 앱 엔진(기본 규칙) 장부의 TQQQ 매도→매수 쌍 = Guard OFF 사건. 같은 상태기계를 TQQQ 체결가로 다시 돌려 앱 장부와 날짜·가격이 같은지 먼저 확인한다.
// ② 합성 1986~2010 : SYNTQQQ(NDX 3배 · 비용 반영) 에 같은 상태기계(SMA225 ±1% · 전일 종가 신호 → 다음 날 종가 체결)를 돌려 사건 수를 늘린다.
// 사건마다: 판 값 → 되산 값(웃돈) · 웃돈 분해(밴드 · 이평 이동 · 신호일 넘침 · 하루 늦은 체결) · OFF 동안 최저가 · 바닥 → 되산 날까지 · 이탈 당일 특징(VIX · 하락 속도 · 이평 기울기 · 고점 대비).
// 사용: node planrule/whip_anatomy.js [out.json]
const fs=require('fs'),path=require('path'); const D=__dirname, R=path.join(D,'..','data');
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const trade=s=>rd(path.join(D,'data',s+'.json')).ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0);
const ser=s=>rd(path.join(R,s+'.json')).series.filter(x=>x.close>0);
const mapOf=a=>{ const m=new Map(); a.forEach(x=>m.set(x.date,x.close)); return m; };
const VIX=mapOf(ser('VIX')), NDX=mapOf(ser('NDX'));
const sma=(a,n)=>{ const o=Array(a.length).fill(null); let s=0; for(let i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; if(i>=n-1) o[i]=s/n; } return o; };
const sd=(a,i,n)=>{ if(i<n) return null; const r=[]; for(let j=i-n+1;j<=i;j++) r.push(Math.log(a[j]/a[j-1])); const m=r.reduce((x,y)=>x+y,0)/n; return Math.sqrt(r.reduce((x,y)=>x+(y-m)**2,0)/(n-1)*252); };
// 상태기계: 신호일 p 의 종가 c 와 SMA → ON(c>SMA×1.01) · OFF(c<SMA×0.99) · 사이면 직전 보유 그대로. 첫날 보유 없음 = OFF 에서 시작(앱 기본과 같음). 체결은 다음 날(p+1) 종가.
function episodes(dates,c,from,to){
  const m=sma(c,225); let on=false,cur=null; const ev=[];
  for(let i=1;i<dates.length;i++){ const p=i-1, d=dates[i]; if(d<from) continue; if(to&&d>to) break; if(!(m[p]>0)) continue;
    const want=c[p]>m[p]*1.01?true:c[p]<m[p]*0.99?false:on;
    if(want===on) continue;
    if(!want){ cur={offSig:p,offExe:i}; }
    else if(cur){ cur.onSig=p; cur.onExe=i; ev.push(cur); cur=null; }
    on=want; }
  if(cur) ev.push(cur);   // 아직 OFF 인 사건(진행 중)
  return {ev,m};
}
function describe(dates,c,m,e){
  const x={offSig:dates[e.offSig],offDate:dates[e.offExe],offPx:c[e.offExe],sigPx:c[e.offSig],smaOff:m[e.offSig]};
  const p=e.offSig;
  x.depth=c[p]/m[p]-1;                                    // 신호일 이평 대비(−1% 를 얼마나 넘었나)
  x.r1=c[p]/c[p-1]-1; x.r5=c[p]/c[p-5]-1; x.r20=c[p]/c[p-20]-1;
  let hi=0,hiI=p; for(let j=Math.max(0,p-252);j<=p;j++) if(c[j]>hi){ hi=c[j]; hiI=j; } x.ddHi=c[p]/hi-1; x.daysFromHi=p-hiI;
  x.slope=m[p]/m[p-20]-1;                                  // 이평 20일 기울기
  x.vix=VIX.get(dates[p])??null; const v5=VIX.get(dates[p-5]); x.vixUp=(x.vix!=null&&v5)?x.vix/v5-1:null;
  x.sig20=sd(c,p,20);
  const nd=NDX.get(dates[p]); let nd20=null; { const d20=dates[p-20]; const a=NDX.get(d20); if(nd&&a) nd20=nd/a-1; } x.ndx20=nd20;
  const end=e.onExe??c.length-1; let lo=Infinity,loI=e.offExe; for(let j=e.offExe;j<=end;j++) if(c[j]<lo){ lo=c[j]; loI=j; }
  x.low=lo; x.lowDate=dates[loI]; x.avoided=lo/x.offPx-1; x.offDays=end-e.offExe;
  if(e.onExe!=null){
    x.onSig=dates[e.onSig]; x.onDate=dates[e.onExe]; x.onPx=c[e.onExe]; x.smaOn=m[e.onSig];
    x.prem=x.onPx/x.offPx-1;                               // + 면 판 값보다 비싸게 되삼(가짜 이탈)
    // 웃돈 분해(로그): 판 날 늦은 체결 · 신호일 넘침(−1% 아래로 더) · 밴드 2% · 이평 이동 · 켜는 신호일 넘침 · 산 날 늦은 체결
    const L=Math.log; x.dec={lagOff:L(c[e.offSig]/c[e.offExe]), under:L(m[e.offSig]*0.99/c[e.offSig]), band:L(1.01/0.99), drift:L(m[e.onSig]/m[e.offSig]), over:L(c[e.onSig]/(m[e.onSig]*1.01)), lagOn:L(c[e.onExe]/c[e.onSig])};
    x.lagFromLow=e.onExe-loI; x.fromLow=x.onPx/lo-1;       // 바닥 뒤 며칠 · 바닥보다 몇 % 위에서 되샀나
  }
  return x;
}
const out={};
// ① 실제 — 앱 엔진 장부와 맞춰 보기
const E=require('./engine_var').load({});
const T=trade('TECL'),Q=trade('TQQQ'),G=trade('SGOV'),qd=new Set(T.map(x=>x.date)),QQ=Q.filter(x=>qd.has(x.date));
const Rp=E.replay({horizon:5,rules:'base',startDate:'2011-04-01',endDate:'',principal:1e6,monthlyAdd:0,tecl:T,tqqq:Q,sgov:G});
const led=Rp.ledger.events.filter(x=>x.type==='trade'&&x.symbol==='TQQQ').map(x=>x.date+' '+x.side+' '+(+x.price).toFixed(2));
const dq=QQ.map(x=>x.date), cq=QQ.map(x=>x.close);
const A=episodes(dq,cq,'2011-04-01');
const mine=[]; { const s=A.ev; for(const e of s){ mine.push(dq[e.offExe]+' sell '+cq[e.offExe].toFixed(2)); if(e.onExe!=null) mine.push(dq[e.onExe]+' buy '+cq[e.onExe].toFixed(2)); } }
const ledNoFirst=led.slice(1);   // 앱 첫 매수(시작일)는 사건이 아님
const same=JSON.stringify(ledNoFirst)===JSON.stringify(mine);
console.log('앱 엔진 장부와 상태기계 일치:',same,'· 앱 TQQQ 주문',led.length,'· 사건',A.ev.length,(same?'':'\n 앱 '+ledNoFirst.slice(0,6).join(' | ')+'\n 나 '+mine.slice(0,6).join(' | ')));
if(!same){ for(let i=0;i<Math.max(ledNoFirst.length,mine.length);i++) if(ledNoFirst[i]!==mine[i]){ console.log('첫 차이',i,ledNoFirst[i],'vs',mine[i]); break; } }
out.real=A.ev.map(e=>describe(dq,cq,A.m,e));
// ② 합성 1986~2011-03(실제와 겹치지 않게)
const S=ser('SYNTQQQ'); const ds=S.map(x=>x.date), cs=S.map(x=>x.close);
const B=episodes(ds,cs,'1986-09-01','2011-03-31');
out.syn=B.ev.map(e=>describe(ds,cs,B.m,e));
const f=(x,d=1)=>x==null||!isFinite(x)?'  —':(x*100).toFixed(d);
for(const [lab,L] of [['실제 2011-04~ (앱 엔진 · 체결가)',out.real],['합성 1986-09~2011-03 (SYNTQQQ)',out.syn]]){
  console.log(`\n■ ${lab} — 사건 ${L.length}개`);
  console.log(' 판 날       판값    되산 날     웃돈%  OFF일  OFF최저% 바닥→산날 바닥위% | 이탈일 깊이% 1일% 5일% 20일% 고점대비% 이평기울기% VIX  σ20%');
  for(const x of L) console.log(` ${x.offDate} ${x.offPx.toFixed(2).padStart(7)} ${x.onDate||'(진행 중)'.padEnd(10)} ${f(x.prem).padStart(6)} ${String(x.offDays).padStart(5)} ${f(x.avoided).padStart(7)} ${String(x.lagFromLow??'—').padStart(6)} ${f(x.fromLow).padStart(7)} | ${f(x.depth).padStart(6)} ${f(x.r1).padStart(5)} ${f(x.r5).padStart(5)} ${f(x.r20).padStart(6)} ${f(x.ddHi).padStart(7)} ${f(x.slope).padStart(6)} ${x.vix==null?'  —':x.vix.toFixed(1).padStart(5)} ${f(x.sig20,0).padStart(4)}`);
  const done=L.filter(x=>x.onDate), W=done.filter(x=>x.prem>0), Sv=done.filter(x=>x.prem<=0);
  const sumL=a=>a.reduce((s,x)=>s+Math.log(1+x.prem),0);
  const med=a=>{ const b=[...a].sort((p,q)=>p-q); return b.length?b[Math.floor((b.length-1)/2)]:null; };
  console.log(` 가짜 이탈(비싸게 되삼) ${W.length} · 로그 웃돈 합 ${f(sumL(W))} · 중앙 ${f(med(W.map(x=>x.prem)))} · OFF 중앙 ${med(W.map(x=>x.offDays))}일 | 지킨 이탈 ${Sv.length} · 합 ${f(sumL(Sv))} · 중앙 ${f(med(Sv.map(x=>x.prem)))} · OFF 중앙 ${med(Sv.map(x=>x.offDays))}일`);
  const comp=k=>W.reduce((s,x)=>s+x.dec[k],0);
  console.log(` 가짜 이탈 웃돈 분해(로그 합 %p): 판 날 늦은 체결 ${f(comp('lagOff'))} · 신호일 −1% 넘어선 몫 ${f(comp('under'))} · 밴드 2% ${f(comp('band'))} · 이평이 오른 몫 ${f(comp('drift'))} · 켜는 날 +1% 넘어선 몫 ${f(comp('over'))} · 산 날 늦은 체결 ${f(comp('lagOn'))}`);
  const compS=k=>Sv.reduce((s,x)=>s+x.dec[k],0);
  console.log(` 지킨 이탈 분해: 늦은 체결 ${f(compS('lagOff'))} · 넘어선 ${f(compS('under'))} · 밴드 ${f(compS('band'))} · 이평 ${f(compS('drift'))} · 넘어선 ${f(compS('over'))} · 늦은 체결 ${f(compS('lagOn'))}`);
  const lagW=done.map(x=>x.fromLow), lagD=done.map(x=>x.lagFromLow);
  console.log(` 바닥 → 되산 날: 중앙 ${med(lagD)}일 · 바닥보다 중앙 +${f(med(lagW))}% 위에서 되삼 · 가장 큰 5개 ${done.slice().sort((a,b)=>b.fromLow-a.fromLow).slice(0,5).map(x=>x.lowDate+' +'+f(x.fromLow,0)+'%('+x.lagFromLow+'일)').join(' · ')}`);
  for(const [k,lab2] of [['depth','이탈일 이평 대비'],['r5','5일 수익'],['r20','20일 수익'],['ddHi','고점 대비'],['slope','이평 기울기'],['vix','VIX'],['sig20','σ20']]){
    const a=W.map(x=>x[k]).filter(v=>v!=null), b=Sv.map(x=>x[k]).filter(v=>v!=null), sc=k==='vix'?1:100;
    console.log(`   특징 ${lab2.padEnd(9)} 가짜 중앙 ${(med(a)*sc).toFixed(1).padStart(6)} [${a.length?(Math.min(...a)*sc).toFixed(1):'—'} ~ ${a.length?(Math.max(...a)*sc).toFixed(1):'—'}] · 지킨 중앙 ${(med(b)*sc).toFixed(1).padStart(6)} [${b.length?(Math.min(...b)*sc).toFixed(1):'—'} ~ ${b.length?(Math.max(...b)*sc).toFixed(1):'—'}]`); }
}
if(process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(out));
