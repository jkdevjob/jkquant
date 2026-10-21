// 전략 토너먼트 — '무매 20분할 + 5년 플랜이 그 어떤 전략보다 나은가' (2026-10-21 사용자 질문 두 번)
// 앱 엔진(무매 runIM · VR · 200일선 · 역분산)과 플랜 규칙(px · plan_rules) · 기준(QQQ·SPY·금·TQQQ·현금)을 같은 조건으로 돌린다:
//   단독 100% · 무매 1/3 + X 2/3 · 5년 플랜 2/3 + X 1/3 · 무매 1/2 + 플랜 1/2 — 계좌는 따로 굴려 더한다(안 옮김).
//   실제 2011-03~ · 합성 2000-04~(병합·분할 반영) · 1만$ · 10만$ · 5년 롤링(분기마다 새로 시작).
//   비교: 지금 구성(무매 1/3 + 5년 플랜 2/3)보다 같은 창에서 '수익도 높고 낙폭도 작은' 비율.
// combo50.js 의 짝 규칙·엔진 호출을 그대로 가져온다(같은 걸 두 번 적지 않는다). 사용: node tourney.js out.json
const fs=require('fs');
const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const OUT=process.argv[2]||'tourney_out.json';
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; };
const src=fs.readFileSync(__dirname+'/combo50.js','utf8');
const grab=(start,end)=>{ const a=src.indexOf(start),b=src.indexOf(end); if(a<0||b<0) throw new Error('combo50.js 조각을 못 찾음: '+start); return src.slice(a,b).replace(/\bconst /g,'var '); };
eval(grab('const hold=sym=>','(async()=>{'));   // hold · cashOnly · plan10/15/20 · rsi · partners
(async()=>{
  const {pg,close}=await open([{sym:'SOXL'},{sym:'TQQQ'},{sym:'SYNSOXL_S'},{sym:'SYNTQQQ_S'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const {run,metrics,series,mixNone,toMap}=await eval('(async()=>{'+grab('  // 일별 자산 고리','  // ── 지표 ──')+'\n'+grab('  // ── 지표 ──','  const res=')
    +'\nreturn {run,metrics,series,mixNone,toMap};})()');
  // 단리 무매 — 사이클 끝에 원금 넘는 잔금을 밖으로(이자 없음 · 안 채움) · 앱·백테 같은 규약
  const imsRun=async(cap,from,to,syn)=>{ const r=await pg.evaluate(o=>{ const r=RUN(o); return {eq:r.eqs.map(x=>[x[0],x[1]]),final:r.final}; },
      {cap,tkr:syn?'SYNSOXL_S':'SOXL',autoTp:true,from,to,compound:false}); return toMap(r.eq,r.final); };
  const go=(spec,cap,from,to,syn)=>spec&&spec.ims?imsRun(cap,from,to,syn):run(spec,cap,from,to,syn);
  const res={meta:{made:new Date().toISOString(),note:'무매 = SOXL 20분할 익절 자동(앱 규칙 · 이자 없음) · 계좌 따로 굴림 · 5년 롤링 분기 시작'}};
  for(const syn of [false,true]){ const lab=syn?'syn':'real', from=syn?'2000-04-03':'2011-03-01';
    const P=Object.fromEntries(partners(syn).map(([k,n,s])=>[k,{name:n,spec:s}]));
    const E=syn?'SYNTECL':'TECL', T=syn?'SYNTQQQ':'TQQQ';
    const S={IM:{name:'무매 20분할(복리)',spec:'IM'}, IMS:{name:'무매 20분할(단리)',spec:{ims:true}}, ...P,
             P5N:{name:'5년 플랜 새 규칙(실험·앱 미반영)',spec:{px:[E,T],rule:Pp=>mk(Pp,E,T,{gbOn:.01,gbOff:.03,sbDn:0,sbUp:.15})}}};
    const singles=Object.keys(S);
    // 조합: [이름, [[다리, 비중], ...]]
    const combos=[['★ 지금: 무매 1/3 + 5년 플랜 2/3',[['IM',1/3],['P5',2/3]]], ['무매 1/2 + 5년 플랜 1/2',[['IM',1/2],['P5',1/2]]]];
    for(const x of ['P5N','P10','VR','MA','IVS','TQ','QQQ','CASH']) combos.push(['무매 1/3 + '+S[x].name+' 2/3',[['IM',1/3],[x,2/3]]]);
    for(const x of ['IMS','VR','MA','IVS','TQ','QQQ','P10',...(syn?[]:['GLD']),'CASH']) combos.push(['5년 플랜 2/3 + '+S[x].name+' 1/3',[['P5',2/3],[x,1/3]]]);
    const all=[...singles.map(k=>[S[k].name+' 100%',[[k,1]]]),...combos];
    res[lab]={};
    for(const cap of [10000,100000]){ console.error(`[${lab} ${cap/1e4}만$] 전략 ${all.length}개`);
      const curveOf=async(legs,s,e,memo)=>{ let m=null; for(const [k,w] of legs){ const key=k+'@'+w; if(!memo[key]) memo[key]=await go(S[k].spec,cap*w,s,e,syn); m=m?mixNone(m,memo[key]):memo[key]; } return m; };
      const R={}; const memoF={};
      for(const [name,legs] of all){ const m=await curveOf(legs,from,'2099-12-31',memoF); R[name]={full:metrics(series(m))}; }
      // 5년 롤링 — 분기마다 새로 시작
      const days=Object.keys(memoF['P5@'+(2/3)]||memoF['IM@1']).sort(), last=days[days.length-1]; const W={}; for(const [name] of all) W[name]=[];
      for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>last) continue;
        const memo={}; for(const [name,legs] of all){ const x=metrics(series(await curveOf(legs,s,e,memo))); W[name].push(x?{s,c:x.cagr,d:x.mdd,mult:x.mult}:null); } }
      const cur=W['★ 지금: 무매 1/3 + 5년 플랜 2/3'];
      for(const [name] of all){ const a=W[name]; const ok=a.map((x,i)=>x&&cur[i]?[x,cur[i]]:null).filter(Boolean);
        R[name].roll={n:a.filter(Boolean).length,cMed:q(a.map(x=>x&&x.c),.5),c10:q(a.map(x=>x&&x.c),.1),cMin:Math.min(...a.filter(Boolean).map(x=>x.c)),
          mMed:q(a.map(x=>x&&x.d),.5),mMax:Math.max(...a.filter(Boolean).map(x=>x.d)),bust:a.filter(x=>x&&x.mult<0.2).length/a.length*100,
          beatsBoth:ok.filter(([x,c])=>x.c>c.c&&x.d<c.d).length/ok.length*100, higherRet:ok.filter(([x,c])=>x.c>c.c).length/ok.length*100, lowerMdd:ok.filter(([x,c])=>x.d<c.d).length/ok.length*100}; }
      res[lab][cap]=R; fs.writeFileSync(OUT,JSON.stringify(res)); console.error('  done', lab, cap); } }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done'); })().catch(e=>{console.error(e);process.exit(1);});
