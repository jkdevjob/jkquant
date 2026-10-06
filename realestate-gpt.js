(function(){
"use strict";

const root=document.getElementById("gpt-re-root");
if(!root||!window.REGPT)return;

root.innerHTML=`
<style>
#gpt-re-root{color:var(--text);text-align:left}
.gpt-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
.gpt-title{font-size:18px;font-weight:900}.gpt-ver{font-size:10px;color:var(--gold);font-weight:800;margin-left:6px}
.gpt-desc{font-size:12px;color:var(--dim);margin-top:4px;line-height:1.6}
.gpt-status{font-size:11px;padding:5px 9px;border:1px solid var(--border);background:var(--surf2);border-radius:999px;color:var(--dim);white-space:nowrap}
.gpt-status.ok{color:var(--green);border-color:rgba(54,211,153,.35)}.gpt-status.err{color:var(--red)}
.gpt-nav{display:flex;gap:6px;overflow:auto;margin:0 0 12px}.gpt-nav button{flex:0 0 auto;border:1px solid var(--border);background:var(--surf2);color:var(--dim);padding:7px 11px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer}.gpt-nav button.on{color:#fff;border-color:var(--accent);background:#353765}
.gpt-view{display:none}.gpt-view.on{display:block}
.gpt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.gpt-card{background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:12px}.gpt-card .k{font-size:10px;color:var(--faint);font-weight:800}.gpt-card .v{font-size:20px;font-weight:900;margin-top:4px}.gpt-card .s{font-size:10px;color:var(--dim);margin-top:2px}
.gpt-panel{background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:13px;margin-bottom:10px}.gpt-panel h4{font-size:13px;margin:0 0 9px}.gpt-panel .note{font-size:11px;color:var(--dim);line-height:1.55}
.gpt-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gpt-table-wrap{overflow:auto}.gpt-table{width:100%;border-collapse:collapse;font-size:11px;min-width:620px}.gpt-table th,.gpt-table td{padding:7px 6px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}.gpt-table th{font-size:10px;color:var(--faint)}.gpt-table th:first-child,.gpt-table td:first-child{text-align:left}.up{color:var(--green)}.dn{color:var(--red)}.gold{color:var(--gold)}
.gpt-badge{display:inline-block;padding:2px 6px;border-radius:5px;background:#2b3151;color:var(--dim);font-size:9px;font-weight:800}.gpt-badge.good{color:var(--green);background:rgba(54,211,153,.1)}.gpt-badge.bad{color:var(--red);background:rgba(248,123,140,.1)}
.gpt-warn{border:1px solid #5a4d20;background:rgba(245,196,81,.07);color:#e8d9a8;border-radius:9px;padding:10px 12px;font-size:11px;line-height:1.6;margin-bottom:10px}
.gpt-src a{color:var(--accent);text-decoration:none}.gpt-src li{margin:7px 0;font-size:11px;color:var(--dim)}
canvas.gpt-chart{width:100%!important;max-height:330px}
@media(max-width:760px){.gpt-grid{grid-template-columns:1fr 1fr}.gpt-two{grid-template-columns:1fr}.gpt-head{display:block}.gpt-status{display:inline-block;margin-top:8px}}
</style>
<div class="gpt-head">
 <div><div class="gpt-title">⚡ GPT 부동산 퀀트 <span class="gpt-ver">v1.0.0</span></div>
 <div class="gpt-desc">대전·세종 장기 가격자료를 학습해 패턴을 규칙화하고, 같은 규칙을 과거에 백테스트한 뒤 현재를 모의 평가합니다. 클로드 분석/엔진은 사용하지 않습니다.</div></div>
 <div id="gptReStatus" class="gpt-status">데이터 불러오는 중</div>
</div>
<div class="gpt-nav" id="gptReNav">
 <button class="on" data-v="overview">큰그림</button>
 <button data-v="history">30년 시장지도</button>
 <button data-v="pattern">패턴 랩</button>
 <button data-v="backtest">백테스트</button>
 <button data-v="paper">현재 모의</button>
 <button data-v="rank">후보 랭킹</button>
 <button data-v="data">데이터</button>
</div>
<div id="gptReViews">
 <div class="gpt-view on" data-v="overview"><div id="gptOverview"></div></div>
 <div class="gpt-view" data-v="history"><div class="gpt-panel"><h4>대전·세종 장기 가격지수</h4><canvas id="gptHistoryChart" class="gpt-chart"></canvas><div id="gptHistoryNote" class="note"></div></div></div>
 <div class="gpt-view" data-v="pattern"><div id="gptPattern"></div></div>
 <div class="gpt-view" data-v="backtest"><div id="gptBacktest"></div></div>
 <div class="gpt-view" data-v="paper"><div id="gptPaper"></div></div>
 <div class="gpt-view" data-v="rank"><div id="gptRank"></div></div>
 <div class="gpt-view" data-v="data"><div id="gptData"></div></div>
</div>`;

const $=s=>root.querySelector(s);
$("#gptReNav").addEventListener("click",e=>{
  const b=e.target.closest("button[data-v]");if(!b)return;
  root.querySelectorAll(".gpt-nav button").forEach(x=>x.classList.toggle("on",x===b));
  root.querySelectorAll(".gpt-view").forEach(x=>x.classList.toggle("on",x.dataset.v===b.dataset.v));
});

function cls(v){return Number.isFinite(v)?(v>0?"up":v<0?"dn":""):""}
function p(v,d=1){return window.REGPT.pct(v,d)}
function num(v,d=1){return Number.isFinite(v)?v.toFixed(d):"-"}
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function metricCard(k,v,s,klass=""){return `<div class="gpt-card"><div class="k">${k}</div><div class="v ${klass}">${v}</div><div class="s">${s||""}</div></div>`}
function summary(name,row){
  if(!row)return metricCard(name,"-","데이터 없음");
  const m=REGPT.metrics(row.points),ph=REGPT.phase(m),sc=REGPT.score(m);
  return metricCard(name,p(m.m12),`${ph} · 점수 ${num(sc,0)} · 최신 ${m.date}`,cls(m.m12));
}
function episodesSummary(row){
  if(!row)return [];
  const eps=REGPT.episodes(row.points);
  const grp={};
  for(const e of eps){(grp[e.state]||(grp[e.state]=[])).push(e)}
  return Object.entries(grp).map(([state,arr])=>({
    state,
    count:arr.length,
    months:arr.reduce((s,x)=>s+x.months,0)/arr.length,
    ret:arr.reduce((s,x)=>s+(x.ret||0),0)/arr.length
  }));
}
function moveinText(obj){
  if(!obj||!obj.rows||!obj.rows.length)return "입주물량 연결 없음";
  const valid=obj.rows.filter(x=>Number.isFinite(x.units));
  const tail=valid.slice(-5);
  return tail.map(x=>`${esc(x.period)} ${Math.round(x.units).toLocaleString()}세대`).join(" · ");
}

let charts={};
function drawHistory(data){
  if(!window.Chart)return;
  const ctx=$("#gptHistoryChart");if(!ctx)return;
  if(charts.history)charts.history.destroy();
  const rows=[["대전",data.daejeon],["세종",data.sejong]].filter(x=>x[1]);
  const labels=[...new Set(rows.flatMap(x=>x[1].points.map(p=>p.date)))].sort();
  const sets=rows.map(([name,row])=>{
    const map=new Map(row.points.map(p=>[p.date,p.value]));
    return {label:name,data:labels.map(d=>map.get(d)??null),spanGaps:true,borderWidth:2,pointRadius:0,tension:.12};
  });
  charts.history=new Chart(ctx,{type:"line",data:{labels,datasets:sets},options:{responsive:true,interaction:{mode:"index",intersect:false},plugins:{legend:{labels:{color:"#9aa6c9"}}},scales:{x:{ticks:{color:"#6f7ba0",maxTicksLimit:10},grid:{color:"rgba(42,51,84,.25)"}},y:{ticks:{color:"#6f7ba0"},grid:{color:"rgba(42,51,84,.35)"}}}}});
  const starts=rows.map(([n,r])=>`${n} ${r.points[0].date}~${r.points[r.points.length-1].date} (${r.points.length}개월)`).join(" · ");
  $("#gptHistoryNote").textContent=starts+" · 각 지수의 기준시점 개편이 있을 수 있어 절대수준보다 변화율·국면을 중심으로 해석합니다.";
}

function renderOverview(data){
  const d=data.daejeon?REGPT.metrics(data.daejeon.points):null;
  const s=data.sejong?REGPT.metrics(data.sejong.points):null;
  $("#gptOverview").innerHTML=`
   <div class="gpt-warn">이 탭의 후보·신호는 실제 매수 지시가 아니라 <b>모의투자 검증용</b>입니다. 가격지수는 개별 아파트 실거래가와 다르며, 세금·대출·취득비용은 아직 포함하지 않습니다.</div>
   <div class="gpt-grid">
    ${summary("대전 12개월",data.daejeon)}
    ${summary("세종 12개월",data.sejong)}
    ${metricCard("대전 36개월 고점 대비",d?p(d.dd36):"-",d?`연환산 변동성 ${p(d.vol12)}`:"",d?cls(d.dd36):"")}
    ${metricCard("세종 36개월 고점 대비",s?p(s.dd36):"-",s?`연환산 변동성 ${p(s.vol12)}`:"",s?cls(s.dd36):"")}
   </div>
   <div class="gpt-two">
    <div class="gpt-panel"><h4>분석 루프</h4><div class="note">① 30년 가격국면 분해 → ② 상승 전·후 공통 신호 탐색 → ③ 미래값을 보지 않는 월간 전략으로 규칙화 → ④ 과거 백테스트 → ⑤ 최신 데이터에 같은 규칙을 모의 적용 → ⑥ 실거래·공급·인구 변수를 추가하며 성능 개선</div></div>
    <div class="gpt-panel"><h4>현재 연결된 원천</h4><div class="note">KB 월간 아파트 매매가격지수 · 전세가율 · 매수우위지수 · 입주물량. 국토부 실거래·미분양·KOSIS 인구/세대는 다음 데이터 계층으로 분리해 붙일 수 있게 설계했습니다.</div></div>
   </div>
   <div class="gpt-panel"><h4>입주물량 최근 구간</h4><div class="note"><b>대전</b> ${moveinText(data.moveD)}<br><b>세종</b> ${moveinText(data.moveS)}</div></div>`;
}

function renderPattern(data){
  const rows=[["대전",data.daejeon],["세종",data.sejong]].filter(x=>x[1]);
  let trs="";
  for(const [name,row] of rows){
    for(const e of episodesSummary(row))trs+=`<tr><td>${name}</td><td><span class="gpt-badge ${e.state==="상승"?"good":e.state==="하락"?"bad":""}">${e.state}</span></td><td>${e.count}</td><td>${num(e.months,1)}개월</td><td class="${cls(e.ret)}">${p(e.ret)}</td></tr>`;
  }
  let assoc=data.associations.map(a=>`<tr><td>${a.city}</td><td>${a.factor}</td><td>${num(a.corr,2)}</td><td>${a.n}</td><td>해당 월 지표와 이후 12개월 가격수익률 상관</td></tr>`).join("");
  $("#gptPattern").innerHTML=`
   <div class="gpt-panel"><h4>가격국면 반복 패턴</h4><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>지역</th><th>국면</th><th>발생</th><th>평균 지속</th><th>구간 평균수익</th></tr></thead><tbody>${trs||'<tr><td colspan="5">데이터 부족</td></tr>'}</tbody></table></div><div class="note">상승=12개월 변화율 +5% 초과, 하락=-3% 미만, 그 외 정체. 임계값은 v1 고정값이며 과거 성과에 맞춰 자동 최적화하지 않았습니다.</div></div>
   <div class="gpt-panel"><h4>“왜 올랐나” 1차 검증 — 선행 연관성</h4><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>지역</th><th>요인</th><th>상관계수</th><th>표본</th><th>정의</th></tr></thead><tbody>${assoc||'<tr><td colspan="5">요인 시계열이 충분하지 않습니다.</td></tr>'}</tbody></table></div><div class="note">상관은 원인을 증명하지 않습니다. 이후 실거래량·미분양·입주물량·인구/세대·금리·교통/정책 이벤트를 같은 방식으로 붙여 재검증하는 구조입니다.</div></div>`;
}

function btRow(name,row){
  if(!row)return "";
  const b=REGPT.backtest(row.points);if(!b)return "";
  return `<tr><td>${name}</td><td>${b.start}~${b.end}</td><td class="${cls(b.total)}">${p(b.total)}</td><td class="${cls(b.cagr)}">${p(b.cagr)}</td><td class="dn">${p(b.mdd)}</td><td>${b.trades.length}</td><td class="${cls(b.buyHoldReturn)}">${p(b.buyHoldReturn)}</td><td>${b.holding?"보유":"현금"}</td></tr>`;
}
function renderBacktest(data){
  $("#gptBacktest").innerHTML=`
   <div class="gpt-panel"><h4>GPT 독립 전략 v1 백테스트</h4>
   <div class="note">신호는 매월 말까지 확인된 데이터만 사용하고 다음 달 지수에서 체결한 것으로 계산합니다. 매수: 12개월·3개월 모멘텀 모두 양수 + 36개월 고점 대비 -20~0% 구간. 매도: 최소 12개월 보유 후 12개월·3개월 모멘텀 모두 음수. 편도 마찰비용 1.5% 가정.</div>
   <div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>지역</th><th>기간</th><th>누적수익</th><th>CAGR</th><th>MDD</th><th>매매횟수</th><th>단순보유</th><th>현재</th></tr></thead><tbody>${btRow("대전",data.daejeon)}${btRow("세종",data.sejong)}</tbody></table></div>
   <div class="note">이 백테스트는 “도시 가격지수 타이밍 모델”입니다. 실제 아파트 매수는 단지 선택, 취득·중개·보유·양도비용, 대출이자, 공실/전세 리스크가 추가되므로 별도 실거래 백테스트가 필요합니다.</div></div>`;
}

function paperCard(name,row){
  if(!row)return metricCard(name,"-","데이터 없음");
  const m=REGPT.metrics(row.points),s=REGPT.score(m),ph=REGPT.phase(m);
  let action="관찰";
  if(m.m12>0&&m.m3>0&&m.dd36<=0&&m.dd36>=-.20)action="모의매수 조건";
  if(m.m12<0&&m.m3<0)action="현금/관망 조건";
  return `<div class="gpt-card"><div class="k">${name}</div><div class="v">${action}</div><div class="s">${ph} · 점수 ${num(s,0)} · 3M ${p(m.m3)} · 12M ${p(m.m12)}</div></div>`;
}
function renderPaper(data){
  $("#gptPaper").innerHTML=`
   <div class="gpt-grid">${paperCard("대전",data.daejeon)}${paperCard("세종",data.sejong)}</div>
   <div class="gpt-panel"><h4>현재 모의 적용 규칙</h4><div class="note">백테스트와 <b>동일한 고정 규칙</b>만 최신 월에 적용합니다. 과거 결과를 본 뒤 현재 신호만 임의로 바꾸지 않습니다. 이 화면은 실전 주문 기능이 없으며 다음 달 데이터가 들어오면 같은 규칙으로 상태가 갱신됩니다.</div></div>`;
}

function renderRank(data){
  const rows=data.rank.slice(0,15);
  const tr=rows.map((x,i)=>{
    const m=x.metrics;
    return `<tr><td>${i+1}. ${esc(x.name||x.code)}</td><td class="gold">${num(x.score,0)}</td><td>${x.phase}</td><td class="${cls(m.m3)}">${p(m.m3)}</td><td class="${cls(m.m12)}">${p(m.m12)}</td><td class="${cls(m.dd36)}">${p(m.dd36)}</td><td>${p(m.vol12)}</td><td>${m.date}</td></tr>`;
  }).join("");
  $("#gptRank").innerHTML=`
   <div class="gpt-warn">랭킹은 “지금 사라”가 아니라 <b>실거래·공급·입지 분석을 먼저 할 모의 조사 순서</b>입니다. 가격지수만으로 단지 매수를 결정하지 않습니다.</div>
   <div class="gpt-panel"><h4>대전·세종 1차 후보 랭킹</h4><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>지역</th><th>점수</th><th>국면</th><th>3M</th><th>12M</th><th>36M 고점대비</th><th>변동성</th><th>기준월</th></tr></thead><tbody>${tr||'<tr><td colspan="8">지역 세부지수 데이터가 없습니다.</td></tr>'}</tbody></table></div><div class="note">점수는 12M 추세 + 3M 가속 + 고점대비 위치 + 변동성으로 계산한 v1 규칙입니다. 동일한 규칙으로 과거 검증한 뒤 가중치를 바꿉니다.</div></div>`;
}

function renderData(data){
  const err=data.errors.length?'<div class="gpt-warn"><b>일부 데이터 오류</b><br>'+data.errors.map(esc).join("<br>")+"</div>":"";
  $("#gptData").innerHTML=`${err}
   <div class="gpt-panel gpt-src"><h4>데이터 원칙</h4><div class="note">GPT 탭은 클로드 전용 파일/계산결과를 참조하지 않고 외부 원천에서 독립 수집합니다. 사용자 입력값을 브라우저 영구저장소에 저장하지 않습니다.</div>
   <ul>
    <li><a href="${data.links.kb}" target="_blank" rel="noopener">KB부동산 데이터허브</a> — 월간 아파트 가격지수·전세가율·매수우위·입주물량</li>
    <li><a href="${data.links.rtms}" target="_blank" rel="noopener">국토교통부 실거래가 공개시스템</a> — 2006년 이후 실거래 기반 2차 검증용</li>
    <li><a href="${data.links.rone}" target="_blank" rel="noopener">한국부동산원 R-ONE</a> — 공식 주택가격·거래통계 교차검증용</li>
    <li><a href="${data.links.molit}" target="_blank" rel="noopener">국토교통 통계누리</a> — 미분양·인허가·착공·준공 등 공급변수</li>
   </ul></div>
   <div class="gpt-panel"><h4>현재 로딩 상태</h4><div class="note">가격: ${esc(data.sourceVia.price||"-")} · 전세가율: ${esc(data.sourceVia.ratio||"-")} · 매수우위: ${esc(data.sourceVia.buyer||"-")}<br>대전 가격행: ${data.daejeon?data.daejeon.points.length:0}개월 · 세종 가격행: ${data.sejong?data.sejong.points.length:0}개월</div></div>`;
}

async function boot(){
  const st=$("#gptReStatus");
  try{
    const data=await REGPT.load();
    window.__REGPT_DATA__=data;
    renderOverview(data);renderPattern(data);renderBacktest(data);renderPaper(data);renderRank(data);renderData(data);drawHistory(data);
    const ok=(data.daejeon||data.sejong);
    st.textContent=ok?"실데이터 연결됨":"가격데이터 없음";
    st.className="gpt-status "+(ok?"ok":"err");
  }catch(e){
    st.textContent="불러오기 실패";st.className="gpt-status err";
    $("#gptOverview").innerHTML='<div class="gpt-warn">GPT 부동산 데이터를 불러오지 못했습니다: '+esc(e.message||e)+'</div>';
    $("#gptData").innerHTML='<div class="gpt-warn">API 연결을 확인해 주세요. 클로드 탭에는 영향이 없습니다.</div>';
  }
}
boot();
})();