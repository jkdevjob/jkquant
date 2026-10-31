// 연속 상승·하락일 매매법 시험(사용자 질문 10-31) — SOXL 실제 2010-03~ · 합성 SYNSOXL 1994~(출시 전 1994~2010 은 표본 밖) · 1만$·10만$
// 체결 두 가지: loc = 그날 종가로 정해지는 조건을 LOC 로 미리 건다(‘N일째 하락이면 매수’ = 전일 종가 −1센트 LOC 매수 · ‘첫 상승일 매도’ = 전일 종가 +1센트 LOC 매도) — 룩어헤드 아님
//               next = 종가로 확정된 신호를 다음 날 종가에(MOC) — 더 보수적.
// 비용: 매매마다 수수료 0.25% + 슬리피지 0.05% · 양도세 22%(250만원 공제, 해마다) · 끝날 그해 실현이익 세금 미리 뺌(px 와 같은 기준) · 소수 주.
// 잔금 이자: 없음(기본) · rp = T-bill −0.5%p(이자소득세 15.4%).
// 규칙: dip:N:exit — N일 연속 하락으로 끝난 날 종가 매수 · exit = up1(첫 상승일 종가 매도) · hH(H일 보유) · up1hH(둘 중 먼저) · up2(2일 연속 상승에 매도)
//       mom:N — N일 연속 상승에 매수 · 첫 하락일에 매도   |   bh — 사서 들고 있기   |   bhx:N — 들고 있다가 N일 연속 상승에 팔고 첫 하락일에 다시 산다
// 사용: node streak.js [규칙,…]   (기본 목록은 아래)
const fs=require('fs'), path=require('path'); const {stats,q}=require('./px');
const load=s=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',s+'.json'))).series.filter(x=>x.close>0);
const IRX={}; load('IRX').forEach(x=>IRX[x.date]=x.close);
const FEE=0.003, KRW=1350, DED=250e4/KRW;
function run(D,rule,o){ const {dates,C,st}=D; const cap=o.cap; const i0=Math.max(1,dates.findIndex(d=>d>=(o.from||'0'))), i1=o.to?dates.findLastIndex(d=>d<=o.to):dates.length-1;
  const [kind,a1,a2]=rule.split(':'); const N=+a1||0;
  let cash=cap, sh=0, basis=0, yr=dates[i0].slice(0,4), pnl=0, held=0, inDays=0, trades=0, wins=0, lastIrx=0, entryV=0; const eq=[];
  const buy=px=>{ const g=cash/(1+FEE); sh=g/px; basis=cash; entryV=cash; cash=0; held=0; trades++; };
  const sell=px=>{ const g=sh*px*(1-FEE); pnl+=g-basis; if(g>entryV) wins++; cash+=g; sh=0; basis=0; };
  const H=a2&&a2.startsWith('h')?+a2.slice(1):a2&&a2.startsWith('up1h')?+a2.slice(4):0;
  for(let k=i0;k<=i1;k++){ const d=dates[k]; if(IRX[d]!=null) lastIrx=IRX[d];
    if(o.rp&&cash>0&&k>i0){ const gap=Math.max(1,Math.round((Date.parse(d)-Date.parse(dates[k-1]))/864e5)); cash+=cash*Math.max(0,lastIrx/100-0.005)*(1-0.154)*gap/365; }
    const y=d.slice(0,4); if(y!==yr){ const t=pnl>0?Math.max(0,pnl-DED)*0.22:0; pnl=0; yr=y;
      if(t>0){ if(cash<t&&sh>0){ const n=Math.min(sh,(t-cash)/(C[k]*(1-FEE))), g=n*C[k]*(1-FEE), b=basis*n/sh; pnl+=g-b; basis-=b; sh-=n; cash+=g; }   // 현금이 모자라면 주식을 팔아 세금을 낸다(그 매도 이익은 올해 몫)
        cash=Math.max(0,cash-t); } }   // 세금이 계좌보다 크면(예: 2000 년 초 실현이익 → 그해 폭락) 계좌는 0 = 파산으로 본다
    const s=o.mode==='loc'?st[k]:st[k-1];   // loc: 오늘 종가까지 센 연속(조건부 LOC 로 실행 가능) · next: 어제 종가까지(확정 신호, 오늘 종가 체결)
    if(sh>0){ held++; let out=false;
      if(kind==='dip'){ if(a2==='up1') out=s>=1; else if(a2==='up2') out=s>=2; else if(a2.startsWith('up1h')) out=s>=1||held>=H; else if(a2.startsWith('h')) out=held>=H; }
      else if(kind==='mom') out=s<=-1; else if(kind==='bhx') out=s>=N;
      if(out) sell(C[k]); }
    else { let go=false; if(kind==='dip') go=s<=-N; else if(kind==='mom') go=s>=N; else if(kind==='bh') go=true; else if(kind==='bhx') go=s<=-1||k===i0;
      if(go&&cash>0) buy(C[k]); }
    if(sh>0) inDays++;
    eq.push([d,cash+sh*C[k]]); }
  // 끝: 그해 실현이익 세금 미리 뺌 + 들고 있는 것은 팔았다고 보고 그 이익의 세금도(사서 들고 있기와 같은 기준)
  const lastPx=C[i1]; let fin=cash+sh*lastPx*(1-FEE); const unreal=sh>0?sh*lastPx*(1-FEE)-basis:0; const tp=pnl+unreal; if(tp>0) fin-=Math.max(0,tp-DED)*0.22;
  eq[eq.length-1][1]=fin;
  const yrs=(Date.parse(dates[i1])-Date.parse(dates[i0]))/(365.25*864e5);
  return {eq, inPct:inDays/(i1-i0+1)*100, tpy:trades/yrs, win:trades?wins/trades*100:0}; }
function prepD(sym){ const a=load(sym); const dates=a.map(x=>x.date), C=a.map(x=>x.close), n=C.length; const st=new Array(n).fill(0);
  for(let k=1;k<n;k++){ const d=C[k]>C[k-1]?1:C[k]<C[k-1]?-1:0; st[k]=d===0?0:(Math.sign(st[k-1])===d?st[k-1]+d:d); } return {dates,C,st}; }
function roll(D,rule,o,y0,y1){ const R=[], last=D.dates[D.dates.length-1]; for(let y=y0;y<=y1;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last||s<D.dates[1]) continue; const r=run(D,rule,Object.assign({},o,{from:s,to:e})); R.push(stats(r.eq,o.cap)); } return R; }
const RULES=(process.argv[2]||'bh,dip:1:up1,dip:2:up1,dip:3:up1,dip:4:up1,dip:5:up1,dip:2:h5,dip:3:h5,dip:3:h10,dip:3:h20,dip:3:up1h5,dip:3:up2,dip:2:up2,mom:2,mom:3,bhx:3,bhx:4,bhx:5').split(',');
const f=x=>x.toFixed(1);
for(const [lab,sym,from,y0] of [['실제 SOXL','SOXL','2010-03-12',2010],['합성 SYNSOXL','SYNSOXL','1994-06-01',1995]]){ const D=prepD(sym);
  for(const mode of (process.env.MODE||'loc,next').split(',')) for(const cap of [10000,100000]){ console.log(`\n■ ${lab} ${from.slice(0,4)}~ · ${mode==='loc'?'LOC 당일 체결':'다음 날 종가 체결'} · ${cap/1e4}만$${process.env.RP?' · 잔금 RP':''}`);
    for(const rule of RULES){ const o={cap,from,mode,rp:!!process.env.RP}; const r=run(D,rule,o), s=stats(r.eq,cap), R=roll(D,rule,o,y0,2021);
      const pre=lab.startsWith('합성')?(()=>{ const x=run(D,rule,Object.assign({},o,{to:'2010-03-10'})); const t=stats(x.eq,cap); return ` | 출시 전 1994~2010 ${f(t.cagr)}/${f(t.mdd)}`; })():'';
      console.log(`  ${rule.padEnd(12)} ${f(s.cagr)}/${f(s.mdd)} · 보유 ${f(r.inPct)}% · 매매 ${f(r.tpy)}회/년 · 이긴 매매 ${f(r.win)}% | 5년 롤링(${R.length}) 중앙 ${f(q(R.map(x=>x.cagr),.5))}/${f(q(R.map(x=>x.mdd),.5))} 하10 ${f(q(R.map(x=>x.cagr),.1))} 최악MDD ${f(Math.max(...R.map(x=>x.mdd)))}${pre}`); } } }
