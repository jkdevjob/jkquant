import {TimerEngine,DEFAULT_CONFIG,normalizeConfig,buildTimeline} from './workout-engine.mjs?v=1.0.0';
import {WorkoutAudio} from './workout-audio.mjs?v=1.0.0';

const $=id=>document.getElementById(id);
const icons={
 timer:'<circle cx="12" cy="14" r="8"/><path d="M12 10v4l2 2M9 2h6M12 2v4m6 2 2-2"/>',
 repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
 bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
 volume:'<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 mute:'<path d="m11 5-6 4H2v6h3l6 4zM17 9l5 6m0-6-5 6"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.7-1.5 1-1.5 2M12 16h.01"/>',
 play:'<path d="m8 4 12 8-12 8z"/>',pause:'<path d="M8 5v14M16 5v14"/>',
 reset:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',skip:'<path d="m5 5 10 7-10 7zM19 5v14"/>',
 expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 shrink:'<path d="M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',plus:'<path d="M12 5v14M5 12h14"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',screen:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 settings:'<path d="m9 3-1 3-3 1-2 3 2 3-1 3 3 3h3l2 2 3-2h3l2-3-1-3 2-3-2-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
 chart:'<path d="M4 3v18h17M9 16v-4m5 4V8m5 8V5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L20 5"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'
};
const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.timer}</svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const duration=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return `${pad(Math.floor(s/60))}:${pad(s%60)}`;};
const swTime=ms=>`${duration(Math.floor(ms/1000)*1000)}.${pad(Math.floor(ms/10)%100)}`;
const clone=x=>structuredClone(x);
const newId=()=>window.crypto?.randomUUID?.()||'wt-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
const presets=[
 {...clone(DEFAULT_CONFIG),name:'기본 라운드',description:'운동 1분 · 20라운드',icon:'repeat'},
 {...clone(DEFAULT_CONFIG),name:'타바타 20:10',description:'운동 20초 · 휴식 10초',icon:'bolt',mode:'tabata',prepare:10,rounds:8,cooldown:30,blocks:[{id:'work',label:'운동',seconds:20,kind:'work'},{id:'rest',label:'휴식',seconds:10,kind:'rest'}],skipLastRest:true},
 {...clone(DEFAULT_CONFIG),name:'스트레칭 30:15',description:'운동 30초 · 휴식 15초',icon:'timer',prepare:10,rounds:6,cooldown:20,blocks:[{id:'work',label:'스트레칭',seconds:30,kind:'work'},{id:'rest',label:'휴식',seconds:15,kind:'rest'}]}
];
let config=clone(DEFAULT_CONFIG),engine=new TimerEngine(config),mode='round',view='timer';
let settings={sound:true,countdown:true,voice:false,haptic:false,wake:true},routines=[],history=[],accountReady=false,currentUid=null;
let toastTimeout,editorAction=null,confirmAction=null,wakeLock=null,lastCue='',lastIndex=-1,justStarted=false;
let sessionId=null,sessionStarted=0,finishedId=null,pendingHistory=null;
let sw={running:false,base:0,anchor:0,laps:[]},saveTimer=null,unsavedConfig=false,autoSaveInFlight=false;
const store=()=>window.JKWorkoutStorage;
const soundPlayer=new WorkoutAudio(window,message=>toast(message));

function mountIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=svg(el.dataset.icon));}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function syncLabel(state,text){$('sync-status').dataset.state=state;$('sync-status').textContent=text;}
function syncError(e){syncLabel('error',e?.code==='conflict'?'다른 화면에서 설정 변경됨 · 눌러서 새로 불러오기':'저장 확인 필요 · 눌러서 다시 연결');toast(e?.code==='conflict'?'다른 화면에서 설정을 바꿨습니다. 새로 불러온 뒤 수정해 주세요.':'저장하지 못했습니다. 연결 상태를 확인해 주세요.');}
function active(){return mode==='stopwatch'?sw.running||sw.base>0:['running','paused'].includes(engine.status);}
function editAllowed(){if(active()){toast('진행 중인 운동을 초기화한 뒤 구성을 바꿀 수 있어요.');return false;}return true;}
function needAccount(){if(!accountReady){toast('로그인과 운동 설정을 확인하는 중입니다.');return false;}return true;}
function confirm(title,description,label,action){confirmAction=action;$('confirm-title').textContent=title;$('confirm-description').textContent=description;$('confirm-yes').textContent=label;$('confirm-dialog').showModal();}
function switchView(next){view=['timer','routines','history','settings'].includes(next)?next:'timer';document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));if(view==='routines')renderRoutines();if(view==='history')renderHistory();if(view==='settings')renderSettings();location.hash=view;window.scrollTo({top:0,behavior:'instant'});}
function setMode(next){if(next===mode)return;const change=()=>{reset();mode=next;if(next!=='stopwatch'){config=normalizeConfig(next==='tabata'?presets[1]:config.mode==='tabata'?presets[0]:config);engine.configure(config);scheduleSave();}renderAll();};if(active())confirm('타이머를 바꿀까요?','진행 중인 타이머가 초기화됩니다.','변경',change);else change();}

function initAudio(options){soundPlayer.configure(settings);void soundPlayer.unlockFromGesture(options);}
function beep(type='phase'){soundPlayer.configure(settings);return soundPlayer.boundary(type);}
function announce(text){soundPlayer.announce(text);$('live-phase').textContent=text;if(settings.haptic&&navigator.vibrate)navigator.vibrate(100);}
async function acquireWake(){if(!settings.wake||!('wakeLock'in navigator)||document.visibilityState!=='visible'||(!sw.running&&engine.status!=='running'))return;try{if(!wakeLock||wakeLock.released){const lock=await navigator.wakeLock.request('screen');if(!settings.wake||(!sw.running&&engine.status!=='running')){await lock.release();return;}wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;updateWakeLabel();});}updateWakeLabel();}catch{updateWakeLabel('화면 켜짐 유지 불가');}}
function releaseWake(){try{wakeLock?.release();}catch{}wakeLock=null;updateWakeLabel();}
function updateWakeLabel(error){$('wake-indicator').innerHTML=svg('screen')+' '+esc(error||(!settings.wake?'화면 유지 꺼짐':!('wakeLock'in navigator)?'화면 유지 미지원':wakeLock?'화면 켜짐 유지 중':'화면 켜짐 유지'));}

async function savePatch(patch){if(!store()?.ready)throw new Error('not_ready');const uid=currentUid;syncLabel('loading','계정에 저장하는 중…');await store().save(patch);if(uid!==currentUid)throw Object.assign(new Error('계정 변경'),{code:'stale_account'});syncLabel('ready','계정에 저장됨');}
function scheduleSave(){unsavedConfig=true;clearTimeout(saveTimer);saveTimer=setTimeout(flushConfig,500);}
async function flushConfig(){if(!unsavedConfig||autoSaveInFlight||!store()?.ready)return;const next=clone(config);unsavedConfig=false;autoSaveInFlight=true;try{await savePatch({config:next});}catch(e){unsavedConfig=true;syncError(e);}finally{autoSaveInFlight=false;if(unsavedConfig&&JSON.stringify(next)!==JSON.stringify(config))scheduleSave();}}
function applyConfig(next){config=normalizeConfig(next);mode=config.mode;engine.configure(config);finishedId=null;sessionId=null;renderAll();scheduleSave();}
function row(label,description,value,kind,key){return `<div class="config-row" style="--row:var(--${kind})"><span class="dot"></span><div class="row-copy"><strong>${esc(label)}</strong><small>${esc(description)}</small></div><button class="row-value" data-edit="${esc(key)}" aria-label="${esc(label)} 설정">${esc(value)}${svg('chevron')}</button></div>`;}
function renderConfig(){const colors={prepare:'prepare',rounds:'cooldown',cooldown:'cooldown'};let html=row('준비','시작하기 전 카운트다운',duration(config.prepare*1000),'prepare','prepare');for(const b of config.blocks)html+=row(b.label,b.kind==='rest'?'다음 라운드 전 쉬는 시간':'내 페이스로 운동하기',duration(b.seconds*1000),b.kind,b.id);html+=row('라운드','운동 + 휴식을 반복해요',String(config.rounds),'cooldown','rounds');html+=row('쿨다운','운동이 끝나면 천천히 마무리',duration(config.cooldown*1000),'cooldown','cooldown');$('config-rows').innerHTML=html;$('skip-last-rest').checked=config.skipLastRest;$('config-summary').textContent=`${config.rounds}라운드 · ${config.blocks.map(b=>b.label).join(' + ')} · 총 ${duration(engine.plan.total)}`;$('add-block-btn').disabled=config.blocks.length>=12;}
function renderAll(){document.body.classList.toggle('stopwatch-mode',mode==='stopwatch');document.querySelectorAll('[data-mode]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.mode===mode)));$('config-panel').hidden=mode==='stopwatch';$('stopwatch-panel').hidden=mode!=='stopwatch';if(mode!=='stopwatch')renderConfig();renderLaps();renderSettings();renderSound();renderTick();}
function renderSound(){soundPlayer.configure(settings);$('sound-toggle').innerHTML=svg(settings.sound?'volume':'mute');$('sound-toggle').setAttribute('aria-label',settings.sound?'소리 끄기':'소리 켜기');$('sound-toggle').setAttribute('aria-pressed',String(settings.sound));}
function renderTick(){
  if(mode==='stopwatch'){renderStopwatch();return;}
  const s=engine.snapshot(),segment=s.segment,finished=s.status==='finished',running=s.status==='running';
  const label=finished?'운동 완료':s.status==='idle'?'시작 준비':s.status==='paused'?'일시정지':segment?.label||'운동';
  $('timer-card').style.setProperty('--phase',finished?'var(--accent)':`var(--${segment?.kind||'work'})`);
  $('phase-label').textContent=label;$('time-display').textContent=duration(s.remaining);
  $('round-display').innerHTML=`ROUND <strong>${pad(finished?config.rounds:segment?.round||0)}</strong><span>/ ${config.rounds}</span>`;
  $('status-pill').querySelector('span').textContent=finished?'COMPLETE':running?'IN PROGRESS':s.status==='paused'?'PAUSED':'READY';
  $('ring-progress').style.strokeDashoffset=String(904.78*(finished?1:s.progress));
  const next=engine.plan.segments[s.index+1];$('next-phase').innerHTML=`<span class="tiny-dot"></span><span>${finished?'멋지게 해냈어요.':next?`다음 <b>${esc(next.label)} · ${duration(next.duration)}</b>`:'마지막 구간입니다.'}</span>`;
  $('start-btn').innerHTML=svg(running?'pause':'play')+`<span>${running?'일시정지':s.status==='paused'?'계속하기':finished?'다시 시작':'운동 시작'}</span>`;
  $('skip-btn').disabled=!['running','paused'].includes(s.status);$('skip-btn').setAttribute('aria-label','다음 구간으로 건너뛰기');$('skip-btn').innerHTML=svg('skip');
  $('total-caption').textContent=s.status==='idle'?'총 운동 시간':'전체 남은 시간';$('total-display').textContent=duration(s.status==='idle'?s.total:s.total-s.elapsed);$('overall-progress').style.width=(s.total?s.elapsed/s.total*100:0)+'%';
  $('config-panel').classList.toggle('locked',['running','paused'].includes(s.status));
  if(running&&document.visibilityState==='visible'){
    const second=Math.ceil(s.remaining/1000),cue=`${s.index}:${second}`;
    if(s.index!==lastIndex){lastIndex=s.index;if(!justStarted){beep('phase');announce(segment.label);}justStarted=false;}
    if(second>0&&second<=5&&cue!==lastCue){lastCue=cue;soundPlayer.countdown(second,cue);}
  }
  if(finished&&sessionId&&finishedId!==sessionId)finish(s);
}
function swElapsed(){return sw.base+(sw.running?Date.now()-sw.anchor:0);}
function renderStopwatch(){const elapsed=swElapsed();$('timer-card').style.setProperty('--phase','var(--accent)');$('phase-label').textContent=sw.running?'페이스를 이어가세요':sw.base?'일시정지':'시작 준비';$('time-display').textContent=swTime(elapsed);$('round-display').innerHTML=`${sw.laps.length}개의 랩 기록`;$('ring-progress').style.strokeDashoffset=String(904.78*((elapsed%60000)/60000));$('status-pill').querySelector('span').textContent=sw.running?'IN PROGRESS':sw.base?'PAUSED':'READY';$('next-phase').innerHTML='<span class="tiny-dot"></span><span>나만의 속도로, 자유롭게.</span>';$('start-btn').innerHTML=svg(sw.running?'pause':'play')+`<span>${sw.running?'일시정지':sw.base?'계속하기':'측정 시작'}</span>`;$('skip-btn').disabled=!sw.running||sw.laps.length>=200;$('skip-btn').innerHTML=svg('plus');$('skip-btn').setAttribute('aria-label','랩 기록');$('total-caption').textContent='총 경과 시간';$('total-display').textContent=duration(Math.floor(elapsed/1000)*1000);$('overall-progress').style.width='0%';}
function renderLaps(){$('lap-count').textContent=sw.laps.length+'개';if(!sw.laps.length){$('lap-list').innerHTML=`<div class="empty-small">${svg('timer')}<p>움직임의 순간을 기록하세요.</p><span>시작 후 랩 버튼을 누르면 기록됩니다.</span></div>`;return;}$('lap-list').innerHTML=sw.laps.map((lap,i)=>`<div class="lap-row"><span>랩 ${pad(i+1)}</span><strong>${swTime(lap-(sw.laps[i-1]||0))}</strong><small>${swTime(lap)}</small></div>`).reverse().join('');}
function reset(){engine.reset();sw={running:false,base:0,anchor:0,laps:[]};sessionId=null;finishedId=null;lastIndex=-1;lastCue='';releaseWake();soundPlayer.reset();renderAll();}
function toggleStart(){
 if(!needAccount())return;
 if(mode==='stopwatch'){
  if(sw.running){sw.base=swElapsed();sw.running=false;releaseWake();soundPlayer.stop();}
  else{soundPlayer.stop();initAudio();sw.anchor=Date.now();sw.running=true;acquireWake();}
  renderTick();return;
 }
 if(engine.status==='running'){engine.pause();releaseWake();soundPlayer.stop();}
 else{
  if(engine.status==='idle'||engine.status==='finished'){sessionId=newId();sessionStarted=Date.now();finishedId=null;lastIndex=-1;lastCue='';justStarted=true;soundPlayer.reset();}
  else soundPlayer.stop();
  initAudio();engine.start();acquireWake();const snapshot=engine.snapshot();if(snapshot.segment)announce(snapshot.segment.label);
 }
 renderTick();
}
async function finish(s){finishedId=sessionId;releaseWake();beep('done');announce('운동 완료. 수고하셨습니다.');pendingHistory={id:sessionId,name:config.name,mode:config.mode,rounds:config.rounds,plannedMs:s.total,activeMs:Math.round(s.activeMs),skipCount:s.skipCount,startedAt:sessionStarted,completedAt:Date.now()};$('done-summary').textContent=`${config.rounds}라운드 · 실제 진행 ${duration(s.activeMs)}${s.skipCount?' · 구간 건너뛰기 '+s.skipCount+'회':''}`;$('done-saved').textContent='운동 기록을 저장하는 중…';$('retry-history').hidden=true;const open=()=>{if(!$('done-dialog').open)$('done-dialog').showModal();};if($('confirm-dialog').open)$('confirm-dialog').close();if($('editor-dialog').open)$('editor-dialog').close();open();await saveHistory();}
async function saveHistory(){if(!pendingHistory)return;const record=clone(pendingHistory),uid=currentUid;$('retry-history').hidden=true;try{await store().saveHistory(record);if(uid!==currentUid)return;if(!history.some(h=>h.id===record.id))history.unshift(record);pendingHistory=null;$('done-saved').textContent='JK 계정에 운동 기록을 저장했습니다.';}catch{if(uid!==currentUid)return;$('done-saved').textContent='기록 저장 실패 · 연결 후 다시 저장해 주세요.';$('retry-history').hidden=false;}if(view==='history')renderHistory();}

function editor(title,fields,action){if(!needAccount())return;editorAction=action;$('editor-title').textContent=title;$('editor-fields').innerHTML=fields;$('editor-dialog').showModal();setTimeout(()=>$('editor-fields').querySelector('input')?.focus(),30);}
function editField(key){if(!editAllowed())return;const block=config.blocks.find(b=>b.id===key),rounds=key==='rounds',value=rounds?config.rounds:block?block.seconds:config[key];const title=rounds?'라운드 횟수':block?block.label+' 설정':key==='prepare'?'준비 시간':'쿨다운 시간';const fields=rounds?`<label class="field-label" for="edit-count">반복 횟수</label><input id="edit-count" class="field-input" type="number" min="1" max="999" inputmode="numeric" value="${value}" required>`:`${block?`<label class="field-label" for="edit-name">구간 이름</label><input class="field-input" id="edit-name" maxlength="40" value="${esc(block.label)}" required>`:''}<div class="time-inputs"><label><input id="edit-minutes" aria-label="분" type="number" inputmode="numeric" min="0" max="59" value="${Math.floor(value/60)}" required><small>분</small></label><span>:</span><label><input id="edit-seconds" aria-label="초" type="number" inputmode="numeric" min="0" max="59" value="${value%60}" required><small>초</small></label></div><p class="editor-note">0초로 설정한 구간은 자동으로 건너뜁니다.</p>${block&&config.blocks.length>2?'<button class="delete-block" id="delete-block" type="button">이 구간 삭제</button>':''}`;editor(title,fields,()=>{const next=clone(config);if(rounds)next.rounds=Number($('edit-count').value);else{const seconds=Number($('edit-minutes').value)*60+Number($('edit-seconds').value);if(block){const b=next.blocks.find(b=>b.id===key);b.seconds=seconds;b.label=$('edit-name').value.trim()||block.label;if(!next.blocks.some(b=>b.kind==='work'&&b.seconds>0)){toast('운동 구간은 한 개 이상, 1초 이상이어야 해요.');return false;}}else next[key]=seconds;}applyConfig(next);});$('delete-block')?.addEventListener('click',()=>{const next=clone(config);next.blocks=next.blocks.filter(b=>b.id!==key);if(!next.blocks.some(b=>b.kind==='work'&&b.seconds>0)){toast('시간이 설정된 운동 구간을 하나 이상 남겨 주세요.');return;}applyConfig(next);$('editor-dialog').close();});}
function addBlock(){if(!editAllowed()||config.blocks.length>=12)return;editor('새 구간 추가','<label class="field-label" for="edit-name">구간 이름</label><input class="field-input" id="edit-name" placeholder="예: 가볍게 걷기" maxlength="40" required><div class="time-inputs"><label><input id="edit-minutes" aria-label="분" type="number" inputmode="numeric" min="0" max="59" value="0" required><small>분</small></label><span>:</span><label><input id="edit-seconds" aria-label="초" type="number" inputmode="numeric" min="0" max="59" value="30" required><small>초</small></label></div><p class="editor-note">각 라운드에서 휴식 전에 실행됩니다. 최대 12구간까지 추가할 수 있어요.</p>',()=>{const seconds=Number($('edit-minutes').value)*60+Number($('edit-seconds').value);if(seconds<=0){toast('1초 이상으로 설정해 주세요.');return false;}const next=clone(config),index=next.blocks.findIndex(b=>b.kind==='rest');next.blocks.splice(index<0?next.blocks.length:index,0,{id:newId(),label:$('edit-name').value.trim(),seconds,kind:'work'});applyConfig(next);});}
function saveRoutine(){if(mode==='stopwatch'){toast('라운드 또는 타바타 운동을 저장할 수 있어요.');return;}editor('내 운동에 저장',`<label class="field-label" for="routine-name">운동 이름</label><input class="field-input" id="routine-name" maxlength="50" value="${esc(config.name)}" required><p class="editor-note">${config.rounds}라운드 · 총 ${duration(engine.plan.total)}<br>같은 이름은 기존 운동을 업데이트합니다.</p>`,async()=>{const name=$('routine-name').value.trim();if(!name)return false;const next=clone(routines),existing=next.find(r=>r.name===name),saved={id:existing?.id||newId(),...clone(config),name};if(existing)next[next.indexOf(existing)]=saved;else{if(next.length>=50){toast('운동은 최대 50개까지 저장할 수 있어요.');return false;}next.push(saved);}try{await savePatch({routines:next});routines=next;config.name=name;engine.config.name=name;scheduleSave();toast('내 운동에 저장했습니다.');renderRoutines();}catch(e){syncError(e);return false;}});}
function loadRoutine(routine){const load=()=>{reset();applyConfig(routine);switchView('timer');toast(`${routine.name}을 불러왔습니다.`);};if(active())confirm('운동을 불러올까요?','진행 중인 타이머가 초기화됩니다.','불러오기',load);else load();}
function renderRoutines(){if(!routines.length){$('routines-list').innerHTML=`<div class="empty-state" style="grid-column:1/-1">${svg('bookmark')}<h2>나만의 루틴을 만들어 보세요.</h2><p>타이머에서 운동을 구성한 뒤 저장하면 여기에 모입니다.</p><button class="button-primary" data-open-timer>운동 구성하기</button></div>`;return;}$('routines-list').innerHTML=routines.map(r=>`<article class="routine-card"><div class="routine-card-top">${svg(r.mode==='tabata'?'bolt':'repeat')}<button class="icon-btn" data-delete-routine="${esc(r.id)}" aria-label="${esc(r.name)} 삭제">${svg('trash')}</button></div><h3>${esc(r.name)}</h3><p>${r.rounds}라운드 · 총 ${duration(buildTimeline(r).total)}</p><div class="routine-card-actions"><button class="button-primary" data-load-routine="${esc(r.id)}">불러오기 ${svg('chevron')}</button></div></article>`).join('');}
function renderHistory(){const activeMinutes=Math.floor(history.reduce((n,h)=>n+(h.activeMs||0),0)/60000),rounds=history.reduce((n,h)=>n+(h.rounds||0),0);$('history-stats').innerHTML=`<div class="stat-card"><span>저장된 운동</span><strong>${history.length}<small>회</small></strong></div><div class="stat-card"><span>누적 진행 시간</span><strong>${activeMinutes}<small>분</small></strong></div><div class="stat-card"><span>완료 라운드</span><strong>${rounds}<small>회</small></strong></div>`;if(!history.length){$('history-list').innerHTML=`<div class="empty-state">${svg('chart')}<h2>첫 라운드를 기다리고 있어요.</h2><p>라운드·타바타 운동을 완료하면 기록이 남습니다.</p><button class="button-primary" data-open-timer>타이머로 가기</button></div>`;return;}$('history-list').innerHTML=history.map(h=>`<article class="history-row"><span class="history-icon">${svg('check')}</span><div><h3>${esc(h.name)}</h3><p>${esc(new Date(h.completedAt).toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}))} · ${h.rounds}라운드${h.skipCount?' · 건너뛰기 '+h.skipCount+'회':''}</p></div><strong>${duration(h.activeMs)}</strong></article>`).join('')+'<p class="subtle" style="text-align:center;margin-top:18px">최근 100개 기록 기준 · 구간 건너뛰기 시간과 일시정지는 진행 시간에서 제외</p>';}
function renderSettings(){const options=[['sound','알림 소리','음성 카운트다운과 구간 전환 비프음을 켭니다.',true],['countdown','5초 음성 카운트다운','오 · 사 · 삼 · 이 · 일 → 구간이 끝나면 삐—', 'speechSynthesis'in window],['voice','구간 이름 음성 안내','구간 이름과 운동 완료를 읽어 줍니다.','speechSynthesis'in window],['haptic','진동 알림','지원하는 기기에서 구간 전환을 진동으로 알려 줍니다.',!!navigator.vibrate],['wake','화면 켜짐 유지','운동 중 화면이 꺼지지 않도록 요청합니다.','wakeLock'in navigator]];$('settings-rows').innerHTML=options.map(([key,label,desc,supported])=>`<div class="settings-row"><div class="settings-copy"><strong>${label}</strong><p>${desc}${supported?'':' (현재 브라우저 미지원)'}</p></div><button class="switch" role="switch" aria-label="${label}" aria-checked="${settings[key]}" data-setting="${key}" ${supported?'':'disabled'}></button></div>`).join('');updateWakeLabel();}
async function toggleSetting(key){
 settings[key]=!settings[key];renderSettings();renderSound();
 if((key==='sound'||key==='countdown'||key==='voice')&&settings[key])initAudio();
 if(key==='wake'){if(settings.wake)acquireWake();else releaseWake();}
 if(key==='voice'&&!settings.voice)soundPlayer.stop();
 try{await savePatch({settings:clone(settings)});}catch(e){syncError(e);}
}

document.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>setMode(el.dataset.mode)));
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>switchView(el.dataset.view)));
$('start-btn').addEventListener('click',toggleStart);
$('reset-btn').addEventListener('click',()=>{if(active())confirm('타이머를 초기화할까요?','진행 중인 운동과 이번 랩 기록이 초기화됩니다.','초기화',reset);else reset();});
$('skip-btn').addEventListener('click',()=>{if(mode==='stopwatch'){if(sw.running&&sw.laps.length<200){sw.laps.push(swElapsed());renderLaps();}}else{engine.skip();renderTick();}});
$('focus-btn').addEventListener('click',()=>{const on=document.body.classList.toggle('focus-mode');$('focus-btn').innerHTML=svg(on?'shrink':'expand');$('focus-btn').setAttribute('aria-label',on?'집중 화면 닫기':'집중 화면 열기');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('focus-mode')){$('focus-btn').click();}});
$('sound-toggle').addEventListener('click',()=>toggleSetting('sound'));
$('help-btn').addEventListener('click',()=>$('help-dialog').showModal());['help-close','help-done'].forEach(id=>$(id).addEventListener('click',()=>$('help-dialog').close()));
['editor-close','editor-cancel'].forEach(id=>$(id).addEventListener('click',()=>$('editor-dialog').close()));
$('editor-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const result=await editorAction?.();if(result!==false)$('editor-dialog').close();}catch{toast('설정을 적용하지 못했습니다.');}finally{button.disabled=false;}});
$('confirm-no').addEventListener('click',()=>$('confirm-dialog').close());$('confirm-yes').addEventListener('click',()=>{const action=confirmAction;$('confirm-dialog').close();action?.();});
$('done-close').addEventListener('click',()=>$('done-dialog').close());$('retry-history').addEventListener('click',saveHistory);
$('config-rows').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)editField(b.dataset.edit);});
$('add-block-btn').addEventListener('click',addBlock);$('save-routine-btn').addEventListener('click',saveRoutine);
$('skip-last-rest').addEventListener('change',()=>{if(!editAllowed()){$('skip-last-rest').checked=config.skipLastRest;return;}applyConfig({...config,skipLastRest:$('skip-last-rest').checked});});
$('quick-routines').innerHTML=presets.map((p,i)=>`<button class="quick-card" data-preset="${i}"><span class="quick-icon">${svg(p.icon)}</span><span class="quick-copy"><strong>${esc(p.name)}</strong><span>${esc(p.description)}</span></span><span class="quick-duration">${duration(buildTimeline(p).total)}</span></button>`).join('');
$('quick-routines').addEventListener('click',e=>{const b=e.target.closest('[data-preset]');if(b&&needAccount())loadRoutine(presets[Number(b.dataset.preset)]);});
$('new-routine-btn').addEventListener('click',()=>loadRoutine(DEFAULT_CONFIG));
$('routines-list').addEventListener('click',e=>{const b=e.target.closest('[data-load-routine],[data-delete-routine]');if(!b)return;const id=b.dataset.loadRoutine||b.dataset.deleteRoutine,r=routines.find(r=>r.id===id);if(!r)return;if(b.dataset.loadRoutine)loadRoutine(r);else confirm('저장한 운동을 삭제할까요?',r.name,'삭제',async()=>{const next=routines.filter(r=>r.id!==id);try{await savePatch({routines:next});routines=next;renderRoutines();toast('운동을 삭제했습니다.');}catch(e){syncError(e);}});});
document.addEventListener('click',e=>{if(e.target.closest('[data-open-timer]'))switchView('timer');});
$('settings-rows').addEventListener('click',e=>{const b=e.target.closest('[data-setting]');if(b)toggleSetting(b.dataset.setting);});
$('test-sound-btn').addEventListener('click',()=>{if(!settings.sound){toast('알림 소리를 먼저 켜 주세요.');return;}if(active()){toast('운동을 초기화한 뒤 소리를 확인해 주세요.');return;}soundPlayer.configure(settings);soundPlayer.preview();toast('오 · 사 · 삼 · 이 · 일 · 삐— 소리를 확인해 보세요.');});
$('sync-status').addEventListener('click',async()=>{if(active()){toast('운동을 초기화한 뒤 설정을 다시 불러올 수 있어요.');return;}if(unsavedConfig&&store()?.ready){await flushConfig();return;}try{await store()?.reload?.();}catch{toast('연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}});
window.addEventListener('beforeunload',e=>{if(active()){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastIndex=engine.snapshot().index;lastCue=`${lastIndex}:${Math.ceil(engine.snapshot().remaining/1000)}`;renderTick();acquireWake();}else soundPlayer.stop();});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1)||'timer';if(next!==view)switchView(next);});
function receiveData(event){const data=event.detail;if(data.state==='signedout'||data.state==='loading'){if(currentUid!==data.uid){reset();config=clone(DEFAULT_CONFIG);engine.configure(config);settings={sound:true,countdown:true,voice:false,haptic:false,wake:true};routines=[];history=[];pendingHistory=null;currentUid=data.uid;accountReady=false;unsavedConfig=false;clearTimeout(saveTimer);for(const d of document.querySelectorAll('dialog[open]'))d.close();renderAll();}syncLabel('loading',data.state==='signedout'?'로그인 후 운동을 사용할 수 있어요.':'운동 설정을 불러오는 중…');return;}if(data.uid!==currentUid&&currentUid!==null)return;if(data.state==='error'){accountReady=true;syncLabel('error','설정 불러오기 실패 · 눌러서 다시 연결');return;}if(data.state==='ready'){currentUid=data.uid;accountReady=true;config=normalizeConfig(data.data?.config||DEFAULT_CONFIG);engine.configure(config);mode=config.mode;settings={...settings,...data.data?.settings};routines=(data.data?.routines||[]).slice(0,50).map(r=>({...normalizeConfig(r),id:String(r.id||newId())}));history=data.history||[];unsavedConfig=false;syncLabel('ready','JK 계정에 연결됨 · 변경 시 자동 저장');renderAll();if(view==='routines')renderRoutines();if(view==='history')renderHistory();}}
window.addEventListener('jk-workout-data',receiveData);
mountIcons();renderAll();switchView(location.hash.slice(1)||'timer');
if(window.JKWorkoutContext)receiveData({detail:window.JKWorkoutContext});
setInterval(()=>{if(view==='timer'||engine.status==='running'||sw.running)renderTick();},50);
