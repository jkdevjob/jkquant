// 무매 SOXL 20분할 · 익절 자동(MA150+초강세·고변동 · −10%→10%) · 큰수 20 · 복리 — 리버스 켬/끔 사건 연구
// 시작일을 옮겨 가며 같은 설정으로 켬·끔을 돌리고, 두 결과가 처음 갈리는 날(= 소진 뒤 리버스 1일차 MOC)을 사건일 E 로 본다.
// E 전날 상태(종가/평단 · T · 잔금)와 E 뒤 h 거래일의 평가액 비(켬/끔)를 모은다. 같은 E 는 한 번만(가장 이른 시작).
const {open}=require('../im_plan/imh.js'); const fs=require('fs');
const CAP=+process.argv[2]||10000, STEP=+process.argv[3]||5;
(async()=>{
  const H=await open([{sym:'SOXL'},{sym:'SYNSOXL'}]);
  const out={};
  for(const tkr of ['SOXL','SYNSOXL']){
    const res=await H.pg.evaluate(([tkr,CAP,STEP])=>{
      const all=Object.keys(M[tkr]).sort(); const idx={}; all.forEach((d,k)=>idx[d]=k);
      const HZ=[20,60,120,250,500]; const ev={};
      for(let s=200; s<all.length-30; s+=STEP){
        const from=all[s];
        const base={tkr,from,cap:CAP,divs:20,tgt:20,autoTp:true,big:20,trace:true};
        const off=RUN({...base,reverse:false}), on=RUN({...base,reverse:true});
        const eo=off.eqs, en=on.eqs; const n=Math.min(eo.length,en.length);
        let e=-1; for(let k=0;k<n;k++){ if(Math.abs(eo[k][1]-en[k][1])>0.01){ e=k; break; } }
        if(e<1) continue;
        const E=eo[e][0]; if(ev[E]) continue;
        const tr=off.trace.tr, pre=tr[e-1];   // [d,c,cash,shares,avg,T,curTP,...] — E 전날(끔 기준 = 켬도 같음)
        const row={E,from,ratio:pre[1]/pre[4],T:pre[5],cash:pre[2],tp:pre[6],eq0:eo[e-1][1],h:{}};
        for(const h of HZ){ const k=e+h; if(k<n) row.h[h]=en[k][1]/eo[k][1]-1; }
        row.end=en[n-1][1]/eo[n-1][1]-1; row.endD=eo[n-1][0];
        // 끔의 회복: E 뒤 몇 거래일 만에 평가액이 E 전날 평가액을 다시 넘나(끔·켬 각각)
        const rec=(arr)=>{ for(let k=e;k<arr.length;k++) if(arr[k][1]>=eo[e-1][1]) return k-e; return null; };
        row.recOff=rec(eo); row.recOn=rec(en);
        // 켬이 리버스에서 나온 날(켬 trace 의 상태는 없으니 T 가 처음 줄어든 매수/매도 패턴 대신, 끔과 같은 사이클 끝까지는 비교만)
        ev[E]=row;
      }
      return Object.values(ev).sort((a,b)=>a.E<b.E?-1:1);
    },[tkr,CAP,STEP]);
    out[tkr]=res; console.error(tkr,'사건',res.length);
  }
  await H.close();
  fs.writeFileSync(__dirname+'/events_'+CAP+'.json',JSON.stringify(out));
  console.log('ok');
})().catch(e=>{console.error(e);process.exit(1);});
