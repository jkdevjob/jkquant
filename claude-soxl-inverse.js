/* 연구(클로드) → ⚡ SOXL 탭 — '인버스 거래대금 비율' 전향 시험 카드. ④ SOXL 단기 반등 전략과는 별개의 실험이다(이름·장부를 섞지 않는다).
   자료: /api/soxl-inverse (scalping-data 브랜치의 data/soxl-inverse-forward/latest.json, 읽기 전용 · 주문 없음)
   계산: scripts/soxl_inverse/forward.cjs — 이 화면은 숫자를 다시 계산하지 않고 기록을 그대로 보여 준다. */
(function(root){
"use strict";
var VERSION="1.0.0",API="/api/soxl-inverse";
var C_ST="#3987e5",C_BH="#d95926",C_SIG="#f5c451";       // 전략(비율 선) · SOXL 그냥 보유 · 기준 넘은 날
var SRC={em:"거래대금 원자료",  "em-cv":"종가×거래량(대체)",yh:"종가×거래량(대체 · Yahoo)"};
var TYPE={signal:"📣 신호",buy:"🟢 매수(모의)",sell:"🔴 매도(모의)"};
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function num(v){return typeof v==="number"&&isFinite(v)}
function pct(v,d){return num(v)?(v>=0?"+":"")+v.toFixed(d==null?1:d)+"%":"—"}
function share(v,d){return num(v)?(v*100).toFixed(d==null?1:d)+"%":"—"}       // 0.458 → 45.8%
function cls(v){return num(v)?(v>=0?"win":"loss"):""}
function md(d){return d?String(d).slice(5).replace("-","/"):"—"}
function ymd(d){return d?String(d).slice(2).replace(/-/g,"/"):"—"}
function usd(v){return num(v)?"$"+v.toFixed(2):"—"}
function eokUsd(v){return num(v)?"$"+(v/1e8).toFixed(1)+"억":"—"}
function kst(t){var d=new Date(t);if(!t||isNaN(d))return "—";var k=new Date(d.getTime()+9*3600e3),p=function(n){return (n<10?"0":"")+n};
  return (k.getUTCMonth()+1)+"/"+k.getUTCDate()+" "+p(k.getUTCHours())+":"+p(k.getUTCMinutes())}
function thr(J){return ((J||{}).params||{}).threshold}
function hold(J){return ((J||{}).params||{}).hold}

/* 지금 상태 한 줄 — pos: 자료 날짜 종가의 상태 · next: 다음 거래일 종가의 상태 */
function stateText(J){
  var s=J.state||{},t=J.today||{},H=hold(J);
  if(s.pos!=="hold"&&s.next==="hold")return {k:"🟢 매수 신호",c:"win",t:esc(md(t.date))+" 비율 "+share(t.ratio)+" — 다음 거래일 종가에 SOXL 매수(모의) · 그 뒤 "+H+"거래일 보유"};
  if(s.pos==="hold"&&s.next!=="hold")return {k:"🔴 매도 예정",c:"loss",t:"마지막 신호 "+esc(md(s.lastSignal))+" 뒤 "+H+"거래일이 지났습니다 — 다음 거래일 종가에 매도(모의)"};
  if(s.pos==="hold")return {k:"보유 중",c:"",t:"매수 "+esc(md(s.boughtDate))+" "+usd(s.boughtPx)+" · 지금 <b class='"+cls(s.openRet)+"'>"+pct(num(s.openRet)?s.openRet*100:null)+"</b> · 마지막 신호 "+esc(md(s.lastSignal))+" · "+(num(s.sellIn)?s.sellIn+"거래일 뒤 종가에 매도":"")+"(그 전에 신호가 또 나오면 그날부터 다시 "+H+"거래일)"};
  return {k:"현금 대기",c:"",t:"비율이 "+share(thr(J),0)+" 이상인 날이 나오면 다음 거래일 종가에 삽니다"};
}
/* 탭 맨 위 한 줄 — 아래 카드로 내려가는 단추 */
function strip(J){
  if(!J||J.ok===false||J.status==="waiting_first_run"||!J.today)return "";
  var t=J.today,st=stateText(J),g=num(t.gap)?(t.gap>0?"기준 "+share(thr(J),0)+"까지 "+(t.gap*100).toFixed(1)+"%p":"기준 "+share(thr(J),0)+" 넘음"):"";
  return "<button type='button' class='rule siv-strip' onclick=\"var e=document.getElementById('siv');if(e)e.scrollIntoView({behavior:'smooth',block:'start'})\">🧪 <b>인버스 거래대금 비율</b> "+esc(md(t.date))+" <b>"+share(t.ratio)+"</b>"+(g?" · "+g:"")+" · <span class='"+st.c+"'>"+st.k+"</span> <span class='sub'>별도 실험 · 주문 없음 · 아래 자세히 ↓</span></button>";
}
function kpis(J){
  var t=J.today||{},f=J.forward||{},st=stateText(J),T=thr(J);
  var k=function(l,v,sub,c){return "<div class='kpi'><div class='l'>"+l+"</div><div class='v "+(c||"")+"'>"+v+"</div>"+(sub?"<div class='sub'>"+sub+"</div>":"")+"</div>"};
  return "<div class='kpis'>"+
    k(esc(md(t.date))+" 비율",share(t.ratio),(num(t.gap)?(t.gap>0?"기준 "+share(T,0)+"까지 "+(t.gap*100).toFixed(1)+"%p":"기준 "+share(T,0)+" 이상 — 신호"):"")+"<br>SOXS "+eokUsd(t.inverseAmount)+" ÷ SOXL "+eokUsd(t.longAmount),num(t.gap)&&t.gap<=0?"win":"")+
    k("지금 상태",st.k,st.t,st.c)+
    k("등록 뒤 모의 성과",f.days>0?pct(f.ret):"—",f.days>0?f.days+"거래일 · SOXL 그냥 보유 "+pct(f.bhRet)+" · 최대 낙폭 "+pct(-f.mdd)+" (보유 "+pct(-f.bhMdd)+")":"등록 "+esc(md(J.registeredDate))+" — 다음 거래일부터 쌓입니다",f.days>0?cls(f.ret):"")+
  "</div>";
}
/* 최근 비율 흐름 — 한 줄(이름은 제목이 말한다) + 기준선 */
function ratioChart(J){
  var rc=(J.recent||[]).filter(function(r){return num(r.ratio)}),T=thr(J);if(rc.length<2)return "<p class='note'>그래프는 자료가 이틀 이상 쌓이면 그립니다.</p>";
  var vals=rc.map(function(r){return r.ratio}),lo=Math.min.apply(null,vals.concat([T])),hi=Math.max.apply(null,vals.concat([T]));
  lo=Math.max(0,Math.floor((lo-0.05)*10)/10);hi=Math.ceil((hi+0.05)*10)/10;
  var nar=typeof root.innerWidth==="number"&&root.innerWidth<560;
  var W=nar?400:820,H=nar?220:250,P={l:nar?38:46,r:nar?58:62,t:14,b:30},n=rc.length,x=function(i){return P.l+i*(W-P.l-P.r)/(n-1)},y=function(v){return P.t+(hi-v)*(H-P.t-P.b)/(hi-lo)};
  var g="",step=(hi-lo)>0.61?0.2:0.1;
  for(var tv=lo;tv<=hi+1e-9;tv+=step){var yy=y(tv).toFixed(1);
    g+="<line x1='"+P.l+"' y1='"+yy+"' x2='"+(W-P.r)+"' y2='"+yy+"' stroke='var(--border)' stroke-width='1'/><text x='"+(P.l-6)+"' y='"+(+yy+4)+"' text-anchor='end' fill='var(--faint)' font-size='10'>"+Math.round(tv*100)+"%</text>"}
  g+="<line x1='"+P.l+"' y1='"+y(T).toFixed(1)+"' x2='"+(W-P.r)+"' y2='"+y(T).toFixed(1)+"' stroke='"+C_SIG+"' stroke-width='1.5' stroke-dasharray='5 4'/><text x='"+(W-P.r+5)+"' y='"+(y(T)+4).toFixed(1)+"' fill='var(--dim)' font-size='10'>기준 "+Math.round(T*100)+"%</text>";
  [0,Math.floor((n-1)/2),n-1].filter(function(v,i,a){return a.indexOf(v)===i}).forEach(function(i){g+="<text x='"+x(i).toFixed(1)+"' y='"+(H-10)+"' text-anchor='"+(i===0?"start":i===n-1?"end":"middle")+"' fill='var(--faint)' font-size='10'>"+esc(md(rc[i].date))+"</text>"});
  g+="<polyline fill='none' stroke='"+C_ST+"' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' points='"+rc.map(function(r,i){return x(i).toFixed(1)+","+y(r.ratio).toFixed(1)}).join(" ")+"'/>";
  rc.forEach(function(r,i){if(r.ratio>=T)g+="<circle cx='"+x(i).toFixed(1)+"' cy='"+y(r.ratio).toFixed(1)+"' r='4.5' fill='"+C_SIG+"' stroke='var(--surf)' stroke-width='2'/>"});
  var L=rc[n-1];g+="<circle cx='"+x(n-1).toFixed(1)+"' cy='"+y(L.ratio).toFixed(1)+"' r='4' fill='"+C_ST+"' stroke='var(--surf)' stroke-width='2'/><text x='"+(W-P.r+5)+"' y='"+(y(L.ratio)+4).toFixed(1)+"' fill='var(--text)' font-size='11' font-weight='700'>"+share(L.ratio)+"</text>";
  var bw=(W-P.l-P.r)/(n-1);                                  // 날짜별 넓은 손잡이 — 올리면 그날 값
  rc.forEach(function(r,i){g+="<rect x='"+(x(i)-bw/2).toFixed(1)+"' y='"+P.t+"' width='"+bw.toFixed(1)+"' height='"+(H-P.t-P.b)+"' fill='transparent'><title>"+esc(r.date)+" · "+share(r.ratio)+(r.ratio>=T?" · 신호":"")+(r.src&&r.src!=="em"?" · "+esc(SRC[r.src]||r.src):"")+"</title></rect>"});
  return "<div style='overflow-x:auto'><svg viewBox='0 0 "+W+" "+H+"' style='display:block;width:100%;height:auto' role='img' aria-label='최근 "+n+"거래일 인버스 거래대금 비율 — 마지막 "+share(L.ratio)+" · 기준 "+Math.round(T*100)+"%'>"+g+"</svg></div>";
}
/* 등록 뒤 모의 장부 vs SOXL 그냥 보유 */
function fwdChart(J){
  var cv=((J.forward||{}).curve||[]).filter(function(p){return num(p.eq)&&num(p.bh)});if(cv.length<2)return "";
  var vals=[1];cv.forEach(function(p){vals.push(p.eq,p.bh)});
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);if(hi-lo<0.02){lo-=0.01;hi+=0.01}var pad=(hi-lo)*0.1;lo-=pad;hi+=pad;
  var nar=typeof root.innerWidth==="number"&&root.innerWidth<560;
  var W=nar?400:820,H=nar?230:270,P={l:nar?40:54,r:nar?10:18,t:16,b:32},n=cv.length,x=function(i){return P.l+i*(W-P.l-P.r)/(n-1)},y=function(v){return P.t+(hi-v)*(H-P.t-P.b)/(hi-lo)};
  var g="",span=(hi-lo)*100,step=[1,2,5,10,20,25,50,100,200].filter(function(t){return span/t<=6})[0]||500;
  for(var tv=Math.ceil((lo-1)*100/step)*step;tv<=(hi-1)*100+1e-9;tv+=step){var yy=y(1+tv/100).toFixed(1);
    g+="<line x1='"+P.l+"' y1='"+yy+"' x2='"+(W-P.r)+"' y2='"+yy+"' stroke='var(--border)' stroke-width='1'/><text x='"+(P.l-6)+"' y='"+(+yy+4)+"' text-anchor='end' fill='var(--faint)' font-size='10'>"+(tv>0?"+":"")+tv+"%</text>"}
  g+="<line x1='"+P.l+"' y1='"+y(1).toFixed(1)+"' x2='"+(W-P.r)+"' y2='"+y(1).toFixed(1)+"' stroke='var(--faint)' stroke-dasharray='4 4'/>";
  [0,Math.floor((n-1)/2),n-1].filter(function(v,i,a){return a.indexOf(v)===i}).forEach(function(i){g+="<text x='"+x(i).toFixed(1)+"' y='"+(H-10)+"' text-anchor='"+(i===0?"start":i===n-1?"end":"middle")+"' fill='var(--faint)' font-size='10'>"+esc(md(cv[i].date))+"</text>"});
  var line=function(key,c,w){return "<polyline fill='none' stroke='"+c+"' stroke-width='"+w+"' stroke-linejoin='round' stroke-linecap='round' points='"+cv.map(function(p,i){return x(i).toFixed(1)+","+y(p[key]).toFixed(1)}).join(" ")+"'/>"};
  g+=line("bh",C_BH,2)+line("eq",C_ST,3);
  var L=cv[n-1];g+="<circle cx='"+x(n-1).toFixed(1)+"' cy='"+y(L.eq).toFixed(1)+"' r='4' fill='"+C_ST+"' stroke='var(--surf)' stroke-width='2'/>";
  var bw=(W-P.l-P.r)/(n-1);
  cv.forEach(function(p,i){g+="<rect x='"+(x(i)-bw/2).toFixed(1)+"' y='"+P.t+"' width='"+bw.toFixed(1)+"' height='"+(H-P.t-P.b)+"' fill='transparent'><title>"+esc(p.date)+" · 실험 "+pct((p.eq-1)*100)+" · SOXL 보유 "+pct((p.bh-1)*100)+" · "+(p.pos?"보유":"현금")+"</title></rect>"});
  var sw=function(c,t){return "<span style='display:inline-flex;align-items:center;gap:5px;white-space:nowrap'><i style='width:14px;height:3px;background:"+c+";display:inline-block'></i>"+t+"</span>"};
  return "<div style='margin-top:12px'><b>등록 뒤 누적</b> <span class='sub'>"+esc(md(cv[0].date))+" 종가 = 0%</span></div><div style='overflow-x:auto'><svg viewBox='0 0 "+W+" "+H+"' style='display:block;width:100%;height:auto' role='img' aria-label='등록 뒤 누적 — 실험 "+pct((L.eq-1)*100)+" · SOXL 그냥 보유 "+pct((L.bh-1)*100)+"'>"+g+"</svg></div>"+
    "<div class='row' style='gap:12px;margin-top:6px;font-size:11px'>"+sw(C_ST,"이 실험(모의) <b class='"+cls(L.eq-1)+"'>"+pct((L.eq-1)*100)+"</b>")+sw(C_BH,"SOXL 그냥 보유 "+pct((L.bh-1)*100))+"</div>";
}
function eventLog(J){
  var ev=((J.forward||{}).events||[]).slice(-30).reverse();
  if(!ev.length)return "<p class='note'>등록("+esc(md(J.registeredDate))+") 뒤로 아직 신호가 없습니다. 등록 전 신호는 여기 넣지 않습니다"+(J.lastPastSignal?" — 등록 전 마지막 신호는 "+esc(ymd(J.lastPastSignal.date))+" ("+share(J.lastPastSignal.ratio)+")":"")+".</p>";
  return "<div class='tbf-ev'>"+ev.map(function(e){
    var what=e.type==="signal"?"비율 "+share(e.ratio)+" (SOXS "+eokUsd(e.inverseAmount)+" ÷ SOXL "+eokUsd(e.longAmount)+")"+(e.src&&e.src!=="em"?" · "+esc(SRC[e.src]||e.src):""):
      e.type==="buy"?"SOXL "+usd(e.price)+" · 근거 "+esc(md(e.signalDate))+" 비율 "+share(e.ratio):
      "SOXL "+usd(e.price)+" · <b class='"+cls(e.ret)+"'>"+pct(num(e.ret)?e.ret*100:null)+"</b> (매수 "+esc(md(e.boughtDate))+" · 마지막 신호 "+esc(md(e.lastSignalDate))+")";
    return "<div><b>"+esc(md(e.date))+"</b> "+(TYPE[e.type]||esc(e.type))+" · "+what+"</div>"}).join("")+"</div>";
}
/* 등록 전 과거 재생 — 전향 성과와 섞이지 않게 접어 두고 이름을 달리 붙인다 */
function backtest(J){
  var b=J.backtest,c=J.counts||{};if(!b||!num(b.cagr))return "";
  var rows=(b.trades||[]).map(function(t,i){return "<tr><td>"+(i+1)+"</td><td>"+esc(ymd(t.in))+"</td><td>"+esc(ymd(t.out))+"</td><td class='"+cls(t.ret)+"'><b>"+pct(t.ret)+"</b></td></tr>"}).join("");
  return "<details class='siv-past'><summary>📜 과거 시험 (등록 전 재생 · 전향 성과 아님) — "+esc(ymd(b.from))+" ~ "+esc(ymd(b.to))+"</summary>"+
    "<div class='kpis'><div class='kpi'><div class='l'>이 규칙 (과거 재생)</div><div class='v'>연 "+pct(b.cagr)+"</div><div class='sub'>최대 낙폭 "+pct(-b.mdd)+" · 보유한 날 "+b.heldPct+"%</div></div>"+
    "<div class='kpi'><div class='l'>SOXL 그냥 보유</div><div class='v'>연 "+pct(b.bhCagr)+"</div><div class='sub'>최대 낙폭 "+pct(-b.bhMdd)+"</div></div>"+
    "<div class='kpi'><div class='l'>매매 횟수</div><div class='v'>"+(b.trades||[]).length+"번</div><div class='sub'>"+(num(b.years)?b.years.toFixed(1)+"년 동안":"")+" — 표본이 아주 적습니다</div></div></div>"+
    (rows?"<div class='tw'><table style='min-width:0'><thead><tr><th>#</th><th>매수</th><th>매도</th><th>수익</th></tr></thead><tbody>"+rows+"</tbody></table></div>":"")+
    "<p class='note'>"+esc(b.note||"")+"<br>전체 "+(c.days||"—")+"거래일 중 비율 50% 이상 "+(c.ge50||0)+"일 · 70% 이상 "+(c.ge70||0)+"일 · 100% 초과 "+(c.gt100||0)+"일. 2017-07 이전은 실제 거래대금 자료가 없어 종가×거래량으로 대신했습니다.</p></details>";
}
function view(J){
  var head="<div class='card' id='siv'><h3>🧪 인버스 거래대금 비율 — 전향 시험 <span class='tag'>별도 실험 · 주문 없음</span></h3>";
  if(!J)return head+"<div class='loading'>불러오는 중…</div></div>";
  if(J.ok===false)return head+"<div class='warn'>인버스 거래대금 비율 자료를 못 불러왔습니다: "+esc(J.error||"")+"</div></div>";
  if(J.status==="waiting_first_run"||!J.today)return head+"<p class='note'>아직 첫 실행 전입니다 — 미국장 마감 뒤 자동 실행이 기록을 시작합니다.</p></div>";
  var T=thr(J),H=hold(J),t=J.today||{};
  return head+"<div class='sub'>위의 ④ 단기 반등 전략과는 <b>상관없는 별도 실험</b>입니다. 자료 <b>"+esc(md(J.asOf))+"</b> 미국장 마감 · 기록 "+esc(kst(J.updatedAt))+" · 등록 "+esc(md(J.registeredDate))+
    (t.src&&t.src!=="em"?" · <span class='loss'>오늘 값은 "+esc(SRC[t.src]||t.src)+"</span>":"")+"</div>"+
    "<div class='rule'><b>규칙(고정)</b> — SOXS(반도체 하락 3배) 하루 거래대금이 SOXL(상승 3배) 거래대금의 <b>"+share(T,0)+" 이상</b>인 날이 나오면 다음 거래일 종가에 SOXL 을 사서, 마지막 신호 뒤 <b>"+H+"거래일</b> 들고 팝니다. 그 밖엔 현금.<br>"+
    "<span class='sub'>하락에 거는 돈이 유난히 몰린 날 = 겁이 극에 달한 날이라는 생각입니다. 평소엔 40% 안팎입니다.</span></div>"+
    kpis(J)+
    "<div style='margin-top:12px'><b>최근 "+(J.recent||[]).length+"거래일 비율</b> <span class='sub'>SOXS 거래대금 ÷ SOXL 거래대금</span></div>"+ratioChart(J)+
    fwdChart(J)+
    "<div style='margin-top:12px'><b>🧾 기록 (등록 뒤 · 고치지 않음)</b></div>"+eventLog(J)+
    backtest(J)+
    "<p class='note'>⚠ 약한 후보입니다 — 과거 16년에 매매가 7번뿐이고, 그 사이 최대 80% 떨어진 적이 있으며, 다른 3배 짝(TQQQ·TECL)에서는 통하지 않았습니다. 그래서 돈을 넣지 않고 앞으로의 기록만 쌓습니다(실주문·알림 없음). "+
    "모의 장부는 원금과 무관한 비율 계산(소수 주식) · 수수료 "+(num((J.params||{}).fee)?((J.params.fee)*100).toFixed(1):"—")+"% · 세금·현금 이자 없음 · 기록 v"+esc(J.strategyVersion||"")+".</p></div>";
}
var api={VERSION:VERSION,API:API,esc:esc,pct:pct,share:share,view:view,strip:strip,stateText:stateText,kpis:kpis,ratioChart:ratioChart,fwdChart:fwdChart,eventLog:eventLog,backtest:backtest};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.ClaudeSoxlInverse=api;
})(typeof window!=="undefined"?window:this);
