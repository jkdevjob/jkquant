#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'scalping.html'),'utf8');
const hist=fs.readFileSync(path.join(root,'functions/api/scalping-history.js'),'utf8');
const review=fs.readFileSync(path.join(root,'functions/api/scalping-review.js'),'utf8');

function fail(msg){console.error('✗ '+msg);process.exit(1);}
function ok(cond,msg){if(!cond)fail(msg);console.log('✓ '+msg);}
function extractFn(text,marker){
  const i=text.indexOf(marker); if(i<0)throw new Error('missing '+marker);
  let j=text.indexOf('{',i),d=0,k=j;
  for(;k<text.length;k++){
    if(text[k]==='{')d++;
    else if(text[k]==='}'){d--;if(!d)break;}
  }
  return text.slice(i,k+1);
}
function buildDailyRisk(src){
  const ret=extractFn(src,'function sessionReturnPct(');
  const risk=extractFn(src,'function dailyRisk(');
  return new Function(ret+'\n'+risk+'\nreturn dailyRisk;')();
}
function near(a,b,t=1e-9){return Math.abs(a-b)<=t;}
function marProbe(src){
  try{
    const fn=extractFn(src,'function scalpingMar(');
    const f=new Function(fn+'\nreturn scalpingMar;')();
    const v=f(21,-10,'2025-01-01','2026-01-01');
    return Number.isFinite(v)&&v>2&&v<2.2;
  }catch(e){return false;}
}
function riskProbe(src){
  try{
    const f=buildDailyRisk(src);
    const rows=[
      {date:'2026-09-29',pnl:2},{date:'2026-09-29',pnl:0},
      {date:'2026-09-30',pnl:-2},{date:'2026-10-01',pnl:-1}
    ];
    const z=f(rows,'opening');
    if(z.daily.length!==3)return false;
    if(!near(z.daily[0].returnPct,1))return false; // same-day equal-weight average, not sum
    if(z.lossStreakTradeDays!==2)return false;
    if(!near(z.currentDrawdownPct,-2.98,1e-8))return false;
    if(z.recentDaily[0].date!=='2026-10-01')return false;
    const z2=f([...rows,{date:'2026-10-02',pnl:0}],'opening');
    if(z2.lossStreakTradeDays!==0)return false;
    if(z2.weekStart!=='2026-09-28')return false;
    return true;
  }catch(e){return false;}
}

ok(/id="scVer">v\d+\.\d+\.\d+<\/span>/.test(ui),'scalping UI version uses x.y.z format');
ok(marProbe(ui),'MAR uses annualized CAGR divided by absolute MDD');
const mutMar=ui.replace('return Number.isFinite(cagr)?cagr/dd:null;','return Number.isFinite(cagr)?cagr:null;');
ok(!marProbe(mutMar),'mutation killed: MAR must divide CAGR by absolute MDD');
ok((ui.match(/<th>MAR<\/th>/g)||[]).length>=3&&ui.includes('전체기간 CAGR ÷ |MDD|'),'BTC/SOXL/daytrading tables expose MAR next to MDD');
const labels=['📖 전략 · 종목선정 규칙','🔎 오늘 종목 선정 · 감시','🟢 매수 타이밍','🔴 매도 · 손절 · 리스크','📒 오늘 모의매매 · 손익','🗓 다음 계획','🧪 그림자 · 매일 검증 · 개선','📚 누적 모의매매 이력','🔍 실행품질 · VTS 대조'];
const pos=labels.map(x=>ui.indexOf(x));
ok(pos.every((x,i)=>x>=0&&(i===0||x>pos[i-1])),'nine-step self-contained tab order');
for(const needle of [
  'strategy-statusline','function nextPlanText(name)','function renderPlan(name)',
  'currentDrawdownPct','lossStreakTradeDays','weeklyTargetGapPct',
  '/api/scalping-review?strategy=','교체 검토 조건 확인 중','교체 검토 조건 충족',
  '목표 수익을 맞추기 위해 필터를 완화하지 않습니다.','startStrategyStatusAuto'
]) ok(ui.includes(needle),'UI contains '+needle);

ok(riskProbe(hist),'risk engine: equal-weight daily return / drawdown / loss streak / weekly progress');
const mutAvg=hist.replace('return sum/a.length;','return sum;');
ok(!riskProbe(mutAvg),'mutation killed: opening daily account return must average same-day trades');
const mutStreak=hist.replace('if(daily[i].returnPct<0)lossStreak++;','if(daily[i].returnPct<=0)lossStreak++;');
ok(!riskProbe(mutStreak),'mutation killed: flat day ends loss streak');

ok(/data\/nightly-research/.test(review),'daily review API reads dated nightly research');
ok(/strategy must be opening\|daytrading\|crypto\|soxl/.test(review),'daily review API restricts four strategies');
ok(!/op=order|opening-execute|kisOrder\(|method:\s*["']POST["']/.test(review),'daily review API is read-only');
ok(/issueCount/.test(review),'daily review separates actionable issues from info flags');
ok(/autoPromotion:false/.test(review),'daily review never auto-promotes baseline');

console.log('✓ self-contained scalping tabs: ALL PASS');
