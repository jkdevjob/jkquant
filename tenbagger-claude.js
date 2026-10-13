/* 텐배거 — 🤖 클로드 탭 화면. 계산은 scripts/tenbagger_claude/(파이썬)에서 끝내고 결과(data/tenbagger/claude/analysis.json)를
   여기서는 그리기만 한다 — 같은 숫자를 두 곳에서 세지 않는다. 이 파일과 #pane-claude 안만 클로드 작업 영역이다(지피티 탭은 건드리지 않는다).
   숫자 형식·목록 거르기 함수는 Node 시험(scripts/test_tenbagger_claude.cjs)이 같은 파일을 불러 값으로 확인한다. */
(function(g){
'use strict';
const VERSION='1.0.0';
const DATA='/data/tenbagger/claude/analysis.json';

/* ── 숫자(순수 함수 — 시험 대상) ── */
const ok=x=>x!=null&&isFinite(x);
const pct=(x,d)=>ok(x)?(x*100).toFixed(d==null?1:d)+'%':'–';
const spct=(x,d)=>ok(x)?(x>=0?'+':'−')+Math.abs(x*100).toFixed(d==null?1:d)+'%':'–';
const mult=(x,d)=>ok(x)?(+x).toFixed(d==null?1:d)+'배':'–';
const eok=x=>{ if(!ok(x)) return '–'; if(Math.abs(x)>=10000){ const j=x/10000; return (Math.abs(j)>=10?Math.round(j).toLocaleString('ko-KR'):j.toFixed(1))+'조'; }
  return Math.round(x).toLocaleString('ko-KR')+'억'; };
const won=x=>ok(x)?Math.round(x).toLocaleString('ko-KR')+'원':'–';
/* 거래일 → 사람 말(21거래일≈1개월, 250거래일≈1년) */
const tdays=d=>!ok(d)?'–':d<250?Math.max(1,Math.round(d/21))+'개월':(d/250).toFixed(1)+'년';
const lift=x=>ok(x)?(+x).toFixed(2)+'배':'–';
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* 텐배거 목록 거르기·정렬·쪽 나누기 — rows 는 cols 순서의 배열 */
function listView(rows,cols,q){
  q=q||{}; const ix={}; cols.forEach((c,i)=>ix[c]=i);
  const text=String(q.text||'').trim().toLowerCase();
  const y0=q.from?+q.from:0,y1=q.to?+q.to:9999;
  let out=rows.filter(r=>{
    const y=+String(r[ix.t0]).slice(0,4);
    if(y<y0||y>y1) return false;
    if(q.mkt&&r[ix.mkt]!==q.mkt) return false;
    if(q.status==='alive'&&!r[ix.alive]) return false;
    if(q.status==='gone'&&r[ix.alive]) return false;
    if(text){ const hay=(r[ix.name0]+' '+r[ix.name]+' '+r[ix.code]+' '+(r[ix.industry]||'')).toLowerCase(); if(hay.indexOf(text)<0) return false; }
    return true;
  });
  const key=ix[q.sort||'peak'],dir=q.dir==='asc'?1:-1;
  out=out.slice().sort((a,b)=>{ const va=a[key],vb=b[key]; if(va===vb) return a[ix.code]<b[ix.code]?-1:1; return (va<vb?-1:1)*dir; });
  const size=q.size||30,pages=Math.max(1,Math.ceil(out.length/size)),page=Math.min(Math.max(1,q.page||1),pages);
  const items=out.slice((page-1)*size,page*size).map(r=>{ const o={}; cols.forEach((c,i)=>o[c]=r[i]); return o; });
  return {total:out.length,pages,page,items};
}

/* 거래 단위 표 읽는 법 — 손으로 적지 않고 표에서 고른다(자료가 바뀌면 문장도 바뀐다) */
function tradeNotes(T){
  if(!T||!T.length) return '';
  const best=T.reduce((m,x)=>x.med>m.med?x:m,T[0]);
  const by=k=>{ const o={}; T.forEach(x=>{ (o[x[k]]=o[x[k]]||[]).push(x); }); return o; };
  const sig=by('sig'),avgMed=a=>a.reduce((s,x)=>s+x.med,0)/a.length;
  const worst=Object.keys(sig).reduce((m,k)=>avgMed(sig[k])<avgMed(sig[m])?k:m,Object.keys(sig)[0]);
  const tb=T.reduce((m,x)=>x.x10>m.x10?x:m,T[0]);
  const rule=by('rule'),avgX3=a=>a.reduce((s,x)=>s+x.x3,0)/a.length;
  const cut=Object.keys(rule).reduce((m,k)=>avgX3(rule[k])<avgX3(rule[m])?k:m,Object.keys(rule)[0]);
  const keep=Object.keys(rule).reduce((m,k)=>avgX3(rule[k])>avgX3(rule[m])?k:m,Object.keys(rule)[0]);
  return '읽는 법: 중앙값이 가장 높은 조합은 \''+esc(best.sig)+' + '+esc(best.rule)+'\'('+spct(best.med,0)+', 이긴 비율 '+pct(best.win,0)+'). '
    +'10배 이상 비율이 가장 높은 조합은 \''+esc(tb.sig)+' + '+esc(tb.rule)+'\'('+pct(tb.x10,1)+'). '
    +'매수 신호 중 평균적으로 중앙값이 가장 나쁜 것은 \''+esc(worst)+'\'. '
    +'\''+esc(cut)+'\'은 3배 이상 비율이 평균 '+pct(avgX3(rule[cut]),1)+'로 가장 낮아 큰 승자를 일찍 잘랐고, \''+esc(keep)+'\'는 '+pct(avgX3(rule[keep]),1)+'였다.';
}
function mcNote(mc,b97){
  if(!mc||!mc.length) return '';
  const best=mc.reduce((m,x)=>x.cagr>m.cagr?x:m,mc[0]),k=b97&&b97.KOSPI;
  return '무작위로 고르면 가장 나은 조합(\''+esc(best.filter)+' · '+esc(best.timing)+' · '+esc(best.rule)+'\')도 연 '+spct(best.cagr,1)+'(하위 10% '+spct(best.p10,1)+' ~ 상위 10% '+spct(best.p90,1)+')로, 같은 기간 코스피(연 '+spct(k&&k.cagr,1)+') 언저리였다. 저가·급락 조건을 더할수록 상장폐지가 쌓여 오히려 나빠졌다.';
}
function coefWords(c){
  const up=c.w>=0;
  if(c.kind==='곡선') return up?'아주 작거나 아주 큰 쪽이 유리':'가운데쯤이 유리';
  return up?'클수록 유리':'작을수록 유리';
}

/* 분석 파일 점검 — 화면이 기대하는 칸이 다 있는지(없으면 그리지 않고 이유를 보인다) */
function validate(A){
  const need=['meta','base','byYear','monthly','featureBins','crash','episodes','model','trades','portfolio','current','headline'];
  const miss=need.filter(k=>!A||A[k]==null);
  if(miss.length) return '분석 파일에 빠진 칸: '+miss.join(', ');
  if(!Array.isArray(A.episodes.list)||!Array.isArray(A.episodes.cols)) return '텐배거 목록 형식이 다릅니다';
  return '';
}

const API={VERSION,DATA,pct,spct,mult,eok,won,tdays,lift,esc,listView,validate,tradeNotes,mcNote,coefWords};
g.JKTenbaggerClaude=API;
if(typeof module!=='undefined'&&module.exports){ module.exports=API; return; }
if(typeof document==='undefined') return;

/* ───────────── 화면 ───────────── */
const ROOT_ID='tbc-root';
/* 차트 색 — dataviz 검증(어두운 카드 #1e2540 · 대비 3:1 이상 · 색각이상 ΔE 9.4): 1 파랑 · 2 주황 · 3 청록 */
const S1='#3987e5',S2='#d95926',S3='#199e70',GRID='#2a3354',TICK='#6f7ba0';
const st={tab:'sum',charts:{},q:{sort:'peak',dir:'desc',page:1,status:'',mkt:'',text:'',from:'',to:''}};
let A=null;

const CSS=`
#pane-claude{padding:14px 14px 18px;text-align:left}
.tbc{text-align:left;color:var(--text)}
.tbc .sub2{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin:2px 0 12px;-webkit-overflow-scrolling:touch}
.tbc .chip{flex:0 0 auto;border:1px solid var(--border);background:var(--surf2);color:var(--dim);border-radius:8px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer}
.tbc .chip.on{border-color:var(--gold);color:var(--gold)}
.tbc .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin-bottom:10px}
.tbc .card{background:var(--surf2);border:1px solid var(--border);border-radius:12px;padding:13px;margin-bottom:10px;overflow-wrap:break-word}
.tbc .card h3{margin:0 0 8px;font-size:14px;color:var(--text)}
.tbc .card h4{margin:12px 0 6px;font-size:12.5px;color:var(--dim)}
.tbc .big{font-size:24px;font-weight:800;line-height:1.25}
.tbc .lbl{font-size:11.5px;color:var(--dim);margin-bottom:2px}
.tbc .kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.tbc .kv span{flex:0 1 auto;color:var(--dim)}
.tbc .kv b{flex:0 0 auto;font-variant-numeric:tabular-nums;text-align:right}
.tbc .note{font-size:11.5px;color:var(--faint);line-height:1.6}
.tbc .lead{font-size:12.5px;color:var(--dim);line-height:1.7;margin:0 0 8px}
.tbc .up{color:var(--green)} .tbc .dn{color:var(--red)} .tbc .gd{color:var(--gold)}
.tbc table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.tbc th,.tbc td{padding:6px 7px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
.tbc th{color:var(--faint);font-weight:700;background:rgba(255,255,255,.02)}
.tbc td:first-child,.tbc th:first-child{text-align:left}
.tbc td.l,.tbc th.l{text-align:left;white-space:normal;min-width:7em;word-break:keep-all}
.tbc .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tbc ol.f,.tbc ul.f{margin:4px 0 0;padding-left:20px;font-size:13px;line-height:1.75;color:var(--dim)}
.tbc ol.f li,.tbc ul.f li{margin-bottom:6px}
.tbc ol.f b,.tbc ul.f b{color:var(--text)}
.tbc .cv{position:relative;height:260px}
.tbc .cv.s{height:170px}
.tbc .warn{padding:9px 11px;border-radius:9px;background:rgba(245,196,81,.08);border:1px solid rgba(245,196,81,.28);color:#f3d58a;font-size:11.5px;line-height:1.6;margin-bottom:10px}
.tbc .bar{position:relative;height:8px;background:rgba(255,255,255,.06);border-radius:4px;min-width:60px}
.tbc .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:${S1}}
.tbc .bar.base{outline:1px solid rgba(255,255,255,.18)}
.tbc tr.best td{background:rgba(245,196,81,.07)}
.tbc details{margin-top:8px} .tbc details summary{cursor:pointer;font-size:12px;font-weight:800;color:var(--dim);padding:4px 0}
.tbc .row{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:4px 0 8px}
.tbc select,.tbc input,.tbc .btn{background:var(--surf);color:var(--text);border:1px solid var(--border);border-radius:8px;height:34px;padding:0 9px;font-size:12px}
.tbc input{min-width:0;flex:1 1 140px}
.tbc .btn{cursor:pointer;font-weight:800}
.tbc .btn[disabled]{opacity:.4;cursor:default}
.tbc .tag{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);color:var(--dim);margin:0 4px 4px 0}
.tbc .legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--dim);margin:2px 0 6px}
.tbc .legend i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}
@media(max-width:560px){.tbc .cv{height:220px}.tbc .big{font-size:20px}.tbc .card{padding:11px}.tbc th,.tbc td{padding:5px 5px}}
`;

function chart(id,cfg){
  if(st.charts[id]){ st.charts[id].destroy(); delete st.charts[id]; }
  const el=document.getElementById(id); if(!el||!window.Chart) return;
  st.charts[id]=new Chart(el.getContext('2d'),cfg);
}
function baseOpts(o){
  o=o||{};
  return {responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:!!o.legend,labels:{color:'#9aa6c9',boxWidth:14,boxHeight:3,font:{size:11}}},
      tooltip:{backgroundColor:'#1c2238',borderColor:'#2e3754',borderWidth:1,titleColor:'#9aa6c9',bodyColor:'#e8ecf7',
        callbacks:{label:c=>' '+(c.dataset.label?c.dataset.label+': ':'')+(o.fmt?o.fmt(c.parsed.y):c.parsed.y)}}},
    scales:{x:{ticks:{color:TICK,maxTicksLimit:o.xticks||(narrow()?5:8),font:{size:10},maxRotation:0,autoSkip:true,
        /* 'YYYY-MM' 눈금은 연도만 — 휴대폰 폭에서 날짜 글자가 서로 붙지 않게 */
        callback:function(v){ const l=this.getLabelForValue(v); return typeof l==='string'&&/^\d{4}-\d{2}$/.test(l)?l.slice(0,4):l; }},grid:{display:false},border:{color:GRID}},
      y:{type:o.log?'logarithmic':'linear',ticks:{color:TICK,font:{size:10},maxTicksLimit:6,callback:v=>o.fmt?o.fmt(v):v},grid:{color:GRID,lineWidth:1},border:{display:false}}}};
}
function narrow(){ return typeof window!=='undefined'&&window.innerWidth<560; }
function line(label,data,color){ return {label,data,borderColor:color,backgroundColor:color,borderWidth:2,pointRadius:0,pointHitRadius:8,tension:0,fill:false}; }
function bars(label,data,color){ return {label,data,backgroundColor:color,borderRadius:4,borderSkipped:'start',maxBarThickness:24,categoryPercentage:.8,barPercentage:.9}; }

function liftBar(v,max){ const w=ok(v)?Math.max(2,Math.min(100,v/max*100)):0; return '<div class="bar'+(ok(v)&&Math.abs(v-1)<0.005?' base':'')+'"><i style="width:'+w.toFixed(1)+'%"></i></div>'; }
function binsTable(rows,title,opt){
  opt=opt||{}; const mx=Math.max(1.5,...rows.map(r=>r.lift||0));
  return '<div class="tw"><table><tr><th class="l">'+esc(title)+'</th><th>표본</th><th>5년 안 10배</th><th>평균 대비</th><th style="min-width:70px"></th><th>5년 수익 중앙값</th><th>5년 안 상장폐지</th></tr>'
    +rows.map(r=>'<tr><td class="l">'+esc(r.bin)+'</td><td>'+(r.n||0).toLocaleString('ko-KR')+'</td><td>'+pct(r.p10,1)+'</td><td>'+lift(r.lift)+'</td><td>'+liftBar(r.lift,mx)+'</td><td class="'+(r.r5>=0?'up':'dn')+'">'+spct(r.r5,0)+'</td><td>'+pct(r.dead,0)+'</td></tr>').join('')
    +'</table></div>';
}
function kv(k,v,cls){ return '<div class="kv"><span>'+k+'</span><b'+(cls?' class="'+cls+'"':'')+'>'+v+'</b></div>'; }

/* ── 칸 ── */
const TABS=[['sum','📌 요약'],['when','⏱ 언제'],['what','🔎 어떤 종목'],['path','📈 오르는 길·고점'],['rules','⚖️ 매매 규칙'],['best','🏆 가장 번 방법'],['now','🧭 지금'],['list','📋 텐배거 목록'],['how','📐 방법·한계']];

function secSummary(){
  const h=A.headline,b=A.base,m=A.meta,p=h.prof,bp=h.best,bk=h.bench||{},c=h.crash5060||{};
  const rc=h.robustCost||{},r2=h.robust2||{},tiny=(A.featureBins.cap||[])[0]||{};
  return '<div class="grid">'
    +'<div class="card"><div class="lbl">아무 때나 산 종목이 5년 안에 10배 될 확률</div><div class="big">'+pct(b.p10_5,2)+'</div><div class="note">3년 안 '+pct(b.p10_3,2)+' · 5년 뒤 수익 중앙값 '+spct(b.r5med,0)+' · 5년 안 상장폐지 '+pct(b.dead5,0)+'</div></div>'
    +'<div class="card"><div class="lbl">코스닥이 1년 고점 대비 −50~−60%일 때 산 종목</div><div class="big">'+pct(c.p10,1)+'</div><div class="note">평소의 '+lift(c.lift)+' · 5년 수익 중앙값 '+spct(c.r5,0)+'</div></div>'
    +'<div class="card"><div class="lbl">가장 많이 번 방법(검증 포함) — 연 수익</div><div class="big">'+spct(bp.cagr,1)+'</div><div class="note">'+esc(h.bestRule)+' · 최대 낙폭 '+spct(bp.mdd,0)+' · 같은 기간 코스피 '+spct(bk.KOSPI&&bk.KOSPI.cagr,1)+'</div></div>'
    +'</div>'
    +'<div class="card"><h3>30년 자료가 말하는 것</h3><ol class="f">'
    +'<li><b>텐배거는 바닥에서 나온다.</b> 10배 오르기 전 저점은 3년 고점 대비 중앙값 <b>'+spct(p.dd3,0)+'</b>, 직전 1년 '+spct(p.ret250,0)+'였다. 시가총액 중앙값 '+eok(p.cap)+', 주가 '+won(p.price)+' — 작고 싸고 망가진 종목이었다.</li>'
    +'<li><b>언제: 시장 전체가 무너졌을 때.</b> 텐배거 저점은 1998·2003·2008·2020 바닥 몇 달에 몰려 있다. 코스닥이 1년 고점 대비 −50~−60%인 달에 산 종목은 5년 안 10배 확률이 <b>'+pct(c.p10,1)+'</b>로 평소('+pct(b.p10_5,2)+')의 '+lift(c.lift)+'였다. 다만 폭락 첫날은 바닥이 아닌 때가 많았다(1997-10·2000-04·2008-08) — 몇 달에 나눠 사는 쪽이 맞았다.</li>'
    +'<li><b>무엇: 작고·싸고·거래가 한산한 종목에서 확률이 높다.</b> 그러나 같은 무리에서 상장폐지도 많다(시총 '+esc(tiny.bin)+'은 10배 확률 '+pct(tiny.p10,1)+'이지만 5년 안 상장폐지 '+pct(tiny.dead,0)+'). 신고가 돌파·거래 폭발 같은 차트 신호는 예측력이 거의 없었고, <b>거래 폭발 추격은 가장 나빴다.</b></li>'
    +'<li><b>오르는 길은 험했다.</b> 2배까지 '+tdays(p.t2)+', 10배까지 '+tdays(p.d10)+'(중앙값). 그 사이 고점 대비 <b>'+spct(p.mdd10,0)+'</b> 하락을 한 번은 견뎌야 했다 — 30% 추적 손절로는 대부분 중간에 털렸다.</li>'
    +'<li><b>언제 팔까: 과열을 보고 판다.</b> 고점에서는 200일선의 '+mult(p.ma200,1)+', 60일 '+spct(p.ret60,0)+', 거래대금이 평소의 '+mult(p.surge,1)+'였다. 고점 1년 뒤에는 '+spct(p.after1,0)+'(중앙값) — 대부분 되돌아갔다. 200일선 2배 넘게 과열된 뒤 고점에서 20% 빠지면 파는 규칙이 가장 좋았다.</li>'
    +'<li><b>실제로 가장 많이 번 방법</b>(아래 🏆): 매달 말 \'3년 안 3배\' 확률 모형 상위 20종목을 다음 날 종가에 사서, 1년 보유하되 과열 뒤 20% 하락이면 먼저 판다. '+m.portStart.slice(0,4)+'~'+m.dataTo.slice(0,4)+' 연 '+spct(bp.cagr,1)+'(최대 낙폭 '+spct(bp.mdd,0)+') · 규칙을 고른 앞 시기 '+spct(bp.is_cagr,1)+' · 고르는 데 안 쓴 뒤 시기(2013~) <b>'+spct(bp.oos_cagr,1)+'</b>. 비용을 1회 1%로 올려도 '+spct(rc.cagr,1)+', 21~40위 종목만 사도 '+spct(r2.cagr,1)+'.</li>'
    +'<li><b>정직한 한계.</b> 이 방법은 \'텐배거 맞히기\'보다 \'텐배거가 잘 나오는 무리를 꾸준히 사고 과열에 파는 것\'이다. 재무(실적·PER·PBR) 자료는 없고 배당은 뺐다. 작은 종목이라 큰 돈은 못 넣는다(₩1억4천만·20종목 기준으로 시험). 과거 성과가 미래를 보장하지 않는다.</li>'
    +'</ol></div>'
    +'<div class="note">자료: '+esc(m.source)+' · '+esc(m.dataFrom)+' ~ '+esc(m.dataTo)+' · 종목 '+m.instruments.toLocaleString('ko-KR')+'개(상장폐지·소멸 '+m.delisted.toLocaleString('ko-KR')+' 포함) · 텐배거 구간 '+m.episodes.toLocaleString('ko-KR')+'개('+m.episodeStocks.toLocaleString('ko-KR')+'종목) · 계산 '+esc(m.generatedAt)+' · 분석 v'+esc(m.version)+'</div>';
}

function secWhen(){
  const fb=A.featureBins,ep=A.episodes;
  let h='<div class="card"><h3>그달에 샀다면 — 5년 안에 10배가 된 종목 비율</h3><p class="lead">매달 말 살 수 있던 모든 종목(상장폐지 포함)을 다음 날 종가에 샀다고 보고, 그 뒤 5년 안에 한 번이라도 10배가 된 비율이다. 결과가 5년 다 지난 달까지만 그린다.</p><div class="cv"><canvas id="tbcMonth"></canvas></div>'
    +'<h4>같은 달 코스닥 지수의 1년 고점 대비 낙폭</h4><div class="cv s"><canvas id="tbcQdd"></canvas></div>'
    +'<p class="note">두 그래프는 같은 가로축(월)이다. 비율이 치솟은 달(1998·2002~2004·2020)은 코스닥이 깊게 빠져 있던 때와 겹친다.</p></div>';
  h+='<div class="card"><h3>시장이 얼마나 빠져 있었나 → 10배 확률</h3>'+binsTable(fb.qdd,'코스닥 1년 고점 대비')+'<div style="height:10px"></div>'+binsTable(fb.kdd,'코스피 1년 고점 대비')+'</div>';
  h+='<div class="card"><h3>폭락이 처음 시작된 날 샀다면</h3><p class="lead">코스닥이 1년 고점 대비 −40% 또는 코스피 −30%가 120거래일 만에 처음 나온 날. \'소형·저가·급락\'은 시총 하위 30% · 주가 5천원 이하 · 3년 고점 대비 −50% 이하.</p><div class="tw"><table><tr><th class="l">시작일</th><th>코스닥 낙폭</th><th>코스피 낙폭</th><th>종목</th><th>5년 안 10배</th><th>3년 수익 중앙값</th><th>5년 수익 중앙값</th><th>소형·저가·급락 10배</th><th>그 무리 5년 중앙값</th><th>근처 텐배거 저점</th></tr>'
    +A.crash.map(c=>{ const a=c.all||{},s=c.sc||{}; return '<tr><td class="l">'+esc(c.start)+(c.done?'':' <span class="tag">진행 중</span>')+'</td><td>'+spct(c.qdd,0)+'</td><td>'+spct(c.kdd,0)+'</td><td>'+(a.n||0)+'</td><td>'+pct(a.p10,1)+'</td><td class="'+(a.r3>=0?'up':'dn')+'">'+spct(a.r3,0)+'</td><td class="'+(a.r5>=0?'up':'dn')+'">'+spct(a.r5,0)+'</td><td>'+pct(s.p10,1)+'</td><td class="'+(s.r5>=0?'up':'dn')+'">'+spct(s.r5,0)+'</td><td>'+c.troughs+'</td></tr>'; }).join('')
    +'</table></div><p class="note">1997-10·2000-04·2008-08 처럼 첫날이 바닥이 아니면 3~5년 성적도 나빴다. 텐배거 저점은 실제 바닥(1998-06~10, 2003-03, 2008-10, 2020-03)에 몰려 있다 — 한 번에 다 사지 말고 폭락 기간에 나눠 사는 이유다. \'진행 중\'은 5년이 안 지나 수익이 아직 확정되지 않았다는 뜻이다.</p></div>';
  h+='<div class="card"><h3>텐배거 저점이 나온 해</h3><div class="cv"><canvas id="tbcTroughs"></canvas></div><h4>저점이 가장 많이 몰린 달</h4><div>'+ep.topMonths.map(x=>'<span class="tag">'+esc(x.m)+' · '+x.n+'개</span>').join('')+'</div></div>';
  return h;
}
function drawWhen(){
  const ms=A.monthly;
  chart('tbcMonth',{type:'line',data:{labels:ms.map(x=>x.d),datasets:[line('5년 안 10배 비율',ms.map(x=>x.p),S1)]},options:baseOpts({fmt:v=>pct(v,0)})});
  chart('tbcQdd',{type:'line',data:{labels:ms.map(x=>x.d),datasets:[line('코스닥 낙폭',ms.map(x=>x.q),S2)]},options:baseOpts({fmt:v=>spct(v,0)})});
  const ys=A.episodes.byYear;
  chart('tbcTroughs',{type:'bar',data:{labels:ys.map(x=>String(x.y)),datasets:[bars('텐배거 저점 수',ys.map(x=>x.n),S1)]},options:baseOpts({fmt:v=>Math.round(v)+'개',xticks:narrow()?6:12})});
}

function secWhat(){
  const fb=A.featureBins,ep=A.episodes,pr=ep.profile;
  const Q=(k)=>pr[k]&&pr[k].length?pr[k]:[null,null,null,null,null];
  let h='<div class="card"><h3>10배 오르기 직전 저점에서의 모습(텐배거 '+A.meta.episodes.toLocaleString('ko-KR')+'개)</h3><div class="tw"><table><tr><th class="l">항목</th><th>하위 10%</th><th>25%</th><th>중앙값</th><th>75%</th><th>상위 10%</th></tr>'
    +[['시가총액',Q('cap0').map(eok)],['투자 가능 종목 중 시총 순위(0=가장 작음)',Q('capP').map(v=>pct(v,0))],['주가',Q('raw0').map(won)],['거래대금(20일 평균)',Q('A20_0').map(v=>ok(v)?v.toFixed(1)+'억':'–')],
      ['3년 고점 대비',Q('dd3_0').map(v=>spct(v,0))],['직전 1년 수익',Q('ret250_0').map(v=>spct(v,0))],['변동성(연)',Q('vol60_0').map(v=>pct(v,0))],['상장 뒤 기간',Q('age0').map(v=>ok(v)?v.toFixed(1)+'년':'–')]]
      .map(r=>'<tr><td class="l">'+r[0]+'</td>'+r[1].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')
    +'</table></div><p class="note">코스닥 '+ep.kosdaq+'개 · 코스피 '+ep.kospi+'개. 지금도 상장된 종목 '+ep.alive+'개(나머지는 상장폐지·합병). 상장 기간은 1995년 5월 이전 상장 종목이 짧게 잡힌다.</p></div>';
  h+='<div class="card"><h3>특징별 10배 확률 — 그때 살 수 있던 모든 종목 기준</h3><p class="lead">텐배거만 보면 \'작고 망가진 종목\'이 보이지만, 그런 종목은 원래 많고 대부분 10배가 되지 않는다. 아래는 같은 특징을 가진 <b>모든</b> 종목 중 몇 %가 10배가 됐는지다(평균 '+pct(A.base.p10_5,2)+').</p>'
    +binsTable(fb.cap,'시가총액')+'<div style="height:10px"></div>'+binsTable(fb.price,'주가')+'<div style="height:10px"></div>'+binsTable(fb.dd3,'3년 고점 대비')
    +'<div style="height:10px"></div>'+binsTable(fb.ret250,'직전 1년 수익')+'<div style="height:10px"></div>'+binsTable(fb.low52,'52주 저점 대비(이미 오른 정도)')
    +'<div style="height:10px"></div>'+binsTable(A.market,'시장')+'</div>';
  const QN={cap:'시가총액',raw:'주가 수준',A20:'거래대금',ret60:'3개월 수익',ret250:'1년 수익',pos52:'52주 고점 근접',dd3:'3년 고점 대비',vol60:'변동성',turn:'회전율',surge:'거래대금 급증',age:'상장 기간'};
  h+='<div class="card"><h3>같은 달 안에서 5등분(Q1 낮음 → Q5 높음)</h3><p class="lead">시대마다 기준이 달라지지 않게 매달 종목을 5등분해 비교했다. 평균 대비 1.2배를 넘는 칸이 드물다 — 가격 패턴 하나로 텐배거를 고르기는 어렵다.</p><div class="tw"><table><tr><th class="l">특징</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th></tr>'
    +Object.keys(A.quintiles).map(k=>'<tr><td class="l">'+(QN[k]||k)+'</td>'+A.quintiles[k].map(r=>'<td class="'+(r.lift>=1.2?'gd':'')+'">'+lift(r.lift)+'</td>').join('')+'</tr>').join('')
    +'</table></div><p class="note">숫자는 그 칸의 5년 안 10배 확률 ÷ 평균. 노란 칸은 1.2배 이상.</p></div>';
  if(ep.eras&&ep.eras.length) h+='<div class="card"><h3>시대별 텐배거와 업종</h3>'+ep.eras.map(e=>'<h4>'+esc(e.era)+' — '+e.n+'개 · 고점 배수 중앙값 '+mult(e.med_peak,1)+'</h4><div>'
      +e.top.map(t=>'<span class="tag">'+esc(t.name)+(t.now&&t.now!==t.name?'('+esc(t.now)+')':'')+' '+mult(t.peak,0)+'</span>').join('')+'</div>'
      +(e.industries.length?'<div class="note">업종(지금 상장 종목만): '+e.industries.map(x=>esc(x.name)+' '+x.n).join(' · ')+'</div>':'')).join('')
    +'<p class="note">업종은 네이버 현재 분류라 상장폐지 종목은 비어 있다. 그래서 업종은 확률 계산에 쓰지 않고 구성만 보인다.</p></div>';
  return h;
}

function secPath(){
  const pr=A.episodes.profile,Q=k=>pr[k]&&pr[k].length?pr[k]:[null,null,null,null,null];
  const row=(t,a,f)=>'<tr><td class="l">'+t+'</td>'+Q(a).map(v=>'<td>'+f(v)+'</td>').join('')+'</tr>';
  return '<div class="card"><h3>저점에서 10배까지 — 걸린 시간과 견딘 하락</h3><div class="tw"><table><tr><th class="l">항목</th><th>하위 10%</th><th>25%</th><th>중앙값</th><th>75%</th><th>상위 10%</th></tr>'
    +row('2배까지','t2',tdays)+row('3배까지','t3',tdays)+row('5배까지','t5',tdays)+row('10배까지','d10',tdays)
    +row('가는 도중 가장 큰 하락(고점 대비)','mdd10',v=>spct(v,0))
    +'</table></div><p class="note">가장 빨리 오른 10%는 '+tdays(Q('d10')[0])+' 안에 10배가 됐지만, 절반은 '+tdays(Q('d10')[2])+' 넘게 걸렸다. 가는 도중 고점 대비 '+spct(Q('mdd10')[2],0)+'(중앙값) 하락은 흔했다.</p></div>'
    +'<div class="card"><h3>고점에서의 모습 — 파는 신호</h3><div class="tw"><table><tr><th class="l">항목</th><th>하위 10%</th><th>25%</th><th>중앙값</th><th>75%</th><th>상위 10%</th></tr>'
    +row('저점 대비 고점 배수','peak',v=>mult(v,1))+row('저점에서 고점까지','dpk',tdays)+row('고점 시가총액','cap_pk',eok)
    +row('200일선 대비(배)','ma200_pk',v=>mult(v,2))+row('직전 60일 수익','ret60_pk',v=>spct(v,0))+row('거래대금 ÷ 1년 평균','surge_pk',v=>mult(v,1))
    +'</table></div></div>'
    +'<div class="card"><h3>고점 뒤 — 대부분 되돌아갔다</h3><div class="tw"><table><tr><th class="l">항목</th><th>하위 10%</th><th>25%</th><th>중앙값</th><th>75%</th><th>상위 10%</th></tr>'
    +row('고점 1년 뒤','after1',v=>spct(v,0))+row('고점 뒤 2년 안 가장 낮은 값','low2',v=>spct(v,0))
    +'</table></div><p class="note">고점 뒤 1년 수익이 가장 잘 버틴 10%에서도 '+spct(Q('after1')[4],0)+'였다. 텐배거를 잡아도 팔지 않으면 지킬 수 없었다.</p></div>';
}

function secRules(){
  const sigs=[...new Set(A.trades.map(t=>t.sig))],rules=[...new Set(A.trades.map(t=>t.rule))];
  let h='<div class="card"><h3>매수 신호 × 매도 규칙 — 거래 하나하나의 결과</h3><p class="lead">신호가 난 다음 날 종가에 사고, 매도 조건은 종가로 확인한 다음 날 판다. 비용(수수료·미끄러짐·거래세)과 상장폐지 손실 포함. 평균은 소수 대박에 끌려가므로 <b>중앙값</b>과 함께 본다.</p><div class="tw"><table><tr><th class="l">매수 신호</th><th class="l">매도 규칙</th><th>거래</th><th>평균</th><th>중앙값</th><th>이긴 비율</th><th>3배 이상</th><th>10배 이상</th><th>보유</th></tr>';
  sigs.forEach(sg=>{ rules.forEach(rl=>{ const t=A.trades.find(x=>x.sig===sg&&x.rule===rl); if(!t) return;
    h+='<tr><td class="l">'+esc(sg)+'</td><td class="l">'+esc(rl)+'</td><td>'+t.n.toLocaleString('ko-KR')+'</td><td class="'+(t.mean>=0?'up':'dn')+'">'+spct(t.mean,0)+'</td><td class="'+(t.med>=0?'up':'dn')+'">'+spct(t.med,0)+'</td><td>'+pct(t.win,0)+'</td><td>'+pct(t.x3,1)+'</td><td>'+pct(t.x10,1)+'</td><td>'+(ok(t.hold)?t.hold.toFixed(1)+'년':'–')+'</td></tr>'; }); });
  const tm=tradeNotes(A.trades);
  h+='</table></div><p class="note">'+tm+'</p></div>';
  const mc=A.portfolio.mc||[];
  if(mc.length){
    h+='<div class="card"><h3>20종목만 들고 간다면 — 무작위 순서 '+(A.portfolio.mcSeeds||30)+'회 반복</h3><p class="lead">같은 조건이라도 그중 어떤 20종목을 고르느냐에 따라 결과가 크게 갈린다. 후보 순서를 무작위로 바꿔 돌린 연 수익의 중앙값과 범위다(1997~, ₩1억4천만, 비용 포함).</p><div class="tw"><table><tr><th class="l">종목 조건</th><th class="l">언제</th><th class="l">매도</th><th>연 수익 중앙값</th><th>하위 10%</th><th>상위 10%</th><th>최대 낙폭</th></tr>'
      +mc.map(r=>'<tr><td class="l">'+esc(r.filter)+'</td><td class="l">'+esc(r.timing)+'</td><td class="l">'+esc(r.rule)+'</td><td class="'+(r.cagr>=0?'up':'dn')+'">'+spct(r.cagr,1)+'</td><td>'+spct(r.p10,1)+'</td><td>'+spct(r.p90,1)+'</td><td>'+spct(r.mdd,0)+'</td></tr>').join('')
      +'</table></div><p class="note">'+mcNote(mc,A.portfolio.bench97)+' \'폭락 국면만\'은 나머지 기간 현금으로 쉬어서 연 수익이 낮게 잡힌다.</p></div>';
  }
  return h;
}

function secBest(){
  const P=A.portfolio,M=A.model,b=P.best,bk=P.bench,tr=P.trades;
  let h='<div class="warn">연구 결과다. 실제 매매 권유가 아니며, 과거 성과가 미래를 보장하지 않는다. 작은 종목 위주라 큰 금액에는 맞지 않는다.</div>';
  h+='<div class="card"><h3>방법</h3><ol class="f"><li><b>매달 말</b> 살 수 있는 종목(20일 평균 거래대금 1억 원 이상 · 관리·환기 종목 제외 · 상장 60거래일 이상)마다 \'<b>3년 안에 3배</b>가 될 확률\'을 모형으로 매긴다. 모형은 그해 첫 결정일 전에 결과가 확정된 과거 자료로만 매년 다시 학습한다('+A.meta.modelYears[0]+'~'+A.meta.modelYears[1]+').</li>'
    +'<li>점수 <b>상위 20종목</b>을 다음 거래일 종가에 같은 금액씩 산다(빈 자리만 채운다).</li>'
    +'<li><b>'+esc(b.rule)+'</b>: 1년이 되면 팔고, 그 전에 주가가 200일선의 2배를 넘는 과열이 한 번이라도 나오면 그 뒤로는 고점에서 20% 빠지는 날 판다(종가 확인 → 다음 날 종가).</li>'
    +'<li>매도 규칙은 앞 시기('+A.meta.portStart.slice(0,4)+'~2012) 성적으로만 골랐다. 2013년 이후는 고르는 데 쓰지 않은 검증 구간이다.</li></ol></div>';
  h+='<div class="grid"><div class="card"><div class="lbl">연 수익('+A.meta.portStart.slice(0,4)+'~'+A.meta.dataTo.slice(0,4)+')</div><div class="big">'+spct(b.cagr,1)+'</div><div class="note">최대 낙폭 '+spct(b.mdd,0)+' · 거래 '+b.trades+'번</div></div>'
    +'<div class="card"><div class="lbl">검증 구간(2013~) 연 수익</div><div class="big">'+spct(b.oos_cagr,1)+'</div><div class="note">앞 시기 '+spct(b.is_cagr,1)+' · 검증 구간 최대 낙폭 '+spct(b.oos_mdd,0)+'</div></div>'
    +'<div class="card"><div class="lbl">같은 기간 지수(가격)</div><div class="big">'+spct(bk.KOSPI.cagr,1)+'</div><div class="note">코스피 · 코스닥 '+spct(bk.KOSDAQ.cagr,1)+' · 최대 낙폭 코스피 '+spct(bk.KOSPI.mdd,0)+'</div></div></div>';
  h+='<div class="card"><h3>1억4천만 원으로 시작했다면 — 지수와 비교(시작=1, 로그 눈금)</h3><div class="legend"><span><i style="background:'+S1+'"></i>모형 상위 20종목</span><span><i style="background:'+S2+'"></i>코스피</span><span><i style="background:'+S3+'"></i>코스닥</span></div><div class="cv"><canvas id="tbcCurve"></canvas></div>'
    +'<details><summary>해마다 수익(표)</summary><div class="tw"><table><tr><th>연도</th><th>수익</th></tr>'+P.yearly.map(y=>'<tr><td>'+y.y+'</td><td class="'+(y.r>=0?'up':'dn')+'">'+spct(y.r,1)+'</td></tr>').join('')+'</table></div></details></div>';
  const tbMax=P.grid.reduce((m,x)=>(x.tb||0)>(m.tb||0)?x:m,P.grid[0]);
  h+='<div class="card"><h3>매도 규칙 비교(같은 종목 선정)</h3><div class="tw"><table><tr><th class="l">매도 규칙</th><th>연 수익</th><th>최대 낙폭</th><th>앞 시기</th><th>검증(2013~)</th><th>검증 낙폭</th><th>거래</th><th>이긴 비율</th><th>10배 거래</th></tr>'
    +P.grid.map(r=>'<tr class="'+(r.rule===b.rule?'best':'')+'"><td class="l">'+esc(r.rule)+'</td><td>'+spct(r.cagr,1)+'</td><td>'+spct(r.mdd,0)+'</td><td>'+spct(r.is_cagr,1)+'</td><td>'+spct(r.oos_cagr,1)+'</td><td>'+spct(r.oos_mdd,0)+'</td><td>'+r.trades+'</td><td>'+pct(r.win,0)+'</td><td>'+(r.tb==null?'–':r.tb)+'</td></tr>').join('')
    +'</table></div><p class="note">노란 줄이 앞 시기 성적으로 고른 규칙이다. 10배 거래를 가장 많이 잡은 규칙은 \''+esc(tbMax.rule)+'\'('+(tbMax.tb||0)+'번)이지만 연 수익은 '+spct(tbMax.cagr,1)+'였다 — 큰 승자를 기다리는 동안 나머지가 고점 뒤 되돌아갔다.</p></div>';
  h+='<div class="card"><h3>흔들어 봐도 버티나</h3><div class="tw"><table><tr><th class="l">바꾼 조건</th><th>연 수익</th><th>최대 낙폭</th><th>검증(2013~)</th><th>거래</th></tr>'
    +P.robust.map(r=>'<tr><td class="l">'+esc(r.label)+'</td><td>'+spct(r.cagr,1)+'</td><td>'+spct(r.mdd,0)+'</td><td>'+spct(r.oos,1)+'</td><td>'+r.trades+'</td></tr>').join('')
    +'</table></div><p class="note">원금 두 가지(1만$·10만$ 환산)로 정수 주식 수의 왜곡을 같이 봤다. 비용을 크게 올려도, 1위 대신 21~60위 종목만 사도 결과가 크게 무너지지 않았다 — 몇 종목의 행운이 아니라는 뜻이다.</p></div>';
  h+='<div class="card"><h3>거래 하나하나</h3>'+kv('거래 수',tr.n+'번')+kv('이긴 비율',pct(tr.win,0))+kv('평균 · 중앙값',spct(tr.mean,0)+' · '+spct(tr.med,0))+kv('2배 이상 · 3배 이상',pct(tr.x2,1)+' · '+pct(tr.x3,1))
    +kv('−50% 이하 손실',pct(tr.loss50,1))+kv('평균 보유',Math.round(tr.hold)+'거래일')+kv('상위 10거래가 전체 이익에서 차지',pct(tr.top10_share,0))+kv('사는 동안 잡은 텐배거(저점~10배 사이 매수)',tr.tb_caught+'개 / '+tr.tb_total+'개')+'</div>';
  h+='<div class="card"><h3>모형이 고르는 종목의 모습(매달 상위 20종목 중앙값)</h3><div class="tw"><table><tr><th class="l">항목</th><th>상위 20</th><th>전체</th></tr>'
    +M.topProfile.map(p=>{ const f=p.k==='cap'||p.k==='A20'?(v=>ok(v)?(p.k==='cap'?eok(v):v.toFixed(1)+'억'):'–'):p.k==='raw'?won:p.k==='age'?(v=>ok(v)?v.toFixed(1)+'년':'–'):p.k==='ma200p'?(v=>mult(v,2)):p.k==='vol60'?(v=>pct(v,1)):(v=>spct(v,1));
      return '<tr><td class="l">'+esc(p.ko)+'</td><td>'+f(p.top)+'</td><td>'+f(p.all)+'</td></tr>'; }).join('')
    +'</table></div><p class="note">작고(시총) · 싸고(주가) · 거래가 한산하지만 기준(1억)은 넘고 · 오래된 회사 · 변동성은 오히려 낮고 · 최근 한두 달 조금 오른 종목. \'망가진 소형주\' 중에서도 버티는 쪽을 고른다.</p>'
    +'<h4>모형이 무게를 둔 특징(지금 모형 · 표준화 계수 큰 순)</h4><div class="tw"><table><tr><th class="l">특징</th><th class="l">모양</th><th>계수</th><th class="l">읽는 법</th></tr>'
    +M.coef.slice(0,10).map(c=>'<tr><td class="l">'+esc(c.ko)+'</td><td class="l">'+esc(c.kind)+'</td><td>'+(c.w>=0?'+':'−')+Math.abs(c.w).toFixed(2)+'</td><td class="l">'+coefWords(c)+'</td></tr>').join('')
    +'</table></div><p class="note">\'방향\'은 그 특징이 클수록(같은 달 순위) 확률이 오르면 +, 내리면 −. \'곡선\'은 가운데보다 양 끝(아주 작거나 아주 큼)이 유리하면 +, 불리하면 −.</p>'
    +'<h4>모형 점수 10등분 — 결과가 확정된 달만(검증용 점수)</h4><div class="cv"><canvas id="tbcDec"></canvas></div>'
    +'<div class="tw"><table><tr><th>등분(10=높음)</th><th>3년 안 3배</th><th>5년 안 10배</th><th>1년 수익 중앙값</th><th>3년 중앙값</th><th>5년 중앙값</th><th>5년 안 상장폐지</th></tr>'
    +M.deciles.map(d=>'<tr><td>'+d.d+'</td><td>'+pct(d.p3,1)+'</td><td>'+pct(d.p10,1)+'</td><td>'+spct(d.r1,1)+'</td><td>'+spct(d.r3,0)+'</td><td>'+spct(d.r5,0)+'</td><td>'+pct(d.dead,0)+'</td></tr>').join('')
    +'</table></div><p class="note">AUC(맞힘 정도, 0.5=동전) — 3년 안 3배 '+(M.auc.y3_3||'–')+' · 5년 안 10배 '+(M.auc.y10_5||'–')+'. 높지 않지만 10등분 위아래의 차이는 뚜렷하다.</p></div>';
  return h;
}
function drawBest(){
  const c=A.portfolio.curve;
  chart('tbcCurve',{type:'line',data:{labels:c.map(x=>x.d),datasets:[line('모형 상위 20종목',c.map(x=>x.v),S1),line('코스피',c.map(x=>x.k),S2),line('코스닥',c.map(x=>x.q),S3)]},
    options:baseOpts({log:true,fmt:v=>ok(v)?(v>=10?Math.round(v).toLocaleString('ko-KR'):(+v).toFixed(v>=1?1:2))+'배':'–'})});
  const d=A.model.deciles;
  chart('tbcDec',{type:'bar',data:{labels:d.map(x=>String(x.d)),datasets:[bars('3년 수익 중앙값',d.map(x=>x.r3),S1)]},options:baseOpts({fmt:v=>spct(v,0)})});
}

function secNow(){
  const C=A.current,td=C.topDecile||{};
  let h='<div class="warn">연구용 목록이다 — 매수 권유가 아니다. 과거 같은 점수 상위 10%의 결과: 3년 안 3배 '+pct(td.p3,0)+' · 1년 수익 중앙값 '+spct(td.r1,1)+' · 3년 중앙값 '+spct(td.r3,0)+' · 5년 안 상장폐지 '+pct(td.dead,0)+'. 대부분은 10배가 되지 않는다.</div>';
  h+='<div class="grid"><div class="card"><div class="lbl">자료 마지막 날</div><div class="big">'+esc(C.asOf)+'</div><div class="note">살 수 있는 종목 '+C.universe.toLocaleString('ko-KR')+'개</div></div>'
    +'<div class="card"><div class="lbl">코스닥 1년 고점 대비</div><div class="big '+(C.qdd<=-0.4?'gd':'')+'">'+spct(C.qdd,0)+'</div><div class="note">코스피 '+spct(C.kdd,0)+' · '+(C.crash?'<b class="gd">폭락 국면 기준(코스닥 −40% 또는 코스피 −30%)에 해당</b>':'폭락 국면 기준(코스닥 −40% 또는 코스피 −30%)에는 아직 못 미친다')+'</div></div></div>';
  h+='<div class="card"><h3>지금 모형 점수 상위 30종목</h3><p class="lead">위 방법에서 매달 사는 \'상위 20\'의 오늘 버전이다. 점수는 순위를 매기는 값(\'3년 안 3배\' 모형 추정치)이다 — 과거 전체 평균은 '+pct(A.base.p3_3,0)+', 점수 상위 10%가 실제로 3배가 된 비율은 '+pct(td.p3,0)+'였다. 점수를 확률 그대로 믿지 않는다.</p><div class="tw"><table><tr><th>#</th><th class="l">종목</th><th>시장</th><th>모형 점수</th><th>시가총액</th><th>주가</th><th>거래대금</th><th>3개월</th><th>3년 고점 대비</th><th class="l">업종</th></tr>'
    +C.candidates.map((c,i)=>'<tr><td>'+(i+1)+'</td><td class="l">'+esc(c.name)+' <span class="note">'+esc(c.code)+'</span></td><td>'+esc(c.mkt)+'</td><td>'+pct(c.score,0)+'</td><td>'+eok(c.cap)+'</td><td>'+won(c.price)+'</td><td>'+(ok(c.A20)?c.A20.toFixed(1)+'억':'–')+'</td><td class="'+(c.ret60>=0?'up':'dn')+'">'+spct(c.ret60,0)+'</td><td>'+spct(c.dd3,0)+'</td><td class="l">'+esc(c.industry||'')+'</td></tr>').join('')
    +'</table></div><p class="note">자료가 매일 바뀌지 않는다 — 이 목록은 분석을 다시 돌린 날('+esc(A.meta.generatedAt)+') 기준이다.</p></div>';
  return h;
}

function secList(){
  const E=A.episodes,q=st.q,v=listView(E.list,E.cols,q);
  const yrs=[...new Set(E.list.map(r=>String(r[E.cols.indexOf('t0')]).slice(0,4)))].sort();
  const opt=(val,lab,cur)=>'<option value="'+val+'"'+(String(cur)===String(val)?' selected':'')+'>'+lab+'</option>';
  let h='<div class="card"><h3>텐배거 구간 '+E.list.length.toLocaleString('ko-KR')+'개 — 살 수 있던 저점에서 5년 안 10배</h3>'
    +'<div class="row"><input id="tbcQ" placeholder="종목·코드·업종 찾기" value="'+esc(q.text)+'">'
    +'<select id="tbcMkt">'+opt('','시장 전체',q.mkt)+opt('코스피','코스피',q.mkt)+opt('코스닥','코스닥',q.mkt)+'</select>'
    +'<select id="tbcSt">'+opt('','상장·폐지 전체',q.status)+opt('alive','지금 상장',q.status)+opt('gone','상장폐지·합병',q.status)+'</select>'
    +'<select id="tbcFrom">'+opt('','저점 연도 처음',q.from)+yrs.map(y=>opt(y,y+'년부터',q.from)).join('')+'</select>'
    +'<select id="tbcTo">'+opt('','끝까지',q.to)+yrs.map(y=>opt(y,y+'년까지',q.to)).join('')+'</select>'
    +'<select id="tbcSort">'+opt('peak','고점 배수 큰 순',q.sort)+opt('t0','저점 날짜 순',q.sort)+opt('d10','10배까지 빠른 순',q.sort)+opt('cap0','저점 시총 작은 순',q.sort)+'</select></div>'
    +'<div class="note" style="margin-bottom:6px">'+v.total.toLocaleString('ko-KR')+'개 중 '+v.page+'/'+v.pages+'쪽</div>'
    +'<div class="tw"><table><tr><th class="l">종목(그때 이름)</th><th>시장</th><th>저점</th><th>10배 날</th><th>고점</th><th>고점 배수</th><th>10배까지</th><th>저점 시총</th><th>저점 주가</th><th>3년 고점 대비</th><th class="l">업종</th></tr>'
    +v.items.map(e=>'<tr><td class="l">'+esc(e.name0)+(e.name!==e.name0?' <span class="note">→ '+esc(e.name)+'</span>':'')+(e.alive?'':' <span class="tag">폐지</span>')+'</td><td>'+esc(e.mkt)+'</td><td>'+esc(e.t0)+'</td><td>'+esc(e.t10)+'</td><td>'+esc(e.tp)+'</td><td>'+mult(e.peak,1)+'</td><td>'+tdays(e.d10)+'</td><td>'+eok(e.cap0)+'</td><td>'+won(e.raw0)+'</td><td>'+spct(e.dd3,0)+'</td><td class="l">'+esc(e.industry||'')+'</td></tr>').join('')
    +'</table></div><div class="row" style="justify-content:center;margin-top:10px"><button class="btn" id="tbcPrev"'+(v.page<=1?' disabled':'')+'>‹ 앞</button><button class="btn" id="tbcNext"'+(v.page>=v.pages?' disabled':'')+'>뒤 ›</button></div>'
    +'<p class="note">고점은 10배 뒤 \'고점에서 50% 넘게 빠지기 전\'의 최고 종가다. 수정주가(분할·증자·감자 반영) · 배당 제외. \'폐지\'는 상장폐지·합병으로 지금 없는 종목.</p></div>';
  return h;
}
function bindList(){
  const set=(k,v)=>{ st.q[k]=v; if(k!=='page') st.q.page=1; draw(); };
  const q=document.getElementById('tbcQ'); if(q){ let t=0; q.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>{ set('text',q.value); const n=document.getElementById('tbcQ'); if(n){ n.focus(); n.setSelectionRange(n.value.length,n.value.length); } },250); }; }
  [['tbcMkt','mkt'],['tbcSt','status'],['tbcFrom','from'],['tbcTo','to'],['tbcSort','sort']].forEach(([id,k])=>{ const el=document.getElementById(id); if(el) el.onchange=()=>{ if(k==='sort') st.q.dir=el.value==='peak'?'desc':'asc'; set(k,el.value); }; });
  const pv=document.getElementById('tbcPrev'),nx=document.getElementById('tbcNext');
  if(pv) pv.onclick=()=>set('page',st.q.page-1); if(nx) nx.onclick=()=>set('page',st.q.page+1);
}

function secHow(){
  const m=A.meta;
  return '<div class="card"><h3>자료</h3><ul class="f"><li>KRX 전종목시세를 날마다 모은 공개 자료(FinanceData/marcap) '+esc(m.dataFrom)+' ~ '+esc(m.dataTo)+' · '+m.tradingDays.toLocaleString('ko-KR')+'거래일. <b>상장폐지 종목도 상장돼 있던 날까지 들어 있어</b> 살아남은 종목만 보는 착시(생존편향)가 없다.</li>'
    +'<li>코스피·코스닥 보통주만(우선주·코넥스·스팩·리츠·각종 펀드 제외). 같은 코드가 20거래일 넘게 비었다가 다시 나오면 다른 종목으로 나눴다(재상장).</li>'
    +'<li>수정주가: KRX 기준가(종가−전일대비)로 하루 수익률을 이어 붙였다 — 액면분할·병합·무상·유상증자·감자가 반영된다. 네이버 수정주가와 48종목 대조에서 30년 누적이 거의 같았다. 규정상 하루에 나올 수 없는 값은 주식 수가 바뀐 날이면 시가총액 연속으로, 아니면 0으로 고쳤다('+(m.dataFix?m.dataFix[0]+'일 · '+m.dataFix[1]+'일':'')+'). 상장폐지 전 30거래일(정리매매)은 사지 않는다.</li>'
    +'<li>현금배당은 빠져 있다(가격 수익률). 업종은 네이버 현재 분류(지금 상장 종목만).</li></ul></div>'
    +'<div class="card"><h3>정의</h3><ul class="f"><li><b>살 수 있던 날</b>: 20일 평균 거래대금 '+(m.liqMin/1e8)+'억 원 이상 · 거래가 있었고 · 정리매매가 아님.</li>'
    +'<li><b>텐배거 구간</b>: 살 수 있던 날의 종가(저점)에서 5년(1,250거래일) 안에 종가가 10배 이상이 된 경우. 같은 종목도 고점 뒤 다시 바닥을 다지고 10배가 되면 새 구간이다.</li>'
    +'<li><b>확률(기저율)</b>: '+m.cohortMonths+'개 월말 × 그달 살 수 있던 모든 종목('+m.cohortRows.toLocaleString('ko-KR')+'행). 사후에 고른 텐배거만 보지 않고, 같은 특징을 가진 모든 종목 중 몇 %가 10배가 됐는지를 본다.</li>'
    +'<li><b>체결</b>: 그날 종가까지의 자료로 신호를 정하고 다음 거래일 종가에 산다. 매도도 종가로 확인한 다음 날 판다(미래 자료 사용 금지).</li>'
    +'<li><b>비용</b>: 사고팔 때 수수료 0.015% + 미끄러짐 0.2%, 팔 때 연도별 거래세(0.30%→0.15~0.20%). 상장폐지는 마지막 가격에 강제 매도.</li></ul></div>'
    +'<div class="card"><h3>한계</h3><ul class="f"><li>재무(매출·이익·PER·PBR)와 뉴스·테마 자료가 없다 — 가격·거래·규모·시장 국면만으로 본 결과다.</li>'
    +'<li>월말 표본은 5년 결과 창이 서로 겹친다 — 표본 수만큼 독립적이지 않다. 그래서 확률 차이는 \'몇 배\' 수준만 믿고, 소수점은 믿지 않는다.</li>'
    +'<li>폭락 국면(코스닥 −40% 또는 코스피 −30%의 첫날)은 30년에 '+A.crash.length+'번뿐이다 — 국면 효과는 강하지만 독립 사례가 적다.</li>'
    +'<li>작은 종목 위주라 큰 금액은 시장 충격이 크다(시험은 ₩1,400만·₩1억4천만). 호가 공백·거래정지·세금 변경은 가정으로만 넣었다.</li>'
    +'<li>2013년 이후 검증 구간도 결국 과거다 — 앞으로 같은 크기로 통한다는 보장은 없다.</li></ul>'
    +'<p class="note">다시 계산: <code>scripts/tenbagger_claude/</code> — panel.py(패널) → industry.py(업종·지수) → analyze.py(이 화면 자료).</p></div>';
}

const SEC={sum:[secSummary],when:[secWhen,drawWhen],what:[secWhat],path:[secPath],rules:[secRules],best:[secBest,drawBest],now:[secNow],list:[secList,bindList],how:[secHow]};
function draw(){
  const body=document.getElementById('tbc-body'); if(!body) return;
  Object.keys(st.charts).forEach(k=>{ st.charts[k].destroy(); delete st.charts[k]; });
  const s=SEC[st.tab]||SEC.sum;
  try{ body.innerHTML=s[0](); if(s[1]) s[1](); }
  catch(e){ console.error(e); body.innerHTML='<div class="warn">이 칸을 그리지 못했습니다 — '+esc(e.message||e)+'</div>'; }
}
function render(){
  const root=document.getElementById(ROOT_ID); if(!root) return;
  root.innerHTML='<div class="sub2">'+TABS.map(t=>'<button class="chip'+(st.tab===t[0]?' on':'')+'" data-tt="'+t[0]+'">'+t[1]+'</button>').join('')+'</div><div id="tbc-body"></div>';
  root.querySelectorAll('[data-tt]').forEach(b=>b.onclick=()=>{ st.tab=b.getAttribute('data-tt'); root.querySelectorAll('[data-tt]').forEach(x=>x.classList.toggle('on',x===b)); draw(); });
  draw();
}
async function boot(){
  const root=document.getElementById(ROOT_ID); if(!root) return;
  if(!document.getElementById('tbc-css')){ const s=document.createElement('style'); s.id='tbc-css'; s.textContent=CSS; document.head.appendChild(s); }
  try{
    const r=await fetch(DATA,{cache:'no-cache'});
    if(!r.ok) throw new Error('분석 파일 '+r.status);
    const j=await r.json(),bad=validate(j);
    if(bad) throw new Error(bad);
    A=j; render();
  }catch(e){ root.innerHTML='<div class="warn">분석 자료를 불러오지 못했습니다 — '+esc(e.message||e)+'</div>'; }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})(typeof window!=='undefined'?window:globalThis);
