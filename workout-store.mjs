// Account-scoped persistence. A late response cannot publish another account's data.
export function createWorkoutStore({readState,writeState,readHistory,writeHistory,notify=()=>{}}){
  let uid=null,generation=0,ready=false,revision=0,data={},queue=Promise.resolve();
  const stale=()=>Object.assign(new Error('로그인 계정이 바뀌었습니다.'),{code:'stale_account'});
  const current=(who,token)=>who===uid&&token===generation;
  function close(nextUid=null){generation++;uid=nextUid;ready=false;revision=0;data={};queue=Promise.resolve();notify({state:uid?'loading':'signedout',uid});}
  async function open(who){close(who);const token=generation;try{const [loaded,history]=await Promise.all([readState(who),readHistory(who)]);if(!current(who,token))return;data=loaded||{};revision=Number(data.revision)||0;ready=true;notify({state:'ready',uid,data,history});return data;}catch(error){if(current(who,token)){ready=false;notify({state:'error',uid,error});}throw error;}}
  function save(patch){const who=uid,token=generation;if(!who||!ready)return Promise.reject(new Error('운동 설정을 먼저 불러오세요.'));const clean={};for(const key of ['config','routines','settings'])if(Object.hasOwn(patch,key))clean[key]=structuredClone(patch[key]);
    const task=queue.catch(()=>{}).then(async()=>{if(!current(who,token))throw stale();if(!ready)throw new Error('설정을 다시 불러오세요.');try{const result=await writeState(who,clean,revision);if(!current(who,token))throw stale();revision=result.revision;data={...data,...clean,revision};return result;}catch(error){if(current(who,token)&&error.code==='conflict')ready=false;throw error;}});queue=task;return task;
  }
  async function saveHistory(record){const who=uid,token=generation;if(!who||!ready)throw new Error('연결 후 기록을 다시 저장하세요.');if(!record?.id)throw new Error('운동 기록 ID가 없습니다.');await writeHistory(who,structuredClone(record));if(!current(who,token))throw stale();}
  return {get ready(){return ready;},get uid(){return uid;},open,close,save,saveHistory,reload(){if(uid)return open(uid);}};
}
