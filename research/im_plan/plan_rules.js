// 5년 플랜 규칙과 변형 — 모두 전일(kp)까지의 종가만 본다
const {ind}=require('./px');
// 하방 변동성: 음수 일수익만 제곱해 평균(n일) — 연율. 대칭이면 σ/√2 쯤이라 s0 도 같이 낮춰야 같은 평균 비중이 된다.
function dvol(a,n){ const o=[]; for(let k=0;k<a.length;k++){ if(k<n){o.push(null);continue;} let s=0; for(let j=k-n+1;j<=k;j++){ const r=a[j]/a[j-1]-1; if(r<0) s+=r*r; } o.push(Math.sqrt(s/n*252)); } return o; }
function mk(P,R,G,p){ p=Object.assign({tw:.70,gw:.30,look:20,s0:.55,sb:.10,ma:225,gb:.01},p||{});
  const GA=p.gAsset||G;   // Guard 슬리브로 실제 사는 종목(신호는 여전히 G 의 이평)
  const gv=p.offK?ind.vol(P.C[G],p.offKn||20):null;   // 변동성 비례 Guard 나올 때 밴드: offK × G 의 일간 σ(offKn 일) — 전일까지
  const offB=k=>(p.offK&&gv[k]>0)?p.offK*gv[k]/Math.sqrt(252):(p.gbOff??p.gb);
  // TECL 리밸을 주(월) 첫 거래일에만: wkDn(내릴 때만) · wkAll(둘 다) · moDn(내릴 때 월 1회). 오늘(=전일 k 다음 날)의 달력만 본다 — 룩어헤드 아님
  const gvT=p.gs0?ind.vol(P.C[GA],p.look):null;   // TQQQ 슬리브 비중도 역분산: gw × min(1, gs0²/σ²) (gs0 없으면 Guard ON 이면 gw 그대로)
  let lastK=-1; const wk=d=>Math.floor((Date.parse(d)/864e5+3)/7), isStart=(k,f)=>k+1<P.dates.length&&k>=0&&f(P.dates[k+1])!==f(P.dates[k]);
  const rv=p.down?dvol(P.C[R],p.look):p.look2?(()=>{ const a=ind.vol(P.C[R],p.look), b=ind.vol(P.C[R],p.look2); return a.map((x,i)=>(x==null||b[i]==null)?null:Math.max(x,b[i])); })():ind.vol(P.C[R],p.look), gm=ind.ma(P.C[G],p.ma), rm=p.rMA?ind.ma(P.C[R],p.rMA):null;
  const rvDn=p.lookDn?ind.vol(P.C[R],p.lookDn):null;   // 내릴 때만 빠른 σ: 목표 = min(σ look 목표, σ lookDn 목표) 가 지금 비중보다 낮으면 그쪽으로(올릴 때는 σ look 그대로)
  const extra=p.div?{sym:p.div, w:p.dw, m:ind.ma(P.C[p.div],p.dMA||200)}:null;
  return {assets:[R,GA].concat(extra?[extra.sym]:[]), warm:Math.max(p.ma,p.look+1,(p.lookDn||0)+1,(p.look2||0)+1,p.rMA||0,extra?(p.dMA||200):0)+1,
    bandOf:(s,t,c)=>{ if(s!==R) return (s===GA&&t>0&&c>0)?(((p.gsbDn!=null&&t<c)?p.gsbDn:(p.gsbUp!=null&&t>c)?p.gsbUp:(p.gsb??0.02))):0.02;
      if((p.wkAll&&!isStart(lastK,wk))||(p.wkDn&&t<c&&!isStart(lastK,wk))||(p.moDn&&t<c&&!isStart(lastK,d=>d.slice(0,7)))) return Infinity;
      return ((p.sbDn!=null&&t<c)?p.sbDn:(p.sbUp!=null&&t>c)?p.sbUp:p.sb)*p.tw; },   // TECL 비중: 내릴 때 sbDn · 올릴 때 sbUp (없으면 sb)
    target(k,cur,st){ lastK=k; const s=rv[k]; let w=Math.min(1,(p.s0*p.s0)/(s*s));
      const c=P.C[G][k], m=gm[k]; if(st.g===undefined) st.g=c>m; if(p.offN||p.offHard){   // 시간 확인: 이평×(1−gbOff) 아래가 offN 일 연속일 때만 나감 · offHard 아래로 떨어지면 바로 나감
        st.n=(c<m*(1-(p.gbOff??p.gb)))?(st.n||0)+1:0;
        if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if((p.offN&&st.n>=p.offN)||(p.offHard&&c<m*(1-p.offHard))) st.g=false; }
      else if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if(c<m*(1-offB(k))) st.g=false;   // 들어갈 때(gbOn)·나올 때(gbOff) 밴드를 따로 줄 수 있다
      if(p.full&&!st.g) w=0;                       // 변형: Guard OFF 면 TECL 도 끔
      if(rm&&P.C[R][k]<rm[k]) w=Math.min(w,p.rFloor??0);   // 변형: TECL 자체 추세
      const t={}; t[R]=p.tw*w; if(rvDn&&rvDn[k]>0){ const wd=Math.min(w,Math.min(1,(p.s0*p.s0)/(rvDn[k]*rvDn[k]))); if(p.tw*wd<(cur[R]||0)) t[R]=p.tw*wd; } t[GA]=st.g?p.gw*((p.gs0&&gvT[k]>0)?Math.min(1,p.gs0*p.gs0/(gvT[k]*gvT[k])):1):0;
      if(extra){ const on=P.C[extra.sym][k]>extra.m[k]; t[extra.sym]=on?extra.w:0; const sum=t[R]+t[G]+t[extra.sym]; if(sum>1){ t[R]*=1/sum; t[G]*=1/sum; t[extra.sym]*=1/sum; } }
      return t; } }; }
module.exports={mk};
