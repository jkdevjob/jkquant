export const DEFAULT_CONFIG={name:'기본 라운드',mode:'round',prepare:30,blocks:[{id:'work',label:'운동',seconds:60,kind:'work'},{id:'rest',label:'휴식',seconds:0,kind:'rest'}],rounds:20,cooldown:30,skipLastRest:false};
export function normalizeConfig(value={}){
  const integer=(v,def,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Math.round(Number(v)))):def;
  let blocks=Array.isArray(value.blocks)?value.blocks.slice(0,12).map((b,i)=>({id:'block-'+i,label:String(b.label||'운동').slice(0,40),seconds:integer(b.seconds,0,0,3599),kind:b.kind==='rest'?'rest':'work'})):structuredClone(DEFAULT_CONFIG.blocks);
  if(!blocks.length)blocks=structuredClone(DEFAULT_CONFIG.blocks);
  if(!blocks.some(b=>b.seconds>0&&b.kind==='work'))blocks[0]={...blocks[0],kind:'work',seconds:60};
  return {name:String(value.name||'나의 운동').slice(0,50),mode:value.mode==='tabata'?'tabata':'round',prepare:integer(value.prepare,30,0,3599),blocks,rounds:integer(value.rounds,20,1,999),cooldown:integer(value.cooldown,30,0,3599),skipLastRest:value.skipLastRest===true};
}
export function buildTimeline(config) {
  const plan=[]; let end=0;
  const add=(label,seconds,kind,round,blockId)=>{
    const duration=Math.max(0,Math.round(Number(seconds)||0))*1000;
    if(!duration)return;
    plan.push({label,kind,round,blockId,duration,start:end,end:end+duration}); end+=duration;
  };
  add('준비',config.prepare,'prepare',0,'prepare');
  for(let round=1;round<=config.rounds;round++){
    for(const b of config.blocks){
      if(config.skipLastRest&&round===config.rounds&&b.kind==='rest')continue;
      add(b.label,b.seconds,b.kind,round,b.id);
    }
  }
  add('쿨다운',config.cooldown,'cooldown',config.rounds,'cooldown');
  return {segments:plan,total:end};
}
export function locate(plan,elapsed) {
  const time=Math.max(0,elapsed);
  const index=plan.segments.findIndex(s=>time<s.end);
  if(index<0)return {index:plan.segments.length,segment:null,remaining:0,progress:1};
  const segment=plan.segments[index];
  return {index,segment,remaining:segment.end-time,progress:Math.max(0,(time-segment.start)/segment.duration)};
}
export class TimerEngine {
  constructor(config,now=()=>Date.now()){this.now=now;this.configure(config);}
  configure(config){this.config=structuredClone(config);this.plan=buildTimeline(config);this.status='idle';this.base=0;this.anchor=0;this.skipped=0;this.skipCount=0;}
  elapsed(now=this.now()){return Math.min(this.plan.total,Math.max(0,this.base+(this.status==='running'?now-this.anchor:0)));}
  start(){if(this.status==='running')return;if(this.status==='finished')this.reset();if(!this.plan.total)return;this.anchor=this.now();this.status='running';}
  pause(){if(this.status!=='running')return;this.base=this.elapsed();this.status=this.base>=this.plan.total?'finished':'paused';}
  reset(){this.status='idle';this.base=0;this.anchor=0;this.skipped=0;this.skipCount=0;}
  skip(){if(!['running','paused'].includes(this.status))return;const snap=this.snapshot();if(!snap.segment)return;this.skipped+=snap.remaining;this.skipCount++;this.base=snap.segment.end;this.anchor=this.now();if(this.base>=this.plan.total)this.status='finished';}
  snapshot(){const elapsed=this.elapsed();if(this.plan.total&&elapsed>=this.plan.total&&this.status!=='idle'){this.base=this.plan.total;this.status='finished';}return {...locate(this.plan,elapsed),elapsed,activeMs:Math.max(0,elapsed-this.skipped),skipCount:this.skipCount,total:this.plan.total,status:this.status};}
  serialize(){return {config:this.config,status:this.status,base:this.base,anchor:this.anchor,skipped:this.skipped,skipCount:this.skipCount};}
  restore(saved){this.configure(saved.config);this.base=Math.min(this.plan.total,Math.max(0,Number(saved.base)||0));this.anchor=Number(saved.anchor)||this.now();this.skipped=Math.max(0,Number(saved.skipped)||0);this.skipCount=Math.max(0,Number(saved.skipCount)||0);this.status=['running','paused','finished'].includes(saved.status)?saved.status:'idle';this.snapshot();}
}
