// 무매(익절 자동) 50 + X 50 — 짝 11가지를 같은 조건으로 비교한다(2026-10-21 사용자: '가능한 최대로 구간별로').
// 무매·VR·200일선·섀넌(역분산)은 backtest.html 실제 엔진(Playwright, 일별 자산 고리만 주입), 플랜·지수·현금은 px 엔진.
// 두 계좌를 따로 굴린다(원금 반씩, 서로 돈을 안 옮김) — 연 1회 다시 맞추기는 참고로만.
// 구간: 전체 · 연도별 · 3개 시기 · 위기 6곳 · 1년(잘라 보기)·3년·5년(매달 새로 시작) 롤링 · 합성 2000~(닷컴·금융위기) · 블록 부트스트랩
// 비용: 수수료·양도세(250만원 공제 — 계좌마다 따로 잡히는 근사) · 놀리는 현금은 T-bill(px·섀넌·200일선) · 1만$·3만$·10만$
// 사용: node combo50.js [out.json]   (fetch.sh 로 data/ 를 먼저 채운다)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'combo50_out.json';
const SMOKE=!!process.env.SMOKE;   // 빠른 점검: 3만$ · 실제 자료 · 롤링 없이
const CAPS=SMOKE?[30000]:[10000,30000,100000];
const REAL_FROM='2011-03-01', SYN_FROM='2000-04-03';
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; };
const med=a=>q(a,.5);

// ── px 규칙 ─────────────────────────────────────────────
const hold=sym=>()=>({assets:[sym],warm:1,target:()=>({[sym]:1})});
const cashOnly=()=>({assets:['QQQ'],warm:1,target:()=>({QQQ:0})});
function plan10(P,T){ // TQQQ SMA250 위 80% · 아래면 RSI14/ATH 3단계 20/40/60% · 나머지 SGOV(=T-bill 현금)
  const c=P.C[T], ma=ind.ma(c,250), rs=rsi(c,14), risk=[]; let ath=-Infinity, bs=-1, stage=0;
  for(let k=0;k<c.length;k++){ ath=Math.max(ath,c[k]);
    if(k>0&&ma[k]!=null&&ma[k-1]!=null&&c[k]<ma[k]&&c[k-1]>=ma[k-1]){ bs=k; stage=0; }
    const bull=ma[k]>0&&c[k]>=ma[k];
    if(!bull&&bs>=0){ const dd=c[k]/ath-1, r=rs[k]; if(r!=null&&r<=40&&dd<=-.12)stage=Math.max(stage,1); if(r!=null&&r<=35&&dd<=-.22)stage=Math.max(stage,2); if(r!=null&&r<=30&&dd<=-.32)stage=Math.max(stage,3); }
    risk.push(ma[k]==null?null:bull?.80:[0,.20,.40,.60][stage]); }
  return {assets:[T],warm:260,target:k=>({[T]:risk[k]||0})}; }
function plan15(P,T){ return {assets:[T],warm:2,target:(k,cur)=>{ const w=cur[T]||0; return {[T]:(w<.40||w>.80)?.60:w}; }}; }
function plan20(P,A,B){ // 직전 월말 9M·12M 가중 모멘텀(0.3·0.7) 승자 40% · 12M 음수면 제외 · 둘 다 아니면 SGOV
  const d=P.dates, me=[]; for(let k=0;k<d.length;k++) me.push(k>0&&d[k].slice(0,7)!==d[k-1].slice(0,7)?k-1:(k?me[k-1]:-1));
  const mom=(S,i)=>{ if(i<252) return null; const p=P.C[S][i],a=P.C[S][i-189],b=P.C[S][i-252]; const m9=p/a-1,m12=p/b-1; return {score:.3*m9+.7*m12,ok:m12>0}; };
  return {assets:[A,B],warm:253,target:k=>{ const i=me[Math.min(k+1,d.length-1)]; const a=mom(A,i), b=mom(B,i);
    let w='C'; if(a&&a.ok&&b&&b.ok) w=a.score>=b.score?A:B; else if(a&&a.ok) w=A; else if(b&&b.ok) w=B;
    return {[A]:w===A?.40:0,[B]:w===B?.40:0}; }}; }
function rsi(a,n){ const o=Array(a.length).fill(null); let ag=0,al=0; for(let i=1;i<a.length;i++){ const z=a[i]-a[i-1],g=Math.max(z,0),l=Math.max(-z,0);
  if(i<=n){ ag+=g; al+=l; if(i===n){ ag/=n; al/=n; o[i]=100-100/(1+(al===0?100:ag/al)); } } else { ag=(ag*(n-1)+g)/n; al=(al*(n-1)+l)/n; o[i]=100-100/(1+(al===0?100:ag/al)); } } return o; }

// ── 짝 목록 ── kind: px(prep 종목, 규칙) · app(엔진 이름, 종목)
function partners(syn){ const T=syn?'SYNTQQQ':'TQQQ', E=syn?'SYNTECL':'TECL', TA=syn?'SYNTQQQ_S':'TQQQ';   // 앱 엔진은 병합·분할을 넣은 합성(_S) — synsplit.js
  return [
    ['P5','5년 플랜(역분산+Guard)',{px:[E,T],rule:P=>mk(P,E,T,{})}],
    ['VR','VR (TQQQ 거치)',{app:'VR',tkr:TA}],
    ['MA','200일선 (TQQQ · T-bill 대피)',{app:'MA',tkr:TA}],
    ['IVS','섀넌·역분산 (TQQQ)',{app:'IVS',tkr:TA}],
    ['P10','10년 플랜(추세+폭락매수)',{px:[T],rule:P=>plan10(P,T)}],
    ['P15','15년 플랜(Shannon 60:40)',{px:[T],rule:P=>plan15(P,T)}],
    ['P20','20년 플랜(듀얼모멘텀)',{px:[E,T],rule:P=>plan20(P,E,T)}],
    ['QQQ','QQQ 보유',{px:['QQQ'],rule:hold('QQQ')}],
    ['SPY','SPY 보유',{px:['SPY'],rule:hold('SPY')}],
    ...(syn?[]:[['GLD','금(GLD) 보유',{px:['GLD'],rule:hold('GLD')}]]),
    ['TQ','TQQQ 보유',{px:[T],rule:hold(T)}],
    ['CASH','현금(T-bill)',{px:['QQQ'],rule:cashOnly}],
  ]; }

(async()=>{
  const {pg,close}=await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'SYNSOXL_S'},{sym:'SYNTQQQ_S'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  // 일별 자산 고리 — 엔진 계산은 건드리지 않고 그날 총자산만 적는다(글자가 바뀌면 멈춘다)
  await pg.evaluate(()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
    patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
    patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
    patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
    patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);'); });
  const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length) m[ks[ks.length-1]]=fin; return m; };
  const imRun=async(cap,from,to,syn)=>{ const r=await pg.evaluate(o=>{ const r=RUN(o); return {eq:r.eqs.map(x=>[x[0],x[1]]),final:r.final}; },{cap,tkr:syn?'SYNSOXL_S':'SOXL',autoTp:true,from,to}); return toMap(r.eq,r.final); };
  const appRun=async(name,tkr,cap,from,to)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to])=>{ window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,true,{park:'bill'});
      else r=runIVS(days,tkr,cap,.45,60,.10,true,'iv','cash');
      return {eq:window.__EQ,final:r.final}; },[name,tkr,cap,from,to]); return toMap(r.eq,r.final); };
  const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
  const pxRun=(spec,cap,from,to)=>{ const P=pxPrep(spec.px), R=spec.rule(P); return toMap(sim(P,Object.assign({cap,from,to,fee:.0025,tax:true,frac:spec.px.some(x=>/^SYN/.test(x))},R)).eq); };
  const run=async(spec,cap,from,to,syn)=>spec==='IM'?imRun(cap,from,to,syn):spec.app?appRun(spec.app,spec.tkr,cap,from,to):pxRun(spec,cap,from,to);

  // ── 지표 ──
  const IRXd=Object.keys(irx).sort(); const rfAt=(()=>{ let li=0,last=0; const memo={}; return d=>{ if(memo[d]!=null) return memo[d]; while(li<IRXd.length&&IRXd[li]<=d){ last=irx[IRXd[li]]; li++; } return memo[d]=last/100; }; })();
  function metrics(eq){ // eq: [[d,v]...]
    const n=eq.length; if(n<3) return null; const v0=eq[0][1], v1=eq[n-1][1]; const yrs=(Date.parse(eq[n-1][0])-Date.parse(eq[0][0]))/(365.25*864e5);
    let pk=v0, mdd=0, uw=0, uwMax=0, ui=0, peakAt=eq[0][0], longest=0; const r=[];
    for(let i=0;i<n;i++){ const v=eq[i][1]; if(v>=pk){ pk=v; peakAt=eq[i][0]; } const dd=(pk-v)/pk; mdd=Math.max(mdd,dd); ui+=dd*dd;
      if(dd>0){ const days=(Date.parse(eq[i][0])-Date.parse(peakAt))/864e5; longest=Math.max(longest,days); }
      if(i) r.push(v/eq[i-1][1]-1); }
    const mean=r.reduce((a,b)=>a+b,0)/r.length, sd=Math.sqrt(r.reduce((a,b)=>a+(b-mean)**2,0)/r.length);
    const ex=r.map((x,i)=>x-rfAt(eq[i][0])/252); const exm=ex.reduce((a,b)=>a+b,0)/ex.length; const dn=Math.sqrt(ex.reduce((a,b)=>a+Math.min(0,b)**2,0)/ex.length);
    const cagr=(Math.pow(Math.max(v1,1e-9)/v0,1/yrs)-1)*100;
    return {cagr, mdd:mdd*100, calmar:mdd>0?cagr/(mdd*100):null, vol:sd*Math.sqrt(252)*100, sharpe:sd>0?exm/sd*Math.sqrt(252):null, sortino:dn>0?exm/dn*Math.sqrt(252):null,
      ulcer:Math.sqrt(ui/n)*100, uwMonths:longest/30.44, mult:v1/v0}; }
  const series=m=>Object.keys(m).sort().map(d=>[d,m[d]]);
  const mixNone=(a,b)=>{ const o={}; Object.keys(a).forEach(d=>{ if(b[d]!=null) o[d]=a[d]+b[d]; }); return o; };
  function mixYear(a,b){ const ds=Object.keys(b).filter(d=>a[d]!=null).sort(); let x=a[ds[0]], y=b[ds[0]], yr=ds[0].slice(0,4); const o={[ds[0]]:x+y};
    for(let k=1;k<ds.length;k++){ const d=ds[k],p=ds[k-1]; x*=a[d]/a[p]; y*=b[d]/b[p]; if(d.slice(0,4)!==yr){ yr=d.slice(0,4); const t=x+y, m=x-t/2; x-=m; y+=m-Math.abs(m)*0.0025; } o[d]=x+y; } return o; }
  const slice=(m,s,e)=>Object.keys(m).sort().filter(d=>d>=s&&d<=e).map(d=>[d,m[d]]);
  function crisis(m,s,e){ const ds=Object.keys(m).sort(), pre=ds.filter(d=>d<s), win=ds.filter(d=>d>=s&&d<=e); if(!pre.length||!win.length) return null;
    const v0=m[pre[pre.length-1]]; let pk=Math.max(...pre.map(d=>m[d])), pkAt=pk, dd=0, trough=null;
    for(const d of win){ pk=Math.max(pk,m[d]); const x=(pk-m[d])/pk; if(x>dd){ dd=x; trough=d; pkAt=pk; } }
    const rec=trough?ds.find(d=>d>trough&&m[d]>=pkAt):null;
    return {ret:(m[win[win.length-1]]/v0-1)*100, dd:dd*100, recMonths:rec?(Date.parse(rec)-Date.parse(trough))/864e5/30.44:null}; }
  function corr(a,b){ const ds=Object.keys(a).filter(d=>b[d]!=null).sort(); const ra=[],rb=[]; for(let i=1;i<ds.length;i++){ ra.push(a[ds[i]]/a[ds[i-1]]-1); rb.push(b[ds[i]]/b[ds[i-1]]-1); }
    const ma=ra.reduce((x,y)=>x+y,0)/ra.length, mb=rb.reduce((x,y)=>x+y,0)/rb.length; let sab=0,saa=0,sbb=0; for(let i=0;i<ra.length;i++){ sab+=(ra[i]-ma)*(rb[i]-mb); saa+=(ra[i]-ma)**2; sbb+=(rb[i]-mb)**2; }
    const crash=ra.map((x,i)=>x<-0.05?rb[i]:null).filter(x=>x!=null); return {daily:sab/Math.sqrt(saa*sbb), onCrash:crash.length?crash.reduce((x,y)=>x+y,0)/crash.length*100:null, crashDays:crash.length}; }
  // 블록 부트스트랩 — 두 계좌의 같은 날 일수익을 함께 뽑아 5년(1,260일)을 2,000번 만든다(평균 블록 63일). 전략 논리를 다시 돌리지 않는 근사다.
  function boot(a,b,paths=2000,len=1260,blk=63,seed=7){ const ds=Object.keys(a).filter(d=>b[d]!=null).sort(); const ra=[],rb=[]; for(let i=1;i<ds.length;i++){ ra.push(a[ds[i]]/a[ds[i-1]]); rb.push(b[ds[i]]/b[ds[i-1]]); }
    let s=seed; const rnd=()=>{ s=(s*1103515245+12345)%2147483648; return s/2147483648; }; const N=ra.length; const C=[],D=[];
    for(let p=0;p<paths;p++){ let x=.5,y=.5,pk=1,mdd=0,i=Math.floor(rnd()*N); for(let t=0;t<len;t++){ if(rnd()<1/blk) i=Math.floor(rnd()*N); else i=(i+1)%N; x*=ra[i]; y*=rb[i]; const v=x+y; if(v>pk) pk=v; else mdd=Math.max(mdd,(pk-v)/pk); }
      C.push((Math.pow(x+y,1/5)-1)*100); D.push(mdd*100); }
    return {cMed:med(C),c5:q(C,.05),c25:q(C,.25),pLoss:C.filter(x=>x<0).length/paths*100,mMed:med(D),m95:q(D,.95),p50:D.filter(x=>x>50).length/paths*100}; }

  const res=process.env.MERGE?JSON.parse(fs.readFileSync(process.env.MERGE)):{meta:{made:new Date().toISOString(),realFrom:REAL_FROM,synFrom:SYN_FROM,caps:CAPS,note:'무매=SOXL 20분할 복리 리버스OFF 큰수20 LOC3 익절 자동 · 수수료·양도세 포함 · 계좌 둘(원금 반씩) 따로'},real:{},syn:{}};
  if(process.env.MERGE){ res.syn={}; res.meta.synNote='합성은 병합·분할 넣은 자료(_S)로 다시 계산 · px 는 소수 주'; }
  for(const syn of (SMOKE?[false]:process.env.MERGE?[true]:[false,true])){ const from=syn?SYN_FROM:REAL_FROM, to='2099-12-31', PS=partners(syn), out=syn?res.syn:res.real; out.partners=PS.map(([k,n])=>({k,n}));
    for(const cap of CAPS){ const half=cap/2, R={};
      console.error(`[${syn?'합성':'실제'} ${cap/1e4}만$] 전체 기간`);
      const IMh=await run('IM',half,from,to,syn), IMf=await run('IM',cap,from,to,syn);
      const P5f=await run(PS[0][2],cap,from,to,syn);
      R.ref={IM100:metrics(series(IMf)), P5_100:metrics(series(P5f))};
      R.full={}; R.year={}; R.cal={}; R.periods={}; R.crisis={}; R.corr={}; R.boot={}; R.roll1={};
      const curves={};
      for(const [k,,spec] of PS){ const xh=await run(spec,half,from,to,syn), xf=await run(spec,cap,from,to,syn); const m=mixNone(IMh,xh); curves[k]=m;
        R.full[k]={mix:metrics(series(m)), alone:metrics(series(xf)), yearly:metrics(series(mixYear(IMf,xf)))};
        // 연도별
        const yrs={}; for(const y of [...new Set(Object.keys(m).map(d=>d.slice(0,4)))]){ const s=slice(m,y+'-01-01',y+'-12-31'); const prev=Object.keys(m).sort().filter(d=>d<y+'-01-01'); const v0=prev.length?m[prev[prev.length-1]]:s[0][1]; yrs[y]=(s[s.length-1][1]/v0-1)*100; } R.cal[k]=yrs;
        R.corr[k]=corr(IMf,xf); R.boot[k]=boot(IMh,xh);
        // 1년 롤링(잘라 보기, 매달)
        const ds=Object.keys(m).sort(); const one=[]; for(let y=+from.slice(0,4);y<=2025;y++) for(let mo=1;mo<=12;mo++){ const s=`${y}-${String(mo).padStart(2,'0')}-01`, e=`${y+1}-${String(mo).padStart(2,'0')}-01`; if(s<from||e>ds[ds.length-1]) continue; const sl=slice(m,s,e); if(sl.length>200) one.push(metrics(sl)); }
        R.roll1[k]={n:one.length,cMed:med(one.map(x=>x.cagr)),c10:q(one.map(x=>x.cagr),.1),cMin:Math.min(...one.map(x=>x.cagr)),pLoss:one.filter(x=>x.cagr<0).length/one.length*100,mMed:med(one.map(x=>x.mdd)),mMax:Math.max(...one.map(x=>x.mdd))};
      }
      curves.IM100=IMf; curves.P5_100=P5f;
      const PER=syn?[['2000-04','2002-12','닷컴 붕괴'],['2003-01','2007-09','회복'],['2007-10','2009-03','금융위기'],['2009-04','2015-12','2009~2015'],['2016-01','2020-12','2016~2020'],['2021-01','2026-12','2021~']]
                   :[['2011-03','2015-12','2011~2015'],['2016-01','2020-12','2016~2020'],['2021-01','2026-12','2021~2026'],['2022-01','2026-12','2022~(모의 기간)']];
      for(const [s,e,lab] of PER){ R.periods[lab]={}; for(const k of Object.keys(curves)) R.periods[lab][k]=metrics(slice(curves[k],s+'-01',e+'-31')); }
      const CR=syn?[['2000-03-24','2002-10-09','닷컴 붕괴'],['2007-10-09','2009-03-09','금융위기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장']]
                  :[['2011-07-22','2011-10-03','2011 미국 강등'],['2015-07-20','2016-02-11','2015 중국·유가'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','2020 코로나'],['2021-11-19','2022-12-28','2022 하락장'],['2024-07-10','2025-04-08','2024~25 관세']];
      for(const [s,e,lab] of CR){ R.crisis[lab]={}; for(const k of Object.keys(curves)) R.crisis[lab][k]=crisis(curves[k],s,e); }
      // 3·5년 롤링 — 매달(합성은 분기) 새로 시작 · 원금 반씩
      for(const Y of (SMOKE?[]:[3,5])){ const step=syn?3:1, rows={}; const last=Object.keys(IMh).sort().pop();
        const starts=[]; for(let y=+from.slice(0,4);y<=2026;y++) for(let mo=1;mo<=12;mo+=step){ const s=`${y}-${String(mo).padStart(2,'0')}-01`, e=`${y+Y}-${String(mo).padStart(2,'0')}-01`; if(s<from||e>last) continue; starts.push([s,e]); }
        console.error(`  롤링 ${Y}년 ${starts.length}개`);
        const imW={}; for(const [s,e] of starts) imW[s]=await run('IM',half,s,e,syn);
        for(const [k,,spec] of PS){ const W=[]; for(const [s,e] of starts){ const x=await run(spec,half,s,e,syn); const mm=metrics(series(mixNone(imW[s],x))); if(mm) W.push({s,c:mm.cagr,d:mm.mdd}); } rows[k]=W; }
        const imOnly=[]; for(const [s,e] of starts){ const a=await run('IM',cap,s,e,syn); imOnly.push({s,c:metrics(series(a)).cagr,d:metrics(series(a)).mdd}); } rows.IM100=imOnly;
        const sum={}; for(const k of Object.keys(rows)){ const W=rows[k], P5=rows.P5; sum[k]={n:W.length,cMed:med(W.map(x=>x.c)),c10:q(W.map(x=>x.c),.1),cMin:Math.min(...W.map(x=>x.c)),pLoss:W.filter(x=>x.c<0).length/W.length*100,
            mMed:med(W.map(x=>x.d)),m90:q(W.map(x=>x.d),.9),mMax:Math.max(...W.map(x=>x.d)),
            beatP5c:k==='P5'?null:W.filter((x,i)=>x.c>P5[i].c).length/W.length*100, beatP5d:k==='P5'?null:W.filter((x,i)=>x.d<P5[i].d).length/W.length*100}; }
        R['roll'+Y]=sum; R['roll'+Y+'raw']=rows; }
      out[cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); } }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
