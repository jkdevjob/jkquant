'use strict';
// Read-only adapter for an authenticated GitHub tree/commit fast-forward.
// Prints JSON chunks; does not push, reset, edit files, or handle credentials.
const {execFileSync}=require('node:child_process');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:8*1024*1024}).trimEnd();
if(git('branch','--show-current')!=='research/daily')throw Error('Research branch required');
const parent=git('rev-parse','origin/research/daily'),baseTree=git('rev-parse',parent+'^{tree}'),tree=git('rev-parse','HEAD^{tree}'),main=git('rev-parse','origin/main');
const changes=git('diff','--name-status','-z',parent,'HEAD').split('\0').filter(Boolean),entries=[];
for(let i=0;i<changes.length;i+=2){const status=changes[i],p=changes[i+1];if(!p||status.startsWith('R'))throw Error('Unsupported change');
 const own=p.startsWith('research/gpt/')||['research/im_plan/RESEARCH_LOG_GPT.md','research/im_plan/REPLICATION.md'].includes(p);
 if(status==='D'){if(!own)throw Error('Unexpected deletion');entries.push({path:p,mode:'100644',type:'blob',sha:null});continue;}
 const mode=git('ls-tree','HEAD','--',p).split(' ')[0];
 entries.push(own?{path:p,mode,type:'blob',content:execFileSync('git',['show','HEAD:'+p],{encoding:'utf8',maxBuffer:4*1024*1024})}:{path:p,mode,type:'blob',sha:git('rev-parse','HEAD:'+p)});
}
const value=JSON.stringify({parent,baseTree,tree,main,entries}),size=12000;
if(process.argv[2]==='meta')console.log(JSON.stringify({parent,baseTree,tree,main,length:value.length,chunks:Math.ceil(value.length/size),paths:entries.map(x=>x.path)}));
else{const n=+process.argv[2];if(!Number.isInteger(n)||n<0)throw Error('Chunk index required');process.stdout.write(JSON.stringify(value.slice(n*size,(n+1)*size)));}
