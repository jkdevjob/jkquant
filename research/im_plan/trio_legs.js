// 2~3 전략 조합 탐색(11-08) 1단계 자료 — 앱 전략 25개를 5년 창마다 한 번씩(원금 전액) 돌려 일별 곡선을 저장한다.
// 2026-11-08 사용자: '앞으로 두 전략으로만 또는 최대 3개 전략으로 투자를 한다면 지금(무매 1/3 · 5년 2/3 · USD 매일 2달러)보다 더 좋은 전략 심도있게 찾아봐'
// 조합은 다리 곡선을 비중만큼 줄여 더한다(선형) — 양도세 250만원 공제가 다리마다 비중만큼 나뉘어 포트폴리오 전체에 한 번만 들어간다(따로 굴린 계좌마다 공제를 다 주던 pairs.js 보다 보수적).
// 정수 주 왜곡은 원금 전액 기준이라 비중이 작은 다리에선 실제보다 덜하다 → 2단계(trio_exact.js)에서 비중별 정확 재실행으로 확인.
// 플랜은 앱 조건(수수료 0.1% · 기본 = TQQQ 는 Guard 바뀔 때만 · 새 규칙 exp1 · 공격형 exp2) · 그 밖은 수수료 0.25% · 양도세 22% 연 정산(끝 청산세 없음).
// 출력: trio_legs.json(색인) + trio_legs.bin(Float64 곡선) · 사용: node trio_legs.js [out-prefix]   (SMOKE=1: 실제 1만$ · 창 2개)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'trio_legs'; const SMOKE=!!process.env.SMOKE;
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
const END='2026-10-19';
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);'); };
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
const pxRun=(spec,cap,from,to)=>{ const P=pxPrep(spec.px), R=spec.rule(P); return toMap(sim(P,Object.assign({cap,from,to,fee:spec.fee??.0025,tax:true,frac:spec.px.some(x=>/^SYN/.test(x))},R)).eq); };
// 앱 플랜 규칙 벌(plan-session-engine.js ALPHA_RULES) — base: Guard ±1% · TECL 밴드 10% 대칭 · TQQQ 는 Guard 바뀔 때만 / exp1: Guard 끄기 −3% · TECL 줄일 때 1%·늘릴 때 15% · TQQQ 해마다 2%p / exp2: exp1 + TECL 목표 변동성 .60
const PB={gsb:1e9}, PN={gbOn:.01,gbOff:.03,sbDn:.01,sbUp:.15,gReb:'y'}, PX=Object.assign({s0:.60},PN);
const LEGS={
  IM:  {n:'무매 SOXL', app:'IM', tkr:'SOXL'},  IMT:{n:'무매 TQQQ', app:'IM', tkr:'TQQQ'},  IMU:{n:'무매 USD', app:'IM', tkr:'USD'},
  P5:  {n:'5년 플랜(기본)', px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PB),fee:.001})},
  P5N: {n:'5년 플랜(새 규칙)', px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PN),fee:.001})},
  P5X: {n:'5년 플랜(공격형)', px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PX),fee:.001})},
  P10: {n:'10년 플랜', px:C=>({px:[C.T],rule:P=>plan10(P,C.T),fee:.001})},  P15:{n:'15년 플랜', px:C=>({px:[C.T],rule:P=>plan15(P,C.T),fee:.001})},
  P20: {n:'20년 플랜', px:C=>({px:[C.E,C.T],rule:P=>plan20(P,C.E,C.T),fee:.001})},
  VR_U:{n:'VR USD', app:'VR', tkr:'USD'}, VR_T:{n:'VR TQQQ', app:'VR', tkr:'TQQQ'}, VR_E:{n:'VR TECL', app:'VR', tkr:'TECL'},
  MA_U:{n:'200일선 USD', app:'MA', tkr:'USD'}, MA_T:{n:'200일선 TQQQ', app:'MA', tkr:'TQQQ'},
  IVS_U:{n:'섀넌 USD(1배수 짝)', app:'IVS', tkr:'USD', ivs:[.55,40,.20,'iv','x1']}, IVS_Uc:{n:'섀넌 USD(현금 짝)', app:'IVS', tkr:'USD', ivs:[.55,40,.20,'iv','cash']},
  IVS_T:{n:'섀넌 TQQQ', app:'IVS', tkr:'TQQQ', ivs:[.45,60,.10,'iv','cash']}, IVS_E:{n:'섀넌 TECL', app:'IVS', tkr:'TECL', ivs:[.55,40,.20,'iv','cash']},
  H_U:{n:'거치 USD', px:C=>({px:[C.U],rule:hold(C.U)})}, H_T:{n:'거치 TQQQ', px:C=>({px:[C.T],rule:hold(C.T)})}, H_E:{n:'거치 TECL', px:C=>({px:[C.E],rule:hold(C.E)})},
  H_Q:{n:'거치 QQQ', px:()=>({px:['QQQ'],rule:hold('QQQ')})}, H_SPY:{n:'거치 SPY', px:()=>({px:['SPY'],rule:hold('SPY')})},
  CASH:{n:'현금(T-bill)', px:()=>({px:['QQQ'],rule:cashOnly})},
  H_GLD:{n:'거치 금(GLD)', px:()=>({px:['GLD'],rule:hold('GLD')}), realOnly:true},
};
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',U:'USD'}, syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',U:'SYNUSD'}};
(async()=>{
  const pages={};
  pages.real=await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'TECL'},{sym:'USD'}]);
  if(!SMOKE) pages.syn=await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'TQQQ',file:'SYNTQQQ_S'},{sym:'TECL',file:'SYNTECL_S'},{sym:'USD',file:'SYNUSD_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,L,cap,from,to)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to,ivs])=>{ window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,true,{park:'bill'});
      else if(name==='IVS') r=runIVS(days,tkr,cap,ivs[0],ivs[1],ivs[2],true,ivs[3],ivs[4]);
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      return {eq:window.__EQ,final:r.final}; },[L.app,L.tkr,cap,from,to,L.ivs||null]); return toMap(r.eq,r.final); };
  const idx={made:new Date().toISOString(),end:END,names:Object.fromEntries(Object.entries(LEGS).map(([k,v])=>[k,v.n])),
    note:'다리 = 원금 전액으로 한 번 돌린 곡선(조합은 비중만큼 선형) · 플랜 앱 조건 수수료 0.1% · 그 밖 0.25% · 양도세 22% 연 정산 · 끝 청산세 없음 · VR 거치 밴드 15% G10 · 200일선 크로스·단기국채 · 섀넌 USD(.55,40,20%) TQQQ(.45,60,10%,현금) TECL(.55,40,20%,현금)',
    blocks:[]};
  const chunks=[]; let off=0;
  const put=(meta,dates,arrs)=>{ const n=dates.length, L=arrs.length, buf=new Float64Array(n*L); arrs.forEach((a,j)=>buf.set(a,j*n)); chunks.push(Buffer.from(buf.buffer)); idx.blocks.push(Object.assign(meta,{n,off,dates})); off+=buf.byteLength; };
  for(const set of (SMOKE?['real']:['real','syn'])){ const C=SETS[set], pg=pages[set].pg;
    const legKeys=Object.keys(LEGS).filter(k=>!(set==='syn'&&LEGS[k].realOnly)); idx[set]={legs:legKeys};
    const run=async(k,cap,s,e)=>{ const L=LEGS[k]; return L.app?appRun(pg,L,cap,s,e):pxRun(L.px(C),cap,s,e); };
    const windows=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; windows.push([s,e]); }
    const WIN=SMOKE?windows.slice(0,2):windows;
    for(const cap of (SMOKE?[10000]:[10000,100000])){ const t0=Date.now();
      for(const [s,e,kind] of [...WIN.map(w=>[w[0],w[1],'win']),[C.from,END,'full']]){
        const maps={}; for(const k of legKeys) maps[k]=await run(k,cap,s,e);
        let dates=Object.keys(maps[legKeys[0]]); for(const k of legKeys.slice(1)){ const m=maps[k]; dates=dates.filter(d=>m[d]!=null); } dates.sort();
        if(dates.length<200) throw new Error(`${set} ${cap} ${s}: 공통 날짜 ${dates.length}`);
        for(const k of legKeys){ const m=maps[k], d0=Object.keys(m).sort()[0]; if(d0>dates[0]) throw new Error(k+' 시작이 늦음 '+d0); }
        put({set,cap,kind,s,e},dates,legKeys.map(k=>Float64Array.from(dates.map(d=>maps[k][d])))); }
      console.error(`[${set} ${cap/1e4}만$] 다리 ${legKeys.length} · 창 ${WIN.length}+전구간 · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close();
  fs.writeFileSync(OUT+'.bin',Buffer.concat(chunks)); fs.writeFileSync(OUT+'.json',JSON.stringify(idx)); console.error('done',OUT,(off/1e6).toFixed(1)+'MB'); })().catch(e=>{console.error(e);process.exit(1);});
