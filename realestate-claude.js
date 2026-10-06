/* 부동산 — 🤖 클로드 탭 화면. 계산은 realestate-claude-engine.js 한 곳에서만 하고, 여기서는 그리기만 한다.
   이 파일과 #pane-claude 안만 클로드 작업 영역이다(지피티 탭은 건드리지 않는다). */
(function(){
'use strict';
const E=window.JKRealEstateClaude;
const ROOT_ID='rec-root',DATA='/data/realestate/claude/';
const COLORS={daejeon:'#8b8cf0',dj_dong:'#f87b8c',dj_jung:'#f5c451',dj_seo:'#36d399',dj_yuseong:'#5ec8f2',dj_daedeok:'#c29cf5',
  sejong:'#ff9f43',national:'#9aa6c9',seoul:'#59627f',metro5:'#7d86a8',cheongju:'#88a',cheonan:'#a88',gongju:'#8a8',gyeryong:'#aa8'};
const st={tab:'sum',region:'daejeon',real:false,opts:{},charts:{}};
let DOC=null,PAPER=null,D=null,WF=null,SNAP=null,WFL=null;

/* ── 꾸밈(클로드 칸 안에서만) ── */
const CSS=`
#pane-claude{padding:14px 14px 18px;text-align:left}
.rec{text-align:left;color:var(--text)}
.rec .sub2{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin:2px 0 12px}
.rec .chip{flex:0 0 auto;border:1px solid var(--border);background:var(--surf2);color:var(--dim);border-radius:8px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer}
.rec .chip.on{border-color:var(--gold);color:var(--gold)}
.rec .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:12px}
.rec .card{background:var(--surf2);border:1px solid var(--border);border-radius:12px;padding:13px;margin-bottom:10px}
.rec .card h3{margin:0 0 8px;font-size:14px;color:var(--text)}
.rec .card h4{margin:12px 0 6px;font-size:12.5px;color:var(--dim)}
.rec .big{font-size:22px;font-weight:900;line-height:1.25}
.rec .kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.05)}
.rec .kv span{flex:0 0 auto;white-space:nowrap;color:var(--dim)}
.rec .kv b{font-variant-numeric:tabular-nums;min-width:0}
.rec .note{font-size:11.5px;color:var(--faint);line-height:1.6}
.rec .lead{font-size:12.5px;color:var(--dim);line-height:1.65;margin:0 0 8px}
.rec .up{color:var(--green)} .rec .dn{color:var(--red)} .rec .gd{color:var(--gold)}
.rec table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.rec th,.rec td{padding:6px 7px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
.rec th{color:var(--faint);font-weight:700;background:rgba(255,255,255,.02)}
.rec td:first-child,.rec th:first-child{text-align:left}
.rec td.l,.rec th.l{text-align:left;white-space:normal}
.rec .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
.rec .tag{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);color:var(--dim);margin:0 4px 4px 0}
.rec .tag.hot{color:var(--gold);border-color:rgba(245,196,81,.45)}
.rec ul.f{margin:4px 0 0;padding-left:18px;font-size:12.5px;line-height:1.7;color:var(--dim)}
.rec ul.f b{color:var(--text)}
.rec .cv{position:relative;height:280px}
.rec .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 8px}
.rec select,.rec .btn{background:var(--surf);color:var(--text);border:1px solid var(--border);border-radius:8px;height:34px;padding:0 9px;font-size:12px}
.rec .btn{cursor:pointer;font-weight:800}
.rec .btn.on{border-color:var(--accent);color:#c9caff}
.rec .warn{padding:9px 11px;border-radius:9px;background:rgba(245,196,81,.08);border:1px solid rgba(245,196,81,.28);color:#f3d58a;font-size:11.5px;line-height:1.6;margin-bottom:10px}
@media(max-width:560px){.rec .cv{height:230px}.rec .big{font-size:19px}}
`;

/* ── 숫자 ── */
const pct=(x,d)=>x==null||!isFinite(x)?'–':(x>=0?'+':'')+(x*100).toFixed(d==null?1:d)+'%';
const pct0=(x,d)=>x==null||!isFinite(x)?'–':(x*100).toFixed(d==null?1:d)+'%';
const pp=(x,d)=>x==null||!isFinite(x)?'–':(x>=0?'+':'')+(x*100).toFixed(d==null?1:d)+'%p';
const num=(x,d)=>x==null||!isFinite(x)?'–':(+x).toFixed(d==null?1:d);
const won=x=>x==null||!isFinite(x)?'–':(x/1e8).toFixed(2)+'억';
const wonM=x=>x==null||!isFinite(x)?'–':Math.round(x/1e4).toLocaleString('ko-KR')+'만';
const cls=x=>x==null?'':(x>=0?'up':'dn');
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const L=r=>r?E.label(D,r):'현금(예금)';
function fmtF(fmt,x){ return fmt==='pct'?pct(x):fmt==='pp'?pp(x):fmt==='pp1'?(x==null?'–':(x>=0?'+':'')+x.toFixed(2)+'%p'):fmt==='x'?(x==null?'–':num(x,2)+'배'):num(x,1); }

/* ── 그래프 ── */
function chart(id,labels,datasets,o){
  o=o||{}; if(st.charts[id]){ st.charts[id].destroy(); delete st.charts[id]; }
  const el=document.getElementById(id); if(!el||!window.Chart) return;
  const fy=o.fmt||(v=>v);
  st.charts[id]=new Chart(el.getContext('2d'),{type:o.type||'line',data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},animation:false,spanGaps:true,
      elements:{point:{radius:0,hitRadius:6},line:{borderWidth:1.6}},
      plugins:{legend:{labels:{color:'#9aa6c9',boxWidth:10,font:{size:10.5}}},
        tooltip:{backgroundColor:'#1c2238',borderColor:'#2e3754',borderWidth:1,titleColor:'#9aa6c9',bodyColor:'#e8ecf7',
          callbacks:{label:c=>' '+c.dataset.label+': '+(c.parsed.y==null?'–':(c.dataset.yAxisID==='y2'&&o.y2?o.y2(c.parsed.y):fy(c.parsed.y)))}}},
      scales:{x:{ticks:{color:'#6f7ba0',maxTicksLimit:9,font:{size:10}},grid:{color:'#1e2540'}},
        y:{type:o.log?'logarithmic':'linear',ticks:{color:'#6f7ba0',font:{size:10},callback:v=>fy(v)},grid:{color:'#1e2540'}},
        ...(o.y2?{y2:{position:'right',ticks:{color:'#c9a24a',font:{size:10},callback:v=>o.y2(v)},grid:{drawOnChartArea:false}}}:{})}}});
}
function months(k0,k1){ const a=[]; for(let k=k0;k<=k1;k++) a.push(E.kym(k)); return a; }
function lineOf(s,k0,k1,f){ const a=[]; for(let k=k0;k<=k1;k++){ const v=E.at(s,k); a.push(v==null?null:(f?f(v,k):v)); } return a; }
function ds(label,data,color,extra){ return Object.assign({label,data,borderColor:color,backgroundColor:color,fill:false},extra||{}); }

/* ── 계산 묶음 ── */
function compute(){
  D=E.prepare(DOC);
  WF=E.walkForward(D,st.opts);
  WFL=E.walkForwardLong(D,st.opts);
  SNAP=E.snapshot(D,st.opts);
}

/* ── 칸들 ── */
const TABS=[['sum','요약'],['hist','40년 흐름'],['why','사이클·원인'],['sup','공급·수급'],['strat','전략 검증'],['paper','모의투자'],['data','데이터·가정']];
function render(){
  const root=document.getElementById(ROOT_ID); if(!root) return;
  Object.keys(st.charts).forEach(k=>{ st.charts[k].destroy(); delete st.charts[k]; });
  root.innerHTML='<div class="sub2">'+TABS.map(t=>'<button class="chip'+(st.tab===t[0]?' on':'')+'" data-rt="'+t[0]+'">'+t[1]+'</button>').join('')+'</div><div id="rec-body"></div>';
  root.querySelectorAll('[data-rt]').forEach(b=>b.onclick=()=>{ st.tab=b.getAttribute('data-rt'); render(); });
  const body=document.getElementById('rec-body');
  try{ ({sum:renderSum,hist:renderHist,why:renderWhy,sup:renderSup,strat:renderStrat,paper:renderPaper,data:renderData})[st.tab](body); }
  catch(e){ body.innerHTML='<div class="warn">화면을 그리지 못했습니다: '+esc(e.message||e)+'</div>'; console.error(e); }
}

function findings(){
  const out=[],fs=E.factorStudy(D,{h:12});
  for(const f of fs){
    if(!f.buckets.length) continue; const lo=f.buckets[0],hi=f.buckets[2];
    if(lo.avg==null||hi.avg==null) continue;
    const diff=hi.avg-lo.avg; if(Math.abs(diff)<0.015) continue;
    out.push({w:Math.abs(diff),html:'<b>'+esc(f.label)+'</b> — '+esc(f.hi)+'(상위 1/3)일 때 이후 12개월 평균 <b class="'+cls(hi.avg)+'">'+pct(hi.avg)+'</b>(오른 비율 '+pct0(hi.hit,0)+'), '
      +esc(f.lo)+'(하위 1/3)일 때 <b class="'+cls(lo.avg)+'">'+pct(lo.avg)+'</b>('+pct0(lo.hit,0)+') · '+f.from+'~'+f.to});
  }
  out.sort((a,b)=>b.w-a.w);
  const weak=fs.filter(f=>f.buckets.length&&f.rho!=null&&Math.abs(f.rho)<0.1).map(f=>f.label);
  if(weak.length) out.push({w:0,html:'뚜렷한 관계가 <b>없던</b> 지표: '+weak.map(esc).join(' · ')+' (순위상관 0.1 미만)'});
  const ll=E.leadLag(D,'sejong','daejeon',12);
  if(ll&&ll.best&&ll.best.r>-2){
    const b=ll.best,z=ll.lags.find(x=>x.lag===0);
    out.push({w:0,html:b.lag>0?'<b>세종이 대전보다 약 '+b.lag+'개월 앞서</b> 움직였다(월간 변동 상관 '+num(b.r,2)+', 같은 달 '+num(z&&z.r,2)+' · '+ll.from+'~'+ll.to+').'
      :b.lag<0?'<b>대전이 세종보다 약 '+(-b.lag)+'개월 앞서</b> 움직였다(상관 '+num(b.r,2)+').':'세종과 대전은 <b>같은 달</b>에 가장 비슷하게 움직였다(상관 '+num(b.r,2)+') — 세종이 대전을 앞서지는 않았다.'});
  }
  return out.slice(0,8).map(x=>x.html);
}
function pickWhy(p){
  if(!p) return '';
  if(p.stay) return '보유 중인 곳이 조건을 계속 만족해서 유지';
  if(p.target) return '조건을 만족하는 지역 중 1위';
  if(p.rule==='momRate'&&p.rate12!=null&&p.rate12>0) return '기준금리가 1년 전보다 '+p.rate12.toFixed(2)+'%p 올라 쉬는 구간(금리 필터)';
  if(p.rule==='mom'||p.rule==='momRate') return '어느 지역도 '+p.k+'개월 상승률이 '+pct0(p.th,1)+'를 넘지 않음';
  if(p.rule==='cash') return '학습 기간에 예금이 집보다 나았음';
  return '조건을 만족하는 지역이 없음';
}
function cyclesSummary(r){
  const cs=E.cycles(D,r,st.opts).filter(c=>!c.open);
  const up=cs.filter(c=>c.type==='up'),dn=cs.filter(c=>c.type==='down');
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return {up:up.length,dn:dn.length,upM:avg(up.map(c=>c.months)),upC:avg(up.map(c=>c.change)),dnM:avg(dn.map(c=>c.months)),dnC:avg(dn.map(c=>c.change))};
}

function renderSum(el){
  const p=SNAP.pick,m=WF&&WF.meta.stats,b=WF&&WF.bench.daejeon&&WF.bench.daejeon.stats,c=WF&&WF.bench.cash&&WF.bench.cash.stats;
  const led=PAPER&&PAPER.marks?PAPER:null,lastDec=PAPER&&PAPER.decisions&&PAPER.decisions.length?PAPER.decisions[PAPER.decisions.length-1]:null;
  const csD=cyclesSummary('daejeon'),csS=cyclesSummary('sejong');
  let h='<div class="warn">과거 통계로 만든 연구용 모의투자입니다. 투자 권유가 아니며, 지수는 지역 평균이라 개별 단지와 다를 수 있습니다.</div>';
  h+='<div class="grid">';
  h+='<div class="card"><h3>🧭 지금 판단</h3>';
  if(p){
    h+='<div class="big '+(p.target?'gd':'')+'">'+esc(L(p.target))+'</div>'
      +'<div class="note">'+esc(p.forMonth)+' 보유 구간부터 · '+esc(p.dataMonth)+' 지수까지 보고 결정</div>'
      +'<div class="kv"><span>적용 전략</span><b style="white-space:normal;text-align:right">'+esc(p.label)+'</b></div>'
      +'<div class="kv"><span>사유</span><b style="white-space:normal;text-align:right">'+esc(pickWhy(p))+'</b></div>'
      +topScores(p.scores,p.cand);
  } else h+='<div class="note">판단할 자료가 부족합니다.</div>';
  h+='</div>';
  h+='<div class="card"><h3>📒 모의투자 장부</h3>';
  if(led){
    const nav=led.acct.nav,ret=nav/led.capital-1;
    h+='<div class="big">'+won(nav)+' <span class="'+cls(ret)+'" style="font-size:14px">'+pct(ret)+'</span></div>'
      +'<div class="kv"><span>시작</span><b>'+esc(led.startedData)+' 자료부터 · 원금 '+won(led.capital)+'</b></div>'
      +'<div class="kv"><span>지금 보유</span><b>'+esc(L(led.acct.pos))+'</b></div>'
      +'<div class="kv"><span>정산된 달</span><b>'+led.marks.length+'개월</b></div>'
      +(lastDec?'<div class="kv"><span>다음 보유</span><b>'+esc(lastDec.m)+' · '+esc(L(lastDec.target))+'</b></div>':'')
      +(led.marks.length?'':'<div class="note">첫 정산은 '+esc(led.decisions[0]&&led.decisions[0].m)+' 지수가 공표되는 다음 달 중순입니다.</div>');
  } else h+='<div class="note">장부를 불러오지 못했습니다.</div>';
  h+='</div>';
  h+='<div class="card"><h3>🧪 과거 검증 (워크포워드)</h3>';
  if(m){
    h+='<div class="kv"><span>검증 기간</span><b>'+esc(WF.oosFrom)+' ~ '+esc(WF.lastRet)+'</b></div>'
      +'<div class="kv"><span>클로드 전략 연복리</span><b class="'+cls(m.cagr)+'">'+pct(m.cagr)+'</b></div>'
      +'<div class="kv"><span>대전 전체 보유</span><b class="'+cls(b&&b.cagr)+'">'+pct(b&&b.cagr)+'</b></div>'
      +'<div class="kv"><span>현금(예금)</span><b>'+pct(c&&c.cagr)+'</b></div>'
      +'<div class="kv"><span>최대낙폭 전략 / 대전</span><b>'+pct0(m.mdd)+' / '+pct0(b&&b.mdd)+'</b></div>'
      +'<div class="kv"><span>3억 → 전략 / 대전</span><b>'+won(m.end)+' / '+won(b&&b.end)+'</b></div>'
      +(WFL&&WFL.bench.daejeon?'<div class="kv"><span>장기 · 대전 전체(KB) '+esc(WFL.oosFrom.slice(0,4))+'~</span><b>보유 '+pct(WFL.bench.daejeon.stats.cagr)+' / 전략 '+pct(WFL.meta.stats.cagr)+'</b></div>':'')
      +'<div class="note">해마다 그해 1월에 볼 수 있던 자료로만 전략을 골라 다음 1년에 적용했습니다(미래 자료 미사용).</div>';
  }
  h+='</div></div>';
  const mkF=E.factorStudy(D,{h:12}).find(f=>f.id==='market'),mkNow=r=>E.at(D.kbMarket[r],E.lastK(D.kbMarket[r])),mkB=v=>!mkF||!mkF.buckets.length||v==null?null:mkF.buckets[v<=mkF.q1?0:v<=mkF.q2?1:2];
  const usNow=r=>{ const k=E.lastK(D.unsold[r]); return k==null?null:{v:E.at(D.unsold[r],k),c:E.unsoldChange(D,r,k),m:E.kym(k)}; };
  h+='<div class="card"><h3>🏗️ 공급·수급 체크 — 지금</h3>'+supplyTable(supplyRows())
    +'<div class="grid" style="margin-top:8px">'+['daejeon','sejong'].map(r=>{ const v=mkNow(r),b=mkB(v),u=usNow(r);
      return '<div><div class="kv"><span>'+esc(L(r))+' KB 매수우위</span><b>'+num(v,1)+(b?' <span class="note">→ 과거 이 구간 뒤 12개월 '+pct(b.avg)+'</span>':'')+'</b></div>'
        +(u?'<div class="kv"><span>'+esc(L(r))+' 미분양('+esc(u.m)+')</span><b>'+Math.round(u.v).toLocaleString('ko-KR')+'호 · 1년 '+pct(u.c)+'</b></div>':'')+'</div>'; }).join('')+'</div>'
    +'<div class="note">입주 예정은 KB(분양 때 공개된 일정). 매수우위 100 = 균형, 낮을수록 팔려는 사람이 많다. 자세한 그래프는 ‘공급·수급’ 칸.</div></div>';
  const ol=E.outlook(D);
  h+='<div class="card"><h3>🗺️ 지역별 참고 전망 — 지금 지표가 과거에 어땠나 (실험적)</h3><p class="lead">'+esc(ol.dataMonth)+' 지표가 과거 어느 구간(하위·중위·상위 1/3)에 해당하는지 보고, 그 구간에서 <b>이후 12개월 평균</b>이 얼마였는지 지표별로 모아 단순 평균했습니다. 전략 판단과 별개의 참고값입니다.</p>'
    +'<div class="tw"><table><tr><th>지역</th><th>참고 평균</th>'+ol.factors.map(f=>'<th class="l">'+esc(f.label)+'</th>').join('')+'</tr>'
    +ol.rows.map(r=>'<tr><td>'+esc(r.label)+'</td><td class="'+cls(r.avg)+'"><b>'+pct(r.avg)+'</b></td>'+ol.factors.map(f=>{ const x=r.parts.find(q=>q.id===f.id);
        return '<td class="l">'+(x?esc(fmtF(x.fmt,x.v))+' <span class="note">'+esc(x.word)+' → </span><span class="'+cls(x.avg)+'">'+pct(x.avg)+'</span>':'<span class="note">–</span>')+'</td>'; }).join('')+'</tr>').join('')
    +'</table></div><div class="note">순위상관 0.2 이상인 지표만 썼습니다('+ol.factors.map(f=>esc(f.label)+' '+num(f.rho,2)).join(' · ')+'). 지표끼리 겹치는 정보가 있어 단순 평균은 과장될 수 있습니다. 매매수급지수는 대전 전체·세종만 있습니다.</div></div>';
  h+='<div class="card"><h3>🔎 30년 자료에서 찾은 패턴</h3><ul class="f">'+findings().map(x=>'<li>'+x+'</li>').join('')
    +'<li>대전 아파트는 상승기 '+csD.up+'번(평균 '+num(csD.upM,0)+'개월 · '+pct(csD.upC)+'), 하락기 '+csD.dn+'번(평균 '+num(csD.dnM,0)+'개월 · '+pct(csD.dnC)+')을 거쳤다(고점·저점에서 '+Math.round(E.DEFAULTS.zigzag*100)+'% 되돌림 기준).</li>'
    +'<li>세종은 상승기 '+csS.up+'번(평균 '+pct(csS.upC)+'), 하락기 '+csS.dn+'번(평균 '+pct(csS.dnC)+') — 대전보다 오르내림이 크다.</li>'
    +'</ul><div class="note">‘높음/낮음’은 지표 하위·상위 1/3 구간입니다. 같은 시기 여러 지역·겹치는 기간을 함께 세었으므로 독립 표본보다 확신을 낮춰 읽어야 합니다.</div></div>';
  el.innerHTML=h;
}
function topScores(scores,cand){
  const ks=Object.keys(scores||{}); if(!ks.length) return '';
  const rule=(cand||'').split('_')[0],desc=rule==='rebound'?(a,b)=>scores[a]-scores[b]:(a,b)=>scores[b]-scores[a];
  const name=rule==='jeonse'?'전세−매매 12개월':rule==='rebound'?'고점 대비':rule==='volume'?'거래량 증가':'상승률';
  return '<h4>지역별 '+name+'</h4>'+ks.sort(desc).slice(0,6).map(k=>'<div class="kv"><span>'+esc(L(k))+'</span><b class="'+cls(scores[k])+'">'+pct(scores[k])+'</b></div>').join('');
}

function renderHist(el){
  const t=D.lastK;
  let h='<div class="card"><h3>🕰️ 대전 아파트 40년 — KB 매매가격지수 (1986~)</h3>'
    +'<div class="row"><button class="btn'+(st.real?'':' on')+'" data-real="0">명목</button><button class="btn'+(st.real?' on':'')+'" data-real="1">실질(물가 차감)</button></div>'
    +'<div class="cv"><canvas id="rc-kb"></canvas></div><div class="note">KB국민은행 월간 아파트 매매가격지수(로그 눈금). 대전은 1986년, 대전 구는 2003년 6월, 세종은 2013년 4월부터.</div></div>';
  h+='<div class="card"><h3>📈 구별·세종 — 한국부동산원 아파트 매매가격지수 (2026년 1월 = 100)</h3>'
    +'<div class="cv"><canvas id="rc-sale"></canvas></div><div class="note">한국부동산원 월간 아파트 매매가격지수. 대전·5개 구는 2003년 11월, 세종은 2012년 11월부터. 실질은 소비자물가로 나눠 지금 물가 기준으로 바꾼 값.</div></div>';
  h+='<div class="card"><h3>🗺️ 30년 땅값 — 지역별 지가지수 (1994년 말~)</h3><div class="cv"><canvas id="rc-land"></canvas></div><div class="note">아파트 지수가 없는 2003년 이전 흐름은 땅값(한국부동산원 지역별 지가지수)으로 봅니다. 2004년까지는 분기, 2005년부터 월간. 세종은 출범(2012) 이후.</div></div>';
  h+='<div class="card"><h3>🏦 금리와 대전 아파트 1년 상승률</h3><div class="cv"><canvas id="rc-rate"></canvas></div></div>';
  h+='<div class="card"><h3>🔁 전세가율 (매매가 대비 전세가)</h3><div class="cv"><canvas id="rc-jr"></canvas></div><div class="note">2012년부터 공표치, 그 전(점선)은 전세·매매 지수 비로 거꾸로 이은 추정.</div></div>';
  h+='<div class="card"><h3>📌 주요 사건과 그 뒤 12개월</h3><div class="tw"><table><tr><th>달</th><th class="l">사건</th><th>대전(KB)</th><th>세종</th></tr>'
    +E.EVENTS.map(ev=>{ const k=E.ymk(ev.m),a=E.chg(D.kbSale.daejeon||D.sale.daejeon,Math.min(k+12,t),Math.min(12,t-k)),b=E.chg(D.sale.sejong,Math.min(k+12,t),Math.min(12,t-k));
      return '<tr><td>'+ev.m+'</td><td class="l"><span class="tag">'+esc(ev.g)+'</span>'+esc(ev.t)+'</td><td class="'+cls(a)+'">'+(k<t?pct(a):'–')+'</td><td class="'+cls(b)+'">'+(k<t?pct(b):'–')+'</td></tr>'; }).join('')
    +'</table></div><div class="note">사건 달부터 12개월 뒤까지의 지수 변동입니다. 같은 시기 금리·공급 등 다른 원인이 섞여 있어 인과로 읽으면 안 됩니다. 사건 날짜는 정부 발표·언론 보도 기준(월 단위).</div></div>';
  el.innerHTML=h;
  el.querySelectorAll('[data-real]').forEach(b=>b.onclick=()=>{ st.real=b.getAttribute('data-real')==='1'; render(); });
  const kbR=['daejeon','seoul','national','sejong'].filter(r=>D.kbSale[r]),kk1=E.lastK(D.kbSale.daejeon),kk0=E.ymk('1986-01'),klab=months(kk0,kk1);
  chart('rc-kb',klab,kbR.map(r=>{ const s0=st.real?E.realSeries(D.kbSale[r],D.macro.cpi):D.kbSale[r];
    return ds('KB '+L(r),lineOf(s0,kk0,kk1),COLORS[r],{borderWidth:r==='daejeon'?2.6:1.3,borderDash:r==='national'||r==='seoul'?[4,3]:undefined}); }),{fmt:v=>num(v,0),log:true});
  const regs=['daejeon','dj_dong','dj_jung','dj_seo','dj_yuseong','dj_daedeok','sejong','national','seoul'];
  const k0=E.ymk('2003-11'),lab=months(k0,t);
  chart('rc-sale',lab,regs.filter(r=>D.sale[r]).map(r=>{ const s=st.real?E.realSeries(D.sale[r],D.macro.cpi):D.sale[r];
    return ds(L(r),lineOf(s,k0,t),COLORS[r],{borderWidth:r==='daejeon'||r==='sejong'?2.4:1.3,borderDash:r==='national'||r==='seoul'?[4,3]:undefined}); }),{fmt:v=>num(v,0)});
  const LR=['daejeon','dj_dong','dj_jung','dj_seo','dj_yuseong','dj_daedeok','sejong','national'].map(r=>[r,E.landLong(D,r)]).filter(x=>x[1]);
  const lk1=Math.max.apply(null,LR.map(x=>E.lastK(x[1]))),lk0=E.firstK(E.landLong(D,'daejeon')),llab=months(lk0,lk1);
  chart('rc-land',llab,LR.map(([r,s])=>ds(L(r),lineOf(s,lk0,lk1),COLORS[r],{borderWidth:r==='daejeon'||r==='sejong'?2.4:1.2})),{fmt:v=>num(v,0)});
  const rk0=E.ymk('2004-11'),rlab=months(rk0,t);
  chart('rc-rate',rlab,[
    ds('기준금리',lineOf(D.macro.baseRate,rk0,t),'#f5c451'),
    ds('주담대 금리',lineOf(D.macro.mortgageRate,rk0,t),'#f87b8c'),
    ds('대전 1년 상승률',rlab.map((_,i)=>{ const v=E.chg(D.sale.daejeon,rk0+i,12); return v==null?null:v*100; }),'#8b8cf0',{type:'bar',borderWidth:0,backgroundColor:'rgba(139,140,240,.35)'})
  ],{fmt:v=>num(v,1)+'%'});
  const jk0=E.ymk('2003-11'),jlab=months(jk0,t),jrLine=(r,est)=>jlab.map((_,i)=>{ const x=E.jeonseRatio(D,r,jk0+i); return x&&x.est===est?x.v:null; });
  chart('rc-jr',jlab,[
    ds('대전',jrLine('daejeon',false),COLORS.daejeon),ds('대전(추정)',jrLine('daejeon',true),COLORS.daejeon,{borderDash:[4,3]}),
    ds('세종',jrLine('sejong',false),COLORS.sejong),ds('유성구',jrLine('dj_yuseong',false),COLORS.dj_yuseong),ds('유성구(추정)',jrLine('dj_yuseong',true),COLORS.dj_yuseong,{borderDash:[4,3]})
  ],{fmt:v=>num(v,0)+'%'});
}

function renderWhy(el){
  const r=st.region,cs=E.cycles(D,r,st.opts),fs=E.factorStudy(D,{h:12}),fs24=E.factorStudy(D,{h:24});
  const opts=['daejeon'].concat(E.UNIVERSE).map(k=>'<option value="'+k+'"'+(k===r?' selected':'')+'>'+esc(L(k))+'</option>').join('');
  const lc=D.kbSale.daejeon?E.cycles(D,'daejeon',Object.assign({},st.opts,{src:'kbSale'})):[];
  let h='<div class="card"><h3>🕰️ 대전 40년 사이클 (KB, 1986~) — 그 사이에 있었던 일</h3>'
    +'<div class="tw"><table><tr><th>구간</th><th>개월</th><th>변동</th><th>연율</th><th>실질</th><th>기준금리</th><th>전세 변동</th><th>시작 때 입주(앞 12개월)</th><th>시작 때 매수우위</th><th class="l">그 사이 사건(참고)</th></tr>'
    +lc.map(c=>{ const a=E.ymk(c.from),b=E.ymk(c.to),ev=E.EVENTS.filter(x=>{ const k=E.ymk(x.m); return k>=a&&k<b; });
      return '<tr><td>'+(c.type==='up'?'▲ ':'▼ ')+c.from+' → '+c.to+(c.open?' (진행)':'')+'</td><td>'+c.months+'</td><td class="'+cls(c.change)+'">'+pct(c.change)+'</td><td class="'+cls(c.cagr)+'">'+pct(c.cagr)+'</td><td class="'+cls(c.real)+'">'+pct(c.real)+'</td>'
        +'<td>'+(c.rateFrom==null?'–':num(c.rateFrom,2)+'→'+num(c.rateTo,2))+'</td><td class="'+cls(c.jeonseChange)+'">'+pct(c.jeonseChange)+'</td><td>'+fmtF('x',c.atStart.supply)+'</td><td>'+num(c.atStart.market,0)+'</td>'
        +'<td class="l">'+ev.map(x=>'<span class="tag">'+esc(x.m)+'</span>'+esc(x.t)).join('<br>')+'</td></tr>'; }).join('')
    +'</table></div><div class="note">KB 대전 아파트 지수의 고점·저점에서 '+Math.round(E.DEFAULTS.zigzag*100)+'% 이상 되돌리면 국면이 바뀐 것으로 본 사후 판정입니다. 사건은 같은 시기에 있었던 일을 나란히 둔 것이라 원인이라고 단정할 수 없습니다. 기준금리는 1999년 5월부터.</div></div>';
  h+='<div class="card"><h3>🔁 상승·하락 사이클 — 구별·세종 (한국부동산원, 2003~)</h3><div class="row"><select id="rc-reg">'+opts+'</select></div>'
    +'<div class="tw"><table><tr><th>구간</th><th>개월</th><th>변동</th><th>연율</th><th>실질</th><th>기준금리</th><th>전세 변동</th><th>시작 때 전세−매매(12개월)</th><th>시작 때 금리 1년 변화</th><th>시작 때 거래량 증가</th><th>시작 때 외지인 비중</th></tr>'
    +cs.map(c=>'<tr><td>'+(c.type==='up'?'▲ ':'▼ ')+c.from+' → '+c.to+(c.open?' (진행)':'')+'</td><td>'+c.months+'</td><td class="'+cls(c.change)+'">'+pct(c.change)+'</td><td class="'+cls(c.cagr)+'">'+pct(c.cagr)+'</td><td class="'+cls(c.real)+'">'+pct(c.real)+'</td>'
      +'<td>'+num(c.rateFrom,2)+'→'+num(c.rateTo,2)+'</td><td class="'+cls(c.jeonseChange)+'">'+pct(c.jeonseChange)+'</td><td>'+pp(c.atStart.jgap12)+'</td><td>'+(c.atStart.rate12==null?'–':(c.atStart.rate12>=0?'+':'')+c.atStart.rate12.toFixed(2)+'%p')+'</td><td>'+pct(c.atStart.volG)+'</td><td>'+pct0(c.atStart.out)+'</td></tr>').join('')
    +'</table></div><div class="note">고점·저점에서 '+Math.round(E.DEFAULTS.zigzag*100)+'% 이상 되돌리면 국면이 바뀐 것으로 본 사후 판정(설명용)입니다. 실시간 매매 신호가 아닙니다.</div></div>';
  h+='<div class="card"><h3>🧩 무엇이 다음 상승을 알려 줬나 — 지표별 이후 수익</h3><p class="lead">대전 5개 구 · 세종 · 대전 전체를 달마다 모아, 그때 지표가 낮음/중간/높음(하위·중위·상위 1/3)일 때 그 뒤 12개월·24개월 매매지수 변동 평균입니다.</p>'
    +'<div class="tw"><table><tr><th class="l">지표</th><th>낮음 12개월</th><th>중간</th><th>높음</th><th>높음−낮음</th><th>오른 비율(높음/낮음)</th><th>순위상관</th><th>높음−낮음 24개월</th><th>표본</th><th>기간</th></tr>'
    +fs.map((f,i)=>{ if(!f.buckets.length) return '<tr><td class="l">'+esc(f.label)+'</td><td colspan="9" class="l note">표본 부족('+f.n+')</td></tr>';
      const b=f.buckets,g=fs24[i],d24=g&&g.buckets.length?g.buckets[2].avg-g.buckets[0].avg:null,d12=b[2].avg-b[0].avg;
      return '<tr><td class="l">'+esc(f.label)+'<div class="note">경계 '+fmtF(f.fmt,f.q1)+' / '+fmtF(f.fmt,f.q2)+'</div></td><td class="'+cls(b[0].avg)+'">'+pct(b[0].avg)+'</td><td class="'+cls(b[1].avg)+'">'+pct(b[1].avg)+'</td><td class="'+cls(b[2].avg)+'">'+pct(b[2].avg)+'</td>'
        +'<td class="'+cls(d12)+'"><b>'+pp(d12)+'</b></td><td>'+pct0(b[2].hit,0)+' / '+pct0(b[0].hit,0)+'</td><td>'+num(f.rho,2)+'</td><td class="'+cls(d24)+'">'+pp(d24)+'</td><td>'+f.n+'</td><td>'+f.from+'~'+f.to+'</td></tr>'; }).join('')
    +'</table></div><div class="note">순위상관은 −1~+1 (0 근처면 관계 약함). 겹치는 기간을 함께 세어 표본 수가 실제 독립 표본보다 크게 보입니다.</div></div>';
  const ll=E.leadLag(D,'sejong','daejeon',12),llY=E.leadLag(D,'sejong','dj_yuseong',12);
  h+='<div class="card"><h3>↔️ 세종과 대전 — 누가 먼저 움직이나</h3><div class="cv"><canvas id="rc-ll"></canvas></div><div class="note">막대 = 세종의 k월 변동과 대전의 k+시차월 변동의 상관. 시차가 양수인 쪽이 높으면 세종이 먼저 움직인 것.</div></div>';
  h+='<div class="card"><h3>📊 '+esc(L(r))+' 거래량 · 외지인 매입 비중</h3><div class="cv"><canvas id="rc-vol"></canvas></div><div class="note">한국부동산원 매입자거주지별 아파트 매매거래(동·호수). 외지인 = 관할 시·도 밖(서울+기타) 매입자. 6개월 합계 기준.</div></div>';
  el.innerHTML=h;
  document.getElementById('rc-reg').onchange=e=>{ st.region=e.target.value; render(); };
  if(ll) chart('rc-ll',ll.lags.map(x=>(x.lag>0?'+':'')+x.lag),[ds('세종→대전',ll.lags.map(x=>x.r),'#ff9f43',{type:'bar',borderWidth:0,backgroundColor:'rgba(255,159,67,.55)'}),
    ds('세종→유성구',llY?llY.lags.map(x=>x.r):[],'#5ec8f2',{type:'bar',borderWidth:0,backgroundColor:'rgba(94,200,242,.45)'})],{type:'bar',fmt:v=>num(v,2)});
  const vs=D.volume[r];
  if(vs){ const k0=E.firstK(vs)+5,k1=E.lastK(vs),lab=months(k0,k1);
    chart('rc-vol',lab,[ds('거래량(6개월 합)',lab.map((_,i)=>{ let t=0; for(let j=0;j<6;j++){ const x=E.at(vs,k0+i-j); if(x==null) return null; t+=x; } return t; }),COLORS[r]||'#8b8cf0'),
      ds('외지인 매입 비중(오른쪽 축)',lab.map((_,i)=>{ const x=E.outShare(D,r,k0+i); return x==null?null:x*100; }),'#f5c451',{borderDash:[4,3],yAxisID:'y2'})],{fmt:v=>Math.round(v).toLocaleString('ko-KR'),y2:v=>num(v,0)+'%'}); }
}

function supplyRows(){
  const t=D.lastK;
  return ['daejeon','dj_dong','dj_jung','dj_seo','dj_yuseong','dj_daedeok','sejong'].filter(r=>D.movein[r]).map(r=>{
    const past=E.moveinSum(D,r,t-119,t);
    return {r,avg:past==null?null:past/10,n12:E.moveinSum(D,r,t+1,t+12),n24:E.moveinSum(D,r,t+1,t+24),ratio:E.supplyRatio(D,r,t)}; });
}
function supplyTable(rows){
  return '<div class="tw"><table><tr><th>지역</th><th>지난 10년 연평균</th><th>앞으로 12개월</th><th>÷ 연평균</th><th>앞으로 24개월</th><th>÷ 연평균×2</th></tr>'
    +rows.map(x=>{ const r24=x.n24!=null&&x.avg>0?x.n24/(x.avg*2):null;
      return '<tr><td>'+esc(L(x.r))+'</td><td>'+(x.avg==null?'–':Math.round(x.avg).toLocaleString('ko-KR'))+'세대</td><td>'+(x.n12==null?'–':Math.round(x.n12).toLocaleString('ko-KR'))+'</td>'
        +'<td class="'+(x.ratio==null?'':x.ratio>1.2?'dn':x.ratio<0.8?'up':'')+'"><b>'+fmtF('x',x.ratio)+'</b></td><td>'+(x.n24==null?'–':Math.round(x.n24).toLocaleString('ko-KR'))+'</td>'
        +'<td class="'+(r24==null?'':r24>1.2?'dn':r24<0.8?'up':'')+'">'+fmtF('x',r24)+'</td></tr>'; }).join('')+'</table></div>';
}
function renderSup(el){
  const t=D.lastK,R=E.moveinRange(D),ty=Math.floor(t/12),fs=E.factorStudy(D,{h:12}).filter(f=>['supply','unsold12','permits','market'].indexOf(f.id)>=0);
  let h='<div class="card"><h3>🏗️ 아파트 입주물량 — 연도별 (KB, '+(R?Math.floor(R[1]/12):'')+'년까지 예정 포함)</h3><div class="cv"><canvas id="rc-mv"></canvas></div>'
    +'<div class="note">옅은 막대는 아직 오지 않은 해(입주 예정 — 분양 때 공개). 올해는 지난달까지 실적 + 남은 달 예정.</div>'
    +'<h4>지역별 — 앞으로 입주 예정 ('+esc(E.kym(t))+' 기준)</h4>'+supplyTable(supplyRows())
    +'<div class="note">빨강 = 평소보다 20% 넘게 많음(가격에 부담), 초록 = 20% 넘게 적음. 대전 구는 KB 구 자료, 세종은 세종시 전체.</div></div>';
  h+='<div class="card"><h3>📦 미분양 · 인허가 (한국은행 ECOS)</h3><div class="cv"><canvas id="rc-us"></canvas></div><div class="cv" style="margin-top:8px"><canvas id="rc-pm"></canvas></div>'
    +'<div class="note">미분양은 달말 재고(호). 인허가는 최근 12개월 합(호) — 아파트는 인허가 2~3년 뒤 입주가 몰린다.</div></div>';
  h+='<div class="card"><h3>🧭 KB 매수우위지수 (100 = 균형 · 클수록 사려는 사람이 많음)</h3><div class="cv"><canvas id="rc-mk"></canvas></div></div>';
  h+='<div class="card"><h3>🧩 이 지표들이 다음 12개월을 알려 줬나</h3><div class="tw"><table><tr><th class="l">지표</th><th>낮음</th><th>중간</th><th>높음</th><th>순위상관</th><th>표본</th><th>기간</th></tr>'
    +fs.map(f=>f.buckets.length?'<tr><td class="l">'+esc(f.label)+(f.post?' <span class="tag">사후 실적</span>':'')+'<div class="note">경계 '+fmtF(f.fmt,f.q1)+' / '+fmtF(f.fmt,f.q2)+'</div></td><td class="'+cls(f.buckets[0].avg)+'">'+pct(f.buckets[0].avg)+'</td><td class="'+cls(f.buckets[1].avg)+'">'+pct(f.buckets[1].avg)+'</td><td class="'+cls(f.buckets[2].avg)+'">'+pct(f.buckets[2].avg)+'</td><td>'+num(f.rho,2)+'</td><td>'+f.n+'</td><td>'+f.from+'~'+f.to+'</td></tr>'
      :'<tr><td class="l">'+esc(f.label)+'</td><td colspan="6" class="l note">표본 부족('+f.n+')</td></tr>').join('')
    +'</table></div><div class="note">대전 5개 구·세종·대전 전체를 달마다 모은 통계. ‘사후 실적’: 과거 시점의 ‘앞으로 입주’는 그때의 예정 대신 실제 입주로 셌습니다(분양 때 대부분 공개되지만 지연·취소는 반영 못 함). 미분양·인허가·매수우위는 시 단위라 대전 구에는 대전 값을 씁니다.</div></div>';
  el.innerHTML=h;
  if(R){ const y0=Math.max(Math.floor(R[0]/12),1990),y1=Math.floor(R[1]/12),ys=[]; for(let y=y0;y<=y1;y++) ys.push(y);
    const ysum=(r,y)=>{ let a=0; for(let m=0;m<12;m++){ const x=E.moveinAt(D,r,y*12+m); if(x==null) return null; a+=x; } return a; };
    const col=(c,y)=>y>ty?c+'55':c;
    chart('rc-mv',ys.map(String),[ds('대전',ys.map(y=>ysum('daejeon',y)),COLORS.daejeon,{type:'bar',borderWidth:0,backgroundColor:ys.map(y=>col('#8b8cf0',y))}),
      ds('세종',ys.map(y=>ysum('sejong',y)),COLORS.sejong,{type:'bar',borderWidth:0,backgroundColor:ys.map(y=>col('#ff9f43',y))})],{type:'bar',fmt:v=>Math.round(v).toLocaleString('ko-KR')}); }
  const u0=E.ymk('2007-01'),ulab=months(u0,t);
  chart('rc-us',ulab,[ds('대전 미분양',lineOf(D.unsold.daejeon,u0,t),COLORS.daejeon),ds('세종 미분양',lineOf(D.unsold.sejong,u0,t),COLORS.sejong)],{fmt:v=>Math.round(v).toLocaleString('ko-KR')});
  const p12=r=>ulab.map((_,i)=>{ let a=0; for(let j=0;j<12;j++){ const x=E.permitsMonthly(D,r,u0+i-j); if(x==null) return null; a+=x; } return a; });
  chart('rc-pm',ulab,[ds('대전 인허가(12개월 합)',p12('daejeon'),COLORS.daejeon),ds('세종 인허가(12개월 합)',p12('sejong'),COLORS.sejong)],{fmt:v=>Math.round(v).toLocaleString('ko-KR')});
  const m0=E.ymk('2000-01'),mlab=months(m0,E.lastK(D.kbMarket.daejeon)||t);
  chart('rc-mk',mlab,[ds('대전',lineOf(D.kbMarket.daejeon,m0,m0+mlab.length-1),COLORS.daejeon,{borderWidth:2.2}),ds('세종',lineOf(D.kbMarket.sejong,m0,m0+mlab.length-1),COLORS.sejong),
    ds('전국',lineOf(D.kbMarket.national,m0,m0+mlab.length-1),COLORS.national,{borderDash:[4,3]}),ds('균형(100)',mlab.map(()=>100),'#59627f',{borderDash:[2,4],borderWidth:1})],{fmt:v=>num(v,0)});
}

function renderStrat(el){
  if(!WF){ el.innerHTML='<div class="warn">검증할 자료가 부족합니다.</div>'; return; }
  const o=WF.opts,m=WF.meta;
  const rows=[['🤖 클로드 전략(워크포워드)',m.stats,'meta']].concat(Object.keys(WF.bench).map(k=>[k==='cash'?'현금(정기예금 세후)':L(k)+' 계속 보유',WF.bench[k].stats,k]));
  let h='<div class="card"><h3>⚙️ 가정 바꿔 보기</h3><div class="row">'
    +'<span class="note">임대·거주가치</span><button class="btn'+(o.rent==='jeonse'?' on':'')+'" data-o="rent" data-v="jeonse">전세 환산 포함</button><button class="btn'+(o.rent==='none'?' on':'')+'" data-o="rent" data-v="none">가격만</button>'
    +'<span class="note" style="margin-left:6px">최소 보유</span>'+[12,24,36].map(v=>'<button class="btn'+(o.minHold===v?' on':'')+'" data-o="minHold" data-v="'+v+'">'+v+'개월</button>').join('')
    +'<span class="note" style="margin-left:6px">공표 시차</span>'+[1,2,3].map(v=>'<button class="btn'+(o.lag===v?' on':'')+'" data-o="lag" data-v="'+v+'">'+v+'개월</button>').join('')
    +'<span class="note" style="margin-left:6px">낙폭 벌점</span>'+[0,.1,.25].map(v=>'<button class="btn'+(o.penalty===v?' on':'')+'" data-o="penalty" data-v="'+v+'">'+v+'</button>').join('')
    +'</div><div class="note">여기서 바꾼 값은 이 화면 계산에만 쓰입니다. 모의투자 장부는 기본값(전세 환산 포함 · 최소 보유 24개월 · 시차 2개월)으로 고정.</div></div>';
  h+='<div class="card"><h3>🧪 같은 기간 성과 ('+esc(WF.oosFrom)+' ~ '+esc(WF.lastRet)+')</h3><div class="tw"><table><tr><th>전략</th><th>기간</th><th>누적</th><th>연복리</th><th>최대낙폭</th><th>보유 비율</th><th>매매</th><th>수수료 합(3억 기준)</th><th>최종</th></tr>'
    +rows.map(x=>{ const s=x[1],r=x[2]==='meta'?m:WF.bench[x[2]];
      return '<tr><td>'+esc(x[0])+'</td><td>'+esc(r.rows[0].m)+'~</td><td class="'+cls(s.total)+'">'+pct(s.total)+'</td><td class="'+cls(s.cagr)+'"><b>'+pct(s.cagr)+'</b></td><td>'+pct0(s.mdd)+'</td><td>'+pct0(s.inMarket,0)+'</td><td>'+s.trades+'</td><td>'+wonM(s.fees)+'</td><td>'+won(s.end)+'</td></tr>'; }).join('')
    +'</table></div><div class="note">세종 보유는 세종 지수가 있는 달부터라 기간이 짧습니다. 마지막 보유분은 매도 비용 없이 평가.</div><div class="cv" style="margin-top:8px"><canvas id="rc-eq"></canvas></div></div>';
  if(WFL){ const lm=WFL.meta.stats,lb=WFL.bench.daejeon&&WFL.bench.daejeon.stats,lcash=WFL.bench.cash.stats,cnt={};
    WFL.years.forEach(y=>{ const id=WFL.sel[y].id; cnt[id]=(cnt[id]||0)+1; });
    h+='<div class="card"><h3>🕰️ 장기 검증 — 대전 전체(KB) '+esc(WFL.oosFrom)+' ~ '+esc(WFL.lastRet)+'</h3><p class="lead">같은 후보·같은 방식(해마다 그해 1월에 볼 수 있던 자료로만 고르기)을 KB 대전 전체 지수에 적용했습니다. 예금 금리 자료가 1996년부터라 학습도 1996년부터입니다. 투자 대상이 대전 전체 하나라 ‘언제 사고 팔지’만 봅니다.</p>'
      +'<div class="tw"><table><tr><th>전략</th><th>누적</th><th>연복리</th><th>최대낙폭</th><th>보유 비율</th><th>매매</th><th>3억 →</th></tr>'
      +[['🤖 클로드 전략(워크포워드)',lm],['대전 전체 계속 보유',lb],['현금(정기예금 세후)',lcash]].map(x=>'<tr><td>'+esc(x[0])+'</td><td class="'+cls(x[1]&&x[1].total)+'">'+pct(x[1]&&x[1].total)+'</td><td class="'+cls(x[1]&&x[1].cagr)+'"><b>'+pct(x[1]&&x[1].cagr)+'</b></td><td>'+pct0(x[1]&&x[1].mdd)+'</td><td>'+pct0(x[1]&&x[1].inMarket,0)+'</td><td>'+(x[1]?x[1].trades:'–')+'</td><td>'+won(x[1]&&x[1].end)+'</td></tr>').join('')
      +'</table></div><div class="note">해마다 고른 전략: '+Object.keys(cnt).map(id=>esc(id)+' '+cnt[id]+'년').join(' · ')+'</div><div class="cv" style="margin-top:8px"><canvas id="rc-eql"></canvas></div></div>'; }
  const sens=[0,.1,.25].map(pen=>{ const w=pen===o.penalty?WF:E.walkForward(D,Object.assign({},st.opts,{penalty:pen})); return [pen,w&&w.meta.stats]; });
  h+='<div class="card"><h3>🎚️ 고르는 기준을 바꾸면 (민감도)</h3><p class="lead">해마다 전략을 고르는 점수 = 연복리 − <b>낙폭 벌점</b> × 최대낙폭. 기본 0.25는 결과를 보기 전에 정한 값입니다. 기준에 따라 결과가 크게 달라지면 규칙 선택이 아직 불안정하다는 뜻입니다.</p>'
    +'<div class="tw"><table><tr><th>낙폭 벌점</th><th>연복리</th><th>최대낙폭</th><th>보유 비율</th><th>매매</th><th>3억 →</th></tr>'
    +sens.map(([pen,s2])=>'<tr><td>'+pen+(pen===E.DEFAULTS.penalty?' (기본)':'')+'</td><td class="'+cls(s2&&s2.cagr)+'">'+pct(s2&&s2.cagr)+'</td><td>'+pct0(s2&&s2.mdd)+'</td><td>'+pct0(s2&&s2.inMarket,0)+'</td><td>'+(s2?s2.trades:'–')+'</td><td>'+won(s2&&s2.end)+'</td></tr>').join('')
    +'</table></div></div>';
  h+='<div class="card"><h3>📅 해마다 고른 전략 (그해 1월에 볼 수 있던 자료로만)</h3><div class="tw"><table><tr><th>적용 연도</th><th>학습 기간</th><th class="l">고른 전략</th><th>학습 연복리</th><th>학습 최대낙폭</th></tr>'
    +WF.years.map(y=>{ const s=WF.sel[y],b=s.table.find(t=>t.id===s.id);
      return '<tr><td>'+y+'</td><td>'+s.trainFrom+'~'+s.trainTo+'</td><td class="l">'+esc(s.label)+'</td><td class="'+cls(b.cagr)+'">'+pct(b.cagr)+'</td><td>'+pct0(b.mdd)+'</td></tr>'; }).join('')
    +'</table></div></div>';
  const tr=m.rows.filter(x=>x.from!==x.to);
  h+='<div class="card"><h3>🔄 매매 기록</h3><div class="tw"><table><tr><th>달</th><th class="l">갈아탄 내용</th><th>매도 수수료</th><th>매수 수수료</th><th>그달 평가액</th></tr>'
    +tr.map(x=>'<tr><td>'+x.m+'</td><td class="l">'+esc(L(x.from))+' → <b>'+esc(L(x.to))+'</b></td><td>'+wonM(x.sellFee)+'</td><td>'+wonM(x.buyFee)+'</td><td>'+won(x.nav)+'</td></tr>').join('')
    +'</table></div></div>';
  h+='<div class="card"><h3>📋 전략 후보 — 같은 기간 전체 결과 (과최적화 참고용)</h3><p class="lead">아래는 검증 기간 전체를 알고 나서 매긴 순위라 실제로는 고를 수 없던 결과입니다. 위 워크포워드 성과와 차이가 클수록 과최적화 위험이 큽니다.</p>'
    +'<div class="tw"><table><tr><th class="l">후보</th><th>연복리</th><th>최대낙폭</th><th>보유 비율</th><th>매매</th><th>점수</th></tr>'
    +WF.fullTable.map(t=>'<tr><td class="l">'+esc(t.label)+'</td><td class="'+cls(t.cagr)+'">'+pct(t.cagr)+'</td><td>'+pct0(t.mdd)+'</td><td>'+pct0(t.inMarket,0)+'</td><td>'+t.trades+'</td><td>'+num(t.score*100,2)+'</td></tr>').join('')
    +'</table></div><div class="note">점수 = 연복리 − '+o.penalty+' × 최대낙폭. 해마다 학습 기간에서 이 점수 1위를 골랐습니다.</div></div>';
  el.innerHTML=h;
  el.querySelectorAll('[data-o]').forEach(b=>b.onclick=()=>{ const k=b.getAttribute('data-o'),v=b.getAttribute('data-v');
    st.opts[k]=k==='rent'?v:+v; compute(); render(); });
  const k0=E.ymk(WF.oosFrom),k1=E.ymk(WF.lastRet),lab=months(k0,k1);
  const navLine=(rs)=>{ const mp={}; rs.forEach(x=>mp[x.m]=x.nav); return lab.map(l=>mp[l]==null?null:mp[l]); };
  if(WFL){ const a0=E.ymk(WFL.oosFrom),a1=E.ymk(WFL.lastRet),llab=months(a0,a1),nl=(rs)=>{ const mp={}; rs.forEach(x=>mp[x.m]=x.nav); return llab.map(l=>mp[l]==null?null:mp[l]); };
    chart('rc-eql',llab,[ds('클로드 전략',nl(WFL.meta.rows),'#f5c451',{borderWidth:2.6}),ds('대전 전체 보유',nl(WFL.bench.daejeon.rows),COLORS.daejeon),ds('현금',nl(WFL.bench.cash.rows),'#9aa6c9',{borderDash:[4,3]})],{fmt:v=>won(v)}); }
  chart('rc-eq',lab,[ds('클로드 전략',navLine(m.rows),'#f5c451',{borderWidth:2.6}),ds('대전 보유',navLine(WF.bench.daejeon.rows),COLORS.daejeon),
    WF.bench.sejong?ds('세종 보유',navLine(WF.bench.sejong.rows),COLORS.sejong):null,ds('현금',navLine(WF.bench.cash.rows),'#9aa6c9',{borderDash:[4,3]})].filter(Boolean),{fmt:v=>won(v)});
}

function renderPaper(el){
  if(!PAPER||!PAPER.decisions){ el.innerHTML='<div class="warn">모의투자 장부(paper.json)를 불러오지 못했습니다.</div>'; return; }
  const P=PAPER,nav=P.acct.nav;
  let h='<div class="card"><h3>📒 모의투자 장부 — 지금부터 매달 쌓는 기록</h3><p class="lead">과거 검증에서 고른 규칙을 <b>'+esc(P.startedData)+'</b> 지수 공표 이후부터 실제로 따라갑니다. 지난 기록은 고치지 않고 새 달만 덧붙입니다(전략 버전·당시 가정 함께 저장).</p>'
    +'<div class="grid"><div><div class="kv"><span>원금</span><b>'+won(P.capital)+'</b></div><div class="kv"><span>평가액</span><b class="'+cls(nav/P.capital-1)+'">'+won(nav)+' ('+pct(nav/P.capital-1)+')</b></div>'
    +'<div class="kv"><span>수수료 누계</span><b>'+wonM(P.acct.fees)+'</b></div><div class="kv"><span>지금 보유</span><b>'+esc(L(P.acct.pos))+'</b></div></div>'
    +'<div><div class="kv"><span>전략 버전</span><b>'+esc(P.strategyVersion)+' · 엔진 '+esc(P.engineVersion)+'</b></div>'
    +'<div class="kv"><span>가정</span><b>매수 '+pct0(P.params.buyCost)+' · 매도 '+pct0(P.params.sellCost)+' · 최소 '+P.params.minHold+'개월</b></div>'
    +'<div class="kv"><span>공표 시차</span><b>'+P.params.lag+'개월 · 임대가치 '+(P.params.rent==='jeonse'?'전세 환산':'제외')+'</b></div></div></div></div>';
  h+='<div class="card"><h3>🗳️ 결정 기록</h3><div class="tw"><table><tr><th>보유 달</th><th>판단 자료</th><th class="l">전략</th><th>선택</th><th>메모</th><th>기록 시각</th></tr>'
    +P.decisions.slice().reverse().map(d=>'<tr><td>'+d.m+'</td><td>'+d.data+'</td><td class="l">'+esc(d.candLabel||d.cand||'–')+'</td><td><b>'+esc(L(d.target))+'</b></td><td>'+(d.locked?'최소 보유로 유지':d.stay?'조건 유지':'')+'</td><td>'+esc((d.at||'').slice(0,16).replace('T',' '))+'</td></tr>').join('')
    +'</table></div></div>';
  h+='<div class="card"><h3>💰 정산 기록</h3>'+(P.marks.length?'<div class="tw"><table><tr><th>달</th><th>보유</th><th>가격</th><th>임대가치</th><th>보유세</th><th>현금이자</th><th>수수료</th><th>평가액</th></tr>'
    +P.marks.slice().reverse().map(x=>'<tr><td>'+x.m+'</td><td>'+esc(L(x.pos))+'</td><td class="'+cls(x.price)+'">'+pct(x.price,2)+'</td><td>'+pct(x.rent,3)+'</td><td>'+pct(x.hold,3)+'</td><td>'+pct(x.cash,3)+'</td><td>'+wonM(x.fee)+'</td><td>'+won(x.nav)+'</td></tr>').join('')
    +'</table></div>':'<div class="note">아직 정산된 달이 없습니다. 첫 보유 달('+esc(P.decisions[0]&&P.decisions[0].m)+') 지수가 공표되면(다음 달 중순) 매달 자동으로 채워집니다.</div>')+'</div>';
  el.innerHTML=h;
}

function renderData(el){
  const src=DOC.sources||{},rone=src.rone||{},ecos=src.ecos||{},kb=src.kb||{},S=DOC.series||{};
  const cov=(t,r)=>{ const x=S[t]&&S[t][r]; if(!x) return '–'; const k0=E.ymk(x.start); return x.start+' ~ '+E.kym(k0+x.v.length-1); };
  let h='<div class="card"><h3>📚 자료</h3><div class="note">수집 '+esc(DOC.fetchedAt||'')+' · 매달 자동 갱신</div><div class="tw"><table><tr><th class="l">자료</th><th class="l">표</th><th>대전</th><th>유성구</th><th>세종</th></tr>'
    +Object.keys(rone.tables||{}).map(t=>{ const x=rone.tables[t]; return '<tr><td class="l">'+esc(x.name)+'<div class="note">'+esc(x.unit||'')+'</div></td><td class="l">'+esc(x.id)+'</td><td>'+cov(t,'daejeon')+'</td><td>'+cov(t,'dj_yuseong')+'</td><td>'+cov(t,'sejong')+'</td></tr>'; }).join('')
    +Object.keys(ecos.series||{}).map(t=>{ const x=ecos.series[t],m=S.macro&&S.macro[t]; return '<tr><td class="l">'+esc(x.name)+'<div class="note">'+esc(x.unit)+'</div></td><td class="l">ECOS '+esc(x.stat)+'/'+esc(x.item)+'</td><td colspan="3">'+(m?m.start+' ~ '+E.kym(E.ymk(m.start)+m.v.length-1):'–')+'</td></tr>'; }).join('')
    +Object.keys(ecos.regional||{}).map(t=>{ const x=ecos.regional[t]; return '<tr><td class="l">'+esc(x.name)+'<div class="note">'+esc(x.unit)+'</div></td><td class="l">ECOS '+esc(x.stat)+'</td><td>'+cov(t,'daejeon')+'</td><td>–</td><td>'+cov(t,'sejong')+'</td></tr>'; }).join('')
    +Object.keys(kb.tables||{}).map(t=>{ const x=kb.tables[t]; return '<tr><td class="l">'+esc(x.name)+'<div class="note">'+esc(x.unit)+'</div></td><td class="l">KB '+esc(x.path)+'</td><td>'+cov(t,'daejeon')+'</td><td>'+cov(t,'dj_yuseong')+'</td><td>'+cov(t,'sejong')+'</td></tr>'; }).join('')
    +(kb.movein?'<tr><td class="l">'+esc(kb.movein.name)+'<div class="note">'+esc(kb.movein.unit)+'</div></td><td class="l">KB '+esc(kb.movein.path)+'</td><td>'+cov('movein','daejeon')+'</td><td>'+cov('movein','dj_yuseong')+'</td><td>'+cov('movein','sejong')+'</td></tr>':'')
    +'</table></div><div class="note">출처: '+esc(rone.name||'')+' · '+esc(ecos.name||'')+' · '+esc(kb.name||'')+'.</div></div>';
  const o=E.DEFAULTS;
  h+='<div class="card"><h3>📐 가정</h3><ul class="f">'
    +'<li><b>시점</b>: 월간 지수는 다음 달 중순에 공표된다. k월 수익에 걸 자리는 k−'+o.lag+'월까지 공표된 자료로만 정한다(룩어헤드 금지).</li>'
    +'<li><b>살 때</b> '+pct0(o.buyCost)+'(취득세 1.1% · 중개 0.4% · 등기 등 0.1%) · <b>팔 때</b> '+pct0(o.sellCost)+'(중개 등) · <b>보유세</b> 연 '+pct0(o.holdCostYr,2)+'.</li>'
    +'<li><b>최소 보유 '+o.minHold+'개월</b>: 1주택 양도세 비과세 보유요건(2년)을 단순화. 그 전에는 팔지 않는다.</li>'
    +'<li><b>현금</b>: 예금은행 정기예금 금리(신규취급액)에서 이자소득세 '+pct0(o.depositTax)+'를 뺀 값.</li>'
    +'<li><b>임대·거주가치</b>: 집을 가지면 전세보증금만큼을 예금에 넣은 효과(전세가율 × 세후 예금금리)를 얻는다고 본다. 집 없이 현금을 들면 그만큼 주거비를 낸다 — 양쪽 주거비 차이를 같게 맞추는 방법.</li>'
    +'<li><b>전략 고르기</b>: 해마다 1월, 그때까지 공표된 자료만으로 후보 '+E.candidates().length+'개(현금 유지 · 대전 보유 포함)를 처음부터 다시 돌려 ‘연복리 − '+o.penalty+'×최대낙폭’ 1위를 그해에 쓴다. 학습 기간 보유 비율이 '+pct0(o.minInMarket,0)+' 미만인 규칙은 사실상 현금이라 뺀다.</li>'
    +'<li><b>투자 단위</b>: 지역 지수를 그대로 따라가는 집 한 채(대출 없음). 실제 단지 수익은 지수와 다를 수 있다.</li></ul></div>';
  h+='<div class="card"><h3>🚧 아직 못 넣은 것 · 다음 단계</h3><ul class="f">'
    +'<li>대전 아파트 40년은 KB 지수(1986~), 구별 비교·전략은 한국부동산원 지수(2003~)를 씁니다. 두 지수는 조사 표본이 달라 값이 조금 다릅니다.</li>'
    +'<li>국토부 실거래가(단지·동 단위)는 정부 서버가 해외 IP 연결을 끊어 아직 못 넣었습니다. 인구 이동(통계청)은 인증키가 있으면 넣을 수 있습니다.</li>'
    +'<li>입주·미분양·매수우위는 분석·참고 전망에만 쓰고 모의장부 전략(rec-wf-1)에는 아직 넣지 않았습니다 — 넣으면 전략 버전이 바뀌어 새 장부로 시작해야 합니다.</li>'
    +'<li>대출(LTV)·전세 끼고 사기(갭투자) 변형은 아직 넣지 않았습니다. 기본은 대출 없는 1주택입니다.</li></ul></div>';
  el.innerHTML=h;
}

/* ── 시작 ── */
async function boot(){
  const root=document.getElementById(ROOT_ID); if(!root) return;
  if(!document.getElementById('rec-css')){ const s=document.createElement('style'); s.id='rec-css'; s.textContent=CSS; document.head.appendChild(s); }
  try{
    const [a,b]=await Promise.all([fetch(DATA+'series.json',{cache:'no-cache'}),fetch(DATA+'paper.json',{cache:'no-cache'})]);
    if(!a.ok) throw new Error('series.json '+a.status);
    DOC=await a.json(); PAPER=b.ok?await b.json():null;
    compute(); render();
  }catch(e){ root.innerHTML='<div class="warn">자료를 불러오지 못했습니다: '+esc(e.message||e)+'</div>'; console.error(e); }
}
window.JKRealEstateClaudeUI={boot,state:st};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
