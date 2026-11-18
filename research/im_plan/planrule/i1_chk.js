// I1(기대 인플레 다이얼) 확인: ① 신호 늦춤(1 · 5 · 21 관측일) ② 전 구간(2011-04~) 해마다 v1.1 대비 세전 수익 차 ③ 신호가 켜진 날 비율
const PR='/home/user/jkquant/research/im_plan/planrule'; process.chdir(PR);
const fs=require('fs'),path=require('path'); const {afterTax}=require(PR+'/aftertax');
const DD=path.join('..','data'), PD='data';
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const csv=f=>{ const o={}; fs.readFileSync(path.join(DD,f+'.csv'),'utf8').trim().split('\n').slice(1).forEach(l=>{ const [d,v]=l.split(','); if(v!==''&&v!=='.'&&!isNaN(+v)) o[d]=+v; }); return o; };
function idxOf(ks){ return d=>{ let lo=0,hi=ks.length-1,a=-1; while(lo<=hi){ const md=(lo+hi)>>1; if(ks[md]<=d){ a=md; lo=md+1; } else hi=md-1; } return a; }; }
const BE=csv('T10YIE'); function lastV(map,lag=0){ const ks=Object.keys(map).sort(), ix=idxOf(ks); return d=>{ const k=ix(d)-lag; return k<0?null:map[ks[k]]; }; }
const be2=(hiT,loT,lag=0)=>{ const g=lastV(BE,lag); return d=>{ const x=g(d); if(x==null) return null; if(x>=hiT) return .50; if(x<=loT) return .60; return null; }; };
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const V={}; for(const lag of [0,1,5,21]) V['I1_'+lag]=Object.assign({},BASE,{panic:PAN},{s0:be2(2.5,1.75,lag)});
const E=require(PR+'/engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const run=(rules,s,e,P,M)=>E.replay({horizon:5,rules,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div,vix:VIXr,vxn:VXNr});
const ann=(R)=>{ const a=afterTax(R); return (Math.pow(Math.max(1e-9,1+a.tr/100),1/R.stats.yrs)-1)*100; };
// ① 늦춤 — 실제 5년 창 2.5만+210 · 1만
for(const [P,M,nm] of [[25000,210,'2.5만'],[10000,0,'1만']]){ const d={0:[],1:[],5:[],21:[]};
  for(let s='2011-04-01'; addM(s,60)<='2026-11-18'; s=addM(s,1)){ const e=addM(s,60); const b=run('panic',s,e,P,M); if(!b.stats) continue; const ab=ann(b);
    for(const lag of [0,1,5,21]){ const r=run('I1_'+lag,s,e,P,M); d[lag].push(ann(r)-ab); } }
  console.log('늦춤 '+nm+': '+[0,1,5,21].map(l=>'lag'+l+' 중앙 '+qq(d[l],.5).toFixed(2)+'(낮은 창 '+d[l].filter(x=>x<0).length+')').join(' · ')); }
// ② 전 구간 해마다 — 1만$ 거치 2011-04-01~2026-11-18
{ const b=run('panic','2011-04-01','2026-11-18',10000,0), r=run('I1_0','2011-04-01','2026-11-18',10000,0);
  const yv=R=>{ const o={}; let prev=null, py=null; for(const n of R.nav){ const y=n.date.slice(0,4); if(py!==y){ if(prev!=null&&py) o[py].end=prev; o[y]={start:prev??+n.total}; py=y; } prev=+n.total; } o[py].end=prev; return o; };
  const A=yv(b), B=yv(r); console.log('전 구간 해마다 세전 수익(v1.1 → I1 · 차):', Object.keys(A).map(y=>y+' '+((A[y].end/A[y].start-1)*100).toFixed(0)+'→'+((B[y].end/B[y].start-1)*100).toFixed(0)+'('+(((B[y].end/B[y].start)-(A[y].end/A[y].start))*100>=0?'+':'')+(((B[y].end/B[y].start)-(A[y].end/A[y].start))*100).toFixed(1)+')').join(' · '));
  console.log('전 구간 끝값 v1.1 '+b.nav[b.nav.length-1].total.toFixed(0)+' · I1 '+r.nav[r.nav.length-1].total.toFixed(0)+' · MDD '+b.stats.mdd.toFixed(1)+' → '+r.stats.mdd.toFixed(1)); }
// ③ 신호 켜진 비율(실제 거래일 2011-04~)
{ const g=lastV(BE); const ds=T.days.map(x=>x.date).filter(d=>d>='2011-04-01'); let hi=0,lo=0; const by={}; for(const d of ds){ const x=g(d); const y=d.slice(0,4); by[y]=by[y]||[0,0,0]; by[y][2]++; if(x>=2.5){ hi++; by[y][0]++; } else if(x<=1.75){ lo++; by[y][1]++; } }
  console.log('켜진 날: 높음(≥2.5 → .50) '+(hi/ds.length*100).toFixed(1)+'% · 낮음(≤1.75 → .60) '+(lo/ds.length*100).toFixed(1)+'% | 해마다 높음/낮음 %: '+Object.keys(by).map(y=>y+' '+(by[y][0]/by[y][2]*100).toFixed(0)+'/'+(by[y][1]/by[y][2]*100).toFixed(0)).join(' · ')); }
