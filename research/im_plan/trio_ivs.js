// 2~3 전략 조합 탐색(11-08) — 추천 조합의 섀넌 USD 설정 민감도: 플랜(새 규칙) 5/6 + 섀넌 USD 1/6 에서 밴드(15·20%p) · s0(50·55·60%) · 룩백(40·60일) · 예수금(단기국채·1배수)
// 다리는 원금 전액으로 한 번(선형 · trio_legs 와 같은 규약). 칸 = 실제 전체·앞·뒤 · 합성 2000~05·2006~10·2011~ 시작 × 1만·10만
const fs=require('fs'); const {open}=require('./imh'); const {prep,sim,ind}=require('./px'); const {mk}=require('./plan_rules');
const src=fs.readFileSync(__dirname+'/combo50.js','utf8'); const grab=(a0,b0)=>{ const a=src.indexOf(a0),b=src.indexOf(b0); return src.slice(a,b).replace(/\bconst /g,'var '); }; eval(grab('const hold=sym=>','(async()=>{'));
const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close);
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>q(a,.5);
const END='2026-10-19', toMap=(eq,fin)=>{ const m={}; eq.forEach(([d,v])=>{ if(d<=END) m[d]=v; }); const ks=Object.keys(m).sort(); if(fin!=null&&ks.length&&ks[ks.length-1]===eq[eq.length-1][0]) m[ks[ks.length-1]]=fin; return m; };
const HOOK=()=>{ let s=runIVS.toString(); const a='if(i%10===0)snap.push([d,eq]);'; if(!s.includes(a)) throw new Error('hook'); (0,eval)('runIVS='+s.split(a).join('window.__EQ.push([d,eq]);'+a)); };
const PB={gsb:1e9}, PN={gbOn:.01,gbOff:.03,sbDn:.01,sbUp:.15,gReb:'y'};
const VAR=[]; for(const band of [.15,.20]) for(const s0 of [.50,.55,.60]) for(const look of [40,60]) VAR.push({band,s0,look,pair:'cash'}); VAR.push({band:.15,s0:.55,look:40,pair:'x1'},{band:.20,s0:.55,look:40,pair:'x1'});
const SETS={real:{from:'2011-03-01',E:'TECL',T:'TQQQ'}, syn:{from:'2000-04-03',E:'SYNTECL',T:'SYNTQQQ'}};
(async()=>{ const pages={real:await open([{sym:'SOXL'},{sym:'USD'}]), syn:await open([{sym:'SOXL',file:'SYNSOXL_S'},{sym:'USD',file:'SYNUSD_S'}])};
  for(const k in pages){ await pages[k].pg.evaluate(x=>{window.__IRX=x;},irx); await pages[k].pg.evaluate(HOOK); }
  const out={}; for(const set of ['real','syn']){ const C=SETS[set], pg=pages[set].pg; const P=prep([C.E,C.T]);
    const wins=[]; for(let y=+C.from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<C.from||e>END) continue; wins.push([s,e]); }
    for(const cap of [10000,100000]){ const rows=[];
      for(const [s,e] of wins){ const pl=(p)=>toMap(sim(P,Object.assign({cap,from:s,to:e,fee:.001,tax:true,frac:set==='syn'},mk(P,C.E,C.T,p))).eq);
        const P5=pl(PB), P5N=pl(PN); const IM=toMap(...await pg.evaluate(([cap,s,e])=>{ const o=RUN({cap,tkr:'SOXL',autoTp:true,from:s,to:e}); return [o.eqs.map(x=>[x[0],x[1]]),o.final]; },[cap,s,e]));
        const IV=[]; for(const v of VAR) IV.push(toMap(...await pg.evaluate(([cap,s,e,v])=>{ window.__EQ=[]; const days=Object.keys(M.USD).sort().filter(d=>d>=s&&d<=e); const r=runIVS(days,'USD',cap,v.s0,v.look,v.band,true,'iv',v.pair); return [window.__EQ,r.final]; },[cap,s,e,v])));
        const ds=Object.keys(P5).filter(d=>P5N[d]!=null&&IM[d]!=null&&IV.every(m=>m[d]!=null)).sort();
        const met=f=>{ let pk=0,md=0; const v=ds.map(f); v.forEach(x=>{ if(x>pk) pk=x; else md=Math.max(md,1-x/pk); }); const yrs=(Date.parse(ds[ds.length-1])-Date.parse(ds[0]))/(365.25*864e5); return {c:(Math.pow(v[v.length-1]/v[0],1/yrs)-1)*100,d:md*100}; };
        rows.push({s,cur:met(d=>IM[d]/3+P5[d]*2/3),v:IV.map(m=>met(d=>P5N[d]*5/6+m[d]/6)),solo:IV.map(m=>met(d=>m[d]))}); }
      out[set+cap]=rows; console.error(set,cap,'done'); } }
  for(const k in pages) await pages[k].close();
  const CELLS=[['real','ALL',s=>true],['real','A',s=>s<='2013-10-01'],['real','B',s=>s>='2018-10-01'],['syn','EARLY',s=>s<='2005-10-01'],['syn','MID',s=>s>='2006-01-01'&&s<='2010-10-01'],['syn','LATE',s=>s>='2011-01-01']];
  console.log('플랜(새 규칙) 5/6 + 섀넌 USD 1/6 — 설정별 · 12칸 짝 중앙 차 최소 · 실제 전체 1만/10만 중앙 연 · MDD 중앙/최악 · 합성 전체 1만 · 섀넌 단독 실제 1만 중앙/MDD');
  VAR.forEach((v,j)=>{ let mn=Infinity, mOK=true; for(const [set,nm,f] of CELLS) for(const cap of [10000,100000]){ const R=out[set+cap].filter(r=>f(r.s)); const dc=R.map(r=>r.v[j].c-r.cur.c); mn=Math.min(mn,med(dc)); if(med(R.map(r=>r.v[j].d))>med(R.map(r=>r.cur.d))) mOK=false; }
    const st=(k,arr)=>`${med(arr.map(r=>r.v[j].c)).toFixed(1)} −${med(arr.map(r=>r.v[j].d)).toFixed(0)}/−${Math.max(...arr.map(r=>r.v[j].d)).toFixed(0)}`;
    const sy=out.syn10000; console.log(`  밴드 ${v.band*100}%p · s0 ${v.s0*100}% · ${v.look}일 · ${v.pair==='cash'?'단기국채':'1배수'}`.padEnd(40)+` 12칸 최소 ${(mn>=0?'+':'')+mn.toFixed(2)} ${mOK?'MDD중앙OK':'MDD중앙↑'} | 실제 1만 ${st(0,out.real10000)} · 10만 ${st(0,out.real100000)} | 합성 1만 ${st(0,sy)} 최악 ${Math.min(...sy.map(r=>r.v[j].c)).toFixed(1)} | 섀넌 단독 ${med(out.real10000.map(r=>r.solo[j].c)).toFixed(1)} −${med(out.real10000.map(r=>r.solo[j].d)).toFixed(0)}`); });
  const cu=a=>`${med(a.map(r=>r.cur.c)).toFixed(1)} −${med(a.map(r=>r.cur.d)).toFixed(0)}/−${Math.max(...a.map(r=>r.cur.d)).toFixed(0)}`; console.log(`  (지금: 실제 1만 ${cu(out.real10000)} · 10만 ${cu(out.real100000)} | 합성 1만 ${cu(out.syn10000)})`);
})().catch(e=>{console.error(e);process.exit(1);});
