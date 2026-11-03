#!/usr/bin/env node
'use strict';
/* QA only: verify deployed Cloudflare Pages HTML, not just GitHub source. */
const urls=['https://jkquant.pages.dev/','https://jkquant.pages.dev/paper'];
const expected=['function paperBuildMobileCards(root)','#paper_body .paper-mobile-view{display:block}','paperBuildMobileCards(body)'];
function versionOf(s){return (s.match(/id="appVerTop"[^>]*>(v\d+\.\d+\.\d+)/)||[])[1]||''}
function atLeast(v,min='3.113.1'){const a=v.replace(/^v/,'').split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}return true}
(async()=>{
 for(let attempt=1;attempt<=10;attempt++){
  const rows=[];
  for(const url of urls){
   try{
    const r=await fetch(url+(url.includes('?')?'&':'?')+'paperSmoke='+Date.now(),{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
    const html=await r.text();
    const version=versionOf(html),checks=expected.map(x=>html.includes(x));
    const valid=r.status===200&&atLeast(version)&&checks.every(Boolean);
    rows.push({url,status:r.status,version,checks,bytes:html.length,valid});
   }catch(e){rows.push({url,error:String(e),valid:false})}
  }
  console.log('PAGES_SMOKE '+JSON.stringify({attempt,rows}));
  if(rows.every(r=>r.valid)){console.log('PAGES_PAPER_MOBILE_DEPLOYED version>=3.113.1 homepage and /paper');return}
  if(attempt<10)await new Promise(resolve=>setTimeout(resolve,12000));
 }
 throw Error('Production Pages is not yet serving the updated mobile cards on both routes');
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
