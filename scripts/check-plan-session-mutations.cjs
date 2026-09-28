const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'jkq-session-mutations-'));
const helper=fs.readFileSync(path.join(root,'plan-session-settings.js'),'utf8'),html=fs.readFileSync(path.join(root,'plan.html'),'utf8');
const cases=[
  ['lost-ledger','PLAN_SETTINGS_PATH',helper,'return x;','x.ledger=null;return x;'],
  ['lost-live-baseline','PLAN_SETTINGS_PATH',helper,'const restoring=x.paper&&!paper&&x.liveSettings;','const restoring=false;'],
  ['late-save','PLAN_HTML_PATH',html,"if(revision!==assetModalRevision||horizon!==activeHorizon||$('assetSessionModal').hidden)return;",''],
];
try{
  for(const [name,key,source,from,to] of cases){
    assert(source.includes(from),name+' mutation target');
    const file=path.join(temp,name+(key==='PLAN_HTML_PATH'?'.html':'.cjs'));fs.writeFileSync(file,source.replace(from,to));
    const r=spawnSync(process.execPath,[path.join(__dirname,'check-plan-session-settings.cjs')],{encoding:'utf8',env:{...process.env,[key]:file}});
    assert.equal(r.status,1,name+' must fail assertions');assert.match(r.stderr,/AssertionError/,name+' must fail a value assertion');
    console.log('PASS mutation caught: '+name);
  }
}finally{for(const file of fs.readdirSync(temp))fs.unlinkSync(path.join(temp,file));fs.rmdirSync(temp);}
