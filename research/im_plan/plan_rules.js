// 5년 플랜 규칙과 변형 — 모두 전일(kp)까지의 종가만 본다
const {ind}=require('./px');
function mk(P,R,G,p){ p=Object.assign({tw:.70,gw:.30,look:20,s0:.55,sb:.10,ma:225,gb:.01},p||{});
  const rv=p.look2?(()=>{ const a=ind.vol(P.C[R],p.look), b=ind.vol(P.C[R],p.look2); return a.map((x,i)=>(x==null||b[i]==null)?null:Math.max(x,b[i])); })():ind.vol(P.C[R],p.look), gm=ind.ma(P.C[G],p.ma), rm=p.rMA?ind.ma(P.C[R],p.rMA):null;
  const extra=p.div?{sym:p.div, w:p.dw, m:ind.ma(P.C[p.div],p.dMA||200)}:null;
  return {assets:[R,G].concat(extra?[extra.sym]:[]), warm:Math.max(p.ma,p.look+1,(p.look2||0)+1,p.rMA||0,extra?(p.dMA||200):0)+1,
    bandOf:s=>s===R?p.sb*p.tw:0.02,
    target(k,cur,st){ const s=rv[k]; let w=Math.min(1,(p.s0*p.s0)/(s*s));
      const c=P.C[G][k], m=gm[k]; if(st.g===undefined) st.g=c>m; if(c>m*(1+p.gb)) st.g=true; else if(c<m*(1-p.gb)) st.g=false;
      if(p.full&&!st.g) w=0;                       // 변형: Guard OFF 면 TECL 도 끔
      if(rm&&P.C[R][k]<rm[k]) w=Math.min(w,p.rFloor??0);   // 변형: TECL 자체 추세
      const t={}; t[R]=p.tw*w; t[G]=st.g?p.gw:0;
      if(extra){ const on=P.C[extra.sym][k]>extra.m[k]; t[extra.sym]=on?extra.w:0; const sum=t[R]+t[G]+t[extra.sym]; if(sum>1){ t[R]*=1/sum; t[G]*=1/sum; t[extra.sym]*=1/sum; } }
      return t; } }; }
module.exports={mk};
