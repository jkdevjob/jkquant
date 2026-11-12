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
// ── 레버리지 회전(Gayed·Bilello 2016 'Leverage for the Long Run'): 지수 > 200일선이면 레버리지, 아니면 T-bill · 일간
const lrs=(sig,lev,cash='BIL',n=200,band=0)=>({name:`${sig} ${n}일선 → ${lev}`+(band?` ±${band*100}%`:''),syms:[sig,lev,cash].filter((x,i,a)=>a.indexOf(x)===i),
  decide:c=>{ const m=H.sma(c,sig,n), x=H.px(c,sig); if(m==null) return null; let on=c.st.on; if(c.first) on=x>m; else if(!on&&x>m*(1+band)) on=true; else if(on&&x<m*(1-band)) on=false;
    return once(c,'on',on,on?{[lev]:1}:{[cash]:1}); }});
S.LRS_N3=lrs('QQQ','TQQQ'); S.LRS_S3=lrs('SPY','UPRO'); S.LRS_S2=lrs('SPY','SSO'); S.LRS_N2=lrs('QQQ','QLD');
// ── 듀얼 모멘텀 GEM(Antonacci 2014): 미국 12개월 총수익 > T-bill 이면 미국·미국 밖 중 12개월 높은 쪽, 아니면 미국 채권 · 월간
S.GEM={name:'듀얼 모멘텀 GEM',syms:['SPY','EFA','AGG','BIL'],decide:c=>{ if(!c.newMonth) return null; const u=H.ret(c,'SPY',12), x=H.ret(c,'EFA',12), b=H.ret(c,'BIL',12); if(u==null||x==null||b==null) return null;
  return u>b?(u>=x?{SPY:1}:{EFA:1}):{AGG:1}; }};
// ── VAA-G4(Keller·Keuning 2017): 13612W · 공격 SPY EFA EEM AGG 모두 > 0 이면 가장 높은 공격 1개, 아니면 방어 LQD IEF SHY 중 가장 높은 1개 · 월간
S.VAA={name:'VAA 공격형(G4)',syms:['SPY','EFA','EEM','AGG','LQD','IEF','SHY'],decide:c=>{ if(!c.newMonth) return null; const O=['SPY','EFA','EEM','AGG'], Dd=['LQD','IEF','SHY'];
  const om=O.map(s=>m13612(c,s)); if(om.some(x=>x==null)) return null; const pick=om.every(x=>x>0)?best(c,O,m13612)[0][0]:best(c,Dd,m13612)[0][0]; return {[pick]:1}; }};
// ── BAA-G4 공격형(Keller 2022): 카나리아 SPY EEM EFA AGG(13612W) 하나라도 < 0 이면 방어 — TIP DBC BIL IEF TLT LQD AGG 중 SMA(12) 상대 모멘텀 상위 3(BIL 보다 낮으면 BIL) 1/3씩 · 아니면 QQQ EEM EFA AGG 중 상위 1 · 월간
S.BAA={name:'BAA 공격형(G4)',syms:['SPY','QQQ','EEM','EFA','AGG','TIP','DBC','BIL','IEF','TLT','LQD'],decide:c=>{ if(!c.newMonth) return null;
  const can=['SPY','EEM','EFA','AGG'].map(s=>m13612(c,s)); if(can.some(x=>x==null)) return null;
  if(can.every(x=>x>=0)){ const b=best(c,['QQQ','EEM','EFA','AGG'],smaRel); return b.length?{[b[0][0]]:1}:null; }
  const bil=smaRel(c,'BIL'), top=best(c,['TIP','DBC','BIL','IEF','TLT','LQD','AGG'],smaRel).slice(0,3); const W={}; for(const [s,m] of top){ const k=(m<bil)?'BIL':s; W[k]=(W[k]||0)+1/3; } return W; }};
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
module.exports={S,m13612,smaRel,avg4};
