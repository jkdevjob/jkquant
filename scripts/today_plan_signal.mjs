import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try{
  const p=await browser.newPage();
  await p.goto('https://jkquant.pages.dev/plan.html',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1000);
  await p.waitForFunction(()=>document.querySelector('#alphaMeta') && !document.querySelector('#alphaMeta').textContent.includes('불러'),{timeout:120000});
  const out=await p.evaluate(()=>({
    meta:document.querySelector('#alphaMeta')?.textContent||'',
    decision:document.querySelector('#alphaDecision')?.innerText||'',
    summary:document.querySelector('#alphaSummary')?.innerText||'',
    actions:document.querySelector('#alphaActions')?.innerText||'',
    sigma:document.querySelector('#alphaSigma')?.textContent||'',
    targetW:document.querySelector('#alphaTargetW')?.textContent||'',
    currentW:document.querySelector('#alphaCurrentW')?.textContent||'',
    guard:document.querySelector('#alphaGuardState')?.textContent||'',
    guardGap:document.querySelector('#alphaGuardGap')?.textContent||'',
    levels:document.querySelector('#alphaGuardLevels')?.textContent||'',
    title:document.querySelector('#alphaStrategyTitle')?.textContent||''
  }));
  console.log('===TODAY_PLAN_SIGNAL===');
  console.log(JSON.stringify(out,null,2));
  console.log('===END_TODAY_PLAN_SIGNAL===');
}finally{await browser.close();}