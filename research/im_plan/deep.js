// 심층: 지금(무매 SOXL 1/3 + 5년 플랜 2/3) vs 플랜 2/3 + 섀넌 USD 1/3 — 2026-11-07 사용자 '더 심도있게 분석해서 고민해봐'
// ① 창마다 원자료 → 시대별 · 반도체(SOX) vs 나스닥(NDX) 우세 구간별 ② 짝 비중 1/2~9/10 ③ 섀넌 설정(현금 짝 · 밴드 15) ④ 세전 ⑤ 5년 뒤 전부 팔 때(청산세+수수료)
// ⑥ 짝지은 블록 부트스트랩(같은 경로에서 둘 비교 · 2,000경로 × 5년 · 63일 블록) ⑦ 전 구간 샤프·소르티노·얼서·최장 물속 기간
// 사용: node deep.js out.json
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'deep_out.json';
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
eval(grab('  // ── 지표 ──','  // 블록 부트스트랩'));
const END='2026-10-19', FEE=0.0025, TAX=0.22;
const toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')&&d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runVR','if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);','window.__EQ.push([d,shares*c+pool+totalWd]);if(isCyc||i===days.length-1)snap.push([d,shares*c+pool+totalWd]);');
  patch('runVR','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);return;','buys++;rebal++;snap.push([d,shares*c+pool+totalWd]);window.__EQ.push([d,shares*c+pool+totalWd]);return;');
  patch('runMA200','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  // 끝날 보유분의 시가·미실현이익 — 청산세 계산용 (장부 LOT 기준)
  patch('runIVS','const fin=Math.max(0, cash+A.sh*lc+B.sh*lc1);','const fin=Math.max(0, cash+A.sh*lc+B.sh*lc1); window.__MV=A.sh*lc+B.sh*lc1; window.__UNREAL=(A.sh*lc-A.lot.basis)+(B.sh*lc1-B.lot.basis);');
  patch('runIMx','const fin=cash+shares*tradeBar(tkr,days[days.length-1])[C]+savedProfit-addedCash;','const fin=cash+shares*tradeBar(tkr,days[days.length-1])[C]+savedProfit-addedCash; window.__MV=shares*tradeBar(tkr,days[days.length-1])[C]; window.__UNREAL=window.__MV-LOT.basis;');
  patch('runVR','const fin=shares*lc+pool+totalWd;','const fin=shares*lc+pool+totalWd; window.__MV=shares*lc; window.__UNREAL=shares*lc-LOT.basis;');
  patch('runMA200','const fin=cash+shares*tradeBar(tkr,days[days.length-1])[C];','const fin=cash+shares*tradeBar(tkr,days[days.length-1])[C]; window.__MV=shares*tradeBar(tkr,days[days.length-1])[C]; window.__UNREAL=window.__MV-LOT.basis;'); };
const PXC={}; const pxPrep=syms=>PXC[syms.join()]||(PXC[syms.join()]=prep(syms));
// px 다리: 청산 없는 곡선 + 청산한 끝값(liq) 둘 다
const pxRun=(spec,cap,from,to,pre)=>{ const P=pxPrep(spec.px), R=spec.rule(P); const base={cap,from,to,fee:pre?0:FEE,tax:!pre,frac:spec.px.some(x=>/^SYN/.test(x))};
  const m=toMap(sim(P,Object.assign({},base,R)).eq); const l=sim(P,Object.assign({},base,R,{liq:true})).eq; return {m, liqFinal:l[l.length-1][1]}; };
const LEGS={ IM:{app:'IM',tkr:'SOXL'}, P5:{px:C=>({px:[C.E,C.T],rule:P=>mk(P,C.E,C.T,{})})},
  IVS_U:{app:'IVS',tkr:'USD',ivs:[.55,40,.20,'iv','x1']}, IVS_Uc:{app:'IVS',tkr:'USD',ivs:[.55,40,.20,'iv','cash']}, IVS_U15:{app:'IVS',tkr:'USD',ivs:[.55,40,.15,'iv','x1']},
  MA_U:{app:'MA',tkr:'USD'}, VR_U:{app:'VR',tkr:'USD'}, H_U:{px:C=>({px:[C.U],rule:hold(C.U)})} };
const STRATS={ CUR:[['IM',1/3],['P5',2/3]], C1:[['P5',2/3],['IVS_U',1/3]], P5:[['P5',1]], C_MA:[['P5',2/3],['MA_U',1/3]], C_VR:[['P5',2/3],['VR_U',1/3]], C_H:[['P5',2/3],['H_U',1/3]],
  C1c:[['P5',2/3],['IVS_Uc',1/3]], C1b15:[['P5',2/3],['IVS_U15',1/3]], IM100:[['IM',1]], IVSU100:[['IVS_U',1]],
  W50:[['P5',.5],['IVS_U',.5]], W60:[['P5',.6],['IVS_U',.4]], W75:[['P5',.75],['IVS_U',.25]], W80:[['P5',.8],['IVS_U',.2]], W90:[['P5',.9],['IVS_U',.1]],
  CURpre:[['IM',1/3,'pre'],['P5',2/3,'pre']], C1pre:[['P5',2/3,'pre'],['IVS_U',1/3,'pre']] };
const NAME={CUR:'지금: 무매 SOXL 1/3 + 플랜 2/3',C1:'플랜 2/3 + 섀넌 USD(1배수) 1/3',P5:'5년 플랜 100%',C_MA:'플랜 2/3 + 200일선 USD 1/3',C_VR:'플랜 2/3 + VR USD 1/3',C_H:'플랜 2/3 + 거치 USD 1/3',
  C1c:'플랜 2/3 + 섀넌 USD(현금 짝) 1/3',C1b15:'플랜 2/3 + 섀넌 USD(1배수·밴드15) 1/3',IM100:'무매 SOXL 100%',IVSU100:'섀넌 USD(1배수) 100%',
  W50:'플랜 1/2 + 섀넌 USD 1/2',W60:'플랜 6/10 + 섀넌 USD 4/10',W75:'플랜 3/4 + 섀넌 USD 1/4',W80:'플랜 8/10 + 섀넌 USD 2/10',W90:'플랜 9/10 + 섀넌 USD 1/10',CURpre:'지금(세전·수수료 0)',C1pre:'플랜 2/3 + 섀넌 USD 1/3(세전·수수료 0)'};
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ',U:'USD',eras:[['2011','2014'],['2015','2017'],['2018','2021']]}, syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ',U:'SYNUSD',eras:[['2000','2004'],['2005','2009'],['2010','2014'],['2015','2021']]}};
// 국면: 창 안에서 SOX 가 NDX 보다 많이 올랐나 (두 세트 모두 실제 지수)
const SOX={}, NDX={}; require('./data/SOX.json').series.forEach(x=>SOX[x.date]=x.close); require('./data/NDX.json').series.forEach(x=>NDX[x.date]=x.close);
const idxAt=(m,d)=>{ const ks=Object.keys(m).sort(); const k=ks.find(x=>x>=d); return k?m[k]:null; };
const regime=(s,e)=>{ const a=idxAt(SOX,s), b=idxAt(SOX,e), c=idxAt(NDX,s), d=idxAt(NDX,e); if(!a||!b||!c||!d) return null; return {sox:b/a, ndx:d/c, semi:b/a>d/c}; };
// 짝지은 블록 부트스트랩
function pboot(a,b,paths=2000,len=1260,blk=63,seed=11){ const ds=Object.keys(a).filter(d=>b[d]!=null).sort(); const ra=[],rb=[]; for(let i=1;i<ds.length;i++){ ra.push(a[ds[i]]/a[ds[i-1]]); rb.push(b[ds[i]]/b[ds[i-1]]); }
  let s=seed; const rnd=()=>{ s=(s*1103515245+12345)%2147483648; return s/2147483648; }; const N=ra.length; const out=[];
  for(let p=0;p<paths;p++){ let x=1,y=1,px=1,py=1,dx=0,dy=0,i=Math.floor(rnd()*N); for(let t=0;t<len;t++){ if(rnd()<1/blk) i=Math.floor(rnd()*N); else i=(i+1)%N; x*=ra[i]; y*=rb[i]; if(x>px)px=x; else dx=Math.max(dx,(px-x)/px); if(y>py)py=y; else dy=Math.max(dy,(py-y)/py); }
    out.push({ca:(Math.pow(x,1/5)-1)*100,cb:(Math.pow(y,1/5)-1)*100,da:dx*100,db:dy*100}); }
  const dc=out.map(o=>o.cb-o.ca), dd=out.map(o=>o.db-o.da);
  return {pBetter:out.filter(o=>o.cb>o.ca).length/paths*100, pBoth:out.filter(o=>o.cb>o.ca&&o.db<o.da).length/paths*100, dMed:med(dc), d10:q(dc,.1), d90:q(dc,.9), ddMed:med(dd), dd90:q(dd,.9),
    a:{c5:q(out.map(o=>o.ca),.05),cMed:med(out.map(o=>o.ca)),d95:q(out.map(o=>o.da),.95)}, b:{c5:q(out.map(o=>o.cb),.05),cMed:med(out.map(o=>o.cb)),d95:q(out.map(o=>o.db),.95)}}; }
(async()=>{
  const pages={ real:await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'TECL'},{sym:'USD'},{sym:'SMH'}]),
    syn:await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'TQQQ',file:'SYNTQQQ_S'},{sym:'TECL',file:'SYNTECL_S'},{sym:'USD',file:'SYNUSD_S'},{sym:'SMH',file:'SYNSMH_S'}]) };
  for(const k of Object.keys(pages)){ const pg=pages[k].pg; await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(HOOK); }
  const appRun=async(pg,L,cap,from,to,pre)=>{ const r=await pg.evaluate(([name,tkr,cap,from,to,ivs,pre])=>{ window.__EQ=[]; window.__MV=0; window.__UNREAL=0; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); let r;
      if(name==='VR') r=runVR(days,tkr,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:!pre});
      else if(name==='MA') r=runMA200(days,tkr,cap,200,!pre,{park:'bill'});
      else if(name==='IVS') r=runIVS(days,tkr,cap,ivs[0],ivs[1],ivs[2],!pre,ivs[3],ivs[4]);
      else if(name==='IM'){ const o=RUN({cap,tkr,autoTp:true,from,to,cost:!pre}); return {eq:o.eqs.map(x=>[x[0],x[1]]),final:o.final,mv:window.__MV,unreal:window.__UNREAL}; }
      return {eq:window.__EQ,final:r.final,mv:window.__MV,unreal:window.__UNREAL}; },[L.app,L.tkr,cap,from,to,L.ivs||null,!!pre]);
    const m=toMap(r.eq,r.final); const liq=pre?0:(TAX*Math.max(0,r.unreal)+FEE*r.mv); return {m, liqFinal:r.final-liq}; };
  const res={meta:{made:new Date().toISOString(),end:END,names:NAME,strats:STRATS,note:'수수료 0.25% · 양도세 22% 연 정산 · liq = 끝날 전부 팔 때(미실현이익 22% + 매도 수수료) · 부트스트랩 2,000경로×5년·63일 블록 · 같은 경로에서 짝 비교'}};
  for(const set of ['real','syn']){ const C=SETS[set], pg=pages[set].pg; res[set]={};
    const run=async(k,cap,s,e,pre)=>{ const L=LEGS[k]; return L.app?appRun(pg,L,cap,s,e,pre):pxRun(L.px(C),cap,s,e,pre); };
    for(const cap of [10000,100000]){ const t0=Date.now(); const R={win:{},full:{},boot:{}};
      const windows=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; windows.push([s,e]); }
      const evalAll=async(s,e)=>{ const LC={}; const get=async(k,w,pre)=>{ const key=k+'@'+w.toFixed(4)+(pre?'p':''); if(!LC[key]) LC[key]=await run(k,cap*w,s,e,pre); return LC[key]; };
        const out={}; for(const [name,legs] of Object.entries(STRATS)){ let m=null, liq=0; for(const [k,w,pre] of legs){ const r=await get(k,w,pre==='pre'); m=m?mixNone(m,r.m):r.m; liq+=r.liqFinal; }
          const x=metrics(series(m)); const yrs=(Date.parse(e)-Date.parse(s))/(365.25*864e5); out[name]=x?{c:x.cagr,d:x.mdd,mult:x.mult,liqMult:liq/cap,liqC:(Math.pow(Math.max(liq,1e-9)/cap,1/Math.max(yrs,0.1))-1)*100,sharpe:x.sharpe,sortino:x.sortino,ulcer:x.ulcer,uw:x.uwMonths,curve:m}:null; }
        return out; };
      Object.keys(STRATS).forEach(k=>R.win[k]=[]);
      for(const [s,e] of windows){ const o=await evalAll(s,e); const rg=regime(s,e); for(const k of Object.keys(STRATS)){ const x=o[k]; R.win[k].push(x?{s,c:x.c,d:x.d,mult:x.mult,liqC:x.liqC,semi:rg&&rg.semi,sox:rg&&rg.sox,ndx:rg&&rg.ndx}:null); } }
      const F=await evalAll(C.from,END); for(const k of Object.keys(STRATS)){ const x=F[k]; R.full[k]=x&&{c:x.c,d:x.d,mult:x.mult,liqC:x.liqC,sharpe:x.sharpe,sortino:x.sortino,ulcer:x.ulcer,uw:x.uw}; }
      for(const k of ['C1','P5','C_MA','C_VR','W75','C1c']) R.boot[k]=pboot(F.CUR.curve,F[k].curve);
      res[set][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`[${set} ${cap/1e4}만$] 창 ${windows.length} · ${((Date.now()-t0)/1e3).toFixed(0)}초`); } }
  for(const k of Object.keys(pages)) await pages[k].close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done',OUT); })().catch(e=>{console.error(e);process.exit(1);});
