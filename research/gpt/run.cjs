'use strict';
// Research-only launcher. No application engine, TLS verification or proxy setting changes.
// Default Playwright first; if its browser is missing, use the pinned official npm
// Chromium distribution. Tar ownership metadata is skipped for managed containers.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pipeline}=require('node:stream/promises'),zlib=require('node:zlib');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
let ready=null;
async function prepareChromium(){
  if(ready)return ready;
  const pw=require('playwright'),launch=pw.chromium.launch.bind(pw.chromium);
  let defaultFailure='';
  try{
    const b=await launch(),version=b.version();await b.close();
    return ready={source:'Playwright default',version};
  }catch(e){
    defaultFailure=e.message.split('\n')[0];
    if(!/Executable doesn't exist/i.test(e.message))throw e;
  }
  const root=process.env.JKQ_GPT_RUNTIME_ROOT||path.join(os.tmpdir(),'jkquant-gpt-runtime');
  const pkg=path.join(root,'node_modules','@sparticuz','chromium');
  fs.mkdirSync(root,{recursive:true});
  if(!fs.existsSync(path.join(pkg,'package.json'))){
    await exec('npm',['install','--prefix',root,'--no-save','--ignore-scripts','--no-audit','--no-fund','@sparticuz/chromium@138.0.2'],{maxBuffer:4*1024*1024});
  }
  const version=JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version;
  if(version!=='138.0.2')throw Error('Unexpected Chromium package '+version);
  const bin=path.join(root,'chromium138'),marker=path.join(bin,'ready-138.0.2');
  fs.mkdirSync(bin,{recursive:true});
  if(!fs.existsSync(marker)||!fs.existsSync(path.join(bin,'chromium'))||!(fs.statSync(path.join(bin,'chromium')).size>0)){
    for(const name of ['chromium','swiftshader.tar','fonts.tar','al2023.tar']){
      const file=path.join(bin,name);
      await pipeline(fs.createReadStream(path.join(pkg,'bin',name+'.br')),zlib.createBrotliDecompress(),fs.createWriteStream(file));
      if(name==='chromium')fs.chmodSync(file,0o755);
      else{
        const dest=name==='swiftshader.tar'?bin:path.join(bin,name.slice(0,-4));
        fs.mkdirSync(dest,{recursive:true});
        await exec('tar',['--no-same-owner','--no-same-permissions','-xf',file,'-C',dest]);
      }
    }
    fs.writeFileSync(marker,version+'\n');
  }
  const executablePath=path.join(bin,'chromium');
  const options=opt=>({...opt,executablePath,env:{...process.env,...opt.env,
    LD_LIBRARY_PATH:path.join(bin,'al2023/lib')+':'+((opt.env||process.env).LD_LIBRARY_PATH||'')}});
  const b=await launch(options({})),browserVersion=b.version();
  try{const p=await b.newPage();await p.setContent('<title>JKQuant research environment</title>');
    if(await p.title()!=='JKQuant research environment')throw Error('Chromium page check failed');
  }finally{await b.close();}
  pw.chromium.launch=(opt={})=>launch(opt.executablePath?opt:options(opt));
  return ready={source:'@sparticuz/chromium@138.0.2',version:browserVersion,executablePath,defaultFailure};
}
module.exports={prepareChromium};
if(require.main===module)(async()=>{
  const info=await prepareChromium(),arg=process.argv[2];
  if(!arg||arg==='--environment'){console.log(JSON.stringify(info));return;}
  const target=path.resolve(arg),research=path.resolve(__dirname,'..')+path.sep;
  if(!target.startsWith(research))throw Error('Only research scripts may be launched');
  process.argv=[process.execPath,target,...process.argv.slice(3)];require(target);
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
