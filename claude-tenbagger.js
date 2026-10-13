/* 연구(클로드) → 🔟 텐배거 탭 — 30년 분석에서 고른 패턴을 앞으로 그대로 사 보는 전향 시험 장부를 보여 준다.
   자료: /api/tenbagger-claude (scalping-data 브랜치의 data/tenbagger-claude-forward/latest.json, 읽기 전용 · 주문 없음)
   계산: scripts/tenbagger_claude/forward.py — 이 화면은 숫자를 다시 계산하지 않고 기록을 그대로 보여 준다. */
(function(root){
"use strict";
var VERSION="1.0.0",API="/api/tenbagger-claude";
var C_ST="#3987e5",C_KS="#d95926",C_KQ="#199e70",C_RD="#8b93b8";     // 전략 · 코스피 · 코스닥 · 무작위(중앙)
var REASON={hotTrail:"과열 뒤 20% 하락",time:"1년 보유 끝",delisted:"상장폐지 정리"};
var TYPE={signal:"📣 신호",buy:"🟢 매수",sell:"🔴 매도",exitSignal:"⏳ 매도 예정"};
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function num(v){return typeof v==="number"&&isFinite(v)}
function pct(v,d){return num(v)?(v>=0?"+":"")+v.toFixed(d==null?1:d)+"%":"—"}
function cls(v){return num(v)?(v>=0?"win":"loss"):""}
function kst(t){var d=new Date(t);if(!t||isNaN(d))return "—";var k=new Date(d.getTime()+9*3600e3),p=function(n){return (n<10?"0":"")+n};
  return (k.getUTCMonth()+1)+"/"+k.getUTCDate()+" "+p(k.getUTCHours())+":"+p(k.getUTCMinutes())}
function won(v){return num(v)?Math.round(v).toLocaleString("ko-KR")+"원":"—"}
function eok(v){return num(v)?(v>=1e8?(v/1e8).toFixed(2)+"억":Math.round(v/1e4).toLocaleString("ko-KR")+"만")+"원":"—"}
function md(d){return d?String(d).slice(5).replace("-","/"):"—"}
function mult(v){return num(v)?v.toFixed(2)+"배":"—"}

function statusLine(J){
  if(J.status==="waiting_first_run")return "아직 첫 실행 전입니다 — 매일 아침 자동 실행이 등록부터 시작합니다.";
  if(J.status==="waiting_kickoff")return "등록 "+esc(md(J.registeredDate))+" · 첫 신호 <b>"+esc(md(J.expectedKickoff))+" 종가</b>(휴장이면 다음 거래일) → 그다음 거래일 종가에 20종목 매수 · 자료 "+esc(md(J.asOf));
  var b=(J.books||{}).usd100k||{},n=(b.curve||[]).length-1;
  return "시작 신호 <b>"+esc(md(J.kickoff))+"</b> → 첫 매수 "+esc(md(J.firstBuy))+" · 자료 <b>"+esc(md(J.asOf))+"</b>"+(n>0?" · "+n+"거래일째":"")+
    (J.lastIsSignal?" · <span class='win'>"+esc(md(J.asOf))+" 종가가 신호 — 다음 거래일 종가에 빈 칸 "+(num(J.freeSlots)?J.freeSlots+"개":"")+"를 아래 '지금 순위' 위에서부터 산다(보유 종목 건너뜀)</span>":"");
}
function ruleCard(J){
  var m=J.model||{},bt=m.backtest||{},r=m.rule||{},bk=(bt.bench||{}).KOSPI||{};
  return "<div class='rule'><b>무엇을</b> 30년(1995~) 코스피·코스닥 전 종목(상장폐지 포함)으로 학습한 모형의 '3년 안 3배' 점수 상위 20종목 — 시가총액·주가·거래대금이 작고 3년 고점 대비 많이 빠졌으며 200일선 근처로 돌아온 종목에 점수가 높다.<br>"+
    "<b>언제 사나</b> 등록 뒤 첫 종가로 첫 신호, 그 뒤로는 매달 마지막 거래일 종가 신호 → 다음 거래일 종가에 <u>빈 칸만</u> 채운다(관리·환기 종목, 상장 60거래일 미만, 20일 거래대금 1억 미만 제외).<br>"+
    "<b>언제 파나</b> "+esc(r.name||"")+" — "+(r.hold||250)+"거래일 보유, 단 200일선의 "+(r.hot||2)+"배 이상 과열된 적이 있으면 최고 종가 대비 "+Math.round((r.hot_trail||0.2)*100)+"% 빠진 날 다음 거래일 종가. 상장폐지는 마지막 거래일 가격.<br>"+
    "<b>비용</b> 수수료 0.015% · 미끄러짐 0.2% · 매도 거래세(연도별) · 정수 주식 · 원금 10만$(₩1억4,000만)·1만$(₩1,400만) 두 장부 · 20칸 균등.<br>"+
    "<b>알림</b> 실제 매수·매도 때만 — '[클로드 연구 텐배거] 🟢 매수 / 🔴 매도' 웹 알림(설정 → 연구 결과)·텔레그램. 장 마감 자료가 다음 날 새벽에 들어오므로 그날 아침 '오늘 종가 매수·매도 예정'으로 옵니다(10만$ 장부 기준).</div>"+
    "<p class='note'>30년 백테(2003~, 같은 규칙): 연 "+pct(bt.cagr*100)+" · 최대 낙폭 "+pct(bt.mdd*100,0)+" · 규칙을 고르지 않은 2013~ 검증 연 "+pct(bt.oos_cagr*100)+
    " (같은 기간 코스피 연 "+pct(bk.cagr*100)+"). 모형 AUC "+esc(((m.auc||{}).y3_3)||"—")+" — 맞히는 힘이 약한 모형이라 20종목을 오래 들고 가야 평균이 드러난다. 이 탭은 그 결과가 앞으로도 나오는지 본다.</p>";
}
function kpis(J){
  var B=J.books||{},b=B.usd100k||{},s=B.usd10k||{},mk=J.market||{},rd=J.random||{};
  var k=function(l,v,sub,c){return "<div class='kpi'><div class='l'>"+l+"</div><div class='v "+(c||"")+"'>"+v+"</div>"+(sub?"<div class='sub'>"+sub+"</div>":"")+"</div>"};
  return "<div class='kpis'>"+
    k("10만$ 장부",pct(b.retPct),eok(b.value)+" · 최대 낙폭 "+pct(b.mddPct),cls(b.retPct))+
    k("1만$ 장부",pct(s.retPct),eok(s.value)+" · 정수 주식 반올림 차이",cls(s.retPct))+
    k("같은 기간 지수",(mk.ok?"코스피 "+pct(mk.KOSPI):"—"),mk.ok?"코스닥 "+pct(mk.KOSDAQ):"지수 자료 없음",cls(mk.KOSPI))+
    k("무작위 20종목(같은 규칙)",pct(rd.p50),num(rd.p10)?"10~90%: "+pct(rd.p10)+" ~ "+pct(rd.p90)+(num(rd.beat)?" · 모형이 "+Math.round(rd.beat*100)+"% 앞섬":""):"씨앗 "+(rd.seeds||30)+"개",cls(rd.p50))+
    k("보유 · 실현",(b.holdings||[]).length+"/20",(b.closedN||0)+"건 매도 · 이익 "+(b.wins||0)+"건")+
    "</div>";
}
// 누적 그래프 — 전략(10만$) · 코스피 · 코스닥 · 무작위 중앙(10~90% 띠). 값은 시작일=1 의 배수.
function chart(J){
  var b=(J.books||{}).usd100k||{},cv=b.curve||[];if(cv.length<2)return "<p class='note'>그래프는 첫 매수 다음 거래일부터 그립니다.</p>";
  var base=cv[0][1],st=cv.map(function(p){return [p[0],p[1]/base]});
  var mk=((J.market||{}).curve||[]),rd=((J.random||{}).curve||[]);
  var dates=st.map(function(p){return p[0]}),di={};dates.forEach(function(d,i){di[d]=i});
  var vals=[1];st.forEach(function(p){vals.push(p[1])});mk.forEach(function(p){if(di[p[0]]!=null)vals.push(p[1],p[2])});rd.forEach(function(p){if(di[p[0]]!=null)vals.push(p[1],p[3])});
  vals=vals.filter(num);
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);if(hi-lo<0.02){lo-=0.01;hi+=0.01}var pad=(hi-lo)*0.1;lo-=pad;hi+=pad;
  var nar=typeof root.innerWidth==="number"&&root.innerWidth<560;      // 휴대폰: 좁은 판으로 그려 글자가 작아지지 않게
  var W=nar?400:820,H=nar?250:290,P={l:nar?40:54,r:nar?10:18,t:16,b:36},n=dates.length,x=function(d){return P.l+di[d]*(W-P.l-P.r)/(n-1)},y=function(v){return P.t+(hi-v)*(H-P.t-P.b)/(hi-lo)};
  var g="",span=(hi-lo)*100,step=[1,2,5,10,20,25,50,100,200].filter(function(t){return span/t<=6})[0]||500;
  for(var tv=Math.ceil((lo-1)*100/step)*step;tv<=(hi-1)*100+1e-9;tv+=step){var yy=y(1+tv/100).toFixed(1);
    g+="<line x1='"+P.l+"' y1='"+yy+"' x2='"+(W-P.r)+"' y2='"+yy+"' stroke='var(--border)' stroke-width='1'/><text x='"+(P.l-6)+"' y='"+(+yy+4)+"' text-anchor='end' fill='var(--faint)' font-size='10'>"+(tv>0?"+":"")+tv+"%</text>"}
  g+="<line x1='"+P.l+"' y1='"+y(1).toFixed(1)+"' x2='"+(W-P.r)+"' y2='"+y(1).toFixed(1)+"' stroke='var(--faint)' stroke-dasharray='4 4'/>";
  [0,Math.floor((n-1)/2),n-1].filter(function(v,i,a){return a.indexOf(v)===i}).forEach(function(i){g+="<text x='"+x(dates[i]).toFixed(1)+"' y='"+(H-12)+"' text-anchor='"+(i===0?"start":i===n-1?"end":"middle")+"' fill='var(--faint)' font-size='10'>"+esc(md(dates[i]))+"</text>"});
  var rdIn=rd.filter(function(p){return di[p[0]]!=null});
  if(rdIn.length>1)g+="<polygon fill='"+C_RD+"' fill-opacity='0.16' stroke='none' points='"+rdIn.map(function(p){return x(p[0]).toFixed(1)+","+y(p[3]).toFixed(1)}).concat(rdIn.slice().reverse().map(function(p){return x(p[0]).toFixed(1)+","+y(p[1]).toFixed(1)})).join(" ")+"'/>";
  var line=function(pts,c,w,dash){return pts.length>1?"<polyline fill='none' stroke='"+c+"' stroke-width='"+w+"'"+(dash?" stroke-dasharray='5 4'":"")+" stroke-linejoin='round' stroke-linecap='round' points='"+pts.map(function(p){return x(p[0]).toFixed(1)+","+y(p[1]).toFixed(1)}).join(" ")+"'/>":""};
  g+=line(rdIn.map(function(p){return [p[0],p[2]]}),C_RD,2,true);
  var mkIn=mk.filter(function(p){return di[p[0]]!=null});
  g+=line(mkIn.map(function(p){return [p[0],p[1]]}),C_KS,2)+line(mkIn.map(function(p){return [p[0],p[2]]}),C_KQ,2)+line(st,C_ST,3);
  var last=st[st.length-1];g+="<circle cx='"+x(last[0]).toFixed(1)+"' cy='"+y(last[1]).toFixed(1)+"' r='4' fill='"+C_ST+"'><title>전략 "+esc(last[0])+" "+pct((last[1]-1)*100)+"</title></circle>";
  var mkl=mkIn[mkIn.length-1],rdl=rdIn[rdIn.length-1];
  var sw=function(c,t,dash){return "<span style='display:inline-flex;align-items:center;gap:5px;white-space:nowrap'><i style='width:14px;height:"+(dash?2:3)+"px;background:"+c+";display:inline-block"+(dash?";opacity:.8":"")+"'></i>"+t+"</span>"};
  return "<div style='overflow-x:auto'><svg viewBox='0 0 "+W+" "+H+"' style='display:block;width:100%;height:auto' role='img' aria-label='전향 시험 누적 — 전략 "+pct((last[1]-1)*100)+"'>"+g+"</svg></div>"+
    "<div class='row' style='gap:12px;margin-top:6px;font-size:11px'>"+sw(C_ST,"전략(10만$) <b class='"+cls((last[1]-1)*100)+"'>"+pct((last[1]-1)*100)+"</b>")+
    (mkl?sw(C_KS,"코스피 "+pct((mkl[1]-1)*100))+sw(C_KQ,"코스닥 "+pct((mkl[2]-1)*100)):"")+
    (rdl?sw(C_RD,"무작위 20종목 중앙 "+pct((rdl[2]-1)*100)+" (띠 10~90%)",true):"")+"</div>";
}
function holdTable(b){
  var h=b.holdings||[];if(!h.length)return "<p class='note'>보유 종목 없음.</p>";
  return "<div class='tbf-list'>"+h.map(function(x){
    var st=x.pendingExit?"<span class='loss'>⏳ "+esc(md(x.exitSignalDate))+" 조건 → 다음 거래일 종가 매도("+esc(REASON[x.pendingExit]||x.pendingExit)+")</span>":
      x.hot?"🔥 과열 표시 · 최고 대비 "+pct(x.fromHighPct)+" (−20%면 매도)":"보유 중 · 200일선 "+(num(x.ma200x)?x.ma200x.toFixed(2)+"배":"—")+" · 최고 대비 "+pct(x.fromHighPct);
    if(!x.traded)st+=" · 오늘 거래 없음";
    return "<div class='tbf-item'><div class='top'><span><b>"+esc(x.name)+"</b> <span class='sub'>"+esc(x.code)+" · "+esc(x.mkt)+"</span></span><span class='r "+cls(x.netPct)+"'>"+pct(x.netPct)+"</span></div>"+
      "<div class='m'>"+esc(md(x.entryDate))+" "+won(x.entryPrice)+" → "+won(num(x.adjClose)?x.adjClose:x.lastClose)+" · "+(x.shares||0).toLocaleString("ko-KR")+"주 · "+eok(x.value)+
      (num(x.adjClose)&&num(x.lastClose)&&Math.abs(x.lastClose/x.adjClose-1)>0.01?"<br><span class='sub'>액면·주식 수 변경 반영(매수가 기준 환산) · 실제 종가 "+won(x.lastClose)+"</span>":"")+"</div>"+
      "<div class='m'>최고 "+mult(x.maxMult)+" · "+x.sessions+"/"+x.holdMax+"거래일</div><div class='s'>"+st+"</div></div>"}).join("")+"</div>"+
    "<p class='note'>수익(순) = 지금 팔면 받는 금액(거래세·비용 뺌) 기준. 최고 = 매수 뒤 가장 높았던 종가 ÷ 매수가.</p>";
}
function closedTable(b){
  var c=(b.closed||[]).slice().reverse();if(!c.length)return "<p class='note'>아직 매도한 종목이 없습니다 — 규칙상 보통 1년(250거래일) 들고 갑니다.</p>";
  return "<div class='tbf-list'>"+c.map(function(x){
    return "<div class='tbf-item'><div class='top'><span><b>"+esc(x.name)+"</b> <span class='sub'>"+esc(x.code)+"</span></span><span class='r "+cls(x.netPct)+"'>"+pct(x.netPct)+"</span></div>"+
      "<div class='m'>"+esc(md(x.entryDate))+" "+won(x.entryPrice)+" → "+esc(md(x.exitDate))+" "+won(x.exitPrice)+" · "+x.sessions+"거래일 · "+(x.shares||0).toLocaleString("ko-KR")+"주</div>"+
      "<div class='s'>"+esc(REASON[x.reason]||x.reason)+" · 최고 "+mult(x.maxMult)+"</div></div>"}).join("")+"</div>";
}
function candTable(J){
  var c=J.candidates||[];if(!c.length)return "<p class='note'>후보 없음.</p>";
  return "<div class='tw'><table class='board'><thead><tr><th>#</th><th style='text-align:left'>종목</th><th>점수</th><th>시총</th><th>주가</th><th>3년 고점 대비</th><th>3개월</th></tr></thead><tbody>"+
    c.map(function(x){return "<tr><td>"+x.rank+"</td><td class='nm' style='text-align:left'><b>"+esc(x.name)+"</b>"+(x.held?" <span class='tag'>보유</span>":"")+" <span class='sub'>"+esc(x.code)+" · "+esc(x.mkt)+"</span></td>"+
      "<td>"+(num(x.score)?(x.score*100).toFixed(1)+"%":"—")+"</td><td>"+(num(x.cap)?x.cap.toLocaleString("ko-KR")+"억":"—")+"</td><td>"+won(x.price)+"</td><td class='loss'>"+pct(x.dd3,0)+"</td><td class='"+cls(x.ret60)+"'>"+pct(x.ret60,0)+"</td></tr>"}).join("")+
    "</tbody></table></div><p class='note'>점수 = 3년(750거래일) 안 종가 3배가 될 추정 확률(30년 평균 "+pct((((J.model||{}).backtest||{}).baseP3||0)*100,1)+"). 순위만 매수에 씁니다 — 다음 월말 신호에 빈 칸이 있으면 위에서부터 삽니다.</p>";
}
function eventLog(J){
  // 같은 날 같은 종류(매수·매도·매도 예정)는 한 줄로 묶는다 — 첫 신호 날엔 20종목을 한꺼번에 산다
  var ev=(J.events||[]).filter(function(e){return !e.book||e.book==="usd100k"}),rows=[],key={};
  ev.forEach(function(e){var k=e.type==="signal"?e.id:e.type+"|"+e.date;if(key[k]==null){key[k]=rows.length;rows.push([])}rows[key[k]].push(e)});
  rows=rows.slice(-30).reverse();
  if(!rows.length)return "<p class='note'>아직 기록된 사건이 없습니다.</p>";
  var late=0;
  var html="<div class='tbf-ev'>"+rows.map(function(g){
    var e=g[0],what;
    if(e.type==="signal")what=(e.kickoff?"첫 신호 · ":"월말 신호 · ")+"후보 "+e.universe+"종목 중 1위 "+esc(((e.picks||[])[0]||{}).name||"—");
    else if(e.type==="buy")what=g.length+"종목 · "+g.map(function(x){return esc(x.name)+" "+won(x.price)}).join(", ");
    else if(e.type==="sell")what=g.map(function(x){return esc(x.name)+" <b class='"+cls(x.netPct)+"'>"+pct(x.netPct)+"</b>("+esc(REASON[x.reason]||x.reason)+")"}).join(", ");
    else what=g.map(function(x){return esc(x.name)+"("+esc(REASON[x.reason]||x.reason)+")"}).join(", ")+" → 다음 거래일 종가";
    var lt=e.type==="signal"&&e.firstSeenAsOf&&e.firstSeenAsOf>e.date;if(lt)late++;
    return "<div><b>"+esc(md(e.date))+"</b> "+(TYPE[e.type]||esc(e.type))+" · "+what+"<div class='t'>기록 "+esc(kst(e.firstSeenAt))+(lt?" · <span class='loss'>늦게 잡힘</span>":"")+"</div></div>"}).join("")+"</div>";
  return html+(late?"<p class='note'>늦게 잡힘 = 그날 자료만으로는 월말인지 알 수 없어(연말 휴장 등) 다음 달 첫 거래일 자료가 들어온 뒤 기록된 신호입니다.</p>":"");
}
function revisions(J){
  var r=J.revisions||[];if(!r.length)return "";
  return "<div class='warn' style='margin-top:10px'>⚠ 수정 감지 "+r.length+"건 — 지난 자료가 바뀌어 다시 계산한 값이 처음 기록과 다릅니다. 기록은 고치지 않고 그대로 둡니다.<br>"+
    r.slice(-5).map(function(x){return esc(x.id)+" · "+esc(x.field)+": "+esc(JSON.stringify(x.stored))+" → "+esc(JSON.stringify(x.recomputed))}).join("<br>")+"</div>";
}
function view(J){
  if(!J)return "<div class='loading'>불러오는 중…</div>";
  if(J.ok===false)return "<div class='warn'>텐배거 전향 시험 자료를 못 불러왔습니다: "+esc(J.error||"")+"</div>";
  var b=(J.books||{}).usd100k||{},src=J.source||{},m=J.model||{};
  var al=J.alert,STG={buy:"🟢 매수",sell:"🔴 매도",both:"🟢🔴 매수·매도"};
  var html="<div class='card'><h3>🔟 텐배거 전향 시험 — 30년에서 찾은 패턴을 앞으로 그대로 사 본다</h3><div class='sub'>"+statusLine(J)+"</div>"+
    (al&&al.body?"<div class='rule' style='border-color:var(--vio)'>🔔 "+esc(md(J.asOf))+" 자료 알림 · <b>"+esc(STG[al.stage]||"")+"</b> — "+esc(al.body)+"</div>":"")+ruleCard(J)+"</div>";
  if(J.status==="running"){
    html+="<div class='card'><h3>📊 지금까지</h3>"+kpis(J)+"<div style='margin-top:10px'>"+chart(J)+"</div>"+
      "<p class='note'>장 마감 공식 종가로 다시 만든 모의 장부입니다(실주문 없음). 무작위 20종목 = 같은 날 같은 후보에서 순서만 무작위로 골라 같은 규칙으로 산 "+((J.random||{}).seeds||30)+"가지 — 모형 순위가 운보다 나은지 봅니다.</p></div>"+
      "<div class='card'><h3>💼 보유 (10만$ 장부)</h3>"+holdTable(b)+"</div>"+
      "<div class='card'><h3>✅ 매도한 종목</h3>"+closedTable(b)+"</div>";
  }
  html+="<div class='card'><h3>🔎 지금 순위 상위 20 <span class='sub'>("+esc(md((J.universe||{}).asOf||J.asOf))+" 종가 · 후보 "+((J.universe||{}).n||"—")+"종목)</span></h3>"+candTable(J)+"</div>";
  html+="<div class='card'><h3>🧾 기록 (등록 뒤 사건 · 고치지 않음)</h3>"+eventLog(J)+revisions(J)+"</div>";
  html+="<div class='card'><h3>ℹ️ 원칙 · 자료</h3><p class='note'>"+(J.notes||[]).map(esc).join("<br>")+"</p>"+
    "<p class='note'>자료: "+esc(src.provider||"KRX")+" · 원천 커밋 "+esc(String(src.upstreamCommit||"").slice(0,10))+" · 자료 "+esc(src.asOf||J.asOf||"")+
    (num(src.staleDays)&&src.staleDays>5?" · <span class='loss'>"+src.staleDays+"일 전 자료</span>":"")+" · 모형 "+esc(m.version||"")+" ("+esc(String(m.sha256||"").slice(0,12))+") · 학습 "+esc(m.trainedThrough||"")+
    " · 기록 v"+esc(J.strategyVersion||"")+" · <a href='/tenbagger'>30년 분석 자세히 →</a></p></div>";
  return html;
}
var api={VERSION:VERSION,API:API,esc:esc,pct:pct,kst:kst,view:view,chart:chart,holdTable:holdTable,closedTable:closedTable,candTable:candTable,eventLog:eventLog,statusLine:statusLine,REASON:REASON};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.ClaudeTenbagger=api;
})(typeof window!=="undefined"?window:this);
