// 합성 USD(반도체 2배) · 합성 SMH(반도체 1배) — 2026-10-31 USD vs 5년 플랜 연구
// 기초 1배 = 2000-06-05 전은 SOX 지수(가격지수), 그 뒤는 SMH 총수익(조정종가 · 고저는 같은 날 조정비율로 맞춤)을 이어 붙인 계열(SEMI1).
//   SOX 2배만 쓰면 2022~ 실제 USD 연 44.7% vs 합성 25.6% 로 크게 어긋난다(USD 지수는 시총가중 — 엔비디아 비중이 크다).
//   SMH 총수익 2배는 2007-02~2026-10 실제 27.8% vs 합성 28.3% 로 맞는다(하위 구간은 ±4~7%p 오차).
// USD = 2×SEMI1 − (보수 0.95% + 1×T-bill)/252 · SMH = SEMI1(SOX 구간만 보수 0.35% 차감 — SMH 총수익은 이미 보수 뺀 값)
const fs=require('fs'),path=require('path'); const {synth}=require('./synth'); const {withSplits}=require('./synsplit'); const D=path.join(__dirname,'data');
const rd=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json')));
const CUT='2000-06-05';
const sox=rd('SOX').ohlc.filter(x=>x.close>0&&x.date<=CUT);
const smh=rd('SMH'); const adj={}; smh.series.forEach(x=>adj[x.date]=x.close);
const smhO=smh.ohlc.filter(x=>x.close>0&&adj[x.date]>0&&x.date>=CUT).map(x=>{ const k=adj[x.date]/x.close; return {date:x.date,open:(x.open||x.close)*k,high:(x.high||x.close)*k,low:(x.low||x.close)*k,close:adj[x.date]}; });
// 이어 붙이기: CUT 날 SOX 종가 = SMH 조정종가 가 되도록 SOX 쪽을 맞춘다
const a=sox[sox.length-1], b=smhO[0]; if(a.date!==CUT||b.date!==CUT) throw new Error('이음 날짜 '+a.date+' '+b.date);
const k=b.close/a.close; const fee1=0.0035/252; let acc=1; const pre=[];
for(let i=0;i<sox.length-1;i++){ pre.push(sox[i]); }
// SOX 구간 보수 차감: 뒤에서부터 누적(이음 날 값을 고정)
const n=pre.length; const preAdj=pre.map((x,i)=>{ const f=Math.pow(1-fee1,-(n-i)); return {date:x.date,open:x.open*k*f,high:x.high*k*f,low:x.low*k*f,close:x.close*k*f}; });
const semi=[...preAdj,...smhO];
fs.writeFileSync(path.join(D,'SEMI1.json'),JSON.stringify({symbol:'SEMI1',src:'synthetic',series:semi.map(r=>({date:r.date,close:r.close})),ohlc:semi}));
const s2=synth('SEMI1',2,0.0095,'SYNUSD'), s1=synth('SEMI1',1,0,'SYNSMH');
console.log(withSplits('SYNUSD'), withSplits('SYNSMH'));
const cmp=(name,syn,real,spans)=>{ const m={}; syn.forEach(r=>m[r.date]=r.close); const R=rd(real).series;
  for(const [a,b] of spans){ const ra=R.find(x=>x.date>=a&&m[x.date]), rb=[...R].reverse().find(x=>x.date<=b&&m[x.date]); const y=(Date.parse(rb.date)-Date.parse(ra.date))/(365.25*864e5);
    const cr=(Math.pow(rb.close/ra.close,1/y)-1)*100, cs=(Math.pow(m[rb.date]/m[ra.date],1/y)-1)*100; console.log(name,ra.date,'~',rb.date,'실제',cr.toFixed(1),'합성',cs.toFixed(1),'차',(cs-cr).toFixed(1)); } };
cmp('USD',s2,'USD',[['2007-02-01','2026-10-31'],['2007-02-01','2011-12-31'],['2012-01-01','2016-12-31'],['2017-01-01','2021-12-31'],['2022-01-01','2026-10-31']]);
cmp('SMH',s1,'SMH',[['2000-06-05','2026-10-31']]);
const lo=(a,b,c)=>{ const w=s2.filter(r=>r.date>=a&&r.date<=b); const pk=Math.max(...s2.filter(r=>r.date>=c&&r.date<=a).map(r=>r.close)); return ((Math.min(...w.map(r=>r.close))/pk-1)*100).toFixed(1); };
console.log('합성 USD 낙폭 | 닷컴(2000 고점→2002-10)',lo('2000-03-10','2002-10-31','2000-01-01'),'| 금융위기',lo('2007-07-17','2009-03-31','2007-01-01'),'| 2022',lo('2021-12-27','2022-12-31','2021-11-01'));
const R=rd('USD').series; const lr=(a,b,c)=>{ const w=R.filter(r=>r.date>=a&&r.date<=b); const pk=Math.max(...R.filter(r=>r.date>=c&&r.date<=a).map(r=>r.close)); return ((Math.min(...w.map(r=>r.close))/pk-1)*100).toFixed(1); };
console.log('실제 USD 낙폭 | 금융위기',lr('2007-07-17','2009-03-31','2007-02-01'),'| 2022',lr('2021-12-27','2022-12-31','2021-11-01'));
