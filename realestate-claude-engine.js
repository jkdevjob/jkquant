/* 부동산(클로드) 엔진 — 분석 · 전략 · 모의장부 계산은 이 파일 한 곳에서만 한다.
   화면(realestate-claude.js) · 월간 모의장부 갱신(scripts/realestate_claude/paper.mjs) · 시험이 모두 이 파일을 쓴다.
   원자료: data/realestate/claude/series.json (scripts/realestate_claude/collect.py — 한국부동산원 R-ONE · 한국은행 ECOS)

   시점 규칙 (룩어헤드 금지)
   - 월간 지수 I[m] 은 m월 중순 조사 · m+1월 중순 공표된다.
   - 수익 r[k] = I[k]/I[k-1] - 1 은 (k-1)월 중순 → k월 중순 구간이다.
   - r[k] 에 걸 자리는 k-LAG(기본 2)월까지의 자료로만 정한다. I[k-2] 공표 직후((k-1)월 중순) 계약하는 셈이다.
   - 최소 보유(기본 24개월) 전에는 팔지 않는다 — 1주택 양도세 비과세 보유요건을 단순화한 것.
   - 전략 선택(워크포워드)도 그해 1월 결정 때 볼 수 있던 자료(1월-LAG 까지)만 쓴다.

   돈 계산 (기록이 스스로 말하게 — 수수료는 장부에 금액으로 남긴다)
   - 살 때 buyCost(취득세·중개·등기), 팔 때 sellCost(중개 등).
   - 보유 중: 가격변화 + 전세환산 임대가치(전세가율 × 예금금리 세후) − 보유세. rent:'none' 이면 가격만.
   - 현금: 정기예금 금리(세후). 전세환산 임대가치는 '집을 가진 쪽'과 '현금 쪽'의 주거비 차이를 같게 맞춘다.
*/
(function(g){
'use strict';

const VERSION='1.2.0';
/* 전략 버전 — 지난 장부는 그 버전 그대로 계속 쌓는다(덮어쓰지 않음). 새 장부·화면 기본은 STRATEGY_VERSION. */
const STRATEGIES=['rec-wf-1','rec-wf-2'];
const STRATEGY_VERSION='rec-wf-2';
const DJ=['dj_dong','dj_jung','dj_seo','dj_yuseong','dj_daedeok'];
const UNIVERSE=DJ.concat(['sejong']);
const DEFAULTS={
  lag:2, minHold:24,
  buyCost:.016,     // 취득세 1.1%(6억 이하 1주택) + 중개 0.4% + 등기 등 0.1%
  sellCost:.005,    // 중개 0.4% + 기타 0.1%
  holdCostYr:.0015, // 재산세 등(시가 대비 연)
  depositTax:.154,  // 이자소득세(지방세 포함)
  rent:'jeonse',    // 'jeonse' 전세환산 임대가치 포함 · 'none' 가격만
  capital:300000000,
  penalty:.25,      // 전략 선택 점수 = 연복리수익 − penalty × 최대낙폭
  minTrain:48,      // 워크포워드 최소 학습 개월
  zigzag:.03,       // 사이클 판정 반전 폭(사후 설명용)
  minInMarket:.1    // 학습 기간 보유 비율이 이보다 낮은 규칙은 '현금'과 같다고 보고 선택에서 뺀다
};

/* 참고 사건 — 설명용 표시(월 단위). 전략 계산에는 쓰지 않는다. */
const EVENTS=[
  {m:'1989-04',g:'공급',t:'1기 신도시(분당·일산 등) 건설 계획 발표'},
  {m:'1991-09',g:'공급',t:'1기 신도시 첫 입주(분당 시범단지)'},
  {m:'1993-08',g:'대전',t:'대전 엑스포 개막(1993.8~11)'},
  {m:'1997-11',g:'경제',t:'외환위기 — IMF 구제금융 신청'},
  {m:'2002-09',g:'세종',t:'대선 후보 신행정수도 건설 공약 발표'},
  {m:'2003-12',g:'세종',t:'신행정수도 특별법 국회 통과'},
  {m:'2004-10',g:'세종',t:'헌법재판소 신행정수도 특별법 위헌 결정'},
  {m:'2005-03',g:'세종',t:'행정중심복합도시 특별법 국회 통과'},
  {m:'2008-09',g:'경제',t:'글로벌 금융위기(리먼 브러더스 파산)'},
  {m:'2010-06',g:'세종',t:'세종시 수정안 국회 부결 — 원안 추진'},
  {m:'2011-05',g:'대전',t:'국제과학비즈니스벨트 거점지구 대전(신동·둔곡) 선정'},
  {m:'2012-07',g:'세종',t:'세종특별자치시 출범'},
  {m:'2012-12',g:'세종',t:'정부세종청사 1단계 부처 이전'},
  {m:'2017-08',g:'규제',t:'8·2 대책 — 세종 투기과열지구 지정'},
  {m:'2020-03',g:'금리',t:'코로나19 대응 기준금리 0.75% 인하(5월 0.50%)'},
  {m:'2020-06',g:'규제',t:'6·17 대책 — 대전 조정대상지역·투기과열지구 지정'},
  {m:'2020-07',g:'세종',t:'여당 원내대표 행정수도 이전 제안'},
  {m:'2021-08',g:'금리',t:'기준금리 인상 시작(0.50→0.75%)'},
  {m:'2021-09',g:'세종',t:'국회세종의사당 설치 국회법 개정안 통과'},
  {m:'2022-07',g:'금리',t:'기준금리 0.50%p 인상(빅스텝)'},
  {m:'2022-09',g:'규제',t:'대전 투기과열지구 해제'},
  {m:'2022-11',g:'규제',t:'대전 조정대상지역 해제'},
  {m:'2023-01',g:'규제',t:'세종 투기과열지구·조정대상지역 해제'}
];

/* ── 달 ── */
function ymk(s){ const m=/^(\d{4})-(\d{2})$/.exec(String(s)); if(!m) throw new Error('달 형식 오류: '+s); return (+m[1])*12+(+m[2]-1); }
function kym(k){ const y=Math.floor(k/12),m=k-y*12+1; return y+'-'+(m<10?'0':'')+m; }

/* ── 시계열 {k0, v} ── */
function ser(x){ return x&&x.start&&Array.isArray(x.v)?{k0:ymk(x.start),v:x.v}:null; }
function at(s,k){ if(!s) return null; const i=k-s.k0; if(i<0||i>=s.v.length) return null; const x=s.v[i]; return (x==null||!isFinite(x))?null:+x; }
function firstK(s){ if(!s) return null; for(let i=0;i<s.v.length;i++) if(s.v[i]!=null) return s.k0+i; return null; }
function lastK(s){ if(!s) return null; for(let i=s.v.length-1;i>=0;i--) if(s.v[i]!=null) return s.k0+i; return null; }
function upTo(s,k){ /* k 이하 마지막 값 */ if(!s) return null; for(let j=Math.min(k,lastK(s));j>=s.k0;j--){ const x=at(s,j); if(x!=null) return x; } return null; }
function chg(s,k,h){ const a=at(s,k),b=at(s,k-h); return (a==null||b==null||b===0)?null:a/b-1; }
function ret(s,k){ return chg(s,k,1); }
function sumWin(s,k,n){ let t=0; for(let j=k-n+1;j<=k;j++){ const x=at(s,j); if(x==null) return null; t+=x; } return t; }

function prepare(doc){
  const S=(doc&&doc.series)||{};
  const D={doc:doc||{},regions:(doc&&doc.regions)||{},macro:{}};
  for(const t of ['sale','jeonse','jratio','avgPrice','demand','volume','buyOutSeoul','buyOutOther','land','landQ',
    'kbSale','kbJeonse','kbJr','kbMarket','movein','unsold','permits','rtIndex']){
    D[t]={}; for(const r in (S[t]||{})){ const x=ser(S[t][r]); if(x) D[t][r]=x; }
  }
  for(const m in (S.macro||{})){ const x=ser(S.macro[m]); if(x) D.macro[m]=x; }
  const ends=DJ.map(r=>lastK(D.sale[r])).filter(x=>x!=null);
  D.lastK=ends.length?Math.min.apply(null,ends):null;
  D.peak={};
  for(const r in D.sale){ const s=D.sale[r],pk=new Array(s.v.length); let m=null;
    for(let i=0;i<s.v.length;i++){ const x=s.v[i]; if(x!=null&&(m==null||x>m)) m=x; pk[i]=m; }
    D.peak[r]={k0:s.k0,v:pk}; }
  return D;
}
function label(D,r){ return (D.regions[r]&&D.regions[r].label)||r; }

/* ── 지표 (t 월까지 자료만) ── */
function drawdown(D,r,t){ const v=at(D.sale[r],t),p=at(D.peak[r],t); return (v==null||p==null)?null:v/p-1; }
function jgap(D,r,t,h){ const a=chg(D.jeonse[r],t,h),b=chg(D.sale[r],t,h); return (a==null||b==null)?null:a-b; }
function rateChange(D,t,h){ const a=at(D.macro.baseRate,t),b=at(D.macro.baseRate,t-h); return (a==null||b==null)?null:a-b; }
function volGrowth(D,r,t){ const a=sumWin(D.volume[r],t,6),b=sumWin(D.volume[r],t-12,6); return (a==null||b==null||b<=0)?null:a/b-1; }
function outShare(D,r,t){ const tot=sumWin(D.volume[r],t,6),a=sumWin(D.buyOutSeoul[r],t,6),b=sumWin(D.buyOutOther[r],t,6);
  return (tot==null||a==null||b==null||tot<=0)?null:(a+b)/tot; }
/* 전세가율(%) — 공표치(2012~)가 있으면 그대로, 그 전은 첫 공표치에서 전세·매매 지수 비로 거꾸로 이어 붙인 추정 */
function jeonseRatio(D,r,t){
  const jr=D.jratio[r],v=at(jr,t); if(v!=null) return {v,est:false};
  const k1=firstK(jr); if(k1==null||t>k1) return null;
  const a=at(D.jeonse[r],t),b=at(D.sale[r],t),a1=at(D.jeonse[r],k1),b1=at(D.sale[r],k1),v1=at(jr,k1);
  if([a,b,a1,b1,v1].some(x=>x==null)||b===0||a1===0) return null;
  return {v:v1*(a/a1)/(b/b1),est:true};
}
/* 시 단위 자료(미분양·인허가·매수우위)는 대전 구에도 대전 값을 쓴다 */
function cityOf(r){ return /^dj_/.test(r)?'daejeon':r; }
/* 입주(KB): 시계열 범위 안의 빈 달은 0세대, 범위 밖은 모름 */
/* KB 입주 일정은 모든 지역이 같은 기간(가장 이른 달 ~ 가장 먼 예정 달)을 덮는다 — 그 안에서 기록이 없는 달은 0세대 */
function moveinRange(D){ if(D._mvR!==undefined) return D._mvR; let a=null,b=null;
  for(const r in D.movein){ const s=D.movein[r],f=firstK(s),l=lastK(s); if(f!=null&&(a==null||f<a)) a=f; if(l!=null&&(b==null||l>b)) b=l; }
  return (D._mvR=a==null?null:[a,b]); }
function moveinAt(D,r,k){ const s=D.movein[r],R=moveinRange(D); if(!s||!R||k<R[0]||k>R[1]) return null; const x=at(s,k); return x==null?0:x; }
function moveinSum(D,r,a,b){ let t=0; for(let k=a;k<=b;k++){ const x=moveinAt(D,r,k); if(x==null) return null; t+=x; } return t; }
/* 앞으로 12개월 입주(예정) ÷ 지난 10년 연평균. 지금 시점은 예정(분양 때 공개)이고, 과거 시점은 실제 입주로 대신한다(지연·취소 미반영). */
function supplyRatio(D,r,t){ const ahead=moveinSum(D,r,t+1,t+12),past=moveinSum(D,r,t-119,t); return (ahead==null||past==null||past<=0)?null:ahead/(past/10); }
/* 인허가는 그해 1월부터 누계로 온다 → 달마다 값으로 바꾼다 */
function permitsMonthly(D,r,k){ const s=D.permits[r],a=at(s,k); if(a==null) return null; const m=k-Math.floor(k/12)*12; if(m===0) return a; const b=at(s,k-1); return b==null?null:a-b; }
function permitsRatio(D,r,t){ let y=0; for(let k=t-11;k<=t;k++){ const x=permitsMonthly(D,r,k); if(x==null) return null; y+=x; }
  let p=0; for(let k=t-71;k<=t-12;k++){ const x=permitsMonthly(D,r,k); if(x==null) return null; p+=x; } return p<=0?null:y/(p/5); }
function unsoldChange(D,r,t){ const a=at(D.unsold[r],t),b=at(D.unsold[r],t-12); return (a==null||b==null||b<=0)?null:a/b-1; }
function features(D,r,t){
  const jr=jeonseRatio(D,r,t);
  return {mom3:chg(D.sale[r],t,3),mom6:chg(D.sale[r],t,6),mom12:chg(D.sale[r],t,12),
    jmom12:chg(D.jeonse[r],t,12),jgap12:jgap(D,r,t,12),jr:jr?jr.v:null,jrEst:jr?jr.est:null,
    dd:drawdown(D,r,t),rate12:rateChange(D,t,12),volG:volGrowth(D,r,t),out:outShare(D,r,t),
    demand:at(D.demand[r],t),supply:supplyRatio(D,r,t),unsold12:unsoldChange(D,cityOf(r),t),
    permits:permitsRatio(D,cityOf(r),t),market:at(D.kbMarket[cityOf(r)],t)};
}

/* 지가 긴 시계열: 2005년 전은 분기말 달의 분기 지수, 그 뒤는 월간 지수(같은 기준이라 그대로 잇는다) */
function landLong(D,r){
  const m=D.land[r],q=D.landQ[r]; if(!m&&!q) return null; if(!q) return m; if(!m) return q;
  const k0=Math.min(q.k0,m.k0),k1=Math.max(lastK(q),lastK(m)),v=[];
  for(let k=k0;k<=k1;k++){ const a=at(m,k); v.push(a!=null?a:at(q,k)); }
  return {k0,v};
}

/* ── 실질(물가 차감) 지수 ── */
function realSeries(s,cpi){
  if(!s||!cpi) return null; const base=upTo(cpi,lastK(s)); const v=[];
  for(let i=0;i<s.v.length;i++){ const k=s.k0+i,x=s.v[i],c=upTo(cpi,k); v.push(x==null||c==null?null:x/c*base); }
  return {k0:s.k0,v};
}

/* ── 사이클(사후 판정 · 설명용) — 고점·저점에서 zz 이상 되돌리면 전환으로 본다 ── */
function zigzag(s,th){
  const k0=firstK(s),kN=lastK(s); if(k0==null) return [];
  const piv=[{k:k0,v:at(s,k0),type:'start'}];
  let mode=0,hK=k0,hV=at(s,k0),lK=k0,lV=hV;
  for(let k=k0+1;k<=kN;k++){
    const v=at(s,k); if(v==null) continue;
    if(mode===0){
      if(v>hV){hV=v;hK=k;} if(v<lV){lV=v;lK=k;}
      if(hV>=lV*(1+th)&&hK>lK){ if(lK>k0) piv.push({k:lK,v:lV,type:'trough'}); mode=1; }
      else if(lV<=hV*(1-th)&&lK>hK){ if(hK>k0) piv.push({k:hK,v:hV,type:'peak'}); mode=-1; hK=lK; hV=lV; }
      continue;
    }
    if(mode===1){ if(v>hV){hV=v;hK=k;} else if(v<=hV*(1-th)){ piv.push({k:hK,v:hV,type:'peak'}); mode=-1; hK=k; hV=v; } }
    else { if(v<hV){hV=v;hK=k;} else if(v>=hV*(1+th)){ piv.push({k:hK,v:hV,type:'trough'}); mode=1; hK=k; hV=v; } }
  }
  const lastV=at(s,kN);
  if(mode!==0&&hK!==piv[piv.length-1].k) piv.push({k:hK,v:hV,type:mode===1?'peak':'trough',open:true});
  if(piv[piv.length-1].k!==kN) piv.push({k:kN,v:lastV,type:'now',open:true});
  return piv;
}
function cycles(D,r,o){
  o=Object.assign({},DEFAULTS,o||{});
  const src=o.src||'sale',s=D[src][r],J=D[src==='kbSale'?'kbJeonse':'jeonse'][r],piv=zigzag(s,o.zigzag),cpi=D.macro.cpi,out=[];
  for(let i=1;i<piv.length;i++){
    const a=piv[i-1],b=piv[i],months=b.k-a.k; if(months<=0) continue;
    const c=b.v/a.v-1,ca=upTo(cpi,a.k),cb=upTo(cpi,b.k);
    const real=(ca&&cb)?(b.v/cb)/(a.v/ca)-1:null;
    const ra=upTo(D.macro.baseRate,a.k),rb=upTo(D.macro.baseRate,b.k);
    const ja=at(J,a.k),jb=at(J,b.k);
    const f=src==='sale'?features(D,r,a.k):{rate12:rateChange(D,a.k,12),supply:supplyRatio(D,r,a.k),unsold12:unsoldChange(D,cityOf(r),a.k),market:at(D.kbMarket[cityOf(r)],a.k)};
    out.push({from:kym(a.k),to:kym(b.k),months,type:c>=0?'up':'down',open:!!b.open,change:c,
      cagr:Math.pow(1+c,12/months)-1,real,rateFrom:ra,rateTo:rb,
      jeonseChange:(ja&&jb)?jb/ja-1:null,atStart:{jgap12:f.jgap12,jr:f.jr,jrEst:f.jrEst,rate12:f.rate12,volG:f.volG,out:f.out,dd:f.dd,mom12:f.mom12,supply:f.supply,unsold12:f.unsold12,market:f.market}});
  }
  return out;
}

/* ── 원인 분석: 지표 → 이후 h개월 수익 (사후 통계 · 설명용) ── */
function mean(a){ return a.length?a.reduce((x,y)=>x+y,0)/a.length:null; }
function corr(x,y){ const n=x.length; if(n<3) return null; const mx=mean(x),my=mean(y); let sxy=0,sxx=0,syy=0;
  for(let i=0;i<n;i++){ const dx=x[i]-mx,dy=y[i]-my; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; }
  return (sxx<=0||syy<=0)?null:sxy/Math.sqrt(sxx*syy); }
function ranks(a){ const idx=a.map((v,i)=>[v,i]).sort((p,q)=>p[0]-q[0]),r=new Array(a.length);
  for(let i=0;i<idx.length;){ let j=i; while(j+1<idx.length&&idx[j+1][0]===idx[i][0]) j++; const rk=(i+j)/2+1; for(let t=i;t<=j;t++) r[idx[t][1]]=rk; i=j+1; } return r; }
function quantile(sorted,q){ if(!sorted.length) return null; const p=(sorted.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p); return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo); }
const FACTORS=[
  {id:'mom12',label:'최근 12개월 상승률',fmt:'pct',hi:'많이 오름',lo:'내림'},
  {id:'mom3',label:'최근 3개월 상승률',fmt:'pct',hi:'오르는 중',lo:'내리는 중'},
  {id:'jgap12',label:'전세 상승률 − 매매 상승률(12개월)',fmt:'pp',hi:'전세가 더 오름',lo:'매매가 더 오름'},
  {id:'jr',label:'전세가율',fmt:'num',hi:'전세가율 높음',lo:'전세가율 낮음'},
  {id:'rate12',label:'기준금리 1년 변화',fmt:'pp1',hi:'금리 오름',lo:'금리 내림'},
  {id:'dd',label:'고점 대비 위치(0=고점)',fmt:'pct',hi:'고점 근처',lo:'고점보다 많이 빠짐'},
  {id:'volG',label:'거래량 증가율(최근 6개월 vs 1년 전)',fmt:'pct',hi:'거래 늘어남',lo:'거래 줄어듦'},
  {id:'out',label:'외지인 매입 비중(최근 6개월)',fmt:'pct',hi:'외지인 많음',lo:'외지인 적음'},
  {id:'demand',label:'매매수급지수(100=균형)',fmt:'num',hi:'매수 우위',lo:'매도 우위'},
  {id:'supply',label:'앞으로 12개월 입주 ÷ 지난 10년 연평균',fmt:'x',hi:'입주 많음',lo:'입주 적음',post:true},
  {id:'unsold12',label:'미분양 1년 변화(시)',fmt:'pct',hi:'미분양 늘어남',lo:'미분양 줄어듦'},
  {id:'permits',label:'인허가 1년 합 ÷ 지난 5년 평균(시)',fmt:'x',hi:'인허가 많음',lo:'인허가 적음'},
  {id:'market',label:'KB 매수우위지수(시 · 100=균형)',fmt:'num',hi:'매수자 많음',lo:'매도자 많음'}
];
function factorStudy(D,o){
  o=Object.assign({h:12,regions:UNIVERSE.concat(['daejeon'])},o||{});
  return FACTORS.map(F=>{
    const obs=[];
    for(const r of o.regions){ const s=D.sale[r]; if(!s) continue; const k0=firstK(s),kN=lastK(s);
      for(let t=k0;t+o.h<=kN;t++){ const f=features(D,r,t)[F.id],y=chg(s,t+o.h,o.h); if(f!=null&&y!=null) obs.push({r,t,f,y}); } }
    if(obs.length<30) return {id:F.id,label:F.label,fmt:F.fmt,hi:F.hi,lo:F.lo,post:!!F.post,n:obs.length,buckets:[],rho:null};
    const fs=obs.map(x=>x.f).sort((a,b)=>a-b),q1=quantile(fs,1/3),q2=quantile(fs,2/3);
    const B=[{name:'낮음',cond:x=>x.f<=q1},{name:'중간',cond:x=>x.f>q1&&x.f<=q2},{name:'높음',cond:x=>x.f>q2}].map(b=>{
      const ys=obs.filter(b.cond).map(x=>x.y); return {name:b.name,n:ys.length,avg:mean(ys),hit:ys.length?ys.filter(y=>y>0).length/ys.length:null}; });
    const rho=corr(ranks(obs.map(x=>x.f)),ranks(obs.map(x=>x.y)));
    const span=[Math.min.apply(null,obs.map(x=>x.t)),Math.max.apply(null,obs.map(x=>x.t))];
    return {id:F.id,label:F.label,fmt:F.fmt,hi:F.hi,lo:F.lo,post:!!F.post,n:obs.length,q1,q2,buckets:B,rho,from:kym(span[0]),to:kym(span[1])};
  });
}
/* 선후행: corr(a의 k월 수익, b의 k+lag월 수익). lag>0 이면 a 가 앞선다. */
function leadLag(D,a,b,maxLag){
  const sa=D.sale[a],sb=D.sale[b]; if(!sa||!sb) return null; maxLag=maxLag||12;
  const k0=Math.max(firstK(sa),firstK(sb))+1,kN=Math.min(lastK(sa),lastK(sb)),out=[];
  for(let L=-maxLag;L<=maxLag;L++){ const x=[],y=[];
    for(let k=k0;k<=kN;k++){ const u=ret(sa,k),w=ret(sb,k+L); if(u!=null&&w!=null){ x.push(u); y.push(w); } }
    out.push({lag:L,n:x.length,r:corr(x,y)}); }
  const best=out.filter(z=>z.r!=null).reduce((p,q)=>(q.r>p.r?q:p),{r:-2});
  return {a,b,from:kym(k0),to:kym(kN),lags:out,best};
}

/* ── 전략 ── */
/* rec-wf-1: 첫 장부의 후보 23개 — 순서까지 고정(동점이면 앞 후보). rec-wf-2: 그 뒤에 입주·매수우위 후보 8개를 붙인다. */
function candidates(sv){
  sv=sv||STRATEGY_VERSION;
  if(STRATEGIES.indexOf(sv)<0) throw new Error('모르는 전략 버전: '+sv);
  const c=[{id:'cash',rule:'cash'},{id:'hold_daejeon',rule:'hold',region:'daejeon'}];
  for(const k of [3,6,12]) for(const th of [0,.01,.02]) c.push({id:'mom_'+k+'_'+th,rule:'mom',k,th});
  for(const k of [6,12]) for(const th of [0,.01]) c.push({id:'momRate_'+k+'_'+th,rule:'momRate',k,th});
  for(const k of [3,6]) c.push({id:'jeonse_'+k,rule:'jeonse',k});
  for(const d of [.1,.15,.2]) c.push({id:'rebound_'+d,rule:'rebound',d});
  c.push({id:'volume_6',rule:'volume',k:6});
  for(const k of [6,12]) c.push({id:'rot_'+k,rule:'rot',k});
  if(sv==='rec-wf-1') return c;
  for(const k of [3,6]) for(const th of [40,60]) c.push({id:'mkt_'+k+'_'+th,rule:'mkt',k,th});
  for(const cap of [1,1.5]) c.push({id:'sup_6_'+cap,rule:'sup',k:6,cap});
  for(const th of [40,60]) c.push({id:'mktHold_'+th,rule:'mktHold',region:'daejeon',th});
  return c;
}
/* 지난 12개월 입주(이미 끝난 실적) ÷ 지난 10년 연평균 — 그 시점에 알 수 있던 공급 압력 */
function supplyPast(D,r,t){ const a=moveinSum(D,r,t-11,t),b=moveinSum(D,r,t-119,t); return (a==null||b==null||b<=0)?null:a/(b/10); }
/* KB 매수우위(시 단위 — 대전 구는 대전 값) */
function marketOf(D,r,t){ return at(D.kbMarket[cityOf(r)],t); }
function candLabel(c){
  const p=x=>(Math.round(x*1000)/10)+'%';
  if(c.rule==='cash') return '현금(정기예금) 유지';
  if(c.rule==='hold') return '대전 전체 계속 보유';
  if(c.rule==='mom') return '추세: '+c.k+'개월 상승률 1위 지역(그 상승률이 '+p(c.th)+' 넘을 때만)';
  if(c.rule==='momRate') return '추세+금리: '+c.k+'개월 상승률 1위 지역(상승률 '+p(c.th)+' 초과 · 기준금리가 1년 전보다 안 올랐을 때만)';
  if(c.rule==='jeonse') return '전세압력: '+c.k+'개월 오르는 지역 중 전세 상승률−매매 상승률(12개월)이 가장 큰 곳';
  if(c.rule==='rebound') return '낙폭 반등: 고점 대비 '+p(c.d)+' 넘게 빠진 뒤 3개월 상승으로 돌아선 지역 중 가장 많이 빠진 곳';
  if(c.rule==='volume') return '거래량: 3개월 오르는 지역 중 거래량 증가율(최근 6개월 vs 1년 전)이 가장 큰 곳';
  if(c.rule==='rot') return '지역 갈아타기: 늘 집을 들고 '+c.k+'개월 상승률 1위 지역으로(보유 지역이 2위 안이면 유지)';
  if(c.rule==='mkt') return '추세+매수우위: KB 매수우위지수 '+c.th+' 이상인 곳 중 '+c.k+'개월 상승률 1위(오를 때만)';
  if(c.rule==='sup') return '추세+공급 회피: 지난 1년 입주가 10년 평균의 '+c.cap+'배 이하인 곳 중 '+c.k+'개월 상승률 1위(오를 때만)';
  if(c.rule==='mktHold') return '매수우위 타이밍: 대전 매수우위지수 '+c.th+' 이상일 때만 대전 전체 보유';
  return c.id;
}
/* 보유 중인 곳이 계속 조건을 만족하면 갈아타지 않는다(갈아타기 비용 약 2.1%). */
function qualifies(D,c,r,t,U){
  U=U||UNIVERSE;
  if(c.rule==='hold') return r===c.region;
  if(c.rule==='cash') return false;
  if(c.rule==='mom'||c.rule==='momRate'){ const m=chg(D.sale[r],t,c.k); if(m==null||m<=c.th) return false;
    if(c.rule==='momRate'){ const rc=rateChange(D,t,12); if(rc==null||rc>0) return false; } return true; }
  if(c.rule==='jeonse'){ const m=chg(D.sale[r],t,c.k); return m!=null&&m>0; }
  if(c.rule==='rebound'){ const m=chg(D.sale[r],t,6); return m!=null&&m>0; }
  if(c.rule==='volume'){ const m=chg(D.sale[r],t,3),v=volGrowth(D,r,t); return m!=null&&m>0&&v!=null&&v>0; }
  if(c.rule==='rot'){ const m=chg(D.sale[r],t,c.k); if(m==null) return false;
    return U.filter(x=>{ const y=chg(D.sale[x],t,c.k); return y!=null&&y>m; }).length<2; }
  if(c.rule==='mkt'){ const m=chg(D.sale[r],t,c.k),mk=marketOf(D,r,t); return m!=null&&m>0&&mk!=null&&mk>=c.th; }
  if(c.rule==='sup'){ const m=chg(D.sale[r],t,c.k),sp=supplyPast(D,r,t); return m!=null&&m>0&&sp!=null&&sp<=c.cap; }
  if(c.rule==='mktHold'){ const mk=marketOf(D,c.region,t); return r===c.region&&mk!=null&&mk>=c.th; }
  return false;
}
function desire(D,c,t,pos,U){
  U=U||UNIVERSE; const sc={};
  if(c.rule==='cash') return {target:null,stay:false,scores:sc};
  if(c.rule==='hold') return {target:c.region,stay:pos===c.region,scores:sc};
  if(c.rule==='mktHold'){ const mk=marketOf(D,c.region,t),ok=mk!=null&&mk>=c.th; if(mk!=null) sc[c.region]=mk; return {target:ok?c.region:null,stay:ok&&pos===c.region,scores:sc}; }
  if(pos&&qualifies(D,c,pos,t,U)) return {target:pos,stay:true,scores:sc};
  let best=null,bv=-Infinity;
  for(const r of U){
    if(c.rule==='mom'||c.rule==='momRate'||c.rule==='rot'){ const m=chg(D.sale[r],t,c.k); if(m==null) continue; sc[r]=m; if(m>bv){bv=m;best=r;} }
    else if(c.rule==='jeonse'){ const m=chg(D.sale[r],t,c.k),gp=jgap(D,r,t,12); if(m==null||gp==null) continue; sc[r]=gp; if(m>0&&gp>bv){bv=gp;best=r;} }
    else if(c.rule==='rebound'){ const dd=drawdown(D,r,t),m=chg(D.sale[r],t,3); if(dd==null||m==null) continue; sc[r]=dd; if(dd<=-c.d&&m>0&&-dd>bv){bv=-dd;best=r;} }
    else if(c.rule==='volume'){ const m=chg(D.sale[r],t,3),v=volGrowth(D,r,t); if(m==null||v==null) continue; sc[r]=v; if(m>0&&v>0&&v>bv){bv=v;best=r;} }
    else if(c.rule==='mkt'){ const m=chg(D.sale[r],t,c.k),mk=marketOf(D,r,t); if(m==null||mk==null) continue; sc[r]=m; if(mk>=c.th&&m>0&&m>bv){bv=m;best=r;} }
    else if(c.rule==='sup'){ const m=chg(D.sale[r],t,c.k),sp=supplyPast(D,r,t); if(m==null||sp==null) continue; sc[r]=m; if(sp<=c.cap&&m>0&&m>bv){bv=m;best=r;} }
  }
  if(best&&(c.rule==='mom'||c.rule==='momRate')){
    if(bv<=c.th) best=null;
    if(best&&c.rule==='momRate'){ const rc=rateChange(D,t,12); if(rc==null||rc>0) best=null; }
  }
  return {target:best,stay:false,scores:sc};
}

/* 결정 사슬 — 자금과 무관하게 '어디를 들고 있을지'만 정한다(장부·백테가 같은 함수를 쓴다). */
function planNext(plan,choice,o){
  let target=choice.target,locked=false;
  if(plan.pos&&plan.held<o.minHold&&target!==plan.pos){ target=plan.pos; locked=true; }
  if(target===plan.pos) plan.held=plan.pos?plan.held+1:0;
  else { plan.pos=target; plan.held=target?1:0; }
  return {target,locked};
}
/* 한 달 정산 — k월 시작에 갈아타고(수수료) k월 수익을 붙인다. */
function monthYield(D,k,pos,o){
  const dep=upTo(D.macro.depositRate,k),netDep=(dep==null?0:dep/100)*(1-o.depositTax);
  if(!pos) return {r:netDep/12,price:0,rent:0,hold:0,cash:netDep/12};
  const price=ret(D.sale[pos],k); if(price==null) throw new Error('가격 없음: '+pos+' '+kym(k));
  let rent=0; if(o.rent==='jeonse'){ const jr=jeonseRatio(D,pos,k); rent=jr?jr.v/100*netDep/12:0; }
  const hold=-o.holdCostYr/12;
  return {r:price+rent+hold,price,rent,hold,cash:0};
}
function markMonth(acct,D,k,target,o){
  const ev={m:kym(k),from:acct.pos,to:target,navStart:acct.nav,fee:0};
  if(target!==acct.pos){
    if(acct.pos){ const f=acct.nav*o.sellCost; acct.nav-=f; ev.fee+=f; ev.sellFee=f; }
    if(target){ const f=acct.nav-acct.nav/(1+o.buyCost); acct.nav-=f; ev.fee+=f; ev.buyFee=f; }
    acct.pos=target;
  }
  const y=monthYield(D,k,acct.pos,o);
  acct.nav*=1+y.r; acct.fees+=ev.fee;
  return Object.assign(ev,{pos:acct.pos,r:y.r,price:y.price,rent:y.rent,hold:y.hold,cash:y.cash,nav:acct.nav});
}
function stats(rows,capital){
  if(!rows.length) return {months:0,total:0,cagr:0,mdd:0,inMarket:0,fees:0,trades:0};
  const end=rows[rows.length-1].nav,yrs=rows.length/12;
  let peak=capital,mdd=0,inM=0,fees=0,trades=0;
  for(const x of rows){ if(x.nav>peak) peak=x.nav; mdd=Math.max(mdd,1-x.nav/peak); if(x.pos) inM++; fees+=x.fee||0; if(x.from!==x.to) trades++; }
  return {months:rows.length,total:end/capital-1,cagr:Math.pow(end/capital,1/yrs)-1,mdd,inMarket:inM/rows.length,fees,trades,end};
}
/* choose(d,pos) → {target,...} : d월까지 자료로 고른다. */
function simulate(D,o,choose){
  o=Object.assign({},DEFAULTS,o||{});
  const plan={pos:null,held:0},acct={nav:o.capital,pos:null,fees:0},rows=[],decisions=[];
  for(let k=o.from;k<=o.to;k++){
    const d=k-o.lag,ch=choose(d,plan.pos)||{target:null},p=planNext(plan,ch,o);
    decisions.push({m:kym(k),data:kym(d),target:p.target,locked:p.locked,cand:ch.cand||null,stay:!!ch.stay});
    rows.push(markMonth(acct,D,k,p.target,o));
  }
  return {rows,decisions,stats:stats(rows,o.capital)};
}
function dataStart(D,o){
  /* 자료로 판단을 시작할 수 있는 첫 달: 투자 대상 중 3곳(대상이 적으면 전부) 이상 12개월 상승률이 나오는 달 */
  const U=(o&&o.universe)||DJ,need=Math.min(3,U.length);
  const k0=Math.min.apply(null,U.map(r=>firstK(D.sale[r])).filter(x=>x!=null));
  for(let t=k0;t<=D.lastK;t++){ if(U.filter(r=>chg(D.sale[r],t,12)!=null).length>=need) return t; }
  return null;
}
/* 학습 표에서 1위 고르기. 학습 기간에 거의 사지 않은 규칙은 '현금' 후보와 같은 것이라 뺀다
   (낙폭이 0 에 가까워 점수가 부풀려진다). 동점이면 앞 후보(현금이 맨 앞). */
function pickBest(table,o){
  o=Object.assign({},DEFAULTS,o||{});
  const elig=table.filter(t=>t.id==='cash'||t.inMarket>=o.minInMarket);
  return elig.reduce((a,b)=>(b.score>a.score+1e-12?b:a));
}
function walkForward(D,o){
  o=Object.assign({},DEFAULTS,o||{});
  const SV=o.strategy||STRATEGY_VERSION,U=o.universe||UNIVERSE,C=candidates(SV),byId={},d0=dataStart(D,Object.assign({},o,{universe:o.universe||DJ})); C.forEach(c=>byId[c.id]=c);
  if(d0==null||D.lastK==null) return null;
  const firstRet=Math.max(d0+o.lag,o.firstRetMin?ymk(o.firstRetMin):-Infinity),lastRet=D.lastK,years=[],sel={};
  for(let y=Math.floor(firstRet/12)+1;;y++){
    const trainTo=y*12-o.lag; if(trainTo>D.lastK) break;
    if(trainTo-firstRet+1<o.minTrain) continue;
    const table=C.map(c=>{ const s=simulate(D,Object.assign({},o,{from:firstRet,to:trainTo}),(d,pos)=>desire(D,c,d,pos,U)).stats;
      return {id:c.id,score:s.cagr-o.penalty*s.mdd,cagr:s.cagr,mdd:s.mdd,trades:s.trades,inMarket:s.inMarket,eligible:c.rule==='cash'||s.inMarket>=o.minInMarket}; });
    const best=pickBest(table,o);
    years.push(y); sel[y]={id:best.id,label:candLabel(byId[best.id]),trainFrom:kym(firstRet),trainTo:kym(trainTo),table};
  }
  if(!years.length) return null;
  const oosFrom=years[0]*12,activeFor=k=>{ const y=Math.floor(k/12); return sel[y]?byId[sel[y].id]:null; };
  const choose=(d,pos)=>{ const c=activeFor(d+o.lag); if(!c) return {target:null}; const r=desire(D,c,d,pos,U); r.cand=c.id; return r; };
  const meta=simulate(D,Object.assign({},o,{from:oosFrom,to:lastRet}),choose);
  const bench={};
  for(const r of ['daejeon'].concat(U.filter(x=>x!=='daejeon'))){
    const s=D.sale[r]; if(!s) continue; const f=Math.max(oosFrom,firstK(s)+1);
    if(f>lastRet) continue;
    bench[r]=simulate(D,Object.assign({},o,{from:f,to:lastRet,minHold:0}),()=>({target:r}));
  }
  bench.cash=simulate(D,Object.assign({},o,{from:oosFrom,to:lastRet}),()=>({target:null}));
  /* 같은 기간 전체표본 최적(과최적화 참고용) */
  const fullTable=C.map(c=>{ const s=simulate(D,Object.assign({},o,{from:oosFrom,to:lastRet}),(d,pos)=>desire(D,c,d,pos,U)).stats;
    return {id:c.id,label:candLabel(c),score:s.cagr-o.penalty*s.mdd,cagr:s.cagr,mdd:s.mdd,trades:s.trades,inMarket:s.inMarket}; })
    .sort((a,b)=>b.score-a.score);
  return {strategy:SV,years,sel,meta,bench,fullTable,oosFrom:kym(oosFrom),lastRet:kym(lastRet),firstRet:kym(firstRet),activeFor,choose,opts:o};
}

/* ── 장기 검증: KB 대전 전체(1986~)로 같은 후보·같은 워크포워드를 돌린다(투자 대상 = 대전 전체 하나).
   예금 금리 자료가 1996년부터라 학습도 1996년부터 — 그 전엔 현금 수익을 셀 수 없다.
   임대가치는 KB 전세가율(1998.12~, 그 전은 KB 전세·매매 지수 비로 거꾸로 이음). ── */
function longD(D){
  const s=D.kbSale.daejeon; if(!s) return null;
  const L={doc:D.doc,regions:D.regions,macro:D.macro,sale:{daejeon:s},jeonse:{daejeon:D.kbJeonse.daejeon},jratio:{daejeon:D.kbJr.daejeon},
    avgPrice:{},demand:{},volume:{},buyOutSeoul:{},buyOutOther:{},land:{},landQ:{},kbSale:{},kbJeonse:{},kbJr:{},kbMarket:D.kbMarket,movein:D.movein,unsold:D.unsold,permits:D.permits,rtIndex:{},peak:{}};
  const pk=new Array(s.v.length); let m=null; for(let i=0;i<s.v.length;i++){ const x=s.v[i]; if(x!=null&&(m==null||x>m)) m=x; pk[i]=m; }
  L.peak.daejeon={k0:s.k0,v:pk}; L.lastK=lastK(s);
  return L;
}
function walkForwardLong(D,o){
  const L=longD(D); if(!L) return null;
  return walkForward(L,Object.assign({},o||{},{universe:['daejeon'],firstRetMin:'1996-01'}));
}

/* ── 모의장부(앞으로) — 덧붙이기만 한다. 지난 기록은 고치지 않는다. ── */
function paperUpdate(ledger,D,o,nowIso){
  o=Object.assign({},DEFAULTS,o||{});
  const SV=(ledger&&ledger.strategyVersion)||o.strategy||STRATEGY_VERSION;
  const wf=walkForward(D,Object.assign({},o,{strategy:SV})); if(!wf) throw new Error('워크포워드 계산 불가');
  const L=ledger&&ledger.decisions?JSON.parse(JSON.stringify(ledger)):{
    schema:1,strategyVersion:SV,engineVersion:VERSION,startedData:kym(D.lastK),
    capital:o.capital,params:pick(o,['lag','minHold','buyCost','sellCost','holdCostYr','depositTax','rent','penalty','minTrain','minInMarket']),
    plan:{pos:null,held:0},acct:{nav:o.capital,pos:null,fees:0},decisions:[],marks:[]};
  const added={decisions:0,marks:0};
  const lastDec=L.decisions.length?ymk(L.decisions[L.decisions.length-1].data):ymk(L.startedData)-1;
  for(let d=lastDec+1;d<=D.lastK;d++){
    const k=d+L.params.lag,c=wf.activeFor(k);
    const ch=c?desire(D,c,d,L.plan.pos):{target:null,scores:{}};
    const p=planNext(L.plan,ch,L.params);
    L.decisions.push({m:kym(k),data:kym(d),cand:c?c.id:null,candLabel:c?candLabel(c):'',target:p.target,locked:p.locked,stay:!!ch.stay,
      scores:roundObj(ch.scores),sv:SV,ev:VERSION,at:nowIso||null});
    added.decisions++;
  }
  const lastMark=L.marks.length?ymk(L.marks[L.marks.length-1].m):null;
  for(const dec of L.decisions){
    const k=ymk(dec.m); if(k>D.lastK||(lastMark!=null&&k<=lastMark)) continue;
    const ev=markMonth(L.acct,D,k,dec.target,L.params); ev.at=nowIso||null; L.marks.push(ev); added.marks++;
  }
  return {ledger:L,added,wf};
}
function pick(o,keys){ const x={}; keys.forEach(k=>x[k]=o[k]); return x; }
function roundObj(s){ const x={}; for(const k in (s||{})) x[k]=Math.round(s[k]*1e6)/1e6; return x; }

/* ── 지역별 참고 전망(실험적) — 지금 지표가 과거 어느 구간(하위·중위·상위 1/3)에 해당하는지 보고
   그 구간의 '이후 12개월 평균'을 지표별로 늘어놓는다. 순위상관 |ρ|≥minRho 인 지표만, 같은 무게로 평균한다.
   전략 판단(워크포워드)과 별개의 참고값이다. ── */
function outlook(D,o){
  o=Object.assign({h:12,minRho:.2},o||{});
  const fs=factorStudy(D,{h:o.h}).filter(f=>f.buckets.length&&f.rho!=null&&Math.abs(f.rho)>=o.minRho);
  const t=D.lastK,rows=[];
  for(const r of UNIVERSE.concat(['daejeon'])){
    if(!D.sale[r]||at(D.sale[r],t)==null) continue;
    const F=features(D,r,t),parts=[];
    for(const f of fs){ const v=F[f.id]; if(v==null) continue;
      const bi=v<=f.q1?0:v<=f.q2?1:2,b=f.buckets[bi];
      parts.push({id:f.id,label:f.label,fmt:f.fmt,v,bucket:['낮음','중간','높음'][bi],word:bi===2?f.hi:bi===0?f.lo:'보통',avg:b.avg,hit:b.hit,rho:f.rho}); }
    const avg=parts.length?parts.reduce((a,x)=>a+x.avg,0)/parts.length:null;
    rows.push({r,label:label(D,r),avg,parts});
  }
  rows.sort((a,b)=>(b.avg==null?-9:b.avg)-(a.avg==null?-9:a.avg));
  return {dataMonth:kym(t),h:o.h,factors:fs.map(f=>({id:f.id,label:f.label,rho:f.rho})),rows};
}

/* ── 지금: 지역별 지표와 현재 적용 전략의 선택 ── */
function snapshot(D,o){
  o=Object.assign({},DEFAULTS,o||{});
  const t=D.lastK,wf=o.wf||walkForward(D,o),rows=[];   // 이미 계산한 워크포워드(같은 전략·가정)가 있으면 다시 쓰지 않는다
  for(const r of UNIVERSE.concat(['daejeon','cheongju','cheonan','gongju','gyeryong'])){
    if(!D.sale[r]||at(D.sale[r],t)==null) continue;
    rows.push(Object.assign({r,label:label(D,r),inUniverse:UNIVERSE.indexOf(r)>=0},features(D,r,t)));
  }
  let pick=null;
  if(wf){ const pos=wf.meta.rows.length?wf.meta.rows[wf.meta.rows.length-1].pos:null,c=wf.activeFor(t+o.lag);
    if(c){ const ch=desire(D,c,t,pos); pick={cand:c.id,rule:c.rule,k:c.k,th:c.th,cap:c.cap,label:candLabel(c),target:ch.target,stay:!!ch.stay,scores:ch.scores,heldNow:pos,forMonth:kym(t+o.lag),dataMonth:kym(t),rate12:rateChange(D,t,12)}; } }
  return {dataMonth:kym(t),rows,pick,wf};
}

const API={VERSION,STRATEGY_VERSION,STRATEGIES,supplyPast,marketOf,DEFAULTS,UNIVERSE,DJ,EVENTS,FACTORS,ymk,kym,ser,at,firstK,lastK,upTo,chg,ret,prepare,label,
  drawdown,jgap,rateChange,volGrowth,outShare,jeonseRatio,features,landLong,realSeries,cityOf,moveinRange,moveinAt,moveinSum,supplyRatio,permitsMonthly,permitsRatio,unsoldChange,longD,walkForwardLong,zigzag,cycles,factorStudy,leadLag,corr,outlook,
  candidates,candLabel,qualifies,desire,planNext,monthYield,markMonth,stats,simulate,dataStart,pickBest,walkForward,paperUpdate,snapshot};
g.JKRealEstateClaude=API;
if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
