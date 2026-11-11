// 변동성 목표(s0)별 모습(11-11) — 앱 엔진 · 1e6 원금 · 세전: TECL 평균 비중 · 위기별 낙폭(고점→저점) · 지금 하락(9/23~) · 전체 · 기본/공포 모드
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data'); const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const BASEV={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const S0=[.55,.60,.65,.70,.80,1.0]; const V={}; for(const s of S0){ V['b'+s]=Object.assign({},BASEV,{s0:s}); V['p'+s]=Object.assign({},BASEV,{s0:s,panic:PAN,version:'1.1'}); }
const E=require('./engine_var').load(V); const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const ix=s=>rd(path.join(R,s+'.json')).series.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close}));
const X={T:q(path.join(D,'data','TECL.json')),Q:q(path.join(D,'data','TQQQ.json')),G:q(path.join(D,'data','SGOV.json'))}, VIX=ix('VIX'), VXN=ix('VXN');
const run=(k,s)=>E.replay({horizon:5,rules:k,startDate:s,endDate:'',principal:1e6,monthlyAdd:0,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix:VIX,vxn:VXN});
const dd=(nav,a,b)=>{ let pk=0,m=0; for(const n of nav){ if(n.date<a) { pk=Math.max(pk,n.total); continue; } if(n.date>b) break; pk=Math.max(pk,n.total); m=Math.max(m,1-n.total/pk); } return m*100; };
const CR=[['2018 4분기','2018-09-01','2018-12-31'],['2020-03','2020-02-01','2020-04-30'],['2022','2021-11-01','2022-12-31'],['2025-04','2025-02-01','2025-04-30']];
for(const fam of ['b','p']){ console.log(`\n■ ${fam==='b'?'기본 v1.0':'공포 모드 v1.1'} (2011-04~ · 1e6 · 세전)`);
  for(const s of S0){ const Rr=run(fam+s,'2011-04-01'), nav=Rr.nav; const avgT=nav.reduce((a,n)=>a+n.tecl*n.teclPx/n.total,0)/nav.length*100;
    const yrs=Rr.stats.yrs, cagr=(Math.pow(nav[nav.length-1].total/1e6,1/yrs)-1)*100;
    const cur=run(fam+s,'2026-09-23'); const c=cur.nav[cur.nav.length-1]; let pk=0,cm=0; for(const n of cur.nav){ pk=Math.max(pk,n.total); cm=Math.max(cm,1-n.total/pk); }
    console.log(`  s0 ${(s*100).toFixed(0)}%: TECL 평균 ${avgT.toFixed(0)}% · 세전 연 ${cagr.toFixed(1)}% · MDD ${Rr.stats.mdd.toFixed(1)}% · 위기 낙폭 `+CR.map(([n,a,b])=>n+' '+dd(nav,a,b).toFixed(0)).join(' · ')+` · 지금 하락(9/23~) ${((c.total/1e6-1)*100).toFixed(1)}%(낙폭 ${(cm*100).toFixed(0)} · 지금 TECL ${(c.tecl*c.teclPx/c.total*100).toFixed(0)}%)`); } }
