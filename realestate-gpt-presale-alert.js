(function(){
"use strict";
const host=document.getElementById("gptPresale");
if(!host)return;
const key=new URLSearchParams(location.search).get("notice");
if(!key)return;
let notice=null,err=null;

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function won(n){
  if(!Number.isFinite(n))return "미확인";
  const e=n/1e8;
  return e>=1?(e.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")+"억"):(Math.round(n/1e4).toLocaleString("ko-KR")+"만원");
}
const pct=n=>Number.isFinite(n)?(n>=0?"+":"")+(n*100).toFixed(1)+"%":"미확인";
function priceCompare(e){
  const m=e.market||{},p=e.model||{};
  if(!m.ok)return '<p>같은 법정동·비슷한 면적의 검증 가능한 실거래 표본이 부족합니다.</p>';
  return '<div class="pn-grid">'+
    metric("대표 분양가",won(p.price),"선택한 전용 "+esc(p.area)+"㎡ 주택형의 최고가 중위")+
    metric("주변 실거래 중앙값",won(m.median),esc(m.umd||"")+" · "+m.count+"건 / "+m.complexes+"개 단지")+
    metric("분양가 대비 가격차",pct(e.margin),e.margin>=0?"주변 중위가격보다 분양가가 낮음":"주변 중위가격보다 분양가가 높음")+
    metric("현재 전세 참고",e.rent&&e.rent.ok?won(e.rent.median):"표본 부족","현재 전세를 미래 입주 시 전세가로 보지 마세요")+
    '</div>';
}
function metric(name,value,sub){
  return '<div class="pn-metric"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small></div>';
}
function modelInfo(m){
  if(!m)return "";
  const a=(m.allModels||[]).filter(x=>Math.abs(x.area-m.area)<=5);
  return '<div class="pn-section"><b>면적·타입별 공식 최고분양가</b><div class="pn-list">'+
    a.map(x=>'<div>'+esc(x.type)+' · 전용 '+x.area.toFixed(1)+'㎡ <strong>'+won(x.price)+'</strong></div>').join("")+
    '</div><small>발코니 확장비·유상옵션·취득세·중도금 이자는 포함하지 않은 분양가입니다.</small></div>';
}
function comparativeExamples(m){
  if(!m||!m.ok)return "";
  return '<div class="pn-section"><b>실제 비교한 아파트 사례</b><div class="pn-list">'+
    (m.examples||[]).map(x=>'<div>'+esc(x.apt)+' · '+esc(x.date)+' · '+x.area.toFixed(1)+'㎡ <strong>'+won(x.price)+'</strong></div>').join("")+
    '</div><small>국토부 계약일 기준 최근 약 4개월, 같은 법정동·전용 ±5㎡·최근 16년 내 준공 단지를 기준으로 비교했습니다. 층·향·브랜드·역거리 차이는 별도 보정하지 않았습니다.</small></div>';
}
function scoreDetails(e){
  if(e.status!=="scored")return '<div class="pn-section pn-caution"><b>평가 보류</b><p>'+esc(e.reason||"비교 데이터 부족")+'</p>조건이 충족되기 전에는 투자점수를 산출하지 않습니다.</div>';
  return '<div class="pn-section"><b>점수 구성 · 자료충족률 '+esc(e.coverage)+'%</b>'+
    '<div class="pn-list">'+(e.components||[]).map(c=>
      '<div>'+esc(c.name)+' <strong>'+c.points+'/'+c.weight+'점</strong><small>'+esc(c.description)+'</small></div>'
    ).join("")+'</div><small>관측된 항목만 정규화해 100점으로 환산했습니다. 자료가 부족하면 전세가율은 제외하며 점수와 함께 자료충족률을 표시합니다. 투자수익률이나 상승확률은 아닙니다.</small></div>';
}
function draw(){
  let box=host.querySelector("#presaleNoticeDetail");
  if(box)return;
  box=document.createElement("section");box.id="presaleNoticeDetail";box.className="gpt-panel pn-detail";
  if(err)box.innerHTML='<h4>신규분양 알림 상세</h4><p>'+esc(err)+'</p>';
  else if(!notice)box.innerHTML='<h4>신규분양 알림 평가</h4><p>알림 상세정보를 불러오는 중…</p>';
  else{
    const p=notice.item,e=p.evaluation||{},scored=e.status==="scored";
    const title=scored?esc(e.grade)+" "+e.score+"점 / 100":"평가 보류";
    const news=Number.isFinite(e.coverage)?e.coverage:0;
    box.innerHTML=
      '<div class="pn-top"><div><h4>🔔 신규분양 평가</h4><strong>'+esc(p.name)+'</strong><small>'+esc(p.region||"")+' · '+esc(p.categoryName||"")+' · 공고 '+esc(p.announce||"-")+'</small></div>'+
      '<div class="pn-score">'+title+(scored?'<small>자료충족률 '+news+'%</small>':'')+'</div></div>'+
      priceCompare(e)+scoreDetails(e)+modelInfo(e.model)+comparativeExamples(e.market)+
      '<div class="pn-section"><b>공급·청약 일정</b><p>공급 규모 '+esc(p.units??"미확인")+'세대 · 접수 '+esc(p.start||"-")+' ~ '+esc(p.end||"-")+' · 입주 '+esc(p.moveIn||"미확인")+'</p></div>'+
      '<div class="pn-section pn-caution"><b>계약 전 확인할 위험·비용</b>'+
        '<div class="pn-list">'+(e.warnings||[]).map(w=>'<div>'+esc(w)+'</div>').join("")+
        '<div>청약자격·전매제한·거주의무·향후 입주물량·대출규제는 모집공고로 별도 확인해야 합니다.</div></div></div>'+
      '<div class="pn-links"><a href="https://www.applyhome.co.kr/" target="_blank" rel="noopener">청약홈 공식 공고 확인</a> <a href="/settings">웹알림 설정</a></div>'+
      '<small>평가 시각 '+esc(notice.alertCreatedAt||"-")+' · '+esc(e.version||"")+' · 가격비교는 인근 거래의 통계적 참고값입니다.</small>';
  }
  host.prepend(box);
}
async function load(){
  try{
    const r=await fetch("/data/realestate/gpt/push-config.json",{cache:"no-store"});
    if(!r.ok)throw new Error("설정 조회 실패");
    const cfg=await r.json();
    if(!cfg.workerUrl)throw new Error("푸시 서버 연결 설정 중");
    const url=cfg.workerUrl+"/presale-item?key="+encodeURIComponent(key);
    const rr=await fetch(url,{cache:"no-store"});
    const j=await rr.json();
    if(!rr.ok||!j.ok)throw new Error(j.error||"조회 실패");
    notice=j;
  }catch(e){err="알림 상세를 확인할 수 없습니다: "+String(e.message||e)}
  const old=host.querySelector("#presaleNoticeDetail");if(old)old.remove();
  draw();
}
const css=document.createElement("style");
css.textContent='.pn-detail{border:1px solid rgba(245,196,81,.45)!important;text-align:left!important}.pn-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.pn-top h4{margin:0 0 4px!important}.pn-top strong{display:block;font-size:14px}.pn-top small{display:block;font-size:10px;color:var(--dim)}.pn-score{font-weight:900;color:var(--gold);font-size:17px;text-align:right}.pn-score small{font-weight:500;font-size:10px}.pn-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}.pn-metric{background:var(--surf2);padding:10px;border:1px solid var(--border);border-radius:9px;min-width:0}.pn-metric span,.pn-metric small{display:block;color:var(--dim);font-size:10px}.pn-metric strong{display:block;color:var(--text);font-size:16px;margin:3px 0}.pn-section{padding:10px 0;border-top:1px solid var(--border);font-size:11px;color:var(--dim);overflow-wrap:anywhere}.pn-section>b{font-size:12px;color:var(--text)}.pn-section p{margin:5px 0}.pn-section>small{font-size:10px;color:var(--faint)}.pn-list{margin:6px 0}.pn-list>div{padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}.pn-list strong{float:right;color:var(--text)}.pn-list small{display:block;color:var(--faint)}.pn-caution{color:var(--gold)}.pn-links{display:flex;gap:12px;flex-wrap:wrap;margin:9px 0;font-size:11px}.pn-links a{color:var(--accent)}@media(max-width:600px){.pn-top{display:block}.pn-score{text-align:left;margin-top:8px}.pn-metric strong{font-size:14px}}';
document.head.appendChild(css);
draw();
const obs=new MutationObserver(()=>{if(!host.querySelector("#presaleNoticeDetail"))draw()});
obs.observe(host,{childList:true});
load();
})();