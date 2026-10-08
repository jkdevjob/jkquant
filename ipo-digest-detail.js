(function(){
"use strict";
const params=new URLSearchParams(location.search);
const brief=params.get("brief");
if(!brief||!/^\d{4}-\d{2}-\d{2}$/.test(brief))return;
const root=document.getElementById("ipoWrap");
if(!root)return;
const esc=v=>String(v??"").replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
const won=n=>Number.isFinite(n)?Math.round(n).toLocaleString("ko-KR")+"원":"미확인";
const pct=n=>Number.isFinite(n)?(n>=0?"+":"")+n.toFixed(1)+"%":"미확인";
const box=document.createElement("section");
box.id="ipoDailyDigest";
box.className="ipo-daily";
root.insertBefore(box,root.querySelector(".subnav")||root.firstChild);
const style=document.createElement("style");
style.textContent='.ipo-daily{border:1px solid #55589c;border-radius:12px;background:#1d2440;padding:13px;margin:10px 0 14px;min-width:0}.ipo-daily h3{margin:0 0 5px;font-size:15px}.ipo-daily p{font-size:11px;color:var(--dim,#9aa6c9);line-height:1.6}.ipo-daily .id-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0}.ipo-daily .id-kpis div{background:#121a30;border:1px solid #303a59;border-radius:9px;padding:9px;font-size:11px;color:#adb8dc}.ipo-daily .id-kpis strong{display:block;font-size:16px;color:#f0f2fc}.ipo-daily .id-card{border-top:1px solid #323f63;padding:11px 0;font-size:12px}.ipo-daily .id-head{display:flex;gap:10px;justify-content:space-between;align-items:flex-start}.ipo-daily .id-name{font-size:13px;font-weight:800}.ipo-daily .id-score{font-size:12px;font-weight:900;color:#ecc37f;white-space:nowrap}.ipo-daily .id-meta{font-size:11px;color:#b6c0da;margin:5px 0;line-height:1.7}.ipo-daily .id-scores{display:grid;grid-template-columns:1fr;gap:4px}.ipo-daily .id-score-row{background:#202948;border-radius:7px;padding:6px 8px;font-size:10px;color:#aebce0;display:flex;justify-content:space-between;gap:8px}.ipo-daily .id-score-row b{color:#eff1fc;white-space:nowrap}.ipo-daily .id-unknown{color:#b5a47f;font-size:10px;margin-top:6px}.ipo-daily a{color:#9da7ff;font-size:11px}.ipo-daily .id-error{color:#ffb6aa}@media(max-width:430px){.ipo-daily{padding:10px}.ipo-daily .id-head{display:block}.ipo-daily .id-score{margin-top:4px}.ipo-daily .id-kpis strong{font-size:14px}}';
document.head.appendChild(style);
box.innerHTML='<h3>📈 '+esc(brief)+' 공모주·청약 브리핑</h3><p>점수와 공모가·청약일정을 불러오는 중…</p>';
async function load(){
  try{
    const cf=await fetch("/data/realestate/gpt/push-config.json",{cache:"no-store"});
    if(!cf.ok)throw new Error("푸시 서버 설정을 가져올 수 없습니다.");
    const cfg=await cf.json();
    if(!cfg.workerUrl)throw new Error("푸시 서버 미설정");
    const res=await fetch(cfg.workerUrl+"/ipo-daily?date="+brief,{cache:"no-store"});
    const j=await res.json();
    if(!res.ok||!j.ok)throw new Error(j.error||"푸시 서버 오류");
    const d=j.digest;
    if(!d)throw new Error("해당 날짜의 브리핑을 찾을 수 없습니다. 다음 브리핑부터 기록됩니다.");
    const cards=(d.items||[]).map(it=>{
      const e=it.evaluation||{},scored=e.status==="scored";
      return '<article class="id-card"><div class="id-head"><div class="id-name">'+esc(it.name)+' · '+esc(it.phase)+'</div>'+
        '<div class="id-score">'+(scored?esc(e.grade)+" "+e.score+"점":"평가 보류")+'</div></div>'+
        '<div class="id-meta">확정 공모가 '+won(it.poPrice)+' · 희망밴드 '+won(it.bandLo)+' ~ '+won(it.bandHi)+
        '<div>기관 수요예측 '+(it.instRate?it.instRate.toLocaleString("ko-KR")+" 대 1":"미확인")+
        ' · 일반청약 '+(it.subRate?it.subRate.toLocaleString("ko-KR")+" 대 1":"미확인")+'</div>'+
        '<div>청약 '+esc(it.subStart||"-")+' ~ '+esc(it.subEnd||"-")+' · 상장 '+esc(it.listDate||"-")+
        ' · 주관사 '+esc(it.leadManager||"미확인")+'</div></div>'+
        (scored?'<div class="id-scores">'+(e.components||[]).map(v=>
          '<div class="id-score-row"><span>'+esc(v.name)+' · '+esc(v.detail)+'</span><b>'+v.points+'/'+v.weight+'점</b></div>'
        ).join("")+'</div><div class="id-unknown">자료충족률 '+e.coverage+
          '% · 점수는 확인 가능한 항목을 100점으로 환산한 조사 우선순위입니다.</div>':
          '<div class="id-unknown">평가 보류: '+esc(e.reason||"평가자료 부족")+'</div>')+
        '<div class="id-unknown">확약률 · 유통가능주식 · 상장 시가총액은 미확인(점수 미포함). 상장 수익률 예측이 아닙니다.</div>'+
        (it.url&&/^https?:\/\//.test(it.url)?'<a href="'+esc(it.url)+'" target="_blank" rel="noopener noreferrer">공모주 상세정보 ↗</a>':'')+'</article>';
    }).join("");
    box.innerHTML='<h3>📈 '+esc(d.date)+' 공모주·청약 브리핑</h3>'+
      '<div class="id-kpis"><div>청약 중<strong>'+d.subs+'종목</strong></div><div>7일 내 예정<strong>'+d.upcoming+'종목</strong></div><div>오늘 상장<strong>'+d.listing+'종목</strong></div></div>'+
      (cards||'<p>오늘 청약 중이거나 7일 안에 청약 예정인 공모주가 없습니다.</p>')+
      '<p>원천: 기존 IPO 일정 API(네이버 증시 캘린더/공모주 목록). 변경·연기 가능성이 있으므로 청약 전 증권신고서와 주관사 공지를 확인하세요.</p>';
  }catch(e){
    box.innerHTML='<h3>📈 '+esc(brief)+' 공모주 브리핑</h3><p class="id-error">'+esc(e.message||e)+'</p>';
  }
}
load();
})();