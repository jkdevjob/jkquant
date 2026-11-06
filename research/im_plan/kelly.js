// 켈리 공식(Kelly) TQQQ 비중 조절 vs JK투자 전략 — 2026-11-06 사용자(유튜브 요약: 2013~2026 TQQQ 1억 → 보유 124억 · 켈리 147억)
// 켈리: f = (장기 평균수익 μ − 무위험 r) ÷ σ² — '장기 평균수익률로 투자 여부(μ−r ≤ 0 이면 0) · 지난 20거래일 변동성으로 비중' · 상한 100%(현금은 T-bill)
//   변형: μ 창 252·504·1260일·전체(시작부터 누적) · σ 20·60일 · 풀 켈리·하프 켈리. 어느 조합이 영상 것인지 모르므로 격자로 돌리고 '가장 좋은 것'은 사후 선택이라고 적는다.
// 상대: 5년 플랜(역분산+Guard) · 지금(무매 SOXL 1/3 + 플랜 2/3) · 무매 SOXL 20 자동 · VR·200일선·섀넌(TQQQ, 앱 엔진) · 10/15/20년 플랜 · TQQQ 보유 · QQQ 보유
// 규약(앞 연구와 같음): 수수료 0.25% · 양도세 22%(연 250만원 공제 · 실현분 연 정산 · 끝 청산세 없음) · 신호는 전일까지 · 체결은 당일 종가 · 밴드 5%p 넘을 때만 리밸런싱
// ① 영상 구간 2013-01-02 ~ 2026-10-19(자료 끝) ② 5년 롤링(2011~2021 분기 시작 43창) ③ 위기 낙폭 ④ 합성 2000~(닷컴·금융위기) ⑤ 섞기(플랜 + 켈리)
// 사용: node kelly.js out.json   (SMOKE=1: 실제 1만$ · 창 4개)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'kelly_out.json'; const SMOKE=!!process.env.SMOKE;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));                  // hold · cashOnly · plan10/15/20 · rsi
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));               // metrics · series · mixNone · slice · crisis
const END='2026-10-19';
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);'); };
// ── 켈리 규칙 ── 전일(k)까지 종가만 본다. μ: 일수익 단순평균 × 252(창 look · 0 이면 시작부터 누적) · σ: ind.vol(sig일, 연율) · r: 전일까지 알려진 T-bill(IRX, %)
function kelly(P,T,p){ p=Object.assign({look:504,sig:20,frac:1,cap:1,minN:252},p);
  const c=P.C[T], n=c.length, r=new Array(n).fill(0); for(let k=1;k<n;k++) r[k]=c[k]/c[k-1]-1;
  const mu=new Array(n).fill(null); let s=0; for(let k=1;k<n;k++){ s+=r[k]; if(p.look&&k>p.look) s-=r[k-p.look]; const m=p.look?Math.min(k,p.look):k; if(m>=p.minN) mu[k]=s/m*252; }
  const sg=ind.vol(c,p.sig);
  const rf=[]; let last=0; const ds=Object.keys(P.irx).sort(); let li=0; for(let k=0;k<n;k++){ const d=P.dates[k]; while(li<ds.length&&ds[li]<=d){ last=P.irx[ds[li]]; li++; } rf.push(last/100); }
  return {assets:[T], warm:Math.max(p.look||p.minN,p.sig)+2, band:0.05,
    target(k){ const m=mu[k], v=sg[k]; if(m==null||!(v>0)) return {[T]:0}; const ex=m-rf[k]; const f=ex>0?Math.min(p.cap,p.frac*ex/(v*v)):0; return {[T]:f}; } }; }
const KV={K252:{look:252,sig:20},K504:{look:504,sig:20},K1260:{look:1260,sig:20,minN:756},KALL:{look:0,sig:20},K504H:{look:504,sig:20,frac:.5},K504S60:{look:504,sig:60}};
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
let LAST_TURN=null;   // 직전 px 실행의 총 매매금액(회전 보고용 — 곡선 지도에 섞지 않는다)
const pxRun=(spec,cap,from,to,opt)=>{ const P=pxPrep(spec.px), R=spec.rule(P); const r=sim(P,Object.assign({cap,from,to,fee:.0025,tax:true,frac:spec.px.some(x=>/^SYN/.test(x))},R,opt||{})); LAST_TURN=r.turn; return toMap(r.eq); };
(async()=>{
  const pages={};
  pages.real=await open([{sym:'SOXL'},{sym:'TQQQ'}]);
  if(!SMOKE) pages.syn=await open([{sym:'SYNSOXL_S'},{sym:'SYNTQQQ_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,name,tkr,cap,from,to)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to])=>{ window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,true,{park:'bill'});
      else if(name==='IVS') r=runIVS(days,tkr,cap,.45,60,.10,true,'iv','cash');
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      return {eq:window.__EQ,final:r.final}; },[name,tkr,cap,from,to]); return toMap(r.eq,r.final); };
  const SETS={real:{from:'2011-03-01',video:'2013-01-02',E:'TECL',T:'TQQQ',S:'SOXL',TA:'TQQQ'}, syn:{from:'2000-04-03',video:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',S:'SYNSOXL_S',TA:'SYNTQQQ_S'}};
  const NAME={P5:'5년 플랜',NOW:'지금: 무매(SOXL) 1/3 + 플랜 2/3',IM:'무매 SOXL 20 자동',VR:'VR(TQQQ)',MA:'200일선(TQQQ)',IVS:'섀넌(TQQQ)',P10:'10년 플랜',P15:'15년 플랜',P20:'20년 플랜',TQ:'TQQQ 보유',QQQ:'QQQ 보유',
    K252:'켈리 μ1년·σ20',K504:'켈리 μ2년·σ20',K1260:'켈리 μ5년·σ20',KALL:'켈리 μ전체·σ20',K504H:'하프켈리 μ2년·σ20',K504S60:'켈리 μ2년·σ60'};
  const KS=Object.keys(KV);
  const legsOf=k=>{ if(k==='NOW') return [['IM',1/3],['P5',2/3]]; let m=k.match(/^P5\+(\w+)@(\d)$/); if(m){ const w=+m[2]===2?2/3:1/2; return [['P5',w],[m[1],1-w]]; } m=k.match(/^IM\+(\w+)$/); if(m) return [['IM',1/3],[m[1],2/3]]; return [[k,1]]; };
  const MIX=['P5+K504@2','P5+K504@1','IM+K504','P5+K504H@2'];
  NAME['P5+K504@2']='플랜 2/3 + 켈리(μ2년) 1/3'; NAME['P5+K504@1']='플랜 1/2 + 켈리(μ2년) 1/2'; NAME['IM+K504']='무매 1/3 + 켈리(μ2년) 2/3'; NAME['P5+K504H@2']='플랜 2/3 + 하프켈리 1/3';
  const ALL=['P5','NOW','IM','VR','MA','IVS','P10','P15','P20','TQ','QQQ',...KS,...MIX];
  const res={meta:{made:new Date().toISOString(),end:END,names:NAME,kelly:KV,note:'수수료 0.25% · 양도세 22%(연 정산 · 끝 청산세 없음) · 밴드 5%p · 계좌 따로 굴려 더함 · 켈리 상한 100% · 현금 T-bill(배당세 15.4%)'}};
  for(const set of (SMOKE?['real']:['real','syn'])){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const leg=async(k,cap,s,e)=>{ if(k==='P5') return pxRun({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,{})},cap,s,e);
      if(k==='P10') return pxRun({px:[C.T],rule:P=>plan10(P,C.T)},cap,s,e);
      if(k==='P15') return pxRun({px:[C.T],rule:P=>plan15(P,C.T)},cap,s,e);
      if(k==='P20') return pxRun({px:[C.E,C.T],rule:P=>plan20(P,C.E,C.T)},cap,s,e);
      if(k==='TQ') return pxRun({px:[C.T],rule:hold(C.T)},cap,s,e);
      if(k==='QQQ') return pxRun({px:['QQQ'],rule:hold('QQQ')},cap,s,e);
      if(KV[k]) return pxRun({px:[C.T],rule:P=>kelly(P,C.T,KV[k])},cap,s,e);
      if(k==='IM') return appRun(pg,'IM',C.S,cap,s,e);
      return appRun(pg,k,C.TA,cap,s,e); };
    for(const cap of (SMOKE?[10000]:[10000,100000])){ const t0=Date.now(); const R={video:{},full:{},crisis:{},roll:{}};
      const curveOf=async(k,s,e,memo)=>{ let m=null; for(const [l,w] of legsOf(k)){ const key=l+'@'+w.toFixed(4); if(!memo[key]) memo[key]=await leg(l,cap*w,s,e); m=m?mixNone(m,memo[key]):memo[key]; } return m; };
      // ① 영상 구간
      { const memo={}; const PX1=['TQ','QQQ','P5','P10','P15','P20']; for(const k of ALL){ LAST_TURN=null; const c=await curveOf(k,C.video,END,memo); const x=metrics(series(c)); R.video[k]={tr:(x.mult-1)*100,cagr:x.cagr,mdd:x.mdd,mult:x.mult,turn:(KV[k]||PX1.includes(k))&&LAST_TURN!=null?LAST_TURN/cap:null}; } }
      // ①' 영상 조건(세전 · 수수료 0 · 매일 목표 맞춤 밴드 0) — 영상의 '켈리 147 vs 보유 124' 가 재현되는지. 실제 자료만.
      if(set==='real'){ for(const k of [...KS,'TQ','P5']){ const spec=KV[k]?{px:[C.T],rule:P=>kelly(P,C.T,KV[k])}:k==='TQ'?{px:[C.T],rule:hold(C.T)}:{px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,{})};
          const x=metrics(series(pxRun(spec,cap,C.video,END,{fee:0,tax:false,band:KV[k]?0.0:undefined}))); R.videoPre=R.videoPre||{}; R.videoPre[k]={mult:x.mult,cagr:x.cagr,mdd:x.mdd,turn:LAST_TURN/cap}; } }
      // 전 구간 + 위기
      const memoF={}, full={}; for(const k of ALL){ full[k]=await curveOf(k,C.from,END,memoF); R.full[k]=metrics(series(full[k])); }
      const CR=set==='syn'?[['2000-03-24','2002-10-09','닷컴 붕괴'],['2007-10-09','2009-03-09','금융위기'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장']]
                          :[['2011-07-22','2011-10-03','2011 미국 강등'],['2015-07-20','2016-02-11','2015 중국·유가'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장'],['2024-07-10','2025-04-08','2024~25 관세']];
      const trim=(m,from)=>{ const o={}; for(const d of Object.keys(m)) if(d>=from) o[d]=m[d]; return o; }, yAgo=d=>(+d.slice(0,4)-1)+d.slice(4);
      for(const [s,e,lab] of CR){ R.crisis[lab]={}; for(const k of ALL) R.crisis[lab][k]=crisis(trim(full[k],yAgo(s)),s,e); }
      // 5년 롤링 — 분기 시작
      const W={}; ALL.forEach(k=>W[k]=[]); const starts=[];
      for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; starts.push([s,e]); }
      for(const [s,e] of (SMOKE?starts.slice(0,4):starts)){ const memo={}; for(const k of ALL){ const x=metrics(series(await curveOf(k,s,e,memo))); W[k].push(x?{s,c:x.cagr,d:x.mdd,mult:x.mult}:null); } }
      const P5=W.P5, TQ=W.TQ;
      for(const k of ALL){ const a=W[k]; const ok=a.map((x,i)=>x&&P5[i]?[x,P5[i],TQ[i]]:null).filter(Boolean);
        R.roll[k]={n:ok.length,cMed:med(a.map(x=>x&&x.c)),c10:q(a.map(x=>x&&x.c),.1),cMin:Math.min(...a.filter(Boolean).map(x=>x.c)),mMed:med(a.map(x=>x&&x.d)),mMax:Math.max(...a.filter(Boolean).map(x=>x.d)),
          pLoss:a.filter(x=>x&&x.c<0).length/ok.length*100,half:a.filter(x=>x&&x.mult<0.5).length/ok.length*100,multMin:Math.min(...a.filter(Boolean).map(x=>x.mult)),
          beatP5:k==='P5'?null:ok.filter(([x,p])=>x.c>p.c).length/ok.length*100, beatBoth:k==='P5'?null:ok.filter(([x,p])=>x.c>p.c&&x.d<p.d).length/ok.length*100,
          beatTQ:k==='TQ'?null:ok.filter(([x,,t])=>t&&x.c>t.c).length/ok.length*100, beatTQBoth:k==='TQ'?null:ok.filter(([x,,t])=>t&&x.c>t.c&&x.d<t.d).length/ok.length*100}; }
      R.rollRaw=W; res[set][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 창 ${starts.length}개 · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
