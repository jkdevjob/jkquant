// capsize.js 결과를 창 시작 때 1회매수금이 몇 주였나(q0 = 원금/20 ÷ 전일 실제 체결가)로 창을 묶어 정수−소수 차이를 본다 — node capsize_q.js capsize_out.json data/SOXL.json (합성: capsize_syn_out.json data/SYNSOXL_S.json)
const fs=require('fs'); const [,,OUT,DATA]=process.argv; const D=JSON.parse(fs.readFileSync(OUT,'utf8'));
const j=JSON.parse(fs.readFileSync(DATA,'utf8')); const T=j.ohlcTrade||j.ohlc; const sp=(j.splits||[]).map(s=>[s.date,s.ratio]);
const unit=d=>sp.reduce((m,[sd,r])=>d<sd?m*r:m,1);   // 분할 전 날짜는 뒤 분할 비율을 곱해 그날 실제 가격으로
const px=T.map(r=>[r.date,r.close*unit(r.date)]);
const prevPx=s=>{ let a=0,b=px.length; while(a<b){ const m=(a+b)>>1; if(px[m][0]<s) a=m+1; else b=m; } return px[Math.max(0,a-1)][1]; };
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length, med=a=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor((b.length-1)/2)]; };
const N=D.starts.length, get=(cap,m,k)=>{ const R=D.res.filter(r=>r.cap===cap&&r.mode===m); return [mean(R.map(r=>r.win[k][0])),mean(R.map(r=>r.win[k][1]))]; };
const B=[[0,1],[1,2],[2,3],[3,5],[5,8],[8,12],[12,20],[20,50],[50,1e9]], rows=B.map(()=>({a:[],b:[],c:[],dm:[]}));
for(const cap of D.CAPS) for(let k=0;k<N;k++){ const q0=cap/20/prevPx(D.starts[k][0]); const bi=B.findIndex(([lo,hi])=>q0>=lo&&q0<hi);
  const I3=get(cap,'I03',k), I0=get(cap,'I00',k), F=get(cap,'F0',k); rows[bi].a.push(I3[0]-F[0]); rows[bi].b.push(I0[0]-F[0]); rows[bi].c.push(I3[0]-I0[0]); rows[bi].dm.push(I3[1]-F[1]); }
console.log(`${D.TK} · 창 ${N} × 원금 ${D.CAPS.length} — 창 시작 1회매수금(주) 묶음별 CAGR 차이(평균 / 중앙) · MDD 차 중앙`);
B.forEach(([lo,hi],i)=>{ const R=rows[i]; if(!R.a.length) return; console.log(`${String(lo).padStart(3)}~${hi>1e8?'   ':String(hi).padEnd(3)}주  창 ${String(R.a.length).padStart(3)} | 정수(3줄)−소수 ${mean(R.a).toFixed(2)} / ${med(R.a).toFixed(2)} | 내림만(0줄)−소수 ${mean(R.b).toFixed(2)} / ${med(R.b).toFixed(2)} | 하방 3줄 몫 ${mean(R.c).toFixed(2)} / ${med(R.c).toFixed(2)} | MDD 차 ${med(R.dm).toFixed(2)} | 정수가 낮은 창 ${R.a.filter(x=>x<0).length}`); });
