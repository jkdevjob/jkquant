// TQQQ 몫(Guard)만 떼어 본 시험(11-11) — 해부(whip_anatomy.js) 결과 '가짜 이탈의 웃돈은 거의 다 종가의 넘침(−1% 를 크게 넘어 마감 · +1% 를 크게 넘어 마감) + 밴드 2%'.
// 그래서 같은 SMA225 ±밴드 선에 '예약 주문'(전일 종가로 정한 선 · 장중 고가·저가로 체결 — 무매 지정가 · VR 사다리와 같은 예약 체결)을 걸면 웃돈이 줄어드는지,
// 장중에만 선을 건드리는 날(종가로는 안 걸릴 날)의 헛매매가 그 이득을 먹는지를 잰다. 앱 체결(전일 종가 신호 → 다음 날 종가)과 같은 줄로 비교.
// 수익: ON 이면 TQQQ, OFF 면 단기국채(^IRX − 0.09%) · 수수료 0.1% · 예약 체결은 미끄러짐 slip 추가(기본 0.2%) · 갭이면 시가에 체결 · 세금 없음(전체 전략 시험은 앱 엔진으로 따로).
// 사용: node planrule/guard_stop.js   (SLIP=0.003 · FROMS 바꾸기)
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data');
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const SLIP=+(process.env.SLIP||0.002), FEE=0.001;
const irx=new Map(rd(path.join(R,'IRX.json')).series.map(x=>[x.date,+x.close]));
const vix=new Map(rd(path.join(R,'VIX.json')).series.map(x=>[x.date,+x.close]));
function bars(kind){
  if(kind==='real'){ const T=new Set(rd(path.join(D,'data','TECL.json')).ohlcTrade.map(x=>x.date)); return rd(path.join(D,'data','TQQQ.json')).ohlcTrade.filter(x=>x.close>0&&T.has(x.date)).map(x=>({d:x.date,o:+x.open||+x.close,h:+x.high||+x.close,l:+x.low||+x.close,c:+x.close})); }
  return rd(path.join(R,'SYNTQQQ.json')).ohlcTrade.filter(x=>x.close>0).map(x=>({d:x.date,o:+x.open,h:+x.high,l:+x.low,c:+x.close}));
}
const smaArr=(a,n)=>{ const o=Array(a.length).fill(null); let s=0; for(let i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; if(i>=n-1) o[i]=s/n; } return o; };
// V: {on, off(종가 신호 밴드), mode:'close'|'stop'|'stopBuy'|'stopSell', vixOff:{v, off2}(VIX<v 면 끄는 밴드 off2)}
function run(B,m,V,from,to){
  let eq=1,pk=1,mdd=0,on=false,lastIrx=0,trips=0,ev=[],cur=null,days=0; const i0=B.findIndex(x=>x.d>=from); let i1=B.length-1; if(to){ i1=B.findLastIndex(x=>x.d<=to); }
  let pend=null;   // 종가 신호로 정한 다음 날 종가 체결
  for(let i=Math.max(i0,226);i<=i1;i++){ const b=B[i],p=i-1,pb=B[p];
    if(irx.has(pb.d)) lastIrx=irx.get(pb.d);
    const mv=m[p]; const offBand=(V.vixOff&&(vix.get(pb.d)??99)<V.vixOff.v)?V.vixOff.off2:V.off;
    const up=mv*(1+V.on), lo=mv*(1-offBand);
    let act=null,fill=null;
    // ① 어제 종가 신호 → 오늘 종가 체결(앱 줄)
    const closeRule=(s)=> s==='close'||(s==='stopBuy'&&on)||(s==='stopSell'&&!on);
    if(closeRule(V.mode)){
      const want=pb.c>up?true:pb.c<lo?false:on;
      if(want!==on){ act=want?'buy':'sell'; fill=b.c; }
    }
    // ② 예약 주문: 들고 있으면 lo 아래 매도 · 없으면 up 위 매수(장중 체결 · 갭이면 시가)
    if(!act&&(V.mode==='stop'||(V.mode==='stopBuy'&&!on)||(V.mode==='stopSell'&&on))){
      if(on&&b.l<=lo){ act='sell'; fill=(b.o<=lo?b.o:lo)*(1-SLIP); }
      else if(!on&&b.h>=up){ act='buy'; fill=(b.o>=up?b.o:up)*(1+SLIP); }
    }
    // 하루 수익
    const cashR=Math.max(0,lastIrx/100-0.0009)/252;
    if(act==='sell'){ eq*=fill/pb.c*(1-FEE); eq*=1+cashR*0; on=false; cur={d:b.d,px:fill}; }
    else if(act==='buy'){ eq*=(1+cashR*0)*(1-FEE)*b.c/fill; on=true; trips++; if(cur){ ev.push({off:cur.d,on:b.d,prem:fill/cur.px-1}); cur=null; } }
    else if(on) eq*=b.c/pb.c; else eq*=1+cashR;
    pk=Math.max(pk,eq); mdd=Math.max(mdd,1-eq/pk); days++;
  }
  const yrs=days/252; const W=ev.filter(x=>x.prem>0);
  return {cagr:(Math.pow(eq,1/yrs)-1)*100,mdd:mdd*100,trips:trips/yrs,nEv:ev.length,nW:W.length,sumW:W.reduce((s,x)=>s+Math.log(1+x.prem),0)*100,sumAll:ev.reduce((s,x)=>s+Math.log(1+x.prem),0)*100,eq};
}
const VS={
  '앱(종가 ±1%)':{on:.01,off:.01,mode:'close'},
  '예약 ±1%':{on:.01,off:.01,mode:'stop'},
  '예약 ±2%':{on:.02,off:.02,mode:'stop'},
  '예약 ±3%':{on:.03,off:.03,mode:'stop'},
  '예약 매수만 +1%':{on:.01,off:.01,mode:'stopBuy'},
  '예약 매수만 +2%':{on:.02,off:.01,mode:'stopBuy'},
  '예약 매도만 −1%':{on:.01,off:.01,mode:'stopSell'},
  '예약 매도만 −3%':{on:.01,off:.03,mode:'stopSell'},
  '종가 −3%/+1%':{on:.01,off:.03,mode:'close'},
  '종가 −2%/+1%':{on:.01,off:.02,mode:'close'},
  '예약 매수 +1% · 종가 −3%':{on:.01,off:.03,mode:'stopBuy'},
  'VIX<20 이면 −4%':{on:.01,off:.01,mode:'close',vixOff:{v:20,off2:.04}},
  'VIX<18 이면 −4%':{on:.01,off:.01,mode:'close',vixOff:{v:18,off2:.04}},
};
const f=x=>x.toFixed(1);
for(const [kind,periods] of [['real',[['2011-04-01',null],['2011-04-01','2018-12-31'],['2019-01-01',null]]],['syn',[['1986-09-01','2011-03-31'],['1986-09-01','1999-12-31'],['2000-01-01','2011-03-31'],['1986-09-01',null]]]]){
  const B=bars(kind), m=smaArr(B.map(x=>x.c),225);
  for(const [a,b] of periods){
    console.log(`\n■ ${kind==='real'?'실제 TQQQ 체결가':'합성 SYNTQQQ'} ${a}~${b||B[B.length-1].d} · 미끄러짐 ${SLIP*100}%`);
    const base=run(B,m,VS['앱(종가 ±1%)'],a,b);
    for(const [k,V] of Object.entries(VS)){ const r=run(B,m,V,a,b);
      console.log(`  ${k.padEnd(22)} 연 ${f(r.cagr).padStart(6)}% (${(r.cagr-base.cagr>=0?'+':'')+f(r.cagr-base.cagr)}) · MDD ${f(r.mdd).padStart(5)}% · 왕복 ${f(r.trips)}회/년 · 이탈 ${r.nEv}(가짜 ${r.nW}) · 가짜 웃돈 합 ${f(r.sumW)} · 전체 ${f(r.sumAll)}`); }
  }
}
