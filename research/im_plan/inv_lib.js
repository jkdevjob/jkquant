// 인버스/롱 거래대금 비율 연구(11-10) 공용 — 거래대금 = Eastmoney 실제 거래대금(data/e_SYM.json · 2017-07~) · 가격 = Yahoo 분할·배당 반영 종가(data/y_SYM.json). 자료는 fetch_inv.sh 로 받는다(저장소에 안 올린다).
// Yahoo 일봉(분할 반영 종가 · 분할 반영 거래량) → 날짜별 {c 종가, v 거래량, dv 거래대금(종가×거래량 — 분할 보정이 서로 지워져 그날의 실제 달러)}
const fs=require('fs'),path=require('path');
function load(sym){const j=JSON.parse(fs.readFileSync(path.join(__dirname,'data','y_'+sym+'.json'),'utf8')).chart.result[0],q=j.indicators.quote[0],adj=(j.indicators.adjclose||[{}])[0].adjclose||[];
  const out=[];for(let i=0;i<j.timestamp.length;i++){const c=q.close[i],v=q.volume[i];if(!(c>0))continue;const d=new Date((j.timestamp[i]+j.meta.gmtoffset)*1000).toISOString().slice(0,10);
    out.push({date:d,c,o:q.open[i],h:q.high[i],l:q.low[i],v:v||0,dv:c*(v||0),ac:adj[i]>0?adj[i]:c});}
  return out;}
const byDate=a=>new Map(a.map(x=>[x.date,x]));
const q=(a,p)=>{const s=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!s.length)return NaN;const i=(s.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return s[l]+(s[h]-s[l])*(i-l);};
function amt(sym){const m=new Map();JSON.parse(fs.readFileSync(path.join(__dirname,'data','e_'+sym+'.json'),'utf8')).data.klines.forEach(l=>{const p=l.split(',');if(+p[6]>0)m.set(p[0],+p[6]);});return m;}
// 짝(인버스 inv · 롱 lng · 지수 idx) → 날짜순 행 {date, r 비율, L 롱 수정종가, X 지수 수정종가, ddX 지수 전고점 대비, ddL}
function pair(inv,lng,idx,from){const A=amt(inv),B=amt(lng),L=load(lng),X=byDate(load(idx));let pkL=0,pkX=0;const out=[];
  for(const z of L){const x=X.get(z.date);if(!x)continue;pkL=Math.max(pkL,z.ac);pkX=Math.max(pkX,x.ac);
    if(z.date<from||!A.has(z.date)||!B.has(z.date))continue;out.push({date:z.date,r:A.get(z.date)/B.get(z.date),a:A.get(z.date),b:B.get(z.date),L:z.ac,X:x.ac,ddL:z.ac/pkL-1,ddX:x.ac/pkX-1});}
  return out;}
module.exports={amt,pair,q,load,byDate};
