// 실제 투자 기준(11-08 사용자) — 무매 1만$ + 플랜 2만$ + 매일 10$ 적립(USD 2 · ROM 2 · QLD 2 · GLDM 1 · TSLA 1 · SPCX 1 · AMDY 1) 를
// 2~3 전략으로 줄인다면 어떤 배분이 좋은가. 일시금(정확 재실행: 다리마다 원금×비중 · 정수 주 · 공제 비중만큼) × 적립 행선지 × 5년 창(실제 43 · 합성 86) × 원금 1만·3만(실제)·10만$.
// 적립: 날마다 종가에 10$(소수 주 · 수수료 0.25% · 안 팖 · 배당 재투자 세전 = 조정 종가). 'PLAN' = 10$ 를 날마다 쌓아 달 첫 거래일에 플랜에 넣고 목표로 맞춤(앱 monthlyAdd 와 같음 · px dep).
// 지금 바구니는 SPCX(2026-06 상장)·AMDY(2023-09 상장)를 시험할 수 없어 나머지 5종목 비율로 10$ 를 다시 나눴다(합성은 TSLA 도 없어 4종목). 금 = GOLDX(GLDM ← GLD ← 금 선물).
// 수익률은 단위(TWR) 방식 — 적립금 들어온 날은 그 돈을 빼고 그날 수익을 잰다. MDD 도 단위 가치로. 끝 평가액은 그대로(청산세 없음).
// 사용: node trio_dca.js out.json   (SMOKE=1: 실제 3만$ · 창 2개)
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'trio_dca.json'; const SMOKE=!!process.env.SMOKE;
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));
const END=process.env.END||'2026-10-19', FEE=0.0025, PERDAY=10;   // 11-09: END · LS(일시금 고르기) · DSUB(적립 고르기) 환경변수 — 안 주면 예전과 같음
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
const pxRun=(spec,cap,from,to,w,dep)=>{ const P=pxPrep(spec.px), R=spec.rule(P); const o=Object.assign({cap,from,to,fee:spec.fee??FEE,tax:true,dedMul:w,frac:spec.px.some(x=>/^SYN/.test(x)),sizePrev:!!process.env.SIZEPREV},R); if(dep) o.dep={perDay:dep};   // SIZEPREV=1: 주수를 전일 종가로(앱 플랜 엔진과 같게 · 11-08)
  const m=toMap(sim(P,o).eq); return dep?{m,flows:o.flows}:m; };
const PB={gsb:1e9}, PN={gbOn:.01,gbOff:.03,sbDn:.01,sbUp:.15,gReb:'y'}, PX=Object.assign({s0:.60},PN);
const LEGS={ IM:{app:'IM',tkr:'SOXL'}, IVS_Uc:{app:'IVS',tkr:'USD',ivs:[.55,40,.15,'iv','cash']},   // 섀넌 USD = 앱 기본값(s0 55 · 40일 · 밴드 15%p · 단기국채)
  P5:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PB),fee:.001}), plan:true}, P5N:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PN),fee:.001}), plan:true}, P5X:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PX),fee:.001}), plan:true},
  H_G:{px:()=>({px:['GOLDX'],rule:hold('GOLDX')})} };
const LUMPS={ L0:[['IM',1/3],['P5',2/3]], L7:[['IM',1/3],['P5N',2/3]], L1:[['P5N',1]], L2:[['P5N',5/6],['IVS_Uc',1/6]], L3:[['P5N',2/3],['IVS_Uc',1/3]],
  L4:[['P5X',5/6],['IVS_Uc',1/6]], L5:[['IM',1/6],['P5X',5/6]], L6:[['P5N',5/6],['H_G',1/6]], L8:[['P5N',2/3],['IVS_Uc',1/6],['H_G',1/6]],
  L9:[['P5',5/6],['IVS_Uc',1/6]], L10:[['P5',1]], L11:[['P5',2/3],['IVS_Uc',1/3]], L12:[['P5X',1]],
  L13:[['P5',3/4],['IVS_Uc',1/4]], L14:[['P5',1/2],['IVS_Uc',1/2]] };   // 11-09 포트폴리오 후보 ① 비중
if(process.env.LS){ const keep=process.env.LS.split(','); for(const k of Object.keys(LUMPS)) if(!keep.includes(k)) delete LUMPS[k]; }
const LNAME={L0:'지금: 무매 1만 + 플랜(기본) 2만',L7:'무매 1/3 + 플랜(새 규칙) 2/3',L1:'플랜(새 규칙) 100%',L2:'플랜(새) 5/6 + 섀넌 USD 1/6',L3:'플랜(새) 2/3 + 섀넌 USD 1/3',
  L4:'플랜(공격형) 5/6 + 섀넌 USD 1/6',L5:'무매 1/6 + 플랜(공격형) 5/6',L6:'플랜(새) 5/6 + 금 1/6',L8:'플랜(새) 2/3 + 섀넌 USD 1/6 + 금 1/6',L9:'플랜(기본) 5/6 + 섀넌 USD 1/6',L10:'플랜(기본) 100%',L11:'플랜(기본) 2/3 + 섀넌 USD 1/3',L12:'플랜(공격형) 100%',L13:'플랜(기본) 3/4 + 섀넌 USD 1/4',L14:'플랜(기본) 1/2 + 섀넌 USD 1/2'};
const DCAS={ BASKET:{USD:2,ROM:2,QLD:2,GOLD:1,TSLA:1}, LEV3:{USD:1,ROM:1,QLD:1}, USD:{USD:1}, ROM:{ROM:1}, QLD:{QLD:1}, TQQQ:{TQQQ:1}, QQQ:{QQQ:1}, SPY:{SPY:1}, GOLD:{GOLD:1}, TSLA:{TSLA:1},
  QLD_G2:{QLD:8,GOLD:2}, QLD_G3:{QLD:7,GOLD:3}, USD_G3:{USD:7,GOLD:3}, QQQ_G3:{QQQ:7,GOLD:3}, SPY_G3:{SPY:7,GOLD:3}, LEV_G2:{USD:8/3,ROM:8/3,QLD:8/3,GOLD:2}, CASH:{CASH:1}, PLAN:'plan', PROP:'prop' };
if(process.env.DSUB){ const keep=process.env.DSUB.split(','); for(const k of Object.keys(DCAS)) if(!keep.includes(k)) delete DCAS[k]; }
const DNAME={BASKET:'지금 바구니',LEV3:'USD·ROM·QLD 같은 비율',USD:'USD',ROM:'ROM',QLD:'QLD',TQQQ:'TQQQ',QQQ:'QQQ',SPY:'SPY',GOLD:'금(GLDM)',TSLA:'TSLA',QLD_G2:'QLD 8 + 금 2',QLD_G3:'QLD 7 + 금 3',USD_G3:'USD 7 + 금 3',
  QQQ_G3:'QQQ 7 + 금 3',SPY_G3:'SPY 7 + 금 3',LEV_G2:'USD·ROM·QLD 8 + 금 2',CASH:'적립 안 함(단기국채에 쌓음)',PLAN:'플랜에 매달 넣기',PROP:'일시금 전략에 비례로 넣기'};
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',sym:{USD:'USD',ROM:'ROM',QLD:'QLD',TQQQ:'TQQQ',QQQ:'QQQ',SPY:'SPY',GOLD:'GOLDX',TSLA:'TSLA'},
                  cr:[['2018-10-01','2018-12-24','2018Q4'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022'],['2024-07-10','2025-04-08','2024~25']]},
            syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',sym:{USD:'SYNUSD',ROM:'SYNROM',QLD:'SYNQLD',TQQQ:'SYNTQQQ',QQQ:'QQQ',SPY:'SPY',GOLD:'GOLDX',TSLA:null},
                  cr:[['2000-04-04','2002-10-09','닷컴'],['2007-10-09','2009-03-09','금융위기'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022']]}};
const PXD={}; const pxDaily=s=>PXD[s]||(PXD[s]=(()=>{ const m={}; require('./data/'+s+'.json').series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; })());
// 1$ 씩 날마다(첫날 제외 — 첫날은 일시금) 산 계좌의 평가액
function unitDca(ds,sym){ const out=new Float64Array(ds.length); if(sym==='CASH'){ let c=0,pd=null,li=0,last=0; const ks=Object.keys(irx).sort();
    ds.forEach((d,t)=>{ while(li<ks.length&&ks[li]<=d){ last=irx[ks[li]]; li++; } if(pd&&c>0){ const gap=Math.max(1,Math.round((Date.parse(d)-Date.parse(pd))/864e5)); c+=c*Math.max(0,last/100-0.0009)*(1-0.154)*gap/365; } if(t>0) c+=1; out[t]=c; pd=d; }); return out; }
  const m=pxDaily(sym); let u=0, lp=null; ds.forEach((d,t)=>{ const p=m[d]??lp; if(p>0) lp=p; if(t>0&&lp>0) u+=(1-FEE)/lp; out[t]=u*(lp||0); }); return out; }
function evalPath(ds,V,F,crs){ const n=ds.length, nav=new Float64Array(n); nav[0]=1; let pk=1,mdd=0; const pkArr=new Float64Array(n); pkArr[0]=1;
  for(let t=1;t<n;t++){ nav[t]=nav[t-1]*(V[t]-F[t])/V[t-1]; if(nav[t]>pk) pk=nav[t]; else mdd=Math.max(mdd,(pk-nav[t])/pk); pkArr[t]=pk; }
  const yrs=(Date.parse(ds[n-1])-Date.parse(ds[0]))/(365.25*864e5); const cr={};
  for(const [s,e,lab] of crs){ if(!(ds[0]<=(+s.slice(0,4)-1)+s.slice(4)&&ds[n-1]>=e)) continue; let x=0; for(let t=0;t<n;t++){ if(ds[t]<s||ds[t]>e) continue; x=Math.max(x,(pkArr[t]-nav[t])/pkArr[t]); } cr[lab]=x*100; }   // 위기 시작 1년 전부터 창 안에 있을 때만
  return {c:(Math.pow(nav[n-1],1/yrs)-1)*100,d:mdd*100,fv:V[n-1],cr}; }
(async()=>{
  const pages={ real:await open([{sym:'SOXL'},{sym:'USD'}]) }; if(!SMOKE) pages.syn=await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'USD',file:'SYNUSD_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,L,cap,from,to,w)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to,ivs,w])=>{ window.__EQ=[]; window.__DEDW=w; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='IVS') r=runIVS(days,tkr,cap,ivs[0],ivs[1],ivs[2],true,ivs[3],ivs[4]);
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); window.__DEDW=1; return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      window.__DEDW=1; return {eq:window.__EQ,final:r.final}; },[L.app,L.tkr,cap,from,to,L.ivs||null,w]); return toMap(r.eq,r.final); };
  const res={meta:{made:new Date().toISOString(),end:END,perDay:PERDAY,lumps:LUMPS,lname:LNAME,dcas:DCAS,dname:DNAME,note:'일시금 정확 재실행 · 적립 매일 10$ 소수 주 수수료 0.25% 배당 재투자(세전) · PLAN = 달마다 플랜에 넣고 목표로 · 단위 수익률 · 끝 청산세 없음 · 지금 바구니는 SPCX·AMDY 를 뺀 비율(합성은 TSLA 도 뺌)'}};
  for(const set of Object.keys(pages)){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const windows=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; windows.push([s,e]); }
    const WIN=SMOKE?windows.slice(0,2):windows;
    const DC={}; for(const [k,v] of Object.entries(DCAS)){ if(typeof v==='string'){ DC[k]=v; continue; } const ok=Object.fromEntries(Object.entries(v).filter(([t])=>t==='CASH'||C.sym[t]));   // 지금 바구니: 시세 없는 종목(합성 TSLA)은 빼고 나머지 비율로
      if(Object.keys(ok).length===Object.keys(v).length||k==='BASKET') DC[k]=ok; }
    const dcaKeys=Object.keys(DC);
    for(const cap of (SMOKE?[30000]:[10000,30000,100000])){ const t0=Date.now(); const R={windows:WIN.map(w=>w[0]),dca:dcaKeys,dcaW:DC,win:{}};
      for(const [s,e] of WIN){ const LC={}; const get=async(k,w,dep)=>{ const key=k+'@'+w.toFixed(4)+(dep?'d':''); if(!LC[key]){ const L=LEGS[k]; LC[key]=L.app?await appRun(pg,L,cap*w,s,e,w):pxRun(L.px(C),cap*w,s,e,w,dep?PERDAY:0); } return LC[key]; };
        const curves={}, depCurves={};
        for(const [nm,legs] of Object.entries(LUMPS)){ let m=null; for(const [k,w] of legs){ const x=await get(k,w); m=m?mixNone(m,x):x; } curves[nm]=m;
          const pl=legs.find(([k])=>LEGS[k].plan); if(pl){ let md=null, fl=null; for(const [k,w] of legs){ const x=(k===pl[0])?await get(k,w,true):{m:await get(k,w)}; if(k===pl[0]) fl=x.flows; md=md?mixNone(md,x.m):x.m; } depCurves[nm]={m:md,flows:fl}; } }
        const ds=Object.keys(curves[Object.keys(curves)[0]]).filter(d=>Object.values(curves).every(m=>m[d]!=null)&&Object.values(depCurves).every(x=>x.m[d]!=null)).sort(); const n=ds.length;
        const U={}; for(const t of new Set(dcaKeys.flatMap(k=>typeof DC[k]==='string'?[]:Object.keys(DC[k])))) U[t]=unitDca(ds,t==='CASH'?'CASH':C.sym[t]);
        const Fd=new Float64Array(n); for(let t=1;t<n;t++) Fd[t]=PERDAY;
        for(const nm of Object.keys(LUMPS)){ const L=Float64Array.from(ds.map(d=>curves[nm][d])); R.win[nm]=R.win[nm]||{};
          for(const dk of dcaKeys){ let o;
            if(DC[dk]==='prop'){ let units=0; for(let t=1;t<n;t++) units+=PERDAY/L[t]; const z=evalPath(ds,L,new Float64Array(n),C.cr); o={c:z.c,d:z.d,fv:L[n-1]*(1+units),cr:z.cr}; }
            else if(DC[dk]==='plan'){ const dc=depCurves[nm]; if(!dc){ o=null; } else { const V=Float64Array.from(ds.map(d=>dc.m[d])); const F=new Float64Array(n); const ix={}; ds.forEach((d,t)=>ix[d]=t);
                for(const [d,a] of dc.flows){ const t=ix[d]; if(t!=null) F[t]+=a; else { const tt=ds.findIndex(x=>x>d); if(tt>=0) F[tt]+=a; } } o=evalPath(ds,V,F,C.cr); } }
            else { const W=DC[dk], tot=Object.values(W).reduce((a,b)=>a+b,0); const V=L.map((v,t)=>v+Object.entries(W).reduce((a,[k,w])=>a+U[k][t]*PERDAY*w/tot,0)); o=evalPath(ds,V,Fd,C.cr); }
            (R.win[nm][dk]=R.win[nm][dk]||[]).push(o?{c:+o.c.toFixed(3),d:+o.d.toFixed(3),fv:+o.fv.toFixed(1),cr:o.cr}:null); } }
        R.paid=(R.paid||[]); R.paid.push(cap+PERDAY*(n-1)); }
      res[set][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 창 ${WIN.length} · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
