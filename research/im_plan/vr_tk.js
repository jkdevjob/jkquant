// 운영 메뉴 VR 밴드 종목별(11-19 · 사용자 "vr 20이 종목별로 다른거 같은데") — vr_base.js 와 같은 엔진·규약(backtest.html runVR 앱 값 그대로 ·
// 적립식 .75 · 기본 공식 · G 10 · 회차 100$ · 사다리 · 비용·세금 켬) · 종목만 바꿈 · 밴드 15(기준) · 17.5 · 20 · 22.5 를 같은 5년 창(매달 시작)에서 짝.
// 값: 돈 가중 연수익(IRR) · 평가액 ÷ 낸 돈(배수) · 엔진 MDD · 매매 수/년.  사용: TK=SOXL node vr_tk.js [out.json]   env: DS=real,syn
const {open}=require('./imh'); const fs=require('fs');
const TK=process.env.TK||'TQQQ', OUT=process.argv[2]||`vr_tk_${TK}.json`, DS=(process.env.DS||'real,syn').split(',');
const SYN={SOXL:'SYNSOXL_S',USD:'SYNUSD_S',TECL:'SYNTECL_S',TQQQ:'SYNTQQQ_S',QLD:'SYNQLD_S'};
const CAPS=[10000,100000], BANDS=[15,17.5,20,22.5], BASE={contrib:100,G:10,mode:0.75,formula:'basic',costOn:true,startV:0,startPool:0};
const PAGE=()=>{ const irr=(cf,final,end)=>{ const T=Date.parse(end); const f=r=>cf.reduce((s,[d,a])=>s+a*Math.pow(1+r,(T-Date.parse(d))/(365.25*864e5)),0)-final;
    let lo=-0.99,hi=5; if(f(lo)>0) return -99; if(f(hi)<0) return 500; for(let k=0;k<80;k++){ const m=(lo+hi)/2; if(f(m)>0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  window.VRW=function(tkr,from,to,base,caps,bands){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const out={};
    for(const cap of caps) for(const b of bands){ const r=runVR(days,tkr,Object.assign({},base,{initAmt:cap,bandPct:b}));
      out[cap+'|'+b]=[irr(r.cf,r.final,days[days.length-1]), r.final/r.invested, r.mdd, r.trades/r.yrs]; }
    return out; }; };
(async()=>{ const out={tk:TK,base:BASE,sets:{}}; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f2=x=>(x>=0?'+':'')+x.toFixed(2);
  for(const ds of DS){ const file=ds==='real'?TK:SYN[TK]; if(!file||!fs.existsSync(__dirname+'/data/'+file+'.json')){ console.log(`${TK} ${ds}: 자료 없음 — 건너뜀`); continue; }
    const {pg,close}=await open([{sym:file,file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),file), END=all[all.length-1]; const y0=ds==='real'?+all[0].slice(0,4):Math.max(1990,+all[0].slice(0,4));
    const starts=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const W=[]; for(const [s,e] of starts) W.push({s,r:await pg.evaluate(a=>VRW(...a),[file,s,e,BASE,CAPS,BANDS])});
    await close(); out.sets[ds]={file,first:all[0],last:END,n:W.length,win:W};
    const H=Math.floor(W.length/2);
    for(const cap of CAPS){ const g=(w,b,k)=>w.r[cap+'|'+b][k];
      console.log(`■ ${TK} ${ds}(${file} ${all[0]}~${END}) ${cap/1e4}만$ · 창 ${W.length} · 밴드 15 IRR 중앙 ${q(W.map(w=>g(w,15,0)),.5).toFixed(1)} · MDD 중앙 ${q(W.map(w=>g(w,15,2)),.5).toFixed(1)} · 매매 ${q(W.map(w=>g(w,15,3)),.5).toFixed(0)}/년`);
      for(const b of BANDS.slice(1)){ const di=W.map(w=>g(w,b,0)-g(w,15,0)), h1=di.slice(0,H), h2=di.slice(H), mr=W.map(w=>g(w,b,1)/g(w,15,1)), dm=W.map(w=>g(w,b,2)-g(w,15,2));
        const wm=Math.max(...W.map(w=>g(w,b,2)))-Math.max(...W.map(w=>g(w,15,2)));
        console.log(`   ${String(b).padEnd(4)} IRR 차 중앙 ${f2(q(di,.5))} · 나은 창 ${(di.filter(x=>x>0).length/di.length*100).toFixed(0)}% · 앞/뒤 ${f2(q(h1,.5))}/${f2(q(h2,.5))} · 최소 ${f2(Math.min(...di))} | 배수 비 ×${q(mr,.5).toFixed(3)} | MDD 차 중앙 ${f2(q(dm,.5))} · 최악 MDD 차 ${f2(wm)} | 매매 ${q(W.map(w=>g(w,b,3)),.5).toFixed(0)}/년`); } } }
  fs.writeFileSync(require('path').isAbsolute(OUT)?OUT:__dirname+'/'+OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
