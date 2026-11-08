// 2~3 전략 조합 탐색(11-08) 2단계 — 1단계 후보를 정확히 다시 돌린다.
// ① 다리마다 실제 크기(원금 × 비중 · 정수 주)로 따로 굴리고, 양도세 250만원 공제는 비중만큼만(한 사람 공제를 나눠 씀 · px dedMul · 앱 엔진 costOf 고리)
// ② 매일 2$ 적립(소수 주 · 수수료 0.25% · 안 팖) 행선지: USD · QQQ · TQQQ · SPY · SOXL · TECL · 현금 · '포트폴리오에 비례로 넣음' — 수익률은 단위(TWR) 방식, 끝 평가액은 그대로
// ③ 위기 낙폭(전 구간 곡선 · 위기 직전 1년 고점 기준) ④ 짝지은 블록 부트스트랩(같은 경로 · 2,000경로 × 5년 · 63일 블록) ⑤ 창마다 반도체(SOX) 대 나스닥(NDX) 국면
// 사용: node trio_exact.js out.json
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'trio_exact.json'; const SMOKE=!!process.env.SMOKE;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));
const END='2026-10-19', FEE=0.0025, DCA=2;
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };   // 공제 배율 — capGainTax 를 쓰는 모든 엔진(runIMx·VR·200일선·섀넌)에 같이 걸린다
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
const pxRun=(spec,cap,from,to,w)=>{ const P=pxPrep(spec.px), R=spec.rule(P); return toMap(sim(P,Object.assign({cap,from,to,fee:spec.fee??FEE,tax:true,dedMul:w,frac:spec.px.some(x=>/^SYN/.test(x))},R)).eq); };
const PB={gsb:1e9}, PN={gbOn:.01,gbOff:.03,sbDn:.01,sbUp:.15,gReb:'y'}, PX=Object.assign({s0:.60},PN);
const LEGS={ IM:{app:'IM',tkr:'SOXL'},
  P5:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PB),fee:.001})}, P5N:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PN),fee:.001})}, P5X:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,PX),fee:.001})},
  IVS_U:{app:'IVS',tkr:'USD',ivs:[.55,40,.20,'iv','x1']}, IVS_Uc:{app:'IVS',tkr:'USD',ivs:[.55,40,.20,'iv','cash']}, H_U:{px:C=>({px:[C.U],rule:hold(C.U)})} };
const STRATS={ CUR:[['IM',1/3],['P5',2/3]], P5N:[['P5N',1]], P5X:[['P5X',1]],
  N_SU:[['P5N',5/6],['IVS_U',1/6]], N_SUc:[['P5N',5/6],['IVS_Uc',1/6]], X_SUc:[['P5X',5/6],['IVS_Uc',1/6]], X_SUc3:[['P5X',2/3],['IVS_Uc',1/3]], N_SU3:[['P5N',2/3],['IVS_U',1/3]],
  IM_X:[['IM',1/6],['P5X',5/6]], IM_N:[['IM',1/6],['P5N',5/6]], IM_X_SUc:[['IM',1/6],['P5X',2/3],['IVS_Uc',1/6]], IM3_N:[['IM',1/3],['P5N',2/3]], N_HU:[['P5N',5/6],['H_U',1/6]] };
const NAME={CUR:'지금: 무매 SOXL 1/3 + 플랜(기본) 2/3',P5N:'플랜(새 규칙) 100%',P5X:'플랜(공격형) 100%',N_SU:'플랜(새) 5/6 + 섀넌 USD(1배수) 1/6',N_SUc:'플랜(새) 5/6 + 섀넌 USD(현금) 1/6',
  X_SUc:'플랜(공격) 5/6 + 섀넌 USD(현금) 1/6',X_SUc3:'플랜(공격) 2/3 + 섀넌 USD(현금) 1/3',N_SU3:'플랜(새) 2/3 + 섀넌 USD(1배수) 1/3',IM_X:'무매 1/6 + 플랜(공격) 5/6',IM_N:'무매 1/6 + 플랜(새) 5/6',
  IM_X_SUc:'무매 1/6 + 플랜(공격) 2/3 + 섀넌 USD(현금) 1/6',IM3_N:'무매 1/3 + 플랜(새) 2/3',N_HU:'플랜(새) 5/6 + 거치 USD 1/6'};
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',U:'USD',dca:{USD:'USD',QQQ:'QQQ',TQQQ:'TQQQ',SPY:'SPY',SOXL:'SOXL',TECL:'TECL'}},
            syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',U:'SYNUSD',dca:{USD:'SYNUSD',QQQ:'QQQ',TQQQ:'SYNTQQQ',SPY:'SPY',SOXL:'SYNSOXL',TECL:'SYNTECL'}}};
const PXD={}; const pxDaily=s=>PXD[s]||(PXD[s]=(()=>{ const m={}; require('./data/'+s+'.json').series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; })());
const SOX={}, NDX={}; require('./data/SOX.json').series.forEach(x=>SOX[x.date]=x.close); require('./data/NDX.json').series.forEach(x=>NDX[x.date]=x.close);
const idxAt=(m,d)=>{ const ks=Object.keys(m).sort(); const k=ks.find(x=>x>=d); return k?m[k]:null; };
const regime=(s,e)=>{ const a=idxAt(SOX,s), b=idxAt(SOX,e), c=idxAt(NDX,s), d=idxAt(NDX,e); if(!a||!b||!c||!d) return null; return {sox:b/a, ndx:d/c, semi:b/a>d/c}; };
// 적립 계좌: 날짜 목록 ds 위에서 매일 종가에 2$ (수수료 떼고) · 현금은 T-bill(−0.09%p · 이자소득세 15.4%)
function dcaSeries(ds,sym){ const out=new Float64Array(ds.length); if(sym==='CASH'){ let c=0,pd=null,li=0,last=0; const ks=Object.keys(irx).sort();
    ds.forEach((d,t)=>{ while(li<ks.length&&ks[li]<=d){ last=irx[ks[li]]; li++; } if(pd&&c>0){ const gap=Math.max(1,Math.round((Date.parse(d)-Date.parse(pd))/864e5)); c+=c*Math.max(0,last/100-0.0009)*(1-0.154)*gap/365; } c+=DCA; out[t]=c; pd=d; }); return out; }
  const m=pxDaily(sym); let u=0, lp=null; ds.forEach((d,t)=>{ const p=m[d]??lp; if(p>0){ u+=DCA*(1-FEE)/p; lp=p; } out[t]=u*(lp||0); }); return out; }
function twr(ds,V,flow){ // V: 총평가(적립 포함) · flow: 그날 들어온 돈(종가 직후 매수) → 단위 가치
  const nav=new Float64Array(ds.length); nav[0]=1; let pk=1,mdd=0; for(let t=1;t<ds.length;t++){ nav[t]=nav[t-1]*(V[t]-flow)/V[t-1]; if(nav[t]>pk) pk=nav[t]; else mdd=Math.max(mdd,(pk-nav[t])/pk); }
  const yrs=(Date.parse(ds[ds.length-1])-Date.parse(ds[0]))/(365.25*864e5); return {c:(Math.pow(nav[ds.length-1],1/yrs)-1)*100, d:mdd*100}; }
function pboot(a,b,paths=2000,len=1260,blk=63,seed=11){ const ds=Object.keys(a).filter(d=>b[d]!=null).sort(); const ra=[],rb=[]; for(let i=1;i<ds.length;i++){ ra.push(a[ds[i]]/a[ds[i-1]]); rb.push(b[ds[i]]/b[ds[i-1]]); }
  let s=seed; const rnd=()=>{ s=(s*1103515245+12345)%2147483648; return s/2147483648; }; const N=ra.length; const out=[];
  for(let p=0;p<paths;p++){ let x=1,y=1,px=1,py=1,dx=0,dy=0,i=Math.floor(rnd()*N); for(let t=0;t<len;t++){ if(rnd()<1/blk) i=Math.floor(rnd()*N); else i=(i+1)%N; x*=ra[i]; y*=rb[i]; if(x>px)px=x; else dx=Math.max(dx,(px-x)/px); if(y>py)py=y; else dy=Math.max(dy,(py-y)/py); }
    out.push({ca:(Math.pow(x,1/5)-1)*100,cb:(Math.pow(y,1/5)-1)*100,da:dx*100,db:dy*100}); }
  const dc=out.map(o=>o.cb-o.ca), dd=out.map(o=>o.db-o.da);
  return {pBetter:out.filter(o=>o.cb>o.ca).length/paths*100, pBoth:out.filter(o=>o.cb>o.ca&&o.db<o.da).length/paths*100, dMed:med(dc), d10:q(dc,.1), d90:q(dc,.9), ddMed:med(dd), dd90:q(dd,.9),
    a:{c5:q(out.map(o=>o.ca),.05),cMed:med(out.map(o=>o.ca)),d95:q(out.map(o=>o.da),.95)}, b:{c5:q(out.map(o=>o.cb),.05),cMed:med(out.map(o=>o.cb)),d95:q(out.map(o=>o.db),.95)}}; }
(async()=>{
  const pages={ real:await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'TECL'},{sym:'USD'}]) };
  if(!SMOKE) pages.syn=await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'TQQQ',file:'SYNTQQQ_S'},{sym:'TECL',file:'SYNTECL_S'},{sym:'USD',file:'SYNUSD_S'}]);
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,L,cap,from,to,w)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to,ivs,w])=>{ window.__EQ=[]; window.__DEDW=w; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='IVS') r=runIVS(days,tkr,cap,ivs[0],ivs[1],ivs[2],true,ivs[3],ivs[4]);
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to}); window.__DEDW=1; return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final}; }
      window.__DEDW=1; return {eq:window.__EQ,final:r.final}; },[L.app,L.tkr,cap,from,to,L.ivs||null,w]); return toMap(r.eq,r.final); };
  // 공제 배율 고리 확인 — 같은 섀넌 다리를 배율 1 · 0 으로 돌리면 0 쪽이 세금을 더 내야 한다
  { const pg=pages.real.pg; const a=await appRun(pg,LEGS.IVS_U,10000,'2011-03-01',END,1), b=await appRun(pg,LEGS.IVS_U,10000,'2011-03-01',END,0); const la=Object.keys(a).sort().pop();
    if(!(b[la]<a[la])) throw new Error('공제 배율 고리가 안 걸림 '+a[la]+' '+b[la]); console.error('공제 고리 확인: 배율1 '+a[la].toFixed(0)+' > 배율0 '+b[la].toFixed(0)); }
  const res={meta:{made:new Date().toISOString(),end:END,names:NAME,strats:STRATS,dca:DCA,note:'다리마다 원금×비중으로 따로(정수 주) · 공제는 비중만큼 · 적립 매일 2$ 소수 주 수수료 0.25% 안 팖 · 단위(TWR) 수익률 · 끝 청산세 없음'}};
  for(const set of Object.keys(pages)){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const run=async(k,cap,s,e,w)=>{ const L=LEGS[k]; return L.app?appRun(pg,L,cap*w,s,e,w):pxRun(L.px(C),cap*w,s,e,w); };
    const windows=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; windows.push([s,e]); }
    const WIN=SMOKE?windows.slice(0,2):windows;
    for(const cap of (SMOKE?[10000]:[10000,100000])){ const t0=Date.now(); const R={win:{},full:{},crisis:{},boot:{},dcaFull:{}};
      const evalAll=async(s,e)=>{ const LC={}; const out={};
        for(const [nm,legs] of Object.entries(STRATS)){ let m=null; for(const [k,w] of legs){ const key=k+'@'+w.toFixed(4); if(!LC[key]) LC[key]=await run(k,cap,s,e,w); m=m?mixNone(m,LC[key]):LC[key]; } out[nm]=m; }
        // 공통 날짜(모든 후보) — 적립 종목은 빠진 날 직전 종가로 잇는다(dcaSeries)
        const ds=Object.keys(out.CUR).filter(d=>Object.values(out).every(m=>m[d]!=null)).sort();
        for(const sym of Object.values(C.dca)) if(!(pxDaily(sym)[ds[0]]>0)) throw new Error(set+' 적립 종목 '+sym+' 시세 없음 '+ds[0]);
        return {ds,curves:out}; };
      Object.keys(STRATS).forEach(k=>R.win[k]=[]);
      for(const [s,e] of WIN){ const {ds,curves}=await evalAll(s,e); const rg=regime(s,e); const n=ds.length;
        const D={}; for(const [lab,sym] of Object.entries(C.dca)) D[lab]=dcaSeries(ds,sym); D.CASH=dcaSeries(ds,'CASH');
        for(const k of Object.keys(STRATS)){ const L=Float64Array.from(ds.map(d=>curves[k][d])); const x=metrics(ds.map((d,t)=>[d,L[t]]));
          const o={s,c:x.cagr,d:x.mdd,mult:x.mult,semi:rg&&rg.semi,sox:rg&&rg.sox,ndx:rg&&rg.ndx,dca:{}};
          for(const lab of Object.keys(D)){ const V=L.map((v,t)=>v+D[lab][t]); const tw=twr(ds,V,DCA); o.dca[lab]={c:tw.c,d:tw.d,fv:V[n-1]}; }
          let units=0; for(let t=0;t<n;t++) units+=DCA/L[t]; o.dca.PROP={c:x.cagr,d:x.mdd,fv:L[n-1]+units*L[n-1]};   // 2$ 를 그날 포트폴리오에 비례로 넣었다고 보면(단위 매수) — 수익률·낙폭은 일시금과 같다
          o.paid=cap+DCA*n; R.win[k].push(o); } }
      // 전 구간 · 위기 · 부트스트랩
      const F=await evalAll(C.from,END); const trim=(m,from)=>{ const o={}; for(const d of Object.keys(m)) if(d>=from) o[d]=m[d]; return o; }, yAgo=d=>(+d.slice(0,4)-1)+d.slice(4);
      const CR=set==='syn'?[['2000-04-04','2002-10-09','닷컴'],['2007-10-09','2009-03-09','금융위기'],['2018-10-01','2018-12-24','2018Q4'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022']]
                          :[['2018-10-01','2018-12-24','2018Q4'],['2020-02-19','2020-03-23','코로나'],['2021-11-19','2022-12-28','2022'],['2024-07-10','2025-04-08','2024~25']];
      for(const k of Object.keys(STRATS)){ const m=F.curves[k]; const x=metrics(series(m)); R.full[k]={c:x.cagr,d:x.mdd,mult:x.mult,sharpe:x.sharpe,sortino:x.sortino,ulcer:x.ulcer,uw:x.uwMonths};
        R.crisis[k]={}; for(const [s,e,lab] of CR){ const z=crisis(trim(m,yAgo(s)),s,e); R.crisis[k][lab]=z?{dd:z.dd,rec:z.recMonths}:null; }
        if(k!=='CUR') R.boot[k]=pboot(F.curves.CUR,m); }
      res[set][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 창 ${WIN.length} · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
