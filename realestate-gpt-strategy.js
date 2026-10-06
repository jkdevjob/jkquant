(function(){
"use strict";
const root=document.getElementById("gpt-re-root");
if(!root)return;
const nav=root.querySelector("#gptReNav"),views=root.querySelector("#gptReViews");
if(!nav||!views||nav.querySelector('[data-v="strategy"]'))return;

const b=document.createElement("button");
b.dataset.v="strategy";
b.textContent="🎯 전략 거래내역";
nav.insertBefore(b,nav.firstChild);

const v=document.createElement("div");
v.className="gpt-view";
v.dataset.v="strategy";
v.innerHTML='<div id="gptStrategy"><div class="gpt-panel"><div class="note">실거래 전략을 불러오는 중…</div></div></div>';
views.insertBefore(v,views.firstChild);

const mount=v.querySelector("#gptStrategy");
const st=document.createElement("style");
st.textContent='.st-hero{border:1px solid rgba(245,196,81,.35);background:rgba(245,196,81,.06);border-radius:11px;padding:13px;margin-bottom:10px}.st-hero h3{font-size:16px;margin:0 0 5px}.st-hero .d{font-size:11px;color:var(--dim);line-height:1.6}.st-flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:10px 0}.st-step{border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--surf2);font-size:10px;color:var(--dim)}.st-step b{display:block;color:var(--text);font-size:11px;margin-bottom:2px}.st-trade{border:1px solid var(--border);background:var(--surf2);border-radius:10px;padding:12px;margin-bottom:8px}.st-side{display:grid;grid-template-columns:1fr 1fr;gap:8px}.st-box{border:1px solid var(--border);border-radius:8px;padding:9px;background:rgba(15,19,32,.25)}.st-box h5{font-size:10px;color:var(--faint);margin:0 0 5px}.st-line{font-size:11px;color:var(--dim);line-height:1.55}.st-line b{color:var(--text)}.st-empty{padding:14px;border:1px dashed var(--border2);border-radius:9px;color:var(--dim);font-size:11px;line-height:1.7}.st-rule{margin:4px 0;font-size:10px;color:var(--dim)}.st-rule:before{content:"• ";color:var(--accent)}@media(max-width:760px){.st-flow{grid-template-columns:1fr}.st-side{grid-template-columns:1fr}}';
root.appendChild(st);

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function won(v){if(!Number.isFinite(v))return "-";const e=v/1e8;return e>=1?(Math.round(e*100)/100).toFixed(e<10?2:1).replace(/0+$/,"").replace(/\.$/,"")+"억":Math.round(v/1e4).toLocaleString()+"만"}
function pct(v){return Number.isFinite(v)?((v>=0?"+":"")+(v*100).toFixed(1)+"%"):"-"}
function rules(xs){return (xs||[]).map(x=>'<div class="st-rule">'+esc(x)+'</div>').join("")}

function tradeCard(t){
  const ret=Number.isFinite(t.buyPrice)&&Number.isFinite(t.sellPrice)?t.sellPrice/t.buyPrice-1:null;
  return '<div class="st-trade"><div style="display:flex;justify-content:space-between;gap:8px"><div><b>'+esc(t.apartment)+'</b><div class="note">'+esc(t.region)+' · 전용 '+esc(t.area)+'㎡</div></div><div class="'+(ret>=0?'up':'dn')+'" style="font-weight:900">'+pct(ret)+'</div></div>'+
  '<div class="st-side" style="margin-top:9px"><div class="st-box"><h5>매수</h5><div class="st-line"><b>'+esc(t.buyDate)+'</b> · '+won(t.buyPrice)+'<br><b>왜 샀나</b> '+esc(t.buyReason||"-")+'<br><b>그때 이벤트</b> '+esc(t.buyEvent||"-")+'</div></div>'+
  '<div class="st-box"><h5>매도</h5><div class="st-line"><b>'+esc(t.sellDate||"보유중")+'</b> · '+won(t.sellPrice)+'<br><b>왜 팔았나</b> '+esc(t.sellReason||"-")+'<br><b>그때 이벤트</b> '+esc(t.sellEvent||"-")+'</div></div></div></div>';
}

async function load(){
  try{
    const r=await fetch("/data/realestate/gpt/strategy.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const d=await r.json();
    const trades=d.trades||[];
    mount.innerHTML=
    '<div class="st-hero"><h3>이 화면이 최종 목적</h3><div class="d"><b>어느 아파트를 · 언제 · 얼마에 · 왜 샀고 → 언제 · 얼마에 · 왜 팔았는지</b>를 실제 실거래와 당시 공개된 뉴스/이벤트로 재현합니다. 지수점수 자체가 전략 결과가 아니라 이 거래내역을 만들기 위한 입력자료입니다.</div></div>'+
    '<div class="st-flow"><div class="st-step"><b>1. 당시 정보</b>가격·전세·거래량·공급·금리·뉴스</div><div class="st-step"><b>2. 매수 신호</b>단지·면적·이유 고정</div><div class="st-step"><b>3. 실제 체결</b>신호 뒤 첫 실거래가격</div><div class="st-step"><b>4. 보유 추적</b>뉴스·정책·입주물량 변화</div><div class="st-step"><b>5. 매도</b>실거래 청산·비용차감 성과</div></div>'+
    '<div class="gpt-panel"><h4>전략 거래내역</h4>'+
      (trades.length?trades.map(tradeCard).join(""):'<div class="st-empty"><b>아직 “아파트 실거래 기반” 완료 거래는 0건입니다.</b><br>기존 백테스트는 대전·세종 도시 가격지수 타이밍 연구였기 때문에 여기에 가짜 아파트 거래로 옮기지 않았습니다. 앞으로 이 칸에는 <b>단지명 / 전용면적 / 매수일 / 실제 매수가 / 매수 당시 뉴스·이벤트 / 매도일 / 실제 매도가 / 매도 당시 뉴스·이벤트 / 비용차감 수익률</b>이 한 건씩 쌓입니다.</div>')+
    '</div>'+
    '<div class="gpt-two"><div class="gpt-panel"><h4>매수 규칙이 남겨야 하는 것</h4>'+rules(d.strategyDefinition&&d.strategyDefinition.entry)+'</div><div class="gpt-panel"><h4>매도 규칙이 남겨야 하는 것</h4>'+rules(d.strategyDefinition&&d.strategyDefinition.exit)+'</div></div>'+
    '<div class="gpt-panel"><h4>데이터 범위</h4><div class="st-line"><b>2006년 이후</b> '+esc(d.dataCoverage.exactApartmentTrades)+'<br><b>2006년 이전</b> '+esc(d.dataCoverage.pre2006)+'<br><b>뉴스/이벤트</b> '+esc(d.dataCoverage.eventEvidence)+'<br><b>체결원칙</b> '+esc(d.dataCoverage.execution)+'</div></div>'+
    '<div class="gpt-warn"><b>기존 화면을 읽는 법</b><br><b>과거 시장</b> = 언제 시장이 상승·하락했는지 연구 · <b>상승 원인 연구</b> = 무엇이 상승 전에 움직였는지 연구 · <b>지역 조사순위</b> = 어느 지역을 먼저 조사할지 · <b>신규분양</b> = 지금 청약 후보 가격분석 · <b>도시지수 실험</b> = 시장 타이밍 연구. <u>최종 전략 성과는 이 전략 거래내역만 기준</u>으로 봅니다.</div>';
  }catch(e){
    mount.innerHTML='<div class="gpt-warn">전략 정의를 불러오지 못했습니다: '+esc(e&&e.message||e)+'</div>';
  }
}
function activate(){
  root.querySelectorAll(".gpt-nav button").forEach(x=>x.classList.toggle("on",x===b));
  root.querySelectorAll(".gpt-view").forEach(x=>x.classList.toggle("on",x.dataset.v==="strategy"));
}
load();
activate();
})();