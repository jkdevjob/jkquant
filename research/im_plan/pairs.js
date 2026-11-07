// 두 전략 조합 토너먼트 — 2026-11-06 사용자: '두 전략만 고려했을 때 무매 1/3 + 5년 플랜 2/3 보다 나은 전략 뽑아봐'
// 앱 전략 24개(무매 SOXL/TQQQ/USD · 5/10/15/20년 플랜 · VR·200일선·섀넌(TQQQ·SOXL·TECL·USD) · 거치 TQQQ·SOXL·TECL·USD·QQQ·QLD·SPY·금 · 현금)로
// 짝 276개 × 비중(1/3·1/2·2/3) 828 조합 + 단독 24. 계좌 따로 굴려 더한다(안 옮김). 앞 연구와 같은 규약(수수료 0.25% · 양도세 연 정산 · 신호 전일까지).
// 5년 롤링(실제 2011~2021 분기 43창 · 합성 2000~2021 86창) · 전 구간 · 위기 낙폭 — 1만$·10만$. 비교 기준 = 지금(무매 SOXL 1/3 + 5년 플랜 2/3).
// 사용: node pairs.js out.json   (SMOKE=1: 실제 1만$ · 창 3개 · 다리 6개)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'pairs_out.json'; const SMOKE=!!process.env.SMOKE;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));
const END='2026-10-19';
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);'); };
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
const pxRun=(spec,cap,from,to)=>{ const P=pxPrep(spec.px), R=spec.rule(P); return toMap(sim(P,Object.assign({cap,from,to,fee:.0025,tax:true,frac:spec.px.some(x=>/^SYN/.test(x))},R)).eq); };
// 다리 — app: 백테 엔진(Playwright) · px: 비중 엔진. 합성은 앱 엔진엔 _S(병합·분할) 자료를 실제 이름으로, px 엔진엔 SYN(소수 주) 자료
const LEGS={
  IM:  {n:'무매 SOXL 20 자동', app:'IM', tkr:'SOXL'},  IMT:{n:'무매 TQQQ 20 자동', app:'IM', tkr:'TQQQ'},  IMU:{n:'무매 USD 20 자동', app:'IM', tkr:'USD'},
  P5:  {n:'5년 플랜', px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,{})})},
  P10: {n:'10년 플랜', px:C=>({px:[C.T],rule:P=>plan10(P,C.T)})},  P15:{n:'15년 플랜', px:C=>({px:[C.T],rule:P=>plan15(P,C.T)})},  P20:{n:'20년 플랜', px:C=>({px:[C.E,C.T],rule:P=>plan20(P,C.E,C.T)})},
  VR_T:{n:'VR TQQQ', app:'VR', tkr:'TQQQ'}, VR_S:{n:'VR SOXL', app:'VR', tkr:'SOXL'}, VR_E:{n:'VR TECL', app:'VR', tkr:'TECL'}, VR_U:{n:'VR USD', app:'VR', tkr:'USD'},
  MA_T:{n:'200일선 TQQQ', app:'MA', tkr:'TQQQ'}, MA_S:{n:'200일선 SOXL', app:'MA', tkr:'SOXL'}, MA_U:{n:'200일선 USD', app:'MA', tkr:'USD'},
  IVS_T:{n:'섀넌 TQQQ', app:'IVS', tkr:'TQQQ', ivs:[.45,60,.10,'iv','cash']}, IVS_E:{n:'섀넌 TECL', app:'IVS', tkr:'TECL', ivs:[.55,40,.20,'iv','cash']}, IVS_U:{n:'섀넌 USD(1배수)', app:'IVS', tkr:'USD', ivs:[.55,40,.20,'iv','x1']},
  H_T:{n:'거치 TQQQ', px:C=>({px:[C.T],rule:hold(C.T)})}, H_S:{n:'거치 SOXL', px:C=>({px:[C.S],rule:hold(C.S)})}, H_E:{n:'거치 TECL', px:C=>({px:[C.E],rule:hold(C.E)})}, H_U:{n:'거치 USD', px:C=>({px:[C.U],rule:hold(C.U)})},
  H_Q:{n:'거치 QQQ', px:()=>({px:['QQQ'],rule:hold('QQQ')})}, H_QLD:{n:'거치 QLD', px:C=>({px:[C.QLD],rule:hold(C.QLD)})}, H_SPY:{n:'거치 SPY', px:()=>({px:['SPY'],rule:hold('SPY')})},
  H_GLD:{n:'거치 금(GLD)', px:()=>({px:['GLD'],rule:hold('GLD')}), realOnly:true},
  CASH:{n:'현금(T-bill)', px:()=>({px:['QQQ'],rule:cashOnly})},
};
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',S:'SOXL',U:'USD',QLD:'QLD'}, syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',S:'SYNSOXL',U:'SYNUSD',QLD:'SYNQLD'}};
const W=[1/3,1/2,2/3]; const wl=w=>w===1?'':(Math.abs(w-1/3)<1e-9?'1/3':Math.abs(w-1/2)<1e-9?'1/2':'2/3');
(async()=>{
  const pages={};
  pages.real=await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'TECL'},{sym:'USD'},{sym:'SMH'}]);
  if(!SMOKE) pages.syn=await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'TQQQ',file:'SYNTQQQ_S'},{sym:'TECL',file:'SYNTECL_S'},{sym:'USD',file:'SYNUSD_S'},{sym:'SMH',file:'SYNSMH_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,L,cap,from,to)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to,ivs])=>{ window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,true,{park:'bill'});
      else if(name==='IVS') r=runIVS(days,tkr,cap,ivs[0],ivs[1],ivs[2],true,ivs[3],ivs[4]);
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      return {eq:window.__EQ,final:r.final}; },[L.app,L.tkr,cap,from,to,L.ivs||null]); return toMap(r.eq,r.final); };
  const res={meta:{made:new Date().toISOString(),end:END,legs:Object.fromEntries(Object.entries(LEGS).map(([k,v])=>[k,v.n])),weights:W,
    note:'계좌 따로 굴려 더함 · 수수료 0.25% · 양도세 22%(연 정산 · 끝 청산세 없음) · VR 거치 밴드 15% G10 · 200일선 크로스·단기국채 · 섀넌 TQQQ(.45,60,10%,현금) TECL(.55,40,20%,현금) USD(.55,40,20%,1배수) · 기준 = 무매 SOXL 1/3 + 5년 플랜 2/3'}};
  for(const set of (SMOKE?['real']:['real','syn'])){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const legKeys=Object.keys(LEGS).filter(k=>!(set==='syn'&&LEGS[k].realOnly)).filter(k=>!SMOKE||['IM','P5','VR_T','H_Q','CASH','IVS_T'].includes(k));
    const combos=[], NM={}; const key=(A,w,B)=>A+'@'+w.toFixed(3)+'+'+B;
    for(let i=0;i<legKeys.length;i++) for(let j=i+1;j<legKeys.length;j++) for(const w of W){ const A=legKeys[i],B=legKeys[j]; combos.push([A,w,B]); NM[key(A,w,B)]=`${LEGS[A].n} ${wl(w)} + ${LEGS[B].n} ${wl(1-w)}`; }   // 짝마다 A 1/3·1/2·2/3 (A 2/3 = B 1/3 이라 i<j 만)
    for(const k of legKeys) NM[k]=LEGS[k].n;
    const run=async(k,cap,s,e)=>{ const L=LEGS[k]; return L.app?appRun(pg,L,cap,s,e):pxRun(L.px(C),cap,s,e); };
    for(const cap of (SMOKE?[10000]:[10000,100000])){ const t0=Date.now();
      const windows=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; windows.push([s,e]); }
      const WIN=SMOKE?windows.slice(0,3):windows;
      const acc={}; const push=(k,x)=>{ (acc[k]=acc[k]||[]).push(x); };
      const evalAll=async(s,e,into)=>{ const LC={}; for(const k of legKeys){ for(const w of [...W,1]){ LC[k+'@'+w.toFixed(3)]=await run(k,cap*w,s,e); } }
        const mm=m=>{ const x=metrics(series(m)); return x?{c:x.cagr,d:x.mdd,mult:x.mult}:null; };
        for(const k of legKeys) into(k,mm(LC[k+'@1.000']));
        for(const [A,w,B] of combos) into(key(A,w,B),mm(mixNone(LC[A+'@'+w.toFixed(3)],LC[B+'@'+(1-w).toFixed(3)])));
        return LC; };
      for(const [s,e] of WIN) await evalAll(s,e,(k,x)=>push(k,x&&Object.assign({s},x)));
      // 전 구간 + 위기(위기 직전 1년 고점 기준)
      const fullC={}; const LCF=await evalAll(C.from,END,(k,x)=>{ fullC[k]=x; });
      const trim=(m,from)=>{ const o={}; for(const d of Object.keys(m)) if(d>=from) o[d]=m[d]; return o; }, yAgo=d=>(+d.slice(0,4)-1)+d.slice(4);
      const CR=set==='syn'?[['2007-10-09','2009-03-09','금융위기'],['2018-10-01','2018-12-24','2018Q4'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022']]
                          :[['2018-10-01','2018-12-24','2018Q4'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022'],['2024-07-10','2025-04-08','2024~25']];
      const curveOf=k=>{ const m=k.match(/^(\w+)@([\d.]+)\+(\w+)$/); return m?mixNone(LCF[m[1]+'@'+(+m[2]).toFixed(3)],LCF[m[3]+'@'+(1-+m[2]).toFixed(3)]):LCF[k+'@1.000']; };
      const CUR=key('IM',1/3,'P5'); const cur=acc[CUR];
      const out={}; for(const k of Object.keys(acc)){ const a=acc[k]; const ok=a.map((x,i)=>x&&cur[i]?[x,cur[i]]:null).filter(Boolean); const cv=curveOf(k); const cr={}; for(const [s,e,lab] of CR){ const z=crisis(trim(cv,yAgo(s)),s,e); cr[lab]=z?+z.dd.toFixed(1):null; }
        out[k]={name:NM[k], n:ok.length,cMed:med(a.map(x=>x&&x.c)),c10:q(a.map(x=>x&&x.c),.1),cMin:Math.min(...a.filter(Boolean).map(x=>x.c)),
          mMed:med(a.map(x=>x&&x.d)),mMax:Math.max(...a.filter(Boolean).map(x=>x.d)),pLoss:a.filter(x=>x&&x.c<0).length/ok.length*100,half:a.filter(x=>x&&x.mult<0.5).length/ok.length*100,
          beatC:ok.filter(([x,c])=>x.c>c.c).length/ok.length*100, beatBoth:ok.filter(([x,c])=>x.c>c.c&&x.d<c.d).length/ok.length*100, lowerD:ok.filter(([x,c])=>x.d<c.d).length/ok.length*100,
          full:fullC[k], crisis:cr}; }
      res[set][cap]={cur:CUR,windows:WIN.length,combos:out}; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 다리 ${legKeys.length} · 조합 ${combos.length} · 창 ${WIN.length} · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
