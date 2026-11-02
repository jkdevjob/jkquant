// Guard OFF 구간 사건 연구(11-03) — offasset.js 의 이득이 '그 자산이 위기 때 특히 좋아서'인지 '표본 기간 내내 올라서'인지 가른다.
// Guard = TQQQ(합성은 SYNTQQQ) SMA225 · 들어갈 때 +1% · 나올 때 −1%(지금 앱) / −3%(새 플랜). 신호는 그날 종가로 정하고 다음 날 종가에 매매 → 날 j 의 수익(j−1 종가→j 종가)은 j−2 신호 상태로 든다.
// 각 자산의 T-bill(^IRX − 0.09%) 대비 초과 수익(로그, 연율)을 OFF 날 · ON 날로 나눠 본다 + OFF 구간마다 초과 수익(구간 수 · 평균 · 중앙 · 이긴 비율 · 가장 나쁜/좋은 구간).
// 실제 2011~ (실제 GLD·IEF·TLT·QQQ) · 합성 1986~ (synbond.build('SYNTQQQ') — 금은 GC=F 가 있는 2000-09~ 만) · 합성 1986~1999(표본 밖) 따로.
// 사용: node offspan.js
const fs=require('fs'), path=require('path'); const {build}=require('./synbond');
const load=s=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',s+'.json'))).series.filter(x=>x.close>0);
const mapOf=s=>{ const m={}; load(s).forEach(x=>m[x.date]=x.close); return m; };
const f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d);
function guard(C,on,off){ const n=C.length, g=new Array(n).fill(null); let s=0; const m=new Array(n).fill(null); for(let k=0;k<n;k++){ s+=C[k]; if(k>=225) s-=C[k-225]; if(k>=224) m[k]=s/225; }
  let st=null; for(let k=0;k<n;k++){ if(m[k]==null) continue; if(st===null) st=C[k]>m[k]; if(C[k]>m[k]*(1+on)) st=true; else if(C[k]<m[k]*(1-off)) st=false; g[k]=st; } return g; }
function study(lab,dates,G,X,irx,from,to){ // X: {이름: 값 배열(dates 축 · null 이면 그 날 없음)}
  const gA=guard(G,0.01,0.01), gN=guard(G,0.01,0.03); const out=[];
  for(const [rn,g] of [['지금 앱 ±1%',gA],['새 −3%',gN]]){
    const hold=j=>j>=2&&g[j-2]!=null?!g[j-2]:null;   // true = OFF 로 들고 있는 날
    const rows=[];
    for(const [nm,v] of Object.entries(X)){ let offS=0,offN=0,onS=0,onN=0; const spans=[]; let cur=null;
      for(let j=1;j<dates.length;j++){ const d=dates[j]; if(d<from||(to&&d>to)) continue; const h=hold(j); if(h==null||v[j]==null||v[j-1]==null) { if(cur){ spans.push(cur); cur=null; } continue; }
        const gap=(Date.parse(d)-Date.parse(dates[j-1]))/864e5, tb=Math.log(1+Math.max(0,(irx[j-1]||0)/100-0.0009)*gap/365), ex=Math.log(v[j]/v[j-1])-tb;
        if(h){ offS+=ex; offN++; if(!cur) cur={s:dates[j-1],ex:0,n:0}; cur.ex+=ex; cur.n++; cur.e=d; } else { onS+=ex; onN++; if(cur){ spans.push(cur); cur=null; } } }
      if(cur) spans.push(cur);
      const sp=spans.map(x=>Math.exp(x.ex)-1).sort((a,b)=>a-b), med=sp.length?sp[Math.floor((sp.length-1)/2)]:0;
      const worst=spans.reduce((a,b)=>!a||b.ex<a.ex?b:a,null), best=spans.reduce((a,b)=>!a||b.ex>a.ex?b:a,null);
      rows.push(`    ${nm.padEnd(5)} OFF 날 ${String(offN).padStart(4)} · 연 ${f((Math.exp(offS/offN*252)-1)*100)}% | ON 날 연 ${f((Math.exp(onS/onN*252)-1)*100)}% | OFF 구간 ${spans.length} · 평균 ${f(sp.reduce((a,b)=>a+b,0)/Math.max(1,sp.length)*100)}% · 중앙 ${f(med*100)}% · 이긴 구간 ${sp.filter(x=>x>0).length} · 최악 ${worst?f((Math.exp(worst.ex)-1)*100)+'% ('+worst.s+'~'+worst.e+')':'-'} · 최고 ${best?f((Math.exp(best.ex)-1)*100)+'% ('+best.s+'~'+best.e+')':'-'}`); }
    out.push(`  [${rn}]`); out.push(...rows); }
  console.log(`\n■ ${lab} ${from}~${to||''} — T-bill 대비 초과(연율) · OFF 구간별 초과`); console.log(out.join('\n')); }
{ // 실제
  const q=load('TQQQ'), dates=q.map(x=>x.date), G=q.map(x=>x.close); const I=mapOf('IRX'); let li=0; const irx=dates.map(d=>{ if(I[d]!=null) li=I[d]; return li; });
  const X={}; for(const s of ['GLD','IEF','TLT','QQQ']){ const m=mapOf(s); X[s]=dates.map(d=>m[d]??null); }
  study('실제',dates,G,X,irx,'2011-01-01'); }
{ // 합성(1985~ 축)
  const B=build('SYNTQQQ'); const T=mapOf('SYNTQQQ'); const dates=B.axis, G=dates.map(d=>T[d]);
  const gcf=mapOf('GCF'); const gold=B.SYNGLD.map((v,i)=>dates[i]>='2000-09-01'?v:null);
  const X={GLD:gold, IEF:B.SYNIEF, TLT:B.SYNTLT, QQQ:B.SYNQQQ};
  study('합성',dates,G,X,B.IRX,'1986-01-01');
  study('합성(표본 밖)',dates,G,X,B.IRX,'1986-01-01','1999-12-31');
  study('합성',dates,G,X,B.IRX,'2000-01-01','2010-12-31'); }
