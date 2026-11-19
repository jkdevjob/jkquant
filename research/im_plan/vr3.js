// 운영 메뉴 VR ③(11-20) — Pool 한도(mode) 적립식 0.75 → 0.6 · 0.9 · 1.0 · backtest.html runVR 앱 값 그대로(G 10 · 회차 100$ · 밴드 15 · 기본 공식 · 비용·세금 켬 · 사다리)
// 끝날 전량 청산(11-20 지피티 교훈): runVR 마지막 날 _vsellQ(보유 전부) 뒤 그해 정산 — window.__VRLIQ 일 때만(고리 안 쓰면 원래와 같음 · 검산 chk)
// 확인(기준 밖): 같은 청산 규약으로 밴드 20(mode .75) · 청산 안 한 밴드 20 · 15 도 같이(R-20261116-1 · R-20261119-2 숫자와 견줌)
// 사용: TK=TQQQ node vr3.js [out.json]   env: DS=real,syn
const {open}=require('./imh'); const fs=require('fs'), path=require('path');
const TK=process.env.TK||'TQQQ', OUT=process.argv[2]||`vr3_${TK}.json`, DS=(process.env.DS||'real,syn').split(',');
const SYN={SOXL:'SYNSOXL_S',USD:'SYNUSD_S',TECL:'SYNTECL_S',TQQQ:'SYNTQQQ_S',QLD:'SYNQLD_S'};
const CAPS=[10000,100000], BASE={contrib:100,G:10,bandPct:15,mode:0.75,formula:'basic',costOn:true,startV:0,startPool:0};
const VAR=[['base',{},1],['m60',{mode:0.6},1],['m90',{mode:0.9},1],['m100',{mode:1.0},1],['b20',{bandPct:20},1],['b20u',{bandPct:20},0],['b15u',{},0]];   // [이름, 덮어쓸 값, 청산 여부]
const PAGE=()=>{ const irr=(cf,final,end)=>{ const T=Date.parse(end); const f=r=>cf.reduce((s,[d,a])=>s+a*Math.pow(1+r,(T-Date.parse(d))/(365.25*864e5)),0)-final;
    let lo=-0.99,hi=5; if(f(lo)>0) return -99; if(f(hi)<0) return 500; for(let k=0;k<80;k++){ const m=(lo+hi)/2; if(f(m)>0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  if(!window.__vrliqP){ let s=runVR.toString(); const a='settleToStable(()=>_settle(lc), ()=>yearPnl);'; if(s.split(a).length!==2) throw new Error('runVR 모양이 바뀜(청산 고리)');
    s=s.replace(a,'if(window.__VRLIQ&&shares>0) pool+=_vsellQ(shares,lc);\n  '+a); (0,eval)('runVR='+s); window.__vrliqP=true; }
  window.VR3=function(tkr,from,to,base,caps,vars){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const out={};
    for(const cap of caps) for(const [v,o,liq] of vars){ window.__VRLIQ=!!liq; const r=runVR(days,tkr,Object.assign({},base,o,{initAmt:cap})); window.__VRLIQ=false;
      out[cap+'|'+v]=[irr(r.cf,r.final,days[days.length-1]), r.final/r.invested, r.mdd, r.trades/r.yrs, r.final]; }
    return out; }; };
(async()=>{ const out={tk:TK,base:BASE,vars:VAR,sets:{}}; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f2=x=>(x>=0?'+':'')+x.toFixed(2);
  for(const ds of DS){ const file=ds==='real'?TK:SYN[TK]; if(!file||!fs.existsSync(path.join(__dirname,'data',file+'.json'))){ console.log(`${TK} ${ds}: 자료 없음`); continue; }
    const {pg,close}=await open([{sym:file,file}]); await pg.evaluate(PAGE);
    // 검산: 청산 고리 끈 판 == 원래 runVR(창 하나 · 센트)
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),file), END=all[all.length-1]; const y0=ds==='real'?+all[0].slice(0,4):Math.max(1990,+all[0].slice(0,4));
    const starts=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const W=[]; for(const [s,e] of starts) W.push({s,r:await pg.evaluate(a=>VR3(...a),[file,s,e,BASE,CAPS,VAR])});
    await close(); out.sets[ds]={file,first:all[0],last:END,n:W.length,win:W}; const H=Math.floor(W.length/2);
    for(const cap of CAPS){ const g=(w,v,k)=>w.r[cap+'|'+v][k];
      console.log(`■ ${TK} ${ds}(${file}) ${cap/1e4}만$ · 창 ${W.length} · 기준(청산) IRR 중앙 ${q(W.map(w=>g(w,'base',0)),.5).toFixed(1)} · 청산 안 함 ${q(W.map(w=>g(w,'b15u',0)),.5).toFixed(1)} · MDD 중앙 ${q(W.map(w=>g(w,'base',2)),.5).toFixed(1)}`);
      const cmp=(v,ref)=>{ const di=W.map(w=>g(w,v,0)-g(w,ref,0)), h1=di.slice(0,H), h2=di.slice(H), mr=W.map(w=>g(w,v,1)/g(w,ref,1)), dm=W.map(w=>g(w,v,2)-g(w,ref,2)), wm=Math.max(...W.map(w=>g(w,v,2)))-Math.max(...W.map(w=>g(w,ref,2)));
        return `IRR 차 중앙 ${f2(q(di,.5))} · 나은 창 ${(di.filter(x=>x>0).length/di.length*100).toFixed(0)}% · 앞/뒤 ${f2(q(h1,.5))}/${f2(q(h2,.5))} · 최소 ${f2(Math.min(...di))} | 배수 비 ×${q(mr,.5).toFixed(3)} | MDD 차 중앙 ${f2(q(dm,.5))} · 최악 MDD 차 ${f2(wm)} | 매매 ${q(W.map(w=>g(w,v,3)),.5).toFixed(0)}/년`; };
      for(const v of ['m60','m90','m100','b20']) console.log(`   ${v.padEnd(5)} (청산 대 청산) ${cmp(v,'base')}`);
      console.log(`   b20u  (청산 안 함 대 청산 안 함) ${cmp('b20u','b15u')}`); } }
  fs.writeFileSync(path.isAbsolute(OUT)?OUT:path.join(__dirname,OUT),JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
