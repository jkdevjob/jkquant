/* JK 투자 — 거래이력 그림: 주가(종가) 위에 내 매수 ▲ · 매도 ▼ (v1.0.0 · 2026-11-11)
   사용자(11/11): "운영에서 각전략 세션 거래이력에 투자종목 그래프 그리고 그 그래프에 매수와 매도한걸 표현해 줄수 있나?
   주가 추이와 내가 어느떄 매수하고 어느때 매도했는지 한눈에 알 수 있게" → 시안 → "어 좋아 그렇게 해".
   - 종가 선 위에 매수 ▲(초록) · 매도 ▼(빨강)를 체결가 자리에 찍는다(뾰족한 끝이 체결가 · 크기 = 금액).
   - 평단(금색 점선 · 계단)과 들고 있던 기간(옅은 띠)을 겹친다. 보유 · 평단 · 손익은 각 탭 계산이 준 값(steps · pnl)을
     그대로 쓴다 — 여기서 다시 세지 않는다(같은 걸 두 군데서 세지 않는다). steps 가 없을 때만 매매로 센다.
   - 같은 날 여러 체결은 한 표시로 묶고, 촘촘하면 매수 · 매도를 따로 주 · 달로 묶는다(드문 매도는 낱낱이).
   - 띠: 판 뒤 5거래일 안에 다시 산 빈틈은 이어 붙이고, 거의 늘(90% 넘게) 들고 있으면 그리지 않는다.
   - 누르면(또는 ←/→) 그날 종가 · 보유 · 평단 · 그날 매매 · 판 날이면 '다음 매수' 날짜 · 값.
   - 화면 글자는 escape 하거나 textContent 로만 넣는다. 기간 · 종목 선택은 이 화면 메모리에만 둔다(브라우저 저장소 안 씀). */
(function(g){
'use strict';
const VERSION='1.0.0';
const STATE=new Map();   // 그림 자리(key) → {period, symbol} — 새로고침하면 처음으로
const PERIODS=[['1m','1개월',21],['3m','3개월',63],['6m','6개월',126],['1y','1년',252],['all','전체',Infinity]];
const V=(n,f)=>'var('+n+','+f+')';   // 운영(index) 색 이름 · 없으면(듀얼가드 화면) 같은 값
const CSS=[
  '.tc-sum{font-size:12px;color:'+V('--dim','#9aa6c9')+';margin-bottom:8px;line-height:1.5}.tc-sum b{color:'+V('--ink','#e8ecf7')+'}',
  '.tc-up{color:'+V('--buy','#36d399')+'}.tc-dn{color:'+V('--sell','#f87b8c')+'}',
  '.tc-per{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
  '.tc-per button{font:inherit;font-size:11.5px;font-weight:700;padding:4px 10px;min-height:30px;border-radius:14px;border:1px solid '+V('--line','#2a3354')+';background:transparent;color:'+V('--dim','#9aa6c9')+';cursor:pointer}',
  '.tc-per button[aria-pressed="true"]{background:'+V('--vio-bg','#262a52')+';border-color:'+V('--vio2','#6366d9')+';color:'+V('--ink','#e8ecf7')+'}',
  '.tc-tk button{font-size:12.5px;padding:5px 12px}',
  '.tc-chart{position:relative;overflow:hidden}.tc-chart svg{display:block;width:100%;height:auto;touch-action:pan-y;outline:none}',
  '.tc-chart svg:focus-visible{outline:2px solid '+V('--vio','#8b8cf0')+';outline-offset:2px;border-radius:4px}',
  '.tc-grid{stroke:'+V('--line','#2a3354')+';stroke-width:1}.tc-ax{fill:'+V('--faint','#646e93')+';font-size:10px}',
  '.tc-line{fill:none;stroke:'+V('--ink','#e8ecf7')+';stroke-opacity:.82;stroke-width:1.6;stroke-linejoin:round}',
  '.tc-avg{fill:none;stroke:'+V('--gold','#f5c451')+';stroke-width:1.4;stroke-dasharray:4 3}',
  '.tc-hold{fill:'+V('--vio','#8b8cf0')+';fill-opacity:.09}',
  '.tc-mk{stroke:'+V('--panel','#171c2e')+';stroke-width:1.6;stroke-linejoin:round}.tc-b{fill:'+V('--buy','#36d399')+'}.tc-s{fill:'+V('--sell','#f87b8c')+'}',
  '.tc-dot{fill:'+V('--ink','#e8ecf7')+';stroke:'+V('--panel','#171c2e')+';stroke-width:2}.tc-cross{stroke:'+V('--faint','#646e93')+';stroke-dasharray:3 3}',
  '.tc-tip{position:absolute;top:6px;left:0;pointer-events:none;background:'+V('--panel2','#1e2540')+';border:1px solid '+V('--line','#2a3354')+';border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.55;color:'+V('--dim','#9aa6c9')+';white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:2}',
  '.tc-th{color:'+V('--ink','#e8ecf7')+';font-weight:700}.tc-tb{color:'+V('--buy','#36d399')+'}.tc-ts{color:'+V('--sell','#f87b8c')+'}.tc-tn{color:'+V('--faint','#646e93')+'}',
  '.tc-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:'+V('--dim','#9aa6c9')+';margin-top:6px}.tc-u{color:'+V('--faint','#646e93')+'}',
  '.tc-k{display:inline-block;margin-right:4px;vertical-align:-1px}',
  '.tc-kb{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid '+V('--buy','#36d399')+'}',
  '.tc-ks{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:9px solid '+V('--sell','#f87b8c')+'}',
  '.tc-ka{width:14px;height:0;border-top:2px dashed '+V('--gold','#f5c451')+';vertical-align:3px}',
  '.tc-kh{width:12px;height:10px;background:'+V('--vio','#8b8cf0')+';opacity:.25;border-radius:2px}',
  '.tc-note{font-size:12px;color:'+V('--faint','#646e93')+';padding:6px 0;line-height:1.6}'
].join('\n');
function ensureStyle(doc){
  if(!doc||!doc.createElement||doc.getElementById('jkTcStyle')) return;
  const s=doc.createElement('style'); s.id='jkTcStyle'; s.textContent=CSS; (doc.head||doc.documentElement).appendChild(s);
}
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function money(v,cur,dp){
  v=+v||0; const neg=v<0, a=Math.abs(v);
  if(cur==='krw') return (neg?'-':'')+Math.round(a).toLocaleString('en-US')+'₩';
  const d=dp==null?2:dp;
  return (neg?'-':'')+'$'+a.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
}
const md=d=>String(d).slice(5).replace('-','/');
const byDate=(a,b)=>a.date<b.date?-1:a.date>b.date?1:((a._o||0)-(b._o||0));
function niceTicks(lo,hi,n){
  const span=hi-lo; if(!(span>0)) return [lo];
  const raw=span/Math.max(1,n), p=Math.pow(10,Math.floor(Math.log10(raw))), m=raw/p, st=(m<1.5?1:m<3?2:m<7?5:10)*p, out=[];
  for(let v=Math.ceil(lo/st)*st; v<=hi+1e-9; v+=st) out.push(+v.toFixed(10));
  return out;
}
const weekKey=d=>{ const t=new Date(d+'T00:00:00Z'); const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day); return t.toISOString().slice(0,10); };
/* 매매만 있을 때의 보유 · 평단(대신 쓰는 값) — 매수는 가중 평균 · 매도는 수량만 · 다 팔면 평단 없음(수수료 제외).
   탭 계산이 steps 를 주면 이 함수는 쓰지 않는다. */
function stepsFromTrades(trades){
  let q=0,avg=null; const out=[];
  for(const t of trades.slice().sort(byDate)){
    const n=+t.qty>0?+t.qty:0;
    if(t.side==='buy'){ if(n>0){ avg=q>0&&avg!=null?(avg*q+t.price*n)/(q+n):t.price; q+=n; } }
    else { q=Math.max(0,q-n); if(q<1e-9){ q=0; avg=null; } }
    out.push({date:t.date,held:q,avg});
  }
  return out;
}
/* 날마다 보유 · 평단 — 그날까지의 마지막 step(그 기록 뒤 상태)을 이어 쓴다. held 가 true 면 '들고 있음(수량 모름)'. */
function pathOf(days,steps){
  const S=(steps||[]).map((s,i)=>({date:String(s.date||'').slice(0,10),held:s.held,avg:s.avg,_o:i})).filter(s=>s.date).sort(byDate);
  let j=0,cur={held:0,avg:null}; const out=[];
  for(const d of days){
    while(j<S.length&&S[j].date<=d.date){
      const h=S[j].held===true?true:(+S[j].held>0?+S[j].held:0), on=h===true||h>0;
      cur={held:h,avg:on&&S[j].avg!=null&&+S[j].avg>0?+S[j].avg:null}; j++;
    }
    out.push(cur);
  }
  return out;
}
const holding=p=>!!p&&(p.held===true||p.held>0);
/* 표시 묶기 — 날 · 주 · 달. 묶음마다 횟수 · 수량 · 금액 · 가중 평균가 · 손익 합(손익을 준 매도만) */
function group(trades,unit){
  const key=t=>unit==='day'?t.date:unit==='week'?weekKey(t.date):t.date.slice(0,7);
  const m=new Map();
  for(const t of trades){
    const k=key(t)+'|'+t.side; let o=m.get(k);
    if(!o){ o={side:t.side,unit,from:t.date,to:t.date,n:0,qty:0,amt:0,pxSum:0,pnl:0,hasPnl:false}; m.set(k,o); }
    o.n++; o.pxSum+=t.price; if(t.qty>0){ o.qty+=t.qty; o.amt+=t.qty*t.price; }
    if(t.pnl!=null){ o.pnl+=t.pnl; o.hasPnl=true; }
    if(t.date<o.from) o.from=t.date; if(t.date>o.to) o.to=t.date;
  }
  return [...m.values()].map(o=>Object.assign(o,{price:o.qty>0?o.amt/o.qty:o.pxSum/o.n}));
}
function pickUnit(list,PW){
  for(const u of ['day','week','month']) if(new Set(group(list,u).map(q=>q.from)).size*7<=PW) return u;
  return 'month';
}
const note=t=>'<div class="tc-note">'+esc(t)+'</div>';
function cleanTrades(list){
  return (list||[]).map((t,i)=>({date:String(t&&t.date||'').slice(0,10),side:t&&t.side,qty:+(t&&t.qty)>0?+t.qty:null,price:+(t&&t.price),
    pnl:t&&t.pnl!=null&&t.pnl!==''&&Number.isFinite(+t.pnl)?+t.pnl:null,label:t&&t.label?String(t.label):'',_o:i}))
    .filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&(t.side==='buy'||t.side==='sell')&&t.price>0).sort(byDate);
}
/* 그림 한 장 — {markup, geo}. o: {symbol, days[{date,close}], trades[{date,side,qty,price,pnl?,label?}], steps?[{date,held,avg}],
   avgLabel?('평단'), cur?('usd'|'krw'), period?, width?, tickers?[...]} */
function render(o){
  const cur=o.cur==='krw'?'krw':'usd', M=v=>money(v,cur), M0=v=>money(v,cur,0), AL=o.avgLabel||'평단', sym=String(o.symbol||'');
  const tick=o.tickers&&o.tickers.length>1?'<div class="tc-per tc-tk" role="group" aria-label="종목">'+o.tickers.map(t=>'<button type="button" data-tctk="'+esc(t)+'" aria-pressed="'+(t===sym)+'">'+esc(t)+'</button>').join('')+'</div>':'';
  const all=(o.days||[]).filter(d=>d&&d.date&&+d.close>0).map(d=>({date:String(d.date).slice(0,10),close:+d.close}));
  const tr=cleanTrades(o.trades);
  if(!tr.length) return {markup:tick+note(sym+' — 아직 매매 기록이 없습니다. 기록하면 주가 위에 매수 ▲ · 매도 ▼ 가 표시됩니다.'),geo:null};
  if(all.length<2) return {markup:tick+note(sym+' 시세를 불러오지 못했습니다 — 잠시 뒤 다시 열어 주세요.'),geo:null};
  const steps=(o.steps&&o.steps.length)?o.steps:stepsFromTrades(tr);
  const per=PERIODS.find(p=>p[0]===o.period)||PERIODS[PERIODS.length-1];
  let i0;
  if(per[2]===Infinity){ i0=all.findIndex(d=>d.date>=tr[0].date); if(i0<0) i0=all.length-1; i0=Math.max(0,i0-10); }   // 전체 = 첫 매매 열흘 전부터
  else i0=Math.max(0,all.length-per[2]);
  if(all.length-i0<2) i0=Math.max(0,all.length-2);
  const days=all.slice(i0), path=pathOf(all,steps).slice(i0), d0=days[0].date, d1=days[days.length-1].date, n=days.length;
  const vis=tr.filter(t=>t.date>=d0);   // 마지막 봉 뒤 기록(오늘 장 마감 전 체결 등)은 끝자리에 붙인다
  const W=Math.max(280,Math.min(1000,Math.round(o.width||360))), H=W<480?210:250, L=46, R=12, T=12, B=22, PW=W-L-R;
  const x=i=>L+PW*(i/(n-1)), f=v=>(+v).toFixed(1);
  const xi=new Map(days.map((d,i)=>[d.date,i]));
  const idxOf=d=>{ if(xi.has(d)) return xi.get(d); const j=days.findIndex(z=>z.date>d); return j<0?n-1:Math.max(0,j); };
  const vb=vis.filter(t=>t.side==='buy'), vs=vis.filter(t=>t.side==='sell'), unitB=pickUnit(vb,PW), unitS=pickUnit(vs,PW);
  const G=[...group(vb,unitB),...group(vs,unitS)];
  let lo=Infinity,hi=-Infinity;
  for(const d of days){ lo=Math.min(lo,d.close); hi=Math.max(hi,d.close); }
  for(const q of G){ lo=Math.min(lo,q.price); hi=Math.max(hi,q.price); }
  for(const p of path) if(p.avg!=null){ lo=Math.min(lo,p.avg); hi=Math.max(hi,p.avg); }
  const pad=(hi-lo)*0.08||hi*0.05||1; lo-=pad; hi+=pad;
  const y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  let s='';
  /* 들고 있던 구간 — 5거래일 이하 빈틈은 이어 붙이고, 90% 넘게 덮으면(늘 들고 있는 전략) 그리지 않는다 */
  const spans=[]; { let a=null; path.forEach((p,i)=>{ const on=holding(p); if(on&&a==null) a=i; if((!on||i===n-1)&&a!=null){ spans.push([a,i]); a=null; } }); }
  const merged=[]; for(const sp of spans){ const p0=merged[merged.length-1]; if(p0&&sp[0]-p0[1]<=5) p0[1]=sp[1]; else merged.push(sp.slice()); }
  const covered=merged.reduce((a,sp)=>a+(sp[1]-sp[0]),0)/Math.max(1,n-1), band=covered<0.9&&merged.length>0;
  if(band) for(const [a,b] of merged) s+='<rect class="tc-hold" x="'+f(x(a))+'" y="'+T+'" width="'+f(Math.max(1,x(b)-x(a)))+'" height="'+(H-T-B)+'"/>';
  s+=niceTicks(lo,hi,4).filter(v=>v>=lo&&v<=hi).map(v=>'<line class="tc-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+f(y(v))+'" y2="'+f(y(v))+'"/><text class="tc-ax" x="'+(L-6)+'" y="'+f(y(v)+4)+'" text-anchor="end">'+esc(hi>=1000?Math.round(v).toLocaleString('en-US'):String(+v.toFixed(2)))+'</text>').join('');
  s+='<text class="tc-ax" x="'+L+'" y="'+(H-6)+'">'+esc(d0.slice(2).replace(/-/g,'.'))+'</text><text class="tc-ax" x="'+(W-R)+'" y="'+(H-6)+'" text-anchor="end">'+esc(d1.slice(2).replace(/-/g,'.'))+'</text>';
  // 평단(계단) — 들고 있을 때만
  let dA='',on=false; path.forEach((p,i)=>{ if(p.avg==null){ on=false; return; } const xx=f(x(i)),yy=f(y(p.avg)); dA+=on?' H'+xx+' V'+yy:' M'+xx+' '+yy; on=true; });
  const hasAvg=!!dA; if(hasAvg) s+='<path class="tc-avg" d="'+dA+'"/>';
  s+='<path class="tc-line" d="'+days.map((d,i)=>(i?'L':'M')+f(x(i))+' '+f(y(d.close))).join(' ')+'"/>';
  // 매매 표시 — 크기 = 금액(넓이 비례 · 금액 모르면 가운데 크기) · 끝이 체결가(매수 ▲ 아래에서 · 매도 ▼ 위에서)
  const maxA=Math.max(1,...G.map(q=>q.amt));
  const mk=q=>{ const r=q.amt>0?Math.sqrt(q.amt/maxA):0.5, sz=8+8*r, i=idxOf(q.unit==='day'?q.from:q.to), cx=x(i), cy=y(q.price), h=sz*0.9, w=sz*0.55;
    const pts=q.side==='buy'?[[cx,cy],[cx-w,cy+h],[cx+w,cy+h]]:[[cx,cy],[cx-w,cy-h],[cx+w,cy-h]];
    return '<polygon class="tc-mk '+(q.side==='buy'?'tc-b':'tc-s')+'" points="'+pts.map(p=>f(p[0])+','+f(p[1])).join(' ')+'"/>'; };
  s+=G.filter(q=>q.side==='buy').map(mk).join('')+G.filter(q=>q.side==='sell').map(mk).join('');   // 매도를 위에(드물고 더 중요)
  s+='<circle class="tc-dot" cx="'+f(x(n-1))+'" cy="'+f(y(days[n-1].close))+'" r="3.5"/>';
  s+='<line class="tc-cross" x1="0" x2="0" y1="'+T+'" y2="'+(H-B)+'" visibility="hidden"/>';
  // 요약 — 지금 값 · 평단(지금) · 이 기간 매수 · 매도 횟수 · 실현(손익을 준 매도만)
  const anySell=tr.some(t=>t.side==='sell');   // 매도가 한 번도 없는 전략(적립)은 매도 칸 · 범례를 뺀다
  const now=pathOf([{date:'9999-12-31'}],steps)[0], last=days[n-1], nB=vb.length, nS=vs.length, withP=vs.filter(t=>t.pnl!=null), rp=withP.reduce((a,t)=>a+t.pnl,0);
  const gap=now.avg!=null?(last.close/now.avg-1)*100:null;
  const sum='<div class="tc-sum"><b>'+esc(sym)+'</b> '+esc(M(last.close))
    +(holding(now)?(now.avg!=null?' · '+esc(AL)+' '+esc(M(now.avg))+' <span class="'+(gap>=0?'tc-up':'tc-dn')+'">('+(gap>=0?'+':'')+gap.toFixed(1)+'%)</span>':' · 들고 있음'):' · 지금 안 들고 있음')
    +' · 매수 '+nB+'번'+(anySell?' · 매도 '+nS+'번':'')+(withP.length?' · 실현 <span class="'+(rp>=0?'tc-up':'tc-dn')+'">'+(rp>=0?'+':'')+esc(M0(rp))+'</span>':'')+'</div>';
  const chips='<div class="tc-per" role="group" aria-label="기간">'+PERIODS.map(p=>'<button type="button" data-tcper="'+p[0]+'" aria-pressed="'+(p===per)+'">'+p[1]+'</button>').join('')+'</div>';
  const unitTxt=u=>u==='week'?'한 주':'한 달';
  const leg='<div class="tc-leg"><span><i class="tc-k tc-kb"></i>매수</span>'+(anySell?'<span><i class="tc-k tc-ks"></i>매도</span>':'')+(hasAvg?'<span><i class="tc-k tc-ka"></i>'+esc(AL)+'</span>':'')+(band?'<span><i class="tc-k tc-kh"></i>들고 있던 기간</span>':'')
    +'<span class="tc-u">'+[unitB!=='day'&&vb.length?'▲ 하나 = '+unitTxt(unitB)+' 매수 합':'',unitS!=='day'&&vs.length?'▼ 하나 = '+unitTxt(unitS)+' 매도 합':''].filter(Boolean).concat(['크기 = 금액']).join(' · ')+'</span></div>';
  const aria=sym+' 종가 '+d0+' ~ '+d1+' · 매수 '+nB+'번 · 매도 '+nS+'번 · 왼쪽·오른쪽 화살표로 날짜 이동';
  const markup=tick+sum+chips+'<div class="tc-chart"><svg viewBox="0 0 '+W+' '+H+'" role="img" tabindex="0" aria-label="'+esc(aria)+'">'+s+'</svg><div class="tc-tip" hidden></div></div>'+leg;
  return {markup,geo:{W,L,PW,n,days,path,G,unitB,unitS,vis,all:tr,M,M0,AL,cur}};
}
/* 십자선 · 값 상자 — 가장 가까운 날로 붙는다. 그날(또는 그 주 · 달) 매매와, 판 날이면 다음에 다시 산 값 */
function bind(box,G){
  if(!box||!G) return;
  const svg=box.querySelector('svg'), tip=box.querySelector('.tc-tip'), cross=svg&&svg.querySelector('.tc-cross'); if(!svg||!tip||!cross) return;
  let cur=G.n-1;
  const line=(txt,cls)=>{ const d=box.ownerDocument.createElement('div'); if(cls) d.className=cls; d.textContent=txt; tip.appendChild(d); };
  const qtyTxt=q=>(+q.toFixed(4)).toLocaleString('en-US')+'주';
  const at=i=>{
    i=Math.max(0,Math.min(G.n-1,i)); cur=i; const d=G.days[i], xx=G.L+G.PW*(i/(G.n-1)), rc=svg.getBoundingClientRect(), sc=(rc.width||G.W)/G.W;
    cross.setAttribute('x1',xx); cross.setAttribute('x2',xx); cross.setAttribute('visibility','visible'); tip.textContent='';
    line(d.date+' · 종가 '+G.M(d.close),'tc-th');
    const p=G.path[i]; if(holding(p)) line((p.held===true?'보유 중':'보유 '+qtyTxt(p.held))+(p.avg!=null?' · '+G.AL+' '+G.M(p.avg):''));
    const uOf=t=>t.side==='buy'?G.unitB:G.unitS, last=i===G.n-1;
    const today=G.vis.filter(t=>uOf(t)==='day'&&(t.date===d.date||(last&&t.date>d.date)));
    for(const t of today){
      const kind=(t.side==='buy'?'▲ ':'▼ ')+(t.label||(t.side==='buy'?'매수':'매도'));
      line(kind+' '+(t.qty?qtyTxt(t.qty)+' × '+G.M(t.price)+' = '+G.M0(t.qty*t.price):G.M(t.price))+(t.side==='sell'&&t.pnl!=null?' · 손익 '+(t.pnl>=0?'+':'')+G.M0(t.pnl):''),t.side==='buy'?'tc-tb':'tc-ts');
      if(t.side==='sell'){ const nb=G.all.find(z=>z.side==='buy'&&z.date>t.date);
        if(nb){ const r=(nb.price/t.price-1)*100; line('  → 다음 매수 '+md(nb.date)+' '+G.M(nb.price)+' ('+(r>=0?'+':'')+r.toFixed(1)+'%)','tc-tn'); } }
    }
    for(const q of G.G.filter(q=>q.unit!=='day'&&d.date>=q.from&&d.date<=q.to))
      line((q.side==='buy'?'▲ 매수 ':'▼ 매도 ')+q.n+'번 · '+(q.amt>0?G.M0(q.amt)+' · ':'')+'평균 '+G.M(q.price)+(q.hasPnl&&q.side==='sell'?' · 손익 '+(q.pnl>=0?'+':'')+G.M0(q.pnl):'')+' ('+md(q.from)+(q.to!==q.from?'~'+md(q.to):'')+')',q.side==='buy'?'tc-tb':'tc-ts');
    tip.hidden=false;
    const tw=tip.offsetWidth||160, px=xx*sc, bw=rc.width||G.W;
    tip.style.left=Math.max(4,Math.min(bw-tw-4,(px+12+tw>bw)?px-tw-12:px+12))+'px';
  };
  const near=ev=>{ const rc=svg.getBoundingClientRect(), sx=(ev.clientX-rc.left)*(G.W/(rc.width||G.W)); return Math.round((sx-G.L)/(G.PW/(G.n-1))); };
  const hide=()=>{ tip.hidden=true; cross.setAttribute('visibility','hidden'); };
  svg.addEventListener('pointermove',ev=>at(near(ev))); svg.addEventListener('pointerdown',ev=>at(near(ev)));
  svg.addEventListener('pointerleave',ev=>{ if(ev.pointerType!=='touch') hide(); });
  svg.addEventListener('focus',()=>at(cur)); svg.addEventListener('blur',hide);
  svg.addEventListener('keydown',ev=>{ if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){ ev.preventDefault(); at(cur+(ev.key==='ArrowLeft'?-1:1)); } else if(ev.key==='Escape') hide(); });
  box._tcAt=at;
}
/* 자리(el)에 그린다 — cfg: {key, symbols[], symbol?(처음 고를 종목), load(sym)→Promise<{days,trades,steps?,avgLabel?,cur?}>, width?}.
   기간 · 종목 단추는 여기서 다시 그린다. 늦게 온 응답이 새 그림을 덮지 않게 차례표(_tcTok)를 쓴다. */
function mount(el,cfg){
  if(!el||!cfg) return Promise.resolve();
  ensureStyle(el.ownerDocument);
  const syms=(cfg.symbols||[]).filter(Boolean), key=cfg.key||'default';
  const st=STATE.get(key)||{period:'all',symbol:null}; STATE.set(key,st);
  const tok=(el._tcTok||0)+1; el._tcTok=tok;
  if(!syms.length){ el.innerHTML=note('아직 매매 기록이 없습니다 — 기록하면 주가 위에 매수 ▲ · 매도 ▼ 가 표시됩니다.'); return Promise.resolve(); }
  if(!syms.includes(st.symbol)) st.symbol=(cfg.symbol&&syms.includes(cfg.symbol))?cfg.symbol:syms[0];
  if(!el.firstChild) el.innerHTML=note('시세를 불러오는 중…');
  const sym=st.symbol;
  return Promise.resolve().then(()=>cfg.load(sym)).then(data=>{
    if(el._tcTok!==tok) return;
    const R=render(Object.assign({},data||{},{symbol:sym,period:st.period,width:el.clientWidth||cfg.width||360,tickers:syms}));
    el.innerHTML=R.markup;
    if(R.geo) bind(el.querySelector('.tc-chart'),R.geo);
    el.querySelectorAll('[data-tcper]').forEach(b=>b.addEventListener('click',()=>{ st.period=b.getAttribute('data-tcper'); mount(el,cfg); }));
    el.querySelectorAll('[data-tctk]').forEach(b=>b.addEventListener('click',()=>{ st.symbol=b.getAttribute('data-tctk'); mount(el,cfg); }));
  }).catch(e=>{ if(el._tcTok===tok) el.innerHTML=note('그림을 그리지 못했습니다 — '+String(e&&e.message||e)); });
}
g.JKTradeChart={VERSION,render,bind,mount,group,pathOf,stepsFromTrades,cleanTrades,money,PERIODS,_state:STATE};
})(typeof window!=='undefined'?window:globalThis);
