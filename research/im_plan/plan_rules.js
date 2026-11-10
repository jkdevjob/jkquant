// 5년 플랜 규칙과 변형 — 모두 전일(kp)까지의 종가만 본다
const {ind}=require('./px');
const fs=require('fs'), path=require('path');
// 하방 변동성: 음수 일수익만 제곱해 평균(n일) — 연율. 대칭이면 σ/√2 쯤이라 s0 도 같이 낮춰야 같은 평균 비중이 된다.
function dvol(a,n){ const o=[]; for(let k=0;k<a.length;k++){ if(k<n){o.push(null);continue;} let s=0; for(let j=k-n+1;j<=k;j++){ const r=a[j]/a[j-1]-1; if(r<0) s+=r*r; } o.push(Math.sqrt(s/n*252)); } return o; }
function mk(P,R,G,p){ p=Object.assign({tw:.70,gw:.30,look:20,s0:.55,sb:.10,ma:225,gb:.01},p||{});
  const GA=p.gAsset||G;   // Guard 슬리브로 실제 사는 종목(신호는 여전히 G 의 이평)
  const gv=p.offK?ind.vol(P.C[G],p.offKn||20):null;   // 변동성 비례 Guard 나올 때 밴드: offK × G 의 일간 σ(offKn 일) — 전일까지
  const offB=k=>(p.offK&&gv[k]>0)?p.offK*gv[k]/Math.sqrt(252):(p.gbOff??p.gb);
  // TECL 리밸을 주(월) 첫 거래일에만: wkDn(내릴 때만) · wkAll(둘 다) · moDn(내릴 때 월 1회). 오늘(=전일 k 다음 날)의 달력만 본다 — 룩어헤드 아님
  const gvT=p.gs0?ind.vol(P.C[GA],p.look):null;   // TQQQ 슬리브 비중도 역분산: gw × min(1, gs0²/σ²) (gs0 없으면 Guard ON 이면 gw 그대로)
  let lastK=-1; const wk=d=>Math.floor((Date.parse(d)/864e5+3)/7), isStart=(k,f)=>k+1<P.dates.length&&k>=0&&f(P.dates[k+1])!==f(P.dates[k]);
  const MO=p.gRebMo||1, sh=d=>{ const y=+d.slice(0,4), m=+d.slice(5,7); return [m>=MO?y:y-1,(m-MO+12)%12]; };   // gRebMo: 정기 맞춤을 몇 월부터 셀지(기본 1월) — 달력 운 검사용
  const PER={m:d=>d.slice(0,7), q:d=>{ const [y,m]=sh(d); return y+'-'+Math.floor(m/3); }, h:d=>{ const [y,m]=sh(d); return y+'-'+Math.floor(m/6); }, y:d=>String(sh(d)[0]), y2:d=>String(Math.floor(sh(d)[0]/2))};
  const rmF=p.reMA?ind.ma(P.C[G],p.reMA):null;   // 변형(11-08): 긴 OFF 뒤 빠른 재진입의 빠른 이평
  const gmL=p.maEns?(p.maList||[200,225,250]).map(n=>ind.ma(P.C[G],n)):null; let lastSt=null;   // 변형(11-07): Guard 이평 앙상블 — 'avg' 이평들의 평균선 · 'vote' 이평마다 히스테리시스 상태를 두고 다수결 · sbDnOffN 용 st 보관
  const rv0=p.down?dvol(P.C[R],p.look):p.look2?(()=>{ const a=ind.vol(P.C[R],p.look), b=ind.vol(P.C[R],p.look2); return a.map((x,i)=>(x==null||b[i]==null)?null:Math.max(x,b[i])); })()
    :p.volEst==='yz'?ind.yz(P.C[R],P.O[R],p.look):p.volEst==='gk'?ind.gk(P.C[R],P.O[R],p.look):p.volEst==='ewma'?ind.ewma(P.C[R],p.lam??0.94,p.look):ind.vol(P.C[R],p.look);   // volEst(11-10): 범위 기반(yz·gk · prep ohlc 필요) · 지수가중(ewma λ)
  // iv(11-10): 내재변동성(VXN · 없으면 VIX×fbK)을 TECL σ 로 환산(k×지수/100) — mode: only(내재만) · geo(기하평균) · max · avg. 날짜는 전일(k)까지 · 없는 날은 직전 값
  const IVP=p.iv||((p.panic&&p.panic.sleeve)?{sym:p.panic.ivSym||'VXN',k:p.panic.k??2.5,fb:p.panic.fb||'VIX',fbK:p.panic.fbK??3.0}:null);
  const ivArr=IVP?(()=>{ const rd=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(__dirname,'data',s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; };
    const A=rd(IVP.sym||'VXN'), B=IVP.fb?rd(IVP.fb):null; let la=null, lb=null; return P.dates.map(d=>{ if(A[d]!=null) la=A[d]; if(B&&B[d]!=null) lb=B[d]; if(la!=null) return la/100*(IVP.k??2.5); if(lb!=null) return lb/100*(IVP.fbK??(IVP.k??2.5)*1.2); return null; }); })():null;
  const rv=(p.iv&&ivArr)?rv0.map((x,i)=>{ const v=ivArr[i]; if(x==null) return v; if(v==null) return x; const m=p.iv.mode||'geo'; return m==='only'?v:m==='max'?Math.max(x,v):m==='avg'?(x+v)/2:Math.sqrt(x*v); }):rv0;
  // gLev(11-10): Guard 를 단계로 — 이평 대비 끄는 선 목록(예 [0.99,0.97,0.95]) · 단계마다 켜는 선 = 끄는 선 + gLw(기본 0.02) · TQQQ 목표 = gw × 켜진 단계 수 / 단계 수 · 단계가 바뀐 날만 매매
  const GL=p.gLev?{o:p.gLev,w:p.gLw??0.02}:null; let levTrade=false;
  const GS=p.gSig||G;   // gSig(11-10): Guard 신호(이평·가격)를 다른 종목(NDX 등)으로 — 매매는 여전히 GA
  const gm=ind.ma(P.C[GS],p.ma), rm=p.rMA?ind.ma(P.C[R],p.rMA):null;
  // panic(11-10): 공포 모드 Guard — VIX(sym) 가 hi 이상이면 '무장' · Guard OFF 인 채 VIX 가 lo 아래로 내려오면(+ 가격 > 빠른 이평 fm×(1+band)) 빠른 모드로 ON · 빠른 모드에선 이평 fm(기본 20) ±band 로 켜고 끄며 · 가격이 SMA225×(1+gbOn) 위로 오르면 보통 모드 복귀 · VIX 가 다시 hi 이상이면 다시 무장
  const pan=p.panic?(()=>{ const m={}; JSON.parse(fs.readFileSync(path.join(__dirname,'data',(p.panic.sym||'VIX')+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); let last=null; return {v:P.dates.map(d=>{ if(m[d]!=null) last=m[d]; return last; }),fm:ind.ma(P.C[GS],p.panic.ma||20)}; })():null;
  const rvDn=p.lookDn?ind.vol(P.C[R],p.lookDn):null;   // 내릴 때만 빠른 σ: 목표 = min(σ look 목표, σ lookDn 목표) 가 지금 비중보다 낮으면 그쪽으로(올릴 때는 σ look 그대로)
  const extra=p.div?{sym:p.div, w:p.dw, m:ind.ma(P.C[p.div],p.dMA||200)}:null;
  // offRate(11-06): Guard OFF 동안 offAsset 을 '금리 하락 국면'에만 — 전일까지의 ^TNX(sym) 가 ma 일선 아래(mode 'ma') · 252 거래일 전보다 낮음(mode 'yoy') 일 때. 아니면 SGOV(현금). 금리 자료는 플랜 날짜 축에 직전 값으로 이음.
  const rs=p.offRate?(()=>{ const R=p.offRate, m={}; JSON.parse(fs.readFileSync(path.join(__dirname,'data',(R.sym||'TNX')+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; });
    let last=null; const y=P.dates.map(d=>{ if(m[d]!=null) last=m[d]; return last; }); if(R.mode==='yoy'){ const L=R.lag||252; return y.map((v,k)=>k>=L&&v!=null&&y[k-L]!=null?v<y[k-L]:false); }
    const ma=ind.ma(y.map(v=>v??0),R.ma||200); return y.map((v,k)=>v!=null&&ma[k]>0?v<ma[k]*(1-(R.band||0)):false); })():null;
  return {deferDec:p.deferDec?Object.assign({},p.deferDec,{sym:R}):undefined, harvest:p.harvest,   // px 옵션 통과(11-08) — 12월 이연 · 연말 세금 최적화(planx VARS 로 쓰려고)
    assets:[R,GA].concat(extra?[extra.sym]:[]).concat(p.offAsset?[p.offAsset]:[]).concat(p.ladder?[p.ladder.sym]:[]),   // ladder(11-10): 2배 ETF 도 자산 목록에
    warm:Math.max(p.ma,p.reMA||0,(p.panic&&p.panic.ma)||0,...(gmL?(p.maList||[200,225,250]):[]),p.look+1,(p.lookDn||0)+1,(p.look2||0)+1,p.rMA||0,extra?(p.dMA||200):0)+1,
    bandOf:(s,t,c)=>{ if(s===GA&&levTrade) return 0.001; if(p.ladder&&s===p.ladder.sym) return ((p.sbDn!=null&&t<c)?p.sbDn:(p.sbUp!=null&&t>c)?p.sbUp:p.sb)*p.tw*(p.ladder.lev/3); if(s!==R) return ((s===GA||(p.offAsset&&s===p.offAsset))&&t>0&&c>0)?(p.gReb?(isStart(lastK,PER[p.gReb])?(p.gRebB??0.02):Infinity):((p.gsbDn!=null&&t<c)?p.gsbDn:(p.gsbUp!=null&&t>c)?p.gsbUp:(p.gsb??0.02))):0.02;   // gReb: TQQQ 를 정해진 때(월 m·분기 q·반기 h·연 y 첫 거래일)만 목표로 — 그날 gRebB 넘게 벌어졌을 때
      if((p.wkAll&&!isStart(lastK,wk))||(p.wkDn&&t<c&&!isStart(lastK,wk))||(p.moDn&&t<c&&!isStart(lastK,d=>d.slice(0,7)))) return Infinity;
      if((p.wkUp&&t>c&&!isStart(lastK,wk))||(p.moUp&&t>c&&!isStart(lastK,d=>d.slice(0,7)))||(p.qUp&&t>c&&!isStart(lastK,PER.q))) return Infinity;   // TECL 올릴 때만 주(wkUp)·월(moUp)·분기(qUp) 첫 거래일에
      const dnOk=p.sbDnOffN==null||(lastSt&&!lastSt.g&&(lastSt.od||0)>=p.sbDnOffN);   // 변형(11-07): 줄일 때 좁은 밴드(sbDn)를 Guard OFF 가 N 신호일 이상 이어진 뒤에만(V형 급락 바닥에서 바로 팔지 않기)
      return ((p.sbDn!=null&&t<c&&dnOk)?p.sbDn:(p.sbUp!=null&&t>c)?p.sbUp:p.sb)*p.tw; },   // TECL 비중: 내릴 때 sbDn · 올릴 때 sbUp (없으면 sb)
    target(k,cur,st){ lastK=k; let s=rv[k];
      if(pan&&p.panic.sleeve){ const v=pan.v[k]; if(v!=null&&v>=p.panic.hi) st.armS=true; if(st.armS&&v!=null&&v<p.panic.lo){ st.ps=true; st.armS=false; st.psn=(st.psn||0)+1; }   // 슬리브 공포 모드: 진정 신호에 켜고
        if(st.ps&&ivArr&&ivArr[k]!=null&&rv0[k]!=null){ if(rv0[k]<=ivArr[k]) st.ps=false; else s=Math.min(s,ivArr[k]); } }   // σ20 이 내재변동성 아래로 내려오면(지난 폭락 날들이 창에서 빠지면) 보통으로
      let w=Math.min(p.wMax??1,(p.s0*p.s0)/(s*s));   // wMax: TECL 슬리브 상한(기본 1) — 1 보다 크면 잔잔할 때만 더 싣는다
      lastSt=st; const c=P.C[GS][k], m=(gmL&&p.maEns==='avg')?gmL.reduce((a,x)=>a+x[k],0)/gmL.length:gm[k]; if(pan&&st.gN!==undefined) st.g=st.gN; if(st.g===undefined) st.g=c>m;
      if(p.reN&&st.fast){   // 빠른 모드(11-08): 225일선 아래라도 빠른 조건이 깨질 때만 끈다 · 225일선 +gbOn 위로 오르면 보통 모드로
        if(c>m*(1+(p.gbOn??p.gb))) st.fast=false;
        else if((p.reMA&&rmF[k]>0)?c<rmF[k]*(1-(p.gbOff??p.gb)):c<st.reLow){ st.g=false; st.fast=false; st.offLow=c; } }
      else if(gmL&&p.maEns==='vote'){ st.gv=st.gv||gmL.map(x=>c>x[k]); gmL.forEach((x,i)=>{ const mm=x[k]; if(c>mm*(1+(p.gbOn??p.gb))) st.gv[i]=true; else if(c<mm*(1-offB(k))) st.gv[i]=false; }); st.g=st.gv.filter(Boolean).length*2>gmL.length; }   // 다수결: 이평마다 같은 밴드로 ON/OFF 를 두고 과반이 ON 이면 ON
      else if(p.offN||p.offHard){   // 시간 확인: 이평×(1−gbOff) 아래가 offN 일 연속일 때만 나감 · offHard 아래로 떨어지면 바로 나감
        st.n=(c<m*(1-(p.gbOff??p.gb)))?(st.n||0)+1:0;
        if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if((p.offN&&st.n>=p.offN)||(p.offHard&&c<m*(1-p.offHard))) st.g=false; }
      else if(GL){ if(!st.gl){ st.gl=GL.o.map(o=>c>m*(o+GL.w/2)); } GL.o.forEach((o,i)=>{ if(c>m*(o+GL.w)) st.gl[i]=true; else if(c<m*o) st.gl[i]=false; }); const n=st.gl.filter(Boolean).length; levTrade=(st.gln!==undefined&&st.gln!==n); st.gln=n; st.g=n>0; st.gfrac=n/GL.o.length; }
      else if(c>m*(1+(p.gbOn??p.gb))) st.g=true; else if(c<m*(1-offB(k))) st.g=false;   // 들어갈 때(gbOn)·나올 때(gbOff) 밴드를 따로 줄 수 있다
      if(p.reN){ if(!st.g){ st.offLow=Math.min(st.offLow??Infinity,c); if((st.od||0)>=p.reN&&((p.reMA&&rmF[k]>0&&c>rmF[k]*(1+(p.gbOn??p.gb)))||(p.reUp&&c>=st.offLow*(1+p.reUp)))){ st.g=true; st.fast=true; st.reLow=st.offLow; } } else if(!st.fast) st.offLow=Infinity; }   // 변형(11-08): OFF 가 reN 신호일 넘으면 TQQQ > reMA일선×(1+gbOn) 또는 OFF 최저가×(1+reUp) 에서 켠다
      if(pan){ st.gN=st.g; const v=pan.v[k], fm=pan.fm[k], b=p.panic.band??0.02; if(v!=null&&v>=p.panic.hi) st.armed=true;
        if(st.gN){ st.pf=false; st.armed=false; }   // 보통 Guard 가 켜지면 공포 모드·무장 해제
        else if(!st.pf){ if(!p.panic.noGuard&&st.armed&&v!=null&&v<p.panic.lo&&(p.panic.needMA===false||(fm>0&&c>fm*(1+b)))){ st.pf=true; st.g=true; st.pg=true; st.pn=(st.pn||0)+1; } }   // noGuard: 슬리브만(Guard 빠른 모드 없음)
        else { if(fm>0&&c>fm*(1+b)) st.g=true; else if(fm>0&&c<fm*(1-b)) st.g=false; else st.g=!!st.pg; st.pg=st.g; if(p.panic.oneShot&&!st.g) st.pf=false; } }   // 11-10 고침(지피티 검토): 중립 구간에선 직전 빠른 상태(st.pg) 유지 — 예전엔 위에서 st.g 를 보통 Guard(OFF)로 되돌린 채 남겨 2020-04-29 에 정의와 다른 매도가 났다   // 빠른 모드: fm ±band 히스테리시스 · oneShot 이면 한 번 꺼지면 보통 모드로(재진입은 SMA225 +gbOn 에서만)
      if(p.full&&!st.g) w=0;                       // 변형: Guard OFF 면 TECL 도 끔
      if(p.offMul!=null&&!st.g) w*=p.offMul;       // 변형: Guard OFF 동안 TECL 목표에 offMul 곱함(일부만 줄임)
      st.od=st.g?0:(st.od||0)+1; if(p.offLongN&&!st.g&&st.od>p.offLongN) w*=(p.offLongK??0.5);   // 변형(11-04): Guard OFF 가 offLongN 신호일 넘게 이어지면 TECL 목표 × offLongK — 긴 하락장만 줄이기
      if(rm&&P.C[R][k]<rm[k]) w=Math.min(w,p.rFloor??0);   // 변형: TECL 자체 추세
      const t={}; t[R]=p.tw*w;
      if(p.ladder){ const L=p.ladder, lev=L.lev||2; const useL=(p.tw*w<=L.below)&&(cur[L.sym]>0||p.tw*w<=L.below-(L.hyst??0.03)||!(cur[R]>0));   // 2배로 바꾸는 선 below · 다시 3배로 돌아오는 선 below+hyst(왕복 매매 줄이기)
        if(useL&&!(cur[R]>0&&p.tw*w>L.below-(L.hyst??0.03)&&!(cur[L.sym]>0))){ t[L.sym]=Math.min(L.cap??0.7,p.tw*w*3/lev); t[R]=0; } else t[L.sym]=0; } if(rvDn&&rvDn[k]>0){ const wd=Math.min(w,Math.min(1,(p.s0*p.s0)/(rvDn[k]*rvDn[k]))); if(p.tw*wd<(cur[R]||0)) t[R]=p.tw*wd; } t[GA]=st.g?p.gw*((p.gs0&&gvT[k]>0)?Math.min(1,p.gs0*p.gs0/(gvT[k]*gvT[k])):1)*((GL&&!st.pf)?(st.gfrac??1):1):0;
      if(p.offAsset) t[p.offAsset]=st.g?0:((rs?rs[k]:true)?(p.offW??p.gw):0);   // 변형(11-03): Guard OFF 동안 TQQQ 몫(gw)을 SGOV(현금) 대신 offAsset(IEF·TLT·GLD·QQQ 등)으로 — 매매 시점·밴드는 TQQQ 와 같은 규칙(Guard 바뀔 때 · gReb)
      if(extra){ const on=P.C[extra.sym][k]>extra.m[k]; t[extra.sym]=on?extra.w:0; const sum=t[R]+t[G]+t[extra.sym]; if(sum>1){ t[R]*=1/sum; t[G]*=1/sum; t[extra.sym]*=1/sum; } }
      return t; } }; }
module.exports={mk};
