// USD(반도체 2배) 전략 vs 5년 플랜 — 2026-10-31 사용자: 'usd로 어떤 전략으로 투자를 해도 5년플랜보다 좋은 거 같은데 어때?'
// 모의 화면(2020-01-01 시작) USD 세션 설정 그대로:
//   거치 · 섀넌(역분산 1/σ² · s0 55% · 40일 · 밴드 20% · 짝 1배수 SMH) · VR(거치식 · 밴드 10% · G10) · 200일선(크로스·크로스 · 단기국채) · 무매(20분할 · 익절 자동)
// 상대: 5년 플랜(역분산+Guard · TECL/TQQQ) · 지금 구성(무매 SOXL 1/3 + 플랜 2/3) — 앞 연구(tourney.js)와 같은 엔진·같은 규약(수수료 · 양도세 연 정산 · 청산세 없음)
// ① 2020-01-02~ 한 구간(모의 화면과 맞는지) ② 5년 롤링(분기 시작): 실제 2011-04~ · 합성 2000-04~ ③ 위기 낙폭 ④ 섞기: 플랜 2/3·1/2 + USD-X 나머지
// 합성 USD = synusd.js (SOX→SMH 총수익 이어 붙인 1배의 2배 · 실제 USD 2007~2026 연 27.8 vs 합성 28.3)
// 사용: node synusd.js && node usd.js out.json   (SMOKE=1: 실제 1만$ · 창 4개)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'usd_out.json'; const SMOKE=!!process.env.SMOKE;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));                  // hold · cashOnly · …
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));               // metrics · series · mixNone · slice · crisis …
const END='2026-10-19';                                         // TECL·TQQQ·SOX 자료 끝 — 모든 전략을 같은 날 끊는다
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);'); };
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
const pxRun=(spec,cap,from,to)=>{ const P=pxPrep(spec.px), R=spec.rule(P); return toMap(sim(P,Object.assign({cap,from,to,fee:.0025,tax:true,frac:spec.px.some(x=>/^SYN/.test(x))},R)).eq); };
(async()=>{
  const pages={};
  pages.real=await open([{sym:'SOXL'},{sym:'USD'},{sym:'SMH'}]);
  if(!SMOKE) pages.syn=await open([{sym:'SYNSOXL_S'},{sym:'USD',file:'SYNUSD_S'},{sym:'SMH',file:'SYNSMH_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,name,tkr,cap,from,to)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to])=>{ window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r, extra=null;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:10,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,true,{park:'bill'});
      else if(name==='IVS'){ r=runIVS(days,tkr,cap,.55,40,.20,true,'iv','x1'); extra={pair:r.pairSym||r.pair||null,synth:r.pairSynth??r.synth??null}; }
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      return {eq:window.__EQ,final:r.final,extra}; },[name,tkr,cap,from,to]); return toMap(r.eq,r.final); };
  const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',U:'USD',S:'SOXL'}, syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',U:'SYNUSD',S:'SYNSOXL_S'}};
  const NAME={P5:'5년 플랜',HOLD:'USD 거치',IVS:'USD 섀넌(역분산·1배수)',VR:'USD VR',MA:'USD 200일선',IMU:'USD 무매 20 자동',NOW:'지금: 무매(SOXL) 1/3 + 플랜 2/3'};
  const USDX=['HOLD','IVS','VR','MA','IMU'];
  const legsOf=k=>{ if(k==='NOW') return [['IMS',1/3],['P5',2/3]]; const m=k.match(/^P5\+(\w+)@(\d)$/); if(m){ const w=+m[2]===2?2/3:1/2; return [['P5',w],[m[1],1-w]]; } return [[k,1]]; };
  const MIX=[]; for(const x of USDX){ MIX.push('P5+'+x+'@2'); MIX.push('P5+'+x+'@1'); }   // @2 = 플랜 2/3 · @1 = 플랜 1/2
  for(const x of USDX){ NAME['P5+'+x+'@2']='플랜 2/3 + '+NAME[x]+' 1/3'; NAME['P5+'+x+'@1']='플랜 1/2 + '+NAME[x]+' 1/2'; }
  const ALL=['P5','NOW',...USDX,...MIX];
  const res={meta:{made:new Date().toISOString(),end:END,names:NAME,note:'수수료 0.25% · 양도세 22%(연 250만원 공제, 실현분 연 정산) · 끝에 청산세 없음(거치가 세금 이연 이득을 그대로 가짐) · 계좌 따로 굴려 더함'}};
  for(const set of (SMOKE?['real']:['real','syn'])){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const leg=async(k,cap,s,e)=>{ if(k==='P5') return pxRun({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,{})},cap,s,e);
      if(k==='HOLD') return pxRun({px:[C.U],rule:hold(C.U)},cap,s,e);
      if(k==='IMS') return appRun(pg,'IM',C.S,cap,s,e);
      if(k==='IMU') return appRun(pg,'IM','USD',cap,s,e);
      return appRun(pg,k,'USD',cap,s,e); };
    for(const cap of (SMOKE?[10000]:[10000,100000])){ const t0=Date.now(); const R={full:{},y2020:{},crisis:{},roll:{}};
      const curveOf=async(k,s,e,memo)=>{ let m=null; for(const [l,w] of legsOf(k)){ const key=l+'@'+w.toFixed(4); if(!memo[key]) memo[key]=await leg(l,cap*w,s,e); m=m?mixNone(m,memo[key]):memo[key]; } return m; };
      // 전 구간 + 위기
      const memoF={}, full={}; for(const k of ALL){ full[k]=await curveOf(k,C.from,END,memoF); R.full[k]=metrics(series(full[k])); }
      const CR=set==='syn'?[['2000-03-24','2002-10-09','닷컴 붕괴'],['2007-10-09','2009-03-09','금융위기'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장']]
                          :[['2011-07-22','2011-10-03','2011 미국 강등'],['2015-07-20','2016-02-11','2015 중국·유가'],['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022 하락장'],['2024-07-10','2025-04-08','2024~25 관세']];
      // 위기 낙폭은 '위기 직전 1년' 안의 고점 기준 — 전 구간 고점(합성은 2000년 거품 꼭대기)을 쓰면 그 뒤 위기가 모두 −90%대로 부풀려진다
      const trim=(m,from)=>{ const o={}; for(const d of Object.keys(m)) if(d>=from) o[d]=m[d]; return o; }, yAgo=d=>(+d.slice(0,4)-1)+d.slice(4);
      for(const [s,e,lab] of CR){ R.crisis[lab]={}; for(const k of ALL) R.crisis[lab][k]=crisis(trim(full[k],yAgo(s)),s,e); }
      // 모의 화면 구간(2020-01-02~) — 실제 자료만
      if(set==='real'){ const memo={}; for(const k of ALL){ const m=metrics(series(await curveOf(k,'2020-01-02',END,memo))); R.y2020[k]={tr:(m.mult-1)*100,cagr:m.cagr,mdd:m.mdd}; } }
      // 5년 롤링 — 분기 시작
      const W={}; ALL.forEach(k=>W[k]=[]); const starts=[];
      for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; starts.push([s,e]); }
      for(const [s,e] of (SMOKE?starts.slice(0,4):starts)){ const memo={}; for(const k of ALL){ const x=metrics(series(await curveOf(k,s,e,memo))); W[k].push(x?{s,c:x.cagr,d:x.mdd,mult:x.mult}:null); } }
      const P5=W.P5, ERA=set==='syn'?[['2000','2004'],['2005','2009'],['2010','2014'],['2015','2021']]:[['2011','2014'],['2015','2017'],['2018','2021']];
      for(const k of ALL){ const a=W[k]; const ok=a.map((x,i)=>x&&P5[i]?[x,P5[i]]:null).filter(Boolean);
        const era={}; for(const [y0,y1] of ERA){ const z=ok.filter(([x])=>x.s.slice(0,4)>=y0&&x.s.slice(0,4)<=y1); era[y0+'~'+y1]={n:z.length,beat:z.length?z.filter(([x,p])=>x.c>p.c).length/z.length*100:null,cMed:med(z.map(([x])=>x.c)),p5Med:med(z.map(([,p])=>p.c))}; }
        R.roll[k]={n:ok.length,cMed:med(a.map(x=>x&&x.c)),c10:q(a.map(x=>x&&x.c),.1),cMin:Math.min(...a.filter(Boolean).map(x=>x.c)),cMax:Math.max(...a.filter(Boolean).map(x=>x.c)),
          mMed:med(a.map(x=>x&&x.d)),mMax:Math.max(...a.filter(Boolean).map(x=>x.d)),pLoss:a.filter(x=>x&&x.c<0).length/ok.length*100,half:a.filter(x=>x&&x.mult<0.5).length/ok.length*100,
          multMed:med(a.map(x=>x&&x.mult)),multMin:Math.min(...a.filter(Boolean).map(x=>x.mult)),
          beatP5:k==='P5'?null:ok.filter(([x,p])=>x.c>p.c).length/ok.length*100, beatBoth:k==='P5'?null:ok.filter(([x,p])=>x.c>p.c&&x.d<p.d).length/ok.length*100, era}; }
      R.rollRaw=W; res[set][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 창 ${starts.length}개 · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
