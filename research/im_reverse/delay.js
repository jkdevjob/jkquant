// 무매 리버스 '늦게 켜기' — 원금 소진 뒤 매매 없는 날이 K 일 이어지면 그때 리버스로 (사용자 11-18 제안 · 실험적 확장)
//  K=0 = 지금 리버스 켬(소진 즉시) · K=∞ = 리버스 끔(기본). 설정은 사용자 세션: SOXL · 20분할 · 익절 자동 · 큰수 20 · 복리.
//  ① 사건 연구: 소진 사건일 E(켬·끔이 처음 갈리는 날)부터 h 거래일 뒤 평가액 ÷ 끔 − 1
//  ② 5년 창: 시작을 20거래일씩 옮겨 5년씩 — 연복리·MDD 를 끔과 비교
// 엔진은 backtest.html runIM 그대로(imh.js 하네스) — 리버스 진입 한 줄만 고리로 바꾼다.
const {open}=require('../im_plan/imh.js'); const fs=require('fs');
const CAP=+process.argv[2]||10000, STEP=+process.argv[3]||20, KS=[0,5,10,20,40,60];
const PATCH=`(()=>{ let src=runIMx.toString();
  const a="let inReverse=false, reverseDay1=false;";
  const b="if(_revOn && !inReverse && (divs-T)<1 && shares>0){ inReverse=true; reverseDay1=true; }";
  if(src.split(a).length!==2||src.split(b).length!==2) throw new Error('patch target');
  src=src.replace(a,a+" let __exN=0;").replace(b,
    "if(!inReverse && (divs-T)<1 && shares>0) __exN++; else __exN=0;\\n    if(_revOn && !inReverse && (divs-T)<1 && shares>0 && __exN>(window.__REVDELAY||0)){ inReverse=true; reverseDay1=true; }");
  (0,eval)(src); return 'ok'; })()`;
(async()=>{
  const H=await open([{sym:'SOXL'},{sym:'SYNSOXL'}]);
  console.error('patch',await H.pg.evaluate(PATCH));
  const out={};
  for(const tkr of ['SOXL','SYNSOXL']){
    out[tkr]=await H.pg.evaluate(([tkr,CAP,STEP,KS])=>{
      const all=Object.keys(M[tkr]).sort();
      const run=(from,to,K)=>{ window.__REVDELAY=(K==null?0:K); return RUN({tkr,from,to,cap:CAP,divs:20,tgt:20,autoTp:true,big:20,reverse:K!=null,trace:false}); };
      const eqAt=(r)=>r.eqs;   // [d, eq, saved]
      // ① 사건 연구 — 끝까지 돌린다
      const HZ=[60,120,250,500], ev={};
      for(let s=200;s<all.length-30;s+=STEP){
        const from=all[s], off=run(from,null,null), on=run(from,null,0);
        const eo=off.eqs, en=on.eqs, n=Math.min(eo.length,en.length);
        let e=-1; for(let k=0;k<n;k++){ if(Math.abs(eo[k][1]-en[k][1])>0.01){ e=k; break; } }
        if(e<1) continue; const E=eo[e][0]; if(ev[E]) continue;
        const row={E,from,h:{}};
        const vars={0:en}; for(const K of KS) if(K>0) vars[K]=run(from,null,K).eqs;
        for(const K of KS){ const v=vars[K]; row.h[K]={}; for(const h of HZ){ const k=e+h; if(k<Math.min(v.length,eo.length)) row.h[K][h]=v[k][1]/eo[k][1]-1; } }
        // 끔 기준 E 뒤 회복 여부(평가액이 E 전날을 넘는 데 걸린 거래일)
        let rec=null; for(let k=e;k<eo.length;k++) if(eo[k][1]>=eo[e-1][1]){ rec=k-e; break; } row.recOff=rec;
        ev[E]=row;
      }
      // ② 5년 창
      const W=[]; const yrs=5;
      for(let s=200;s<all.length;s+=STEP){
        const from=all[s]; const t=new Date(from+'T00:00:00Z'); t.setUTCFullYear(t.getUTCFullYear()+yrs); const to=t.toISOString().slice(0,10);
        if(to>all[all.length-1]) break;
        const row={from,to,r:{}};
        for(const K of [null].concat(KS)){ const r=run(from,to,K); let pk=0,mdd=0; for(const [,q] of r.eqs){ if(q>pk) pk=q; else mdd=Math.max(mdd,1-q/pk); }
          row.r[K==null?'off':K]={cagr:Math.pow(r.final/CAP,1/yrs)-1,mdd}; }
        W.push(row);
      }
      return {events:Object.values(ev).sort((a,b)=>a.E<b.E?-1:1),windows:W};
    },[tkr,CAP,STEP,KS]);
    console.error(tkr,'사건',out[tkr].events.length,'창',out[tkr].windows.length);
  }
  await H.close();
  fs.writeFileSync(__dirname+'/delay_'+CAP+'.json',JSON.stringify(out));
  console.log('ok');
})().catch(e=>{console.error(e);process.exit(1);});
