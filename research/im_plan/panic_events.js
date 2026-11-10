// 공포 모드 사건 표(11-10) — 기준(지금 앱 규칙) vs 공포 모드 변형을 같은 자료로 돌려, 무장(VIX≥hi)·진정(VIX<lo) 사건마다 두 곡선의 비율 변화(진정일 → 6개월 · 보통 모드 복귀까지)와 모드 전환 날짜를 적는다.
// 사용: node panic_events.js real|syn '{"panic":{...}}'
const {prep,sim,stats,ind}=require('./px'); const {mk}=require('./plan_rules'); const fs=require('fs');
const SET=process.argv[2]||'real'; const VP=JSON.parse(process.argv[3]||'{"panic":{"hi":40,"lo":30,"ma":50,"band":0.02,"sleeve":"min","k":2.8,"fbK":3.35}}');
const [R,G,from]=SET==='syn'?['SYNTECL','SYNTQQQ','2000-01-01']:['TECL','TQQQ','2011-01-01']; const P=prep([R,G],{ohlc:true});
const run=p=>{ const rule=mk(P,R,G,p); const daily=[]; const o=Object.assign({cap:10000,fee:0.001,sizePrev:true,from,daily},rule); if(SET==='syn') o.frac=true; const r=sim(P,o); return {daily,S:stats(r.eq,10000)}; };
const A=run({gsb:1e9}), B=run(Object.assign({gsb:1e9},VP));
const tot=x=>x.cash+x.q[R]*x.px[R]+x.q[G]*x.px[G]; const ki=Object.fromEntries(A.daily.map((x,i)=>[x.d,i]));
console.log(`${SET} 기준 ${A.S.cagr.toFixed(1)}/${A.S.mdd.toFixed(1)} → 변형 ${B.S.cagr.toFixed(1)}/${B.S.mdd.toFixed(1)} · 끝 비율 ×${(tot(B.daily[B.daily.length-1])/tot(A.daily[A.daily.length-1])).toFixed(3)}`);
const vix={}; JSON.parse(fs.readFileSync('data/VIX.json','utf8')).series.forEach(x=>vix[x.date]=x.close); let lv=null; const V=A.daily.map(x=>{ if(vix[x.d]!=null) lv=vix[x.d]; return lv; });
// 사건: 전일 VIX≥hi 로 무장 → 전일 VIX<lo 진정(그날 상태 변화는 B.daily[i].st 에서)
let i=0, hi=VP.panic.hi, lo=VP.panic.lo; const D=B.daily; let armed=false, startI=null;
console.log('무장일 → 진정일 | Guard 빠른 모드(ON 날 → 보통 복귀 날) · 슬리브 공포 모드(시작 → 끝) | 비율 변화(진정일 기준): +1개월 · +3개월 · +6개월 · 보통 복귀/끝 | 기준 TECL 비중 → 변형 비중(진정 다음 날)');
for(i=1;i<D.length;i++){ const v=V[i-1]; if(v==null) continue; if(!armed&&v>=hi){ armed=true; startI=i; } if(armed&&v<lo){ const calm=i; armed=false;
    // 모드 날짜
    let pfOn=null,pfOff=null,psOn=null,psOff=null; for(let j=calm;j<D.length&&j<calm+400;j++){ const s=D[j].st; if(pfOn===null&&s.pf) pfOn=j; if(pfOn!==null&&pfOff===null&&!s.pf) pfOff=j; if(psOn===null&&s.ps) psOn=j; if(psOn!==null&&psOff===null&&!s.ps) psOff=j; }
    const ratio=j=>{ j=Math.min(j,D.length-1); return (tot(D[j])/tot(A.daily[j]))/(tot(D[calm])/tot(A.daily[calm])); };
    const endI=Math.max(pfOff??calm,psOff??calm); const w=(X,j)=>{ const x=X[j]; return (x.q[R]*x.px[R]/tot(x)*100).toFixed(0); };
    console.log(`  ${D[startI].d} (VIX ${V[startI-1].toFixed(0)}) → ${D[calm].d} (VIX ${v.toFixed(0)}) | Guard ${pfOn!=null?D[pfOn].d+' → '+(pfOff!=null?D[pfOff].d:'…'):'없음'} · 슬리브 ${psOn!=null?D[psOn].d+' → '+(psOff!=null?D[psOff].d:'…'):'없음'} | ×${ratio(calm+21).toFixed(3)} · ×${ratio(calm+63).toFixed(3)} · ×${ratio(calm+126).toFixed(3)} · 복귀 ${endI>calm?D[Math.min(endI,D.length-1)].d+' ×'+ratio(endI).toFixed(3):'-'} | TECL ${w(A.daily,Math.min(calm+1,D.length-1))}% → ${w(D,Math.min(calm+1,D.length-1))}%`); } }
