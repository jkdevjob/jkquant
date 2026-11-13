// 시중 매매법(11-12) — 원문 규칙을 sim.js 규약(전일 종가 신호 · 당일 종가 체결)으로 옮김. 각 규칙의 출처·원문 값은 RESEARCH_LOG 11-12 '시중 매매법' 장.
// 월간 규칙: 그달 첫 거래일에 체결(신호 = 전달 마지막 거래일 종가) · 분기: 1·4·7·10월 첫 거래일 · 일간: 매일 전일 종가 신호 → 바뀔 때만 매매.
const {H}=require('./sim');
const once=(c,key,val,W)=>{ if(c.first||c.st[key]!==val){ c.st[key]=val; return W; } return null; };
const m13612=(c,s)=>{ const r=[1,3,6,12].map(m=>H.ret(c,s,m)); return r.some(x=>x==null)?null:12*r[0]+4*r[1]+2*r[2]+r[3]; };
const smaRel=(c,s,n=13)=>{ const e=H.monthEnds(c,s,n); return e?e[0]/(e.reduce((a,b)=>a+b,0)/n)-1:null; };          // BAA 'SMA(12)': p0 ÷ 평균(p0..p12) − 1
const avg4=(c,s)=>{ const r=[1,3,6,12].map(m=>H.ret(c,s,m)); return r.some(x=>x==null)?null:(r[0]+r[1]+r[2]+r[3])/4; };   // HAA: 1·3·6·12개월 평균
const best=(c,list,f)=>list.map(s=>[s,f(c,s)]).filter(x=>x[1]!=null).sort((a,b)=>b[1]-a[1]);
const S={};
// ── 참고: 그냥 보유(분기마다 배당 현금 재투자)
for(const t of ['QQQ','TQQQ','SPY','UPRO']) S['BH_'+t]={name:t+' 그냥 보유',syms:[t],decide:c=>(c.first||c.newQuarter)?{[t]:1}:null};
// ── HFEA(Bogleheads 'Hedgefundie' 2019): UPRO 55 · TMF 45 · 분기 맞춤
S.HFEA={name:'HFEA UPRO55·TMF45 분기',syms:['UPRO','TMF'],decide:c=>(c.first||c.newQuarter)?{UPRO:.55,TMF:.45}:null};
S.HFEA_TQ={name:'HFEA TQQQ55·TMF45 분기',syms:['TQQQ','TMF'],syn:{TQQQ:'SYNTQQQ',TMF:'SYNTMF'},decide:c=>(c.first||c.newQuarter)?{TQQQ:.55,TMF:.45}:null};   // 커뮤니티 변형(공식 비율 없음)
// ── 레버리지 회전(Gayed·Bilello 2016 'Leverage for the Long Run'): 지수 > 200일선이면 레버리지, 아니면 T-bill · 일간
// 11-12 2차: 신호 = 총수익(배당 조정) 지수의 200일 단순 이평(논문 각주 15) · up/dn = 켜는/끄는 밴드 · conf = 연속 며칠 확인 · tr=false 면 1차(가격) 판
const lrs=(sig,lev,cash='BIL',n=200,{up=0,dn=0,conf=1,tr=true}={})=>({name:`${sig} ${n}일선 → ${lev}`+(up||dn?` +${up*100}/−${dn*100}%`:'')+(conf>1?` ${conf}일 확인`:'')+(tr?'':' (가격)'),syms:[sig,lev,cash].filter((x,i,a)=>a.indexOf(x)===i),
  decide:c=>{ const m=H.sma(c,sig,n,tr), x=H.px(c,sig,tr); if(m==null) return null; c.st.hu=x>m*(1+up)?(c.st.hu||0)+1:0; c.st.hd=x<m*(1-dn)?(c.st.hd||0)+1:0;
    let on=c.st.on; if(c.first) on=x>m; else if(!on&&c.st.hu>=conf) on=true; else if(on&&c.st.hd>=conf) on=false;
    return once(c,'on',on,on?{[lev]:1}:{[cash]:1}); }});
S.LRS_N3=lrs('QQQ','TQQQ'); S.LRS_S3=lrs('SPY','UPRO'); S.LRS_S2=lrs('SPY','SSO'); S.LRS_N2=lrs('QQQ','QLD');
S.LRS_N3p=lrs('QQQ','TQQQ','BIL',200,{tr:false});                       // 1차 판(가격 이평) — 비교용
S.LRS_N3b=lrs('SPY','TQQQ','BIL',200,{up:.04,dn:.03});                  // TradingView 'SPY 200SMA +4% Entry −3% Exit (QQQ/TQQQ)' 핵심만(QQQ 분할 매수·과열 디레버리지 생략)
S.LRS_N3c=lrs('QQQ','TQQQ','BIL',200,{conf:2});                          // 커뮤니티 '이틀 확인' 변형
// ── 듀얼 모멘텀 GEM(Antonacci 2014): 미국 12개월 총수익 > T-bill 이면 미국·미국 밖 중 12개월 높은 쪽, 아니면 미국 채권 · 월간
// 11-12 2차: Antonacci FAQ 의 ETF(IVV ≈ SPY · 미국 밖 = VEU(ACWI ex-US) · 채권 = BND · T-bill = BIL) — 1차는 EFA·AGG 였다
S.GEM={name:'듀얼 모멘텀 GEM',syms:['SPY','VEU','BND','BIL'],decide:c=>{ if(!c.newMonth) return null; const u=H.ret(c,'SPY',12), x=H.ret(c,'VEU',12), b=H.ret(c,'BIL',12); if(u==null||x==null||b==null) return null;
  return u>b?(u>=x?{SPY:1}:{VEU:1}):{BND:1}; }};
// ── VAA-G4(Keller·Keuning 2017): 13612W · 공격 SPY EFA EEM AGG 모두 > 0 이면 가장 높은 공격 1개, 아니면 방어 LQD IEF SHY 중 가장 높은 1개 · 월간
S.VAA={name:'VAA 공격형(G4)',syms:['SPY','EFA','EEM','AGG','LQD','IEF','SHY'],decide:c=>{ if(!c.newMonth) return null; const O=['SPY','EFA','EEM','AGG'], Dd=['LQD','IEF','SHY'];
  const om=O.map(s=>m13612(c,s)); if(om.some(x=>x==null)) return null; const pick=om.every(x=>x>0)?best(c,O,m13612)[0][0]:best(c,Dd,m13612)[0][0]; return {[pick]:1}; }};
// ── BAA-G4 공격형(Keller 2022): 카나리아 SPY EEM EFA AGG(13612W) 하나라도 < 0 이면 방어 — TIP DBC BIL IEF TLT LQD AGG 중 SMA(12) 상대 모멘텀 상위 3(BIL 보다 낮으면 BIL) 1/3씩 · 아니면 QQQ EEM EFA AGG 중 상위 1 · 월간
// 11-12 2차: 논문(SSRN 4166845 v0.98) 종목으로 — 1차는 EEM·EFA·AGG 대용이었다
S.BAA={name:'BAA 공격형(G4)',syms:['SPY','QQQ','VWO','VEA','BND','TIP','DBC','BIL','IEF','TLT','LQD'],decide:c=>{ if(!c.newMonth) return null;
  const can=['SPY','VWO','VEA','BND'].map(s=>m13612(c,s)); if(can.some(x=>x==null)) return null;
  if(can.every(x=>x>=0)){ const b=best(c,['QQQ','VWO','VEA','BND'],smaRel); return b.length?{[b[0][0]]:1}:null; }
  const bil=smaRel(c,'BIL'), top=best(c,['TIP','DBC','BIL','IEF','TLT','LQD','BND'],smaRel).slice(0,3); const W={}; for(const [s,m] of top){ const k=(m<bil)?'BIL':s; W[k]=(W[k]||0)+1/3; } return W; }};
// ── HAA(Keller 2023): 카나리아 TIP(1·3·6·12개월 평균) > 0 이면 SPY IWM VEA VWO VNQ DBC IEF TLT 중 상위 4 · 1/4씩(음수면 현금 자산) · 아니면 현금 자산 100% · 현금 자산 = BIL·IEF 중 높은 쪽 · 월간
S.HAA={name:'HAA 균형형(G8)',syms:['TIP','SPY','IWM','VEA','VWO','VNQ','DBC','IEF','TLT','BIL'],decide:c=>{ if(!c.newMonth) return null; const t=avg4(c,'TIP'); if(t==null) return null;
  const cashA=(avg4(c,'BIL')??-1)>=(avg4(c,'IEF')??-1)?'BIL':'IEF'; if(t<=0) return {[cashA]:1};
  const top=best(c,['SPY','IWM','VEA','VWO','VNQ','DBC','IEF','TLT'],avg4).slice(0,4); const W={}; for(const [s,m] of top){ const k=m>0?s:cashA; W[k]=(W[k]||0)+.25; } return W; }};
// ── LAA(강환국 '게으른 자산배분'): IWD·GLD·IEF 25% 씩(해마다 맞춤) + 25% 는 QQQ — S&P500 < 200일선 이고 미국 실업률 > 12개월 평균이면 SHY · 월간 확인
//    실업률은 발표가 늦어 그달 첫 거래일엔 두 달 전 값까지만 쓴다(룩어헤드 금지)
const UNR=(()=>{ try{ return require('../data/UNRATE.json').series; }catch(e){ return []; } })();
const unrBad=d=>{ const m=+d.slice(5,7), y=+d.slice(0,4); const k=(y*12+m-1)-2; const key=`${Math.floor(k/12)}-${String(k%12+1).padStart(2,'0')}-01`; const i=UNR.findIndex(x=>x.date===key); if(i<11) return null; const v=UNR[i].close, ma=UNR.slice(i-11,i+1).reduce((a,b)=>a+b.close,0)/12; return v>ma; };
S.LAA={name:'LAA 게으른 자산배분',syms:['IWD','GLD','IEF','QQQ','SHY','SPY'],decide:c=>{ if(!c.newMonth) return null; const m=H.sma(c,'SPY',200), x=H.px(c,'SPY'), u=unrBad(c.date); if(m==null||u==null) return null;
  const risk=!(x<m&&u), yr=c.first||c.date.slice(5,7)==='01'; const k=risk?'QQQ':'SHY';
  if(yr) return {IWD:.25,GLD:.25,IEF:.25,[k]:.25};
  if(c.st.risk!==risk){ c.st.risk=risk; const cur=s=>c.pos[s]*H.px(c,s)/c.total; const W={IWD:cur('IWD'),GLD:cur('GLD'),IEF:cur('IEF')}; W[k]=1-W.IWD-W.GLD-W.IEF; return W; } return null; }};

// ── 9-Sig(Jason Kelly · 'The 3% Signal' 2015 의 TQQQ 판): 기본 TQQQ 60 · 채권 40 · 분기(달력 분기 끝 종가 → 다음 날 종가 체결)
//    신호선 = 지난 분기 끝 주식 잔고(그때 신호 가격 기준) × 1.09 + 그 분기 새 돈의 50% · 위면 넘친 만큼 채권으로 · 아래면 모자란 만큼 채권에서(채권이 모자라면 있는 만큼)
//    새 돈(월 입금)·배당은 모두 채권으로 · '30 down, stick around': 기준 종목 분기 종가가 앞 8분기 종가 최고의 70% 이하면 다음 매도 신호 n 번 건너뜀(n 번 또는 8분기 뒤 끝 · 끝난 뒤엔 조건이 한 번 풀려야 다시 켬)
//    출처가 갈림: 책(3Sig) SPY · 4번 | Kelly 2020-04 '9Sig 는 1번' | 뒤 제3자 '2번 · TQQQ 기준' — 셋 다 돈다. sub = 구독자 규칙이라는 것(미확인): 분기 TQQQ +100% 뒤 60/40 · 매수는 채권의 90% 까지 · 건너뛰기 끝나면 60/40
const nineSig=({trig='SPY',skips=1,bond='AGG',sub=false,name})=>({name,syms:['TQQQ',bond,trig].filter((x,i,a)=>a.indexOf(x)===i),
  syn:{TQQQ:'SYNTQQQ',AGG:'SYNAGG',BIL:'SYNBIL',SPY:'SYNSPY'},
  deposit:c=>{ c.st.nc=(c.st.nc||0)+c.depAmt; return {[bond]:1}; },
  decide:c=>{ const pT=H.px(c,'TQQQ'), tp=H.px(c,trig);
    if(c.first){ c.st.nc=0; c.st.hist=[]; c.st.left=0; c.st.ql=0; c.st.armOK=true; c.st.base=.6*c.total; c.st.lastT=pT; return {TQQQ:.6,[bond]:.4}; }
    if(!c.newQuarter) return null;
    const stock=c.pos.TQQQ*pT, total=c.total; let tgt=c.st.base*1.09+.5*c.st.nc; c.st.nc=0;
    const mx=c.st.hist.length?Math.max(...c.st.hist.slice(-8)):null, down=mx!=null&&tp<=.7*mx; c.st.hist.push(tp);
    if(!down) c.st.armOK=true;
    if(c.st.left<=0&&down&&c.st.armOK){ c.st.left=skips; c.st.ql=8; c.st.armOK=false; }
    const qRet=c.st.lastT?pT/c.st.lastT-1:0; c.st.lastT=pT;
    if(sub&&c.st.left<=0&&qRet>=1){ c.st.base=.6*total; return {TQQQ:.6,[bond]:.4}; }
    let newStock;
    if(stock>tgt){ if(c.st.left>0){ c.st.left--; newStock=stock; if(sub&&c.st.left===0){ c.st.ql=0; c.st.base=.6*total; return {TQQQ:.6,[bond]:.4}; } } else newStock=tgt; }
    else { const avail=Math.max(0,total-stock)*(sub?.9:1); newStock=stock+Math.min(tgt-stock,avail); }
    if(c.st.ql>0){ c.st.ql--; if(c.st.ql===0) c.st.left=0; }
    c.st.base=newStock; const w=Math.max(0,Math.min(1,newStock/total)); return {TQQQ:w,[bond]:1-w}; }});
S.NS1=nineSig({name:'9-Sig(SPY · 1번 건너뜀 · AGG)'}); S.NS4=nineSig({skips:4,name:'9-Sig(책 · SPY · 4번)'}); S.NS2T=nineSig({trig:'TQQQ',skips:2,name:'9-Sig(TQQQ 기준 · 2번)'});
S.NS1B=nineSig({bond:'BIL',name:'9-Sig(SPY · 1번 · 단기국채)'}); S.NS1X=nineSig({sub:true,name:'9-Sig(+구독자 규칙 · 미확인)'});
// ── 아기티큐 200일선(FMKorea · TQQQ 자기 200일선) — 2024-09-28 판: 위로 뚫으면 TQQQ 100% · 아래로 뚫으면 BIL 100% · 선보다 10% 이상 비싸면 'TQQQ 10% · BIL 90% 매수' · 10% 안으로 오면 BIL → TQQQ
//    '과열'이 보유분에도 걸리는지 글에 없다 → b = 새로 사는 돈(진입·입금)에만(2025 판과 같은 뜻) · a = 글자 그대로 보유분도 10/90
const agi24=lit=>({name:'아기티큐 2024'+(lit?' (과열=보유분도)':' (과열=새 돈만)'),syms:['TQQQ','BIL'],syn:{TQQQ:'SYNTQQQ',BIL:'SYNBIL'},
  deposit:c=>{ const m=H.sma(c,'TQQQ',200), x=H.px(c,'TQQQ'); if(m==null||x<m) return {BIL:1}; return x>m*1.1?{TQQQ:.1,BIL:.9}:{TQQQ:1}; },
  decide:c=>{ const m=H.sma(c,'TQQQ',200), x=H.px(c,'TQQQ'); if(m==null) return null; const above=x>=m, hot=x>m*1.1;
    if(!above) return once(c,'z','off',{BIL:1});
    if(lit) return once(c,'z',hot?'hot':'on',hot?{TQQQ:.1,BIL:.9}:{TQQQ:1});
    if(c.st.z==='off'||c.st.z==null){ c.st.z=hot?'part':'on'; return hot?{TQQQ:.1,BIL:.9}:{TQQQ:1}; }
    if(c.st.z==='part'&&!hot){ c.st.z='on'; const t=c.pos.TQQQ*x/c.total; return {TQQQ:1}; }
    if(!hot&&c.pos.BIL>0&&c.st.z==='on'){ return {TQQQ:1}; }   // 입금으로 생긴 BIL 을 10% 안으로 오면 TQQQ 로
    return null; }});
S.AGI24=agi24(false); S.AGI24a=agi24(true);
// 2025-10-02 '[Official]' 판: 200일선 아래 = 전부 팔고 SGOV(대용 BIL) 100% · 선 ~ +5% = SGOV → TQQQ · 새 돈 TQQQ · SPLG(대용 SPY) 는 그대로 · +5% 위 = TQQQ 그대로 · 새 돈 SPLG
//    진입은 이틀 연속 선 위(해석 B: 구간과 무관 — +5% 구간은 새 돈의 행선지) · core = 익절·손절 없음('최소 원칙') · full = 단계 익절(평단 +10% · +25% · +50% 에 각 보유 10% · 평단의 2·3·4…배마다 남은 것 50% → SPLG) + 평단 −5% 손절(미리 걸어 둔 매도 → 당일 저가로 체결 · SPLG 도 팔고 SGOV · 다시 들어가려면 선 아래로 한 번 내려갔다 이틀 위 — 해석)
const agi25=full=>({name:'아기티큐 2025'+(full?' (익절·손절)':' (구간만)'),syms:['TQQQ','SPY','BIL'],syn:{TQQQ:'SYNTQQQ',SPY:'SYNSPY',BIL:'SYNBIL'},
  intraday:full?(d=>{ const q=d.pos.TQQQ; if(!(q>0)) return []; const a=d.avg('TQQQ'), b=d.bar('TQQQ'), st=d.st, out=[];
      const stop=a*.95; if(b.l<=stop){ st.stopped=true; st.needCross=true; return [{s:'TQQQ',q:-q,px:Math.min(b.o,stop)}]; }
      let left=q; const lv=[[1.10,'t10'],[1.25,'t25'],[1.50,'t50']];
      for(const [k,f] of lv){ if(!st[f]&&b.h>=a*k){ st[f]=true; const n=Math.floor(q*.1); if(n>0){ out.push({s:'TQQQ',q:-n,px:Math.max(b.o,a*k)}); left-=n; } } }
      let mul=st.mul||2; while(b.h>=a*mul&&left>1){ const n=Math.floor(left*.5); out.push({s:'TQQQ',q:-n,px:Math.max(b.o,a*mul)}); left-=n; mul++; } st.mul=mul;
      return out; }):null,
  deposit:c=>{ const m=H.sma(c,'TQQQ',200), x=H.px(c,'TQQQ'); if(m==null||x<m||!(c.pos.TQQQ>0)) return {BIL:1}; return x>m*1.05?{SPY:1}:{TQQQ:1}; },
  decide:c=>{ const m=H.sma(c,'TQQQ',200), x=H.px(c,'TQQQ'); if(m==null) return null; const st=c.st;
    st.ab2=x>=m?(st.ab1?true:false):false; st.ab1=x>=m;
    const val=s=>c.pos[s]*H.px(c,s), tot=c.total;
    if(x<m){ st.needCross=false; for(const f of ['t10','t25','t50','mul']) delete st[f]; if(c.pos.TQQQ>0||c.pos.SPY>0||st.stopped){ st.stopped=false; return {BIL:1}; } return c.first?{BIL:1}:null; }
    if(st.stopped){ st.stopped=false; return {BIL:1}; }                                   // 손절 날 SPLG 도 정리
    if(full&&c.cash>1&&c.pos.TQQQ>0&&!st.needCross){ const w={TQQQ:val('TQQQ')/tot,SPY:(val('SPY')+c.cash)/tot,BIL:val('BIL')/tot}; return w; }   // 익절 현금 → SPLG
    if(st.needCross) return null;
    // 진입 = 이틀 연속 선 위(구간과 무관 · 해석 B) — 글자 그대로 '선 ~ +5% 에서만 SGOV → TQQQ' 로 읽으면 2020-03 매도 뒤 2023-02 에야 다시 사 원문의 연 25% 주장과 맞지 않는다(11-12 확인)
    if(!(c.pos.TQQQ>0)){ if(st.ab2){ for(const f of ['t10','t25','t50','mul']) delete st[f]; return {TQQQ:(tot-val('SPY'))/tot,SPY:val('SPY')/tot}; } return c.first?{BIL:1}:null; }
    if(x<=m*1.05&&c.pos.BIL>0) return {TQQQ:(val('TQQQ')+val('BIL')+c.cash)/tot,SPY:val('SPY')/tot};   // 구간 안: SGOV → TQQQ
    return null; }});
S.AGI25c=agi25(false); S.AGI25=agi25(true);
// ── 가속 듀얼 모멘텀(Engineered Portfolio 2018 · 국내 '가속 듀얼모멘텀'): 1+3+6개월 수익 합이 SPY·SCZ 중 높은 쪽이 > 0 이면 그것 · 아니면 TLT · 월간
S.ADM={name:'가속 듀얼 모멘텀',syms:['SPY','SCZ','TLT'],decide:c=>{ if(!c.newMonth) return null; const sc=s=>{ const r=[1,3,6].map(m=>H.ret(c,s,m)); return r.some(x=>x==null)?null:r[0]+r[1]+r[2]; };
  const a=sc('SPY'), b=sc('SCZ'); if(a==null||b==null) return null; const [k,v]=a>=b?['SPY',a]:['SCZ',b]; return v>0?{[k]:1}:{TLT:1}; }};
// ── Faber GTAA5(2007 · 2013 개정): SPY EFA IEF VNQ DBC 20% 씩 — 달 끝 값이 10개월 평균 위일 때만 · 아래면 그 몫 T-bill(BIL) · 월간
S.GTAA={name:'Faber GTAA 5',syms:['SPY','EFA','IEF','VNQ','DBC','BIL'],decide:c=>{ if(!c.newMonth) return null; const W={BIL:0};
  for(const s of ['SPY','EFA','IEF','VNQ','DBC']){ const e=H.monthEnds(c,s,10); if(!e) return null; const on=e[0]>e.reduce((a,b)=>a+b,0)/10; if(on) W[s]=.2; else W.BIL+=.2; } return W; }};
// ── 11-13 3차용 틀(값은 출처 조사로 정해 S 에 등록) ──
// 레버리지 모멘텀 교체: 달마다 후보 중 m개월 총수익(가중치 w 로 여러 기간 합 가능) 1등 · 1등 점수 ≤ 0(또는 cash 보다 낮으면) cash · trend=n 이면 그 종목 신호 지수가 n일선 아래면 제외
const lmr=({name,cands,months=[3],w=null,cash='BIL',sig=null,trend=0,syn=null,absVsCash=false})=>({name,syn,syms:[...new Set([...cands,cash,...(sig?Object.values(sig):[])])],
  decide:c=>{ if(!c.newMonth) return null; const sc=s=>{ let t=0; for(let i=0;i<months.length;i++){ const r=H.ret(c,s,months[i]); if(r==null) return null; t+=(w?w[i]:1)*r; } return t; };
    let best=null; for(const s of cands){ const v=sc(s); if(v==null) return null; if(trend){ const k=(sig&&sig[s])||s, m=H.sma(c,k,trend,true), x=H.px(c,k,true); if(m==null||x<m) continue; } if(!best||v>best[1]) best=[s,v]; }
    const cv=absVsCash?sc(cash):0; if(!best||best[1]<=Math.max(0,cv??0)) return {[cash]:1}; return {[best[0]]:1}; }});
// 골든크로스: 신호 지수 SMA(fast) > SMA(slow) 이면 레버리지 · 아니면 cash · 일간(바뀔 때만)
const gx=({name,sig,lev,fast=50,slow=200,cash='BIL',syn=null})=>({name,syn,syms:[...new Set([sig,lev,cash])],
  decide:c=>{ const f=H.sma(c,sig,fast,true), sl=H.sma(c,sig,slow,true); if(f==null||sl==null) return null; return once(c,'on',f>sl,f>sl?{[lev]:1}:{[cash]:1}); }});
// RSI 단기 되돌림(Connors 꼴): 추세 위(신호 지수 > SMA(trend))에서 RSI(n) < entry 면 레버리지 매수 · 나가는 건 exit='sma5'(종가 > SMA5) 또는 RSI > exitRsi · 그 밖은 cash
const rsiMR=({name,sig,lev,n=2,entry=10,exit='sma5',exitRsi=70,trend=200,cash='BIL',syn=null,stopBelowTrend=false})=>({name,syn,syms:[...new Set([sig,lev,cash])],
  decide:c=>{ const r=H.rsi(c,sig,n), x=H.px(c,sig), m=trend?H.sma(c,sig,trend):0; if(r==null||(trend&&m==null)) return null; let on=!!c.st.on;
    if(!on){ if(r<entry&&(!trend||x>m)) on=true; } else { const out=exit==='sma5'?x>H.sma(c,sig,5):r>exitRsi; if(out||(stopBelowTrend&&trend&&x<m)) on=false; }
    if(c.first) return (c.st.on=on, on?{[lev]:1}:{[cash]:1}); return once(c,'on',on,on?{[lev]:1}:{[cash]:1}); }});
// ════ 11-13 시중 매매법 3차(사전 등록 그대로) ════
// EU 이평 교차: 신호 종목의 fast일 평균 > slow일 평균이면 lev · 아니면 cash(일간 · 바뀔 때만 · 전일 신호 → 당일 종가)
const ma2=({name,sig,lev,fast,slow,cash='BIL',syn})=>({name,syn,syms:[...new Set([sig,lev,cash])],decide:c=>{ const f=H.sma(c,sig,fast), sl=H.sma(c,sig,slow); if(f==null||sl==null) return null; return once(c,'on',f>sl,f>sl?{[lev]:1}:{[cash]:1}); }});
const sTQ={TQQQ:'SYNTQQQ',BIL:'SYNBIL'}, sQTQ={QQQ:'SYNQQQ',TQQQ:'SYNTQQQ',BIL:'SYNBIL'};
S.EU219=ma2({name:'eulb 3/219 TQQQ',sig:'TQQQ',lev:'TQQQ',fast:3,slow:219,syn:sTQ}); S.EU220=ma2({name:'eulb 3/220',sig:'TQQQ',lev:'TQQQ',fast:3,slow:220,syn:sTQ});
S.EU229=ma2({name:'eulb 3/229',sig:'TQQQ',lev:'TQQQ',fast:3,slow:229,syn:sTQ}); S.EUQ161=ma2({name:'eulb QQQ 3/161',sig:'QQQ',lev:'TQQQ',fast:3,slow:161,syn:sQTQ});
for(const n of [160,180,200,240]) S['EU'+n]=ma2({name:'3/'+n+' TQQQ(고원)',sig:'TQQQ',lev:'TQQQ',fast:3,slow:n,syn:sTQ});
// TQ50: 해마다 한 번(기본 12-27 이후 첫 거래일 · mo 를 주면 그달 첫 거래일) TQQQ w · BIL 1−w · 입금은 그 비중대로 사기만
const tqx=({name,w,mo=null})=>({name,syn:sTQ,syms:['TQQQ','BIL'],decide:c=>{ const y=c.date.slice(0,4); const due=mo?(c.newMonth&&+c.date.slice(5,7)===mo):(c.date.slice(5)>='12-27'); if(c.first||(due&&c.st.y!==y)){ c.st.y=y; return {TQQQ:w,BIL:1-w}; } return null; }});
S.TQ50=tqx({name:'TQQQ 50:50 연 1회(12-27)',w:.5}); S.TQ60=tqx({name:'TQQQ 60:40 연 1회',w:.6}); S.TQ70=tqx({name:'TQQQ 70:30 연 1회',w:.7});
for(const m of [1,4,7]) S['TQ50m'+m]=tqx({name:'TQQQ 50:50 '+m+'월',w:.5,mo:m});
// VG 변동성 관문: 전일 VIX(VXN) 60일 평균 > 지수 n일 실현변동성 이면 레버리지 · 아니면 BIL(매일)
const vg=({name,vol='VIX',idx='SPY',lev='UPRO',n=10,trend=0,syn})=>({name,syn,syms:[...new Set([idx,lev,'BIL'])],decide:c=>{ const v=H.sma(c,vol,60), r=H.rv(c,idx,n); if(v==null||r==null) return null; let on=v>r; if(trend){ const m=H.sma(c,idx,trend,true); if(m==null) return null; on=on&&H.px(c,idx,true)>m; } return once(c,'on',on,on?{[lev]:1}:{BIL:1}); }});
const sVG={SPY:'SYNSPY',UPRO:'SYNUPRO',BIL:'SYNBIL'};
S.VG=vg({name:'변동성 관문 VIX60>SPY RV10 → UPRO',syn:sVG}); S.VG20=vg({name:'변동성 관문 RV20 → UPRO',n:20,syn:sVG});
S.VGT=vg({name:'변동성 관문 VXN60>QQQ RV10 → TQQQ',vol:'VXN',idx:'QQQ',lev:'TQQQ'}); S.VGT2=vg({name:'관문 + QQQ 200일선 → TQQQ',vol:'VXN',idx:'QQQ',lev:'TQQQ',trend:200});
// FTLT(Composer Reddit 판) — 매일 · 전일 신호 → 당일 종가 · alt=BIL 이면 UVXY 자리를 BIL 로
const ftlt=({name,alt='UVXY'})=>({name,syms:[...new Set(['SPY','TQQQ','SPXL','TECL','UPRO','SQQQ','TLT','BIL',alt])],decide:c=>{
  const r=(s)=>H.rsi(c,s,10), spy=H.px(c,'SPY'), m200=H.sma(c,'SPY',200), tq=H.px(c,'TQQQ'), m20=H.sma(c,'TQQQ',20); if(m200==null||m20==null) return null;
  const R={TQQQ:r('TQQQ'),SPXL:r('SPXL'),SPY:r('SPY'),SQQQ:r('SQQQ'),TLT:r('TLT')}; if(Object.values(R).some(x=>x==null)) return null; let k;
  if(spy>m200) k=R.TQQQ>79?alt:R.SPXL>80?alt:'TQQQ';
  else k=R.TQQQ<31?'TECL':R.SPY<30?'UPRO':tq<m20?(R.SQQQ>=R.TLT?'SQQQ':'TLT'):R.SQQQ<31?'SQQQ':'TQQQ';
  return once(c,'k',k,{[k]:1}); }});
S.FTLT=ftlt({name:'FTLT(Composer)'}); S.FTLTb=ftlt({name:'FTLT UVXY→BIL',alt:'BIL'});
// SPY +4/−3% → TQQQ · 꺼진 동안 QQQ(원문)
S.LRS_N3q=Object.assign(lrs('SPY','TQQQ','QQQ',200,{up:.04,dn:.03}),{syn:{SPY:'SYNSPY',TQQQ:'SYNTQQQ',QQQ:'SYNQQQ'}}); S.LRS_N3q.name='SPY +4/−3% → TQQQ · 밖은 QQQ';
// Connors RSI(2) · Double 7's · 쌍 교체
S.RSI2=Object.assign(rsiMR({name:'Connors RSI(2)≤5 QQQ→TQQQ',sig:'QQQ',lev:'TQQQ',n:2,entry:5.0001,exit:'sma5',trend:200}),{syn:sQTQ});
S.RSI2b=Object.assign(rsiMR({name:'Connors RSI(2)≤10',sig:'QQQ',lev:'TQQQ',n:2,entry:10.0001,exit:'sma5',trend:200}),{syn:sQTQ});
S.D7={name:"Double 7's QQQ→TQQQ",syn:sQTQ,syms:['QQQ','TQQQ','BIL'],decide:c=>{ const x=H.px(c,'QQQ'), m=H.sma(c,'QQQ',200), lo=H.loN(c,'QQQ',7), hi=H.hiN(c,'QQQ',7); if(m==null||lo==null) return null; let on=!!c.st.on;
  if(!on){ if(x>m&&x<=lo) on=true; } else if(x>=hi) on=false; if(c.first) return (c.st.on=on,on?{TQQQ:1}:{BIL:1}); return once(c,'on',on,on?{TQQQ:1}:{BIL:1}); }};
S.PS={name:'쌍 교체 SPY/TLT 3개월 → UPRO/TMF 분기',syn:{SPY:'SYNSPY',TLT:'SYNTLT',UPRO:'SYNUPRO',TMF:'SYNTMF'},syms:['SPY','TLT','UPRO','TMF'],decide:c=>{ if(!(c.first||c.newQuarter)) return null; const a=H.ret(c,'SPY',3), b=H.ret(c,'TLT',3); if(a==null||b==null) return null; return a>=b?{UPRO:1}:{TMF:1}; }};
// 11-14 달력 규칙(원문 값) — 거래소 달력은 미리 알려져 있어 '오늘이 그달 마지막(앞) 거래일인가'는 룩어헤드가 아니다(체결 = 그날 종가).
// Halloween(Bouman & Jacobsen 2002 · AER 92(5)) — 11~4월 보유 · 5~10월 단기국채: 10월 마지막 거래일 종가에 사고 4월 마지막 거래일 종가에 판다.
const _lastTD=c=>{ const nx=c.cal[c.i+1]; return !nx||nx.slice(0,7)!==c.date.slice(0,7); };
function hal(name,risk,safe,syn){ return {name,syn,syms:[risk,safe],decide:c=>{ const m=c.date.slice(5,7), L=_lastTD(c);
  if(c.first){ const on=(['11','12','01','02','03'].includes(m))||(m==='04'&&!L)||(m==='10'&&L); c.st.on=on; return on?{[risk]:1}:{[safe]:1}; }
  if(L&&m==='10'&&!c.st.on){ c.st.on=true; return {[risk]:1}; }
  if(L&&m==='04'&&c.st.on){ c.st.on=false; return {[safe]:1}; }
  return null; }}; }
S.HAL_TQ=hal('Halloween 11~4월 TQQQ · 5~10월 BIL','TQQQ','BIL',{TQQQ:'SYNTQQQ',BIL:'SYNBIL'});
S.HAL_Q=hal('Halloween 11~4월 QQQ · 5~10월 BIL','QQQ','BIL',{QQQ:'SYNQQQ',BIL:'SYNBIL'});
// 월말·월초(McConnell & Xu 2008 · FAJ 64(2)) — 그달 마지막 거래일 ~ 다음 달 셋째 거래일(4일)만 보유: 마지막 앞 거래일 종가에 사고 셋째 거래일 종가에 판다.
function tom(name,risk,safe,syn){ return {name,syn,syms:[risk,safe],decide:c=>{ const ym=c.date.slice(0,7), n1=c.cal[c.i+1], n2=c.cal[c.i+2];
  const pre=!!n1&&n1.slice(0,7)===ym&&(!n2||n2.slice(0,7)!==ym);   // 내일이 그달 마지막 거래일
  let k=0; for(let j=c.i;j>=0&&c.cal[j].slice(0,7)===ym;j--) k++;   // 오늘이 그달 몇째 거래일
  if(c.first){ const on=pre||_lastTD(c)||k<3; c.st.on=on; return on?{[risk]:1}:{[safe]:1}; }
  if(pre&&!c.st.on){ c.st.on=true; return {[risk]:1}; }
  if(k===3&&c.st.on){ c.st.on=false; return {[safe]:1}; }
  return null; }}; }
S.TOM_TQ=tom('월말·월초 4일 TQQQ · 나머지 BIL','TQQQ','BIL',{TQQQ:'SYNTQQQ',BIL:'SYNBIL'});
module.exports={S,m13612,smaRel,avg4,lmr,gx,rsiMR};
