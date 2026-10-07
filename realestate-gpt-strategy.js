(function(){
"use strict";
const root=document.getElementById("gpt-re-root");
if(!root)return;
const nav=root.querySelector("#gptReNav"),views=root.querySelector("#gptReViews");
if(!nav||!views||nav.querySelector('[data-v="strategy"]'))return;

const b=document.createElement("button");
b.dataset.v="strategy";b.textContent="🎯 전략 거래내역";nav.insertBefore(b,nav.firstChild);
const v=document.createElement("div");
v.className="gpt-view";v.dataset.v="strategy";
v.innerHTML='<div id="gptStrategy"><div class="gpt-panel"><div class="note">실거래 전략을 준비하는 중…</div></div></div>';
views.insertBefore(v,views.firstChild);
const mount=v.querySelector("#gptStrategy");

const st=document.createElement("style");
st.textContent='.st-hero{border:1px solid rgba(245,196,81,.35);background:rgba(245,196,81,.06);border-radius:11px;padding:13px;margin-bottom:10px}.st-hero h3{font-size:16px;margin:0 0 5px}.st-hero .d{font-size:11px;color:var(--dim);line-height:1.6}.st-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:end}.st-tools label{font-size:9px;color:var(--faint);display:grid;gap:2px}.st-tools select,.st-tools input,.st-tools button{border:1px solid var(--border);background:var(--surf2);color:var(--text);border-radius:7px;padding:7px 8px;font-size:10px}.st-tools button{font-weight:900;cursor:pointer}.st-tools button.primary{background:#353765;border-color:var(--accent)}.st-progress{height:6px;background:var(--border);border-radius:999px;overflow:hidden;margin:9px 0}.st-progress>i{display:block;height:100%;background:var(--accent);width:0}.st-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:10px 0}.st-kpi{border:1px solid var(--border);border-radius:8px;padding:9px;background:var(--surf2)}.st-kpi .k{font-size:9px;color:var(--faint)}.st-kpi .v{font-size:17px;font-weight:900;margin-top:2px}.st-kpi .s{font-size:9px;color:var(--dim)}.st-trade{border:1px solid var(--border);background:var(--surf2);border-radius:10px;padding:12px;margin-bottom:8px}.st-trade-top{display:flex;justify-content:space-between;gap:8px}.st-side{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.st-box{border:1px solid var(--border);border-radius:8px;padding:9px;background:rgba(15,19,32,.25)}.st-box h5{font-size:10px;color:var(--faint);margin:0 0 5px}.st-line{font-size:11px;color:var(--dim);line-height:1.62}.st-line b{color:var(--text)}.st-event{display:block;margin-top:5px;padding-top:5px;border-top:1px solid var(--border);font-size:10px}.st-event a{color:var(--accent);text-decoration:none}.st-empty{padding:14px;border:1px dashed var(--border2);border-radius:9px;color:var(--dim);font-size:11px;line-height:1.7}.st-assume{font-size:9px;color:var(--faint);margin-top:7px;line-height:1.55}@media(max-width:760px){.st-summary{grid-template-columns:1fr 1fr}.st-side{grid-template-columns:1fr}.st-trade-top{display:block}.st-tools{display:grid;grid-template-columns:1fr 1fr}.st-tools button{grid-column:span 2}}';
root.appendChild(st);

let CFG=null,EVENTS=[],STATUS=null,LAST=null,running=false;
let PARAM={start:2016,hold:12,buyCost:1.5,sellCost:1.0};
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function won(v){if(!Number.isFinite(v))return "-";const e=v/1e8;return e>=1?(Math.round(e*100)/100).toFixed(e<10?2:1).replace(/0+$/,"").replace(/\.$/,"")+"억":Math.round(v/1e4).toLocaleString("ko-KR")+"만"}
function pct(v){return Number.isFinite(v)?((v>=0?"+":"")+(v*100).toFixed(1)+"%"):"-"}
function eventHtml(es){
  if(!es||!es.length)return '<span class="st-event">연결된 공식 이벤트 없음</span>';
  return '<span class="st-event">'+es.map(e=>'<a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.date+" · "+e.title)+'</a>').join("<br>")+'</span>';
}
function waitMarket(){
  return new Promise((resolve,reject)=>{
    let n=0;const t=setInterval(()=>{if(window.__REGPT_DATA__){clearInterval(t);resolve(window.__REGPT_DATA__)}else if(++n>80){clearInterval(t);reject(new Error("시장지수 로딩 지연"))}},250);
  });
}
function tradeCard(t,i){
  return '<div class="st-trade"><div class="st-trade-top"><div><b>#'+(i+1)+' '+esc(t.apartment)+'</b><div class="note">'+esc(t.region)+" "+esc(t.umd||"")+' · 전용 '+esc(t.area)+'㎡ · '+esc(t.holdMonths)+'개월 보유</div></div><div><b class="'+(t.netReturn>=0?'up':'dn')+'">'+pct(t.netReturn)+'</b><div class="note">가격 '+pct(t.grossReturn)+'</div></div></div>'+
  '<div class="st-side">'+
   '<div class="st-box"><h5>매수 — 왜/언제/얼마</h5><div class="st-line"><b>신호</b> '+esc(t.buySignalDate)+'<br><b>실제 체결 프록시</b> '+esc(t.buyDate)+' · '+won(t.buyPrice)+(t.buyFloor!=null?' · '+esc(t.buyFloor)+'층':'')+'<br><b>매수 이유</b><br>'+esc(t.buyReason)+eventHtml(t.buyEvents)+'</div></div>'+
   '<div class="st-box"><h5>매도 — 왜/언제/얼마</h5><div class="st-line"><b>신호</b> '+esc(t.sellSignalDate)+'<br><b>실제 체결 프록시</b> '+esc(t.sellDate)+' · '+won(t.sellPrice)+(t.sellFloor!=null?' · '+esc(t.sellFloor)+'층':'')+'<br><b>매도 이유</b><br>'+esc(t.sellReason)+eventHtml(t.sellEvents)+'</div></div>'+
  '</div><div class="st-assume">비용가정 후 '+pct(t.netReturn)+' · 매수비용 '+pct(t.buyCost)+' · 매도비용 '+pct(t.sellCost)+' · 양도세/대출이자는 개인조건 때문에 별도</div></div>';
}
function openCard(t){
  if(!t)return "";
  return '<div class="gpt-panel"><h4>현재 보유로 끝난 포지션</h4><div class="st-trade"><b>'+esc(t.apartment)+'</b><div class="st-line">전용 '+esc(t.area)+'㎡ · '+esc(t.buyDate)+' '+won(t.buyPrice)+' 매수 → '+esc(t.markDate)+' 최근 실제 거래 '+won(t.markPrice)+'<br><b>평가 가격수익률</b> '+pct(t.grossReturn)+' · 지금 매도비용까지 가정 '+pct(t.netIfSold)+'<br><b>매수 이유</b> '+esc(t.buyReason)+eventHtml(t.buyEvents)+'</div></div></div>';
}
function summaryHtml(r){
  return '<div class="st-summary"><div class="st-kpi"><div class="k">완료 거래</div><div class="v">'+r.tradeCount+'건</div><div class="s">한 번에 한 채</div></div>'+
  '<div class="st-kpi"><div class="k">누적 복리</div><div class="v '+(r.cumulativeReturn>=0?'up':'dn')+'">'+pct(r.cumulativeReturn)+'</div><div class="s">비용가정 후</div></div>'+
  '<div class="st-kpi"><div class="k">CAGR</div><div class="v '+(r.cagr>=0?'up':'dn')+'">'+pct(r.cagr)+'</div><div class="s">첫 매수~마지막 매도</div></div>'+
  '<div class="st-kpi"><div class="k">승률</div><div class="v">'+pct(r.winRate)+'</div><div class="s">평균 '+pct(r.avgReturn)+'</div></div></div>';
}
function controls(){
  const cy=new Date().getFullYear();
  return '<div class="gpt-panel"><h4>실제 아파트 실거래 백테스트</h4><div class="st-tools">'+
  '<label>시작연도<select id="stStart"><option value="2016" '+(PARAM.start===2016?'selected':'')+'>2016 (빠른검증)</option><option value="2010" '+(PARAM.start===2010?'selected':'')+'>2010</option><option value="2006" '+(PARAM.start===2006?'selected':'')+'>2006 전체</option></select></label>'+
  '<label>최소보유<input id="stHold" type="number" min="6" max="60" step="6" value="'+PARAM.hold+'">개월</label>'+
  '<label>매수비용 가정<input id="stBuyCost" type="number" min="0" max="10" step=".1" value="'+PARAM.buyCost+'">%</label>'+
  '<label>매도비용 가정<input id="stSellCost" type="number" min="0" max="10" step=".1" value="'+PARAM.sellCost+'">%</label>'+
  '<button class="primary" id="stRun">▶ '+cy+'년까지 실거래 백테스트 실행</button></div>'+
  '<div class="st-progress"><i id="stBar"></i></div><div class="note" id="stMsg">'+
  (STATUS&&STATUS.configured?'공식 실거래 API 연결됨 · 실행 전':'공공데이터포털 인증키가 없어 실행할 수 없습니다.')+'</div>'+
  '<div class="st-assume">체결은 신호가 나온 월이 끝난 뒤 <b>동일 단지·동일 면적군의 첫 실제 신고거래</b>를 사용합니다. 같은 호수의 재매매를 추적하는 것은 아니므로 층 차이는 남겨서 보여줍니다. 매수 후보 선정에는 그 시점까지의 거래만 사용합니다.</div></div>';
}
function render(){
  const result=LAST&&LAST.result;
  mount.innerHTML='<div class="st-hero"><h3>최종 목적: 실제로 무엇을 왜 사고팔았나</h3><div class="d"><b>단지 → 매수신호 → 실제 매수가 → 당시 이벤트 → 매도신호 → 실제 매도가 → 수익률</b> 순서로 봅니다. 아래 거래가 최종 전략 결과이고, 다른 GPT 메뉴는 이 거래규칙을 만드는 연구자료입니다.</div></div>'+
  controls()+
  (result?summaryHtml(result):'')+
  '<div class="gpt-panel"><h4>전략 거래내역</h4>'+
    (result&&result.closed&&result.closed.length?result.closed.map(tradeCard).join(""):'<div class="st-empty"><b>아직 실행된 실거래 백테스트 결과가 없습니다.</b><br>위 버튼을 누르면 국토부 실거래를 연도별로 읽고, 대전·세종 시장신호가 발생한 시점에 실제 단지를 선택해 매수→매도 거래를 만듭니다.</div>')+
  '</div>'+
  (result?openCard(result.open):'')+
  (result&&result.collectionWarnings&&result.collectionWarnings.length?'<div class="gpt-warn"><b>부분 수집 경고 '+result.collectionWarnings.length+'건</b><br>일부 월/구 데이터는 타임아웃 또는 일시 오류로 누락됐습니다. 나머지 데이터로 계산한 결과이므로 전체 검증 전에는 최종 전략으로 확정하지 않습니다.</div>':'')+
  '<div class="gpt-warn"><b>현재 전략 v1</b><br>시장 진입조건은 과거 도시지수 실험에서 쓰던 3개월·12개월 상승 + 36개월 고점 대비 -20~0%를 그대로 사용합니다. 그 시점에 거래가 충분한 실제 아파트 중 최근 거래량·6/12개월 흐름·고점대비 위치로 한 채를 선택합니다. 최소보유 뒤 시장 3M·12M이 모두 음수이거나 해당 단지 6M 흐름이 -8% 아래면 매도신호를 냅니다. <b>이 규칙 자체를 앞으로 워크포워드 검증하며 개선</b>합니다.</div>';
  bind();
}
function bind(){
  const btn=mount.querySelector("#stRun");if(!btn)return;
  btn.disabled=running||!(STATUS&&STATUS.configured);
  btn.addEventListener("click",runNow);
}
async function runNow(){
  if(running)return;
  PARAM.start=Number(mount.querySelector("#stStart")&&mount.querySelector("#stStart").value)||2016;
  PARAM.hold=Number(mount.querySelector("#stHold")&&mount.querySelector("#stHold").value)||12;
  PARAM.buyCost=Number(mount.querySelector("#stBuyCost")&&mount.querySelector("#stBuyCost").value)||0;
  PARAM.sellCost=Number(mount.querySelector("#stSellCost")&&mount.querySelector("#stSellCost").value)||0;
  const start=PARAM.start,hold=PARAM.hold,bc=PARAM.buyCost/100,sc=PARAM.sellCost/100;
  const end=new Date().getFullYear();
  running=true;render();
  const bar=mount.querySelector("#stBar"),msg=mount.querySelector("#stMsg");
  try{
    if(msg)msg.textContent="시장지수와 실거래를 준비하는 중…";
    const market=await waitMarket();
    const trades=await RESTRAT.loadHistory(start,end,p=>{
      const q=Math.round(p.done/p.total*100);if(bar)bar.style.width=q+"%";
      if(msg)msg.textContent=p.year+"년 "+(p.region||p.lawd)+" 수집 "+p.done+"/"+p.total+" · "+p.count.toLocaleString()+"건"+(p.warnings?" · 누락/재시도 "+p.warnings+"건":"");
    });
    if(msg)msg.textContent="실거래 "+trades.length.toLocaleString()+"건으로 미래값 없는 거래전략 계산 중…";
    const result=RESTRAT.run(trades,market,EVENTS,{startYear:start,endYear:end,minHold:hold,buyCost:bc,sellCost:sc});
    result.collectionWarnings=Array.isArray(trades.collectionWarnings)?trades.collectionWarnings:[];
    LAST={ranAt:new Date().toISOString(),start,end,result};
  }catch(e){
    alert("실거래 백테스트 실패: "+String(e&&e.message||e));
  }finally{running=false;render()}
}
async function boot(){
  try{
    const [c,e,s]=await Promise.all([
      fetch("/data/realestate/gpt/strategy.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.json()),
      fetch("/data/realestate/gpt/events.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.json()),
      RESTRAT.status()
    ]);
    CFG=c;EVENTS=e.events||[];STATUS=s;
  }catch(e){STATUS={configured:false,note:String(e&&e.message||e)}}
  render();
}
function activate(){
  root.querySelectorAll(".gpt-nav button").forEach(x=>x.classList.toggle("on",x===b));
  root.querySelectorAll(".gpt-view").forEach(x=>x.classList.toggle("on",x.dataset.v==="strategy"));
}
boot();activate();
})();