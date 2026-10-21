// 장기 폭락을 미리 알아채 무매를 쉬게 할 수 있나 — 지수(^SOX)·금리(^TNX−^IRX) 국면 신호 시험 (2026-10-21 사용자 질문)
// 신호는 전부 '전일까지 확정된' 지수 자료로 정한다(룩어헤드 금지). 무매는 backtest.html 실제 엔진(runIM · 익절 자동 · 잔금 T-bill 이상형).
// 대응: gate = 꺼짐이면 새 사이클을 안 시작(진행 중 사이클은 그대로) · exit = 꺼지는 날 시가에 전량 매도하고 켜질 때까지 쉼
// 자료: 합성 SYNSOXL_S(병합·분할 반영, 1995-06~) · 실제 SOXL(2010-04~) · 1만$·10만$
// 사용: node regime.js [out.json]
const fs=require('fs'); const {open}=require('./imh');
const OUT=process.argv[2]||'regime_out.json';
const load=s=>JSON.parse(fs.readFileSync(__dirname+'/data/'+s+'.json')).series.filter(x=>x.close>0);
const SOX=load('SOX'), TNX=load('TNX'), IRX=load('IRX');
const sd=SOX.map(x=>x.date), sc=SOX.map(x=>x.close);
const ma=(a,n)=>{ const o=[]; let s=0; for(let k=0;k<a.length;k++){ s+=a[k]; if(k>=n) s-=a[k-n]; o.push(k>=n-1?s/n:null); } return o; };
const MA200=ma(sc,200);
// 월말(그 달 마지막 거래일) 인덱스
const me=[]; for(let k=0;k<sd.length;k++) if(k===sd.length-1||sd[k+1].slice(0,7)!==sd[k].slice(0,7)) me.push(k);
const meIdx={}; me.forEach((k,j)=>meIdx[k]=j);
// 금리 차(10년 − 3개월) — 날짜별 최근 값
const tnx={}, irx={}; TNX.forEach(x=>tnx[x.date]=x.close); IRX.forEach(x=>irx[x.date]=x.close);
let lt=null, li=null; const spread=sd.map(d=>{ if(tnx[d]!=null) lt=tnx[d]; if(irx[d]!=null) li=irx[d]; return (lt!=null&&li!=null)?lt-li:null; });
// 각 신호: SOX 날짜 k 의 '종가 뒤' 상태(true=켜짐). 매매일 d 에는 d 보다 앞선 마지막 SOX 날의 상태를 쓴다.
function sigMA(b){ let on=true; return sc.map((c,k)=>{ const m=MA200[k]; if(m>0){ if(on&&c<m*(1-b)) on=false; else if(!on&&c>m*(1+b)) on=true; } return on; }); }
function sigMonthly(test){ let on=true; const o=[]; for(let k=0;k<sc.length;k++){ if(meIdx[k]!=null){ const j=meIdx[k]; const r=test(j); if(r!=null) on=r; } o.push(on); } return o; }
const sma10=j=>{ if(j<9) return null; let s=0; for(let t=j-9;t<=j;t++) s+=sc[me[t]]; return sc[me[j]]>s/10; };
const mom12=j=>j<12?null:sc[me[j]]>sc[me[j-12]];
const dual=j=>{ const a=sma10(j), b=mom12(j); if(a==null||b==null) return null; return a||b; };   // 둘 다 나빠야 꺼짐
function sigDD(x){ let on=true, ath=0; return sc.map((c,k)=>{ ath=Math.max(ath,c); const m=MA200[k]; if(m>0){ if(on&&c/ath-1<-x&&c<m) on=false; else if(!on&&c>m) on=true; } return on; }); }
function sigCurve(){ let on=true; return sc.map((c,k)=>{ const m=MA200[k]; let inv=false; for(let t=Math.max(0,k-252);t<=k;t++) if(spread[t]!=null&&spread[t]<0){ inv=true; break; }
  if(m>0){ if(on&&inv&&c<m) on=false; else if(!on&&c>m) on=true; } return on; }); }
const SIG={ MA200:sigMA(0.03), SMA10:sigMonthly(sma10), MOM12:sigMonthly(mom12), DUAL:sigMonthly(dual), DD30:sigDD(0.30), CURVE:sigCurve() };
// 매매일 → 전일 SOX 상태
function stateFor(sig,days){ const st={}; let p=0; for(const d of days){ while(p<sd.length&&sd[p]<d) p++; const k=p-1; st[d]=k>=0?sig[k]:true; } return st; }
const RULES=[['기준(신호 없음)',null,null]]; for(const k of Object.keys(SIG)){ RULES.push([k+' · 새 사이클만 쉼',k,'gate']); RULES.push([k+' · 꺼지면 팔고 쉼',k,'exit']); }
const PER_SYN=[['1995-06','1999-12','1995~1999 거품'],['2000-01','2002-12','2000~2002 닷컴'],['2003-01','2007-09','2003~2007'],['2007-10','2009-12','2007~2009 금융위기'],['2010-01','2026-12','2010~2026']];
function metrics(eq){ const v0=eq[0][1], v1=eq[eq.length-1][1], yrs=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/(365.25*864e5);
  let pk=v0,m=0; for(const [,v] of eq){ if(v>pk) pk=v; else m=Math.max(m,(pk-v)/pk); } return {cagr:(Math.pow(Math.max(v1,1e-9)/v0,1/Math.max(yrs,1e-6))-1)*100, mdd:m*100, mult:v1/v0}; }
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  const irxm={}; IRX.forEach(x=>irxm[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irxm);
  const run=(o)=>pg.evaluate(o=>{ const r=RUN(o); return {eq:r.eqs.map(x=>[x[0],x[1]]),final:r.final,exits:r.exits,cycles:r.cycles}; },o);
  const res={meta:{made:new Date().toISOString(),note:'무매 SOXL 20분할 복리 리버스OFF 큰수20 LOC3 익절 자동 · 잔금 T-bill(이상형) · 수수료·세금 · 신호는 ^SOX/^TNX/^IRX 전일 확정값'},syn:{},real:{},signals:{}};
  // 신호가 '꺼짐'이었던 비율(시대별) — 신호가 무엇을 잡았는지 먼저 본다
  for(const [k,s] of Object.entries(SIG)){ const frac=(a,b)=>{ const ix=sd.map((d,i)=>i).filter(i=>sd[i]>=a&&sd[i]<=b); return ix.filter(i=>!s[i]).length/ix.length*100; };
    let flips=0; for(let i=1;i<s.length;i++) if(s[i]!==s[i-1]&&sd[i]>='1995-06-01') flips++;
    res.signals[k]={off9599:frac('1995-06','1999-12'),off0002:frac('2000-01','2002-12'),off0307:frac('2003-01','2007-09'),off0709:frac('2007-10','2009-12'),off1026:frac('2010-01','2026-12'),flips}; }
  for(const [lab,tk,from] of [['syn','SYNSOXL_S','1995-06-01'],['real','SOXL','2010-04-01']]){
    const days=await pg.evaluate(tk=>Object.keys(M[tk]).sort(),tk);
    for(const cap of [10000,100000]){ const R={}; res[lab][cap]=R; console.error(`[${lab} ${cap/1e4}만$]`);
      for(const [name,sk,mode] of RULES){ const regime=sk?{st:stateFor(SIG[sk],days),gate:true,exit:mode==='exit'}:null;
        const r=await run({cap,tkr:tk,autoTp:true,cashYield:true,from,regime});
        const eq=r.eq; eq[eq.length-1]=[eq[eq.length-1][0],r.final]; const m=metrics(eq); const per={};
        if(lab==='syn') for(const [a,b,pl] of PER_SYN){ const sl=eq.filter(([d])=>d>=a+'-01'&&d<=b+'-31'); const prev=eq.filter(([d])=>d<a+'-01'); if(sl.length>2){ const base=prev.length?prev[prev.length-1]:sl[0]; per[pl]=metrics([base,...sl]); } }
        // 5년 롤링(분기마다 새로 시작)
        const W=[]; const last=days[days.length-1]; for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>last) continue;
          const w=await run({cap,tkr:tk,autoTp:true,cashYield:true,from:s,to:e,regime}); const we=w.eq; we[we.length-1]=[we[we.length-1][0],w.final]; W.push(metrics(we)); }
        R[name]={full:m,per,exits:r.exits,cycles:r.cycles,roll:{n:W.length,cMed:q(W.map(x=>x.cagr),.5),c10:q(W.map(x=>x.cagr),.1),cMin:Math.min(...W.map(x=>x.cagr)),mMed:q(W.map(x=>x.mdd),.5),mMax:Math.max(...W.map(x=>x.mdd)),pBust:W.filter(x=>x.mult<0.2).length/W.length*100}};
        console.error('  '+name.padEnd(22), m.cagr.toFixed(1)+'/'+m.mdd.toFixed(1)); }
      fs.writeFileSync(OUT,JSON.stringify(res)); } }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done'); })().catch(e=>{console.error(e);process.exit(1);});
