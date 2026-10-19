// 5년 플랜 규칙과 변형 — 모두 전일(kp)까지의 종가만 본다
const {ind}=require('./px');
// 하방 변동성: 음수 일수익만 제곱해 평균(n일) — 연율. 대칭이면 σ/√2 쯤이라 s0 도 같이 낮춰야 같은 평균 비중이 된다.
function dvol(a,n){ const o=[]; for(let k=0;k<a.length;k++){ if(k<n){o.push(null);continue;} let s=0; for(let j=k-n+1;j<=k;j++){ const r=a[j]/a[j-1]-1; if(r<0) s+=r*r; } o.push(Math.sqrt(s/n*252)); } return o; }
function mk(P,R,G,p){ p=Object.assign({tw:.70,gw:.30,look:20,s0:.55,sb:.10,ma:225,gb:.01},p||{});
  const GA=p.gAsset||G;   // Guard 슬리브로 실제 사는 종목(신호는 여전히 G 의 이평)
  const rv=p.down?dvol(P.C[R],p.look):p.look2?(()=>{ const a=ind.vol(P.C[R],p.look), b=ind.vol(P.C[R],p.look2); return a.map((x,i)=>(x==null||b[i]==null)?null:Math.max(x,b[i])); })():ind.vol(P.C[R],p.look), gm=ind.ma(P.C[G],p.ma), rm=p.rMA?ind.ma(P.C[R],p.rMA):null;
  const extra=p.div?{sym:p.div, w:p.dw, m:ind.ma(P.C[p.div],p.dMA||200)}:null;
  return {assets:[R,GA].concat(extra?[extra.sym]:[]), warm:Math.max(p.ma,p.look+1,(p.look2||0)+1,p.rMA||0,extra?(p.dMA||200):0)+1,
    bandOf:s=>s===R?p.sb*p.tw:0.02,
    target(k,cur,st){ const s=rv[k]; let w=Math.min(1,(p.s0*p.s0)/(s*s));
      const c=P.C[G][k], m=gm[k]; if(st.g===undefined) st.g=c>m; if(p.offN||p.offHard){   // 시간 확인: 이평×(1−gbOff) 아래가 offN 일 연속일 때만 나감 · offHard 아래로 떨어지면 바로 나감
        st.n=(c<m*(1-(p.gbOff??p.gb)))?(st.n||0)+1:0;
        if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if((p.offN&&st.n>=p.offN)||(p.offHard&&c<m*(1-p.offHard))) st.g=false; }
      else if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if(c<m*(1-(p.gbOff??p.gb))) st.g=false;   // 들어갈 때(gbOn)·나올 때(gbOff) 밴드를 따로 줄 수 있다
      if(p.full&&!st.g) w=0;                       // 변형: Guard OFF 면 TECL 도 끔
      if(rm&&P.C[R][k]<rm[k]) w=Math.min(w,p.rFloor??0);   // 변형: TECL 자체 추세
      const t={}; t[R]=p.tw*w; t[GA]=st.g?p.gw:0;
      if(extra){ const on=P.C[extra.sym][k]>extra.m[k]; t[extra.sym]=on?extra.w:0; const sum=t[R]+t[G]+t[extra.sym]; if(sum>1){ t[R]*=1/sum; t[G]*=1/sum; t[extra.sym]*=1/sum; } }
      return t; } }; }
module.exports={mk};
