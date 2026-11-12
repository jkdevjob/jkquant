// 시중 매매법 합성 자료(11-12) — synth.js 와 같은 비용 식: 일 수익 = 배수×기초 총수익 − (보수 + (배수−1)×T-bill)/252
//   SYNUPRO = SPY 조정 종가(총수익 · 1993~) × 3 − 2.45% · SYNSSO = SPY × 2 − 1.70% (실제와 맞춘 비용)
//   SYNTMF = TLT 조정 종가(2002-07~) · 그 전 SYNTLT(만기 25년 금리 합성 · 1998-12~) × 3 − 1.9%
//   SYNAGG = AGG(2003-09~) · 그 전 SYNIEF(만기 8.5년 · 대용) · SYNSPY = SPY 조정 종가(그대로 · 신호용)
// 검증: 겹치는 기간(실제 UPRO 2009-06~ · TMF 2009-04~ · SSO 2006-06~) 연복리 · 최대 낙폭을 실제와 견준다.
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'..','data');
const ser=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series.filter(x=>x.close>0).sort((a,b)=>a.date<b.date?-1:1);
const irx={}; ser('IRX').forEach(x=>irx[x.date]=x.close);
function chain(primary,fallback){ const P=ser(primary); const p0=P[0].date; if(!fallback) return P; const F=ser(fallback).filter(x=>x.date<=p0); const k=P[0].close/F[F.length-1].close; return F.slice(0,-1).map(x=>({date:x.date,close:x.close*k})).concat(P); }
function lev(base,L,fee,out){ let last=0, px=100, prev=null; const rows=[];
  for(const x of base){ if(irx[x.date]!=null) last=irx[x.date]; if(prev==null){ prev=x.close; rows.push({date:x.date,close:px}); continue; }
    px=Math.max(1e-6,px*(1+L*(x.close/prev-1)-(fee+(L-1)*last/100)/252)); prev=x.close; rows.push({date:x.date,close:px}); }
  fs.writeFileSync(path.join(D,out+'.json'),JSON.stringify({symbol:out,src:'synthetic',series:rows,ohlcTrade:rows,dividends:[]})); return rows; }
function plain(base,out){ fs.writeFileSync(path.join(D,out+'.json'),JSON.stringify({symbol:out,src:'synthetic',series:base,ohlcTrade:base,dividends:[]})); return base; }
const SPY=ser('SPY'), TLTc=chain('TLT','SYNTLT'), AGGc=chain('AGG','SYNIEF');
const U=lev(SPY,3,.0095+.015,'SYNUPRO'), S2=lev(SPY,2,.009+.008,'SYNSSO'), T3=lev(TLTc,3,.010+.009,'SYNTMF');   // 실제와 맞추려 UPRO +1.5% · SSO +0.8% · TMF +0.9%p 비용 추가(스와프 금리가 T-bill 보다 높음) plain(AGGc,'SYNAGG'); plain(SPY,'SYNSPY');
const cmp=(syn,real,from)=>{ const R=ser(real), m={}; syn.forEach(x=>m[x.date]=x.close); const a=R.find(x=>x.date>=from&&m[x.date]), b=[...R].reverse().find(x=>m[x.date]);
  const y=(Date.parse(b.date)-Date.parse(a.date))/(365.25*864e5), cr=(Math.pow(b.close/a.close,1/y)-1)*100, cs=(Math.pow(m[b.date]/m[a.date],1/y)-1)*100;
  const dd=arr=>{ let pk=0,md=0; arr.forEach(v=>{ if(v>pk)pk=v; else md=Math.max(md,(pk-v)/pk); }); return md*100; };
  const rs=R.filter(x=>x.date>=a.date&&m[x.date]); console.log(`${real} ${a.date}~${b.date}: 실제 ${cr.toFixed(1)}% · 합성 ${cs.toFixed(1)}% · MDD 실제 ${dd(rs.map(x=>x.close)).toFixed(1)} · 합성 ${dd(rs.map(x=>m[x.date])).toFixed(1)}`); };
cmp(U,'UPRO','2009-07-01'); cmp(T3,'TMF','2009-05-01'); cmp(S2,'SSO','2006-07-01');
console.log('SYNUPRO',U[0].date,'SYNTMF',T3[0].date);
