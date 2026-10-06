'use strict';
const fs=require('fs');
const pages=['index.html','backtest.html','plan.html','scalping.html','job.html','ipo.html','admin.html','claude.html','realestate.html'];
let fail=0;
function ck(v,m){if(v)console.log('PASS '+m);else{console.error('FAIL '+m);fail++;}}
for(const f of pages){
  const src=fs.readFileSync(f,'utf8');
  const vp=(src.match(/<meta\s+name=["']viewport["'][^>]*>/i)||[''])[0];
  ck(!!vp,f+' viewport');
  ck(/viewport-fit\s*=\s*cover/i.test(vp),f+' viewport-fit');
  ck(src.split('/jk-mobile.css?v=1.0.0').length-1===1,f+' mobile css');
}
const css=fs.readFileSync('jk-mobile.css','utf8');
ck(/@media\s*\(max-width:768px\)/.test(css),'768px mobile rules');
ck(/input,select,textarea\{font-size:16px!important\}/.test(css),'iOS input zoom prevention');
ck(/safe-area-inset-left/.test(css)&&/safe-area-inset-right/.test(css),'safe area');
ck(/overflow-x:auto/.test(css)&&/-webkit-overflow-scrolling:touch/.test(css),'touch horizontal scroll');
ck(/100dvh/.test(css),'mobile modal height');
if(fail)throw new Error('mobile layout failures: '+fail);
console.log('ALL PASS mobile layout: '+pages.length+' pages');
