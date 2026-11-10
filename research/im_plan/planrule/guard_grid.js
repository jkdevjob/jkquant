// TQQQ 몫만 · 종가 신호(앱 줄) · 켜는 밴드 × 끄는 밴드 격자(11-11) — 실제 체결가 2011-04~ (앞·뒤 절반) · 합성 1986-09~2011-03 (앞·뒤) · 5년 창(매달 시작) 짝
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data'); const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const irx=new Map(rd(path.join(R,'IRX.json')).series.map(x=>[x.date,+x.close]));
const T=new Set(rd(path.join(D,'data','TECL.json')).ohlcTrade.map(x=>x.date));
const REAL=rd(path.join(D,'data','TQQQ.json')).ohlcTrade.filter(x=>x.close>0&&T.has(x.date)).map(x=>({d:x.date,c:+x.close}));
const SYN=rd(path.join(R,'SYNTQQQ.json')).ohlcTrade.filter(x=>x.close>0).map(x=>({d:x.date,c:+x.close}));
const smaArr=(a,n)=>{ const o=Array(a.length).fill(null); let s=0; for(let i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; if(i>=n-1) o[i]=s/n; } return o; };
function run(B,m,on,off,from,to){ let eq=1,pk=1,mdd=0,st=false,li=0,days=0,trips=0; const i0=Math.max(226,B.findIndex(x=>x.d>=from)); const i1=to?B.findLastIndex(x=>x.d<to):B.length-1;
  for(let i=i0;i<=i1;i++){ const pb=B[i-1],b=B[i]; if(irx.has(pb.d)) li=irx.get(pb.d); const up=m[i-1]*(1+on),lo=m[i-1]*(1-off); const want=pb.c>up?true:pb.c<lo?false:st;
    if(want!==st){ eq*=1-0.001; if(want) trips++; } if(st) eq*=b.c/pb.c; else eq*=1+Math.max(0,li/100-0.0009)/252; // 바뀌는 날: 어제 종가 상태로 오늘 수익(체결이 오늘 종가)
    st=want; pk=Math.max(pk,eq); mdd=Math.max(mdd,1-eq/pk); days++; }
  return {cagr:(Math.pow(eq,252/days)-1)*100,mdd:mdd*100,trips:trips/days*252}; }
const ONS=[0,.005,.01,.02], OFFS=[.01,.02,.03,.04,.05];
const addM=(d,k)=>{ const y=+d.slice(0,4),mo=+d.slice(5,7)-1+k; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
for(const [lab,B,a,h,b,y0,y1] of [['실제 2011-04~',REAL,'2011-04-01','2019-01-01',null,'2011-04-01','2021-11-01'],['합성 1986-09~2011-03',SYN,'1986-09-01','1999-01-01','2011-04-01','1986-09-01','2006-03-01']]){
  const m=smaArr(B.map(x=>x.c),225), base=run(B,m,.01,.01,a,b), b1=run(B,m,.01,.01,a,h), b2=run(B,m,.01,.01,h,b);
  const wins=[]; for(let s=y0; s<=y1; s=addM(s,1)) wins.push([s,addM(s,60)]);
  const bw=wins.map(([s,e])=>run(B,m,.01,.01,s,e));
  console.log(`\n■ ${lab} · 기준(+1/−1) 연 ${base.cagr.toFixed(1)} · MDD ${base.mdd.toFixed(1)} · 왕복 ${base.trips.toFixed(1)}/년 · 앞 ${b1.cagr.toFixed(1)} · 뒤 ${b2.cagr.toFixed(1)} · 5년 창 ${wins.length}`);
  console.log('  켜기/끄기   연(차)       MDD(차)      앞 차  뒤 차  왕복  | 5년 창 연 차 중앙 · 낮은 창% · MDD 차 중앙');
  for(const on of ONS) for(const off of OFFS){ const r=run(B,m,on,off,a,b), r1=run(B,m,on,off,a,h), r2=run(B,m,on,off,h,b);
    const w=wins.map(([s,e])=>run(B,m,on,off,s,e)), dc=w.map((x,i)=>x.cagr-bw[i].cagr).sort((p,q)=>p-q), dm=w.map((x,i)=>x.mdd-bw[i].mdd).sort((p,q)=>p-q), md=a2=>a2[Math.floor((a2.length-1)/2)];
    console.log(`  +${(on*100).toFixed(1)}/−${(off*100).toFixed(0)}  ${r.cagr.toFixed(1).padStart(5)}(${(r.cagr-base.cagr>=0?'+':'')+(r.cagr-base.cagr).toFixed(1)})  ${r.mdd.toFixed(1).padStart(5)}(${(r.mdd-base.mdd>=0?'+':'')+(r.mdd-base.mdd).toFixed(1)})  ${(r1.cagr-b1.cagr>=0?'+':'')+(r1.cagr-b1.cagr).toFixed(1)}  ${(r2.cagr-b2.cagr>=0?'+':'')+(r2.cagr-b2.cagr).toFixed(1)}  ${r.trips.toFixed(1)} | ${(md(dc)>=0?'+':'')+md(dc).toFixed(2)} · ${(dc.filter(x=>x<-1e-9).length/dc.length*100).toFixed(0)}% · ${(md(dm)>=0?'+':'')+md(dm).toFixed(1)}`); }
}
