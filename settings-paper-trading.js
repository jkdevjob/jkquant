// Research KIS mock orders. No local persistence; the server checks the same settings.
let PAPER_SETTINGS_DATA=null,PAPER_SETTINGS_BUSY=false,PAPER_SETTINGS_EPOCH=0,PAPER_SETTINGS_REQUEST=0,PAPER_SETTINGS_CONTROLLER=null;
const paperEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showSettingsTab(name){
 for(const tab of document.querySelectorAll('[data-settings-tab]')){const on=tab.dataset.settingsTab===name;tab.classList.toggle('on',on);tab.setAttribute('aria-selected',String(on));}
 for(const panel of document.querySelectorAll('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==name;
 if(name==='paper')loadPaperSettings();
}
function renderPaperSettings(j){
 const root=document.getElementById('paperTradingSettings');if(!root)return;
 PAPER_SETTINGS_DATA=j;
 root.innerHTML=(j.globalStopped?'<p class="note">전역 모의주문 중지 상태입니다. 개별 설정을 켜도 주문하지 않습니다.</p>':'')+
  '<div class="alert-list">'+j.strategies.map(s=>{const x=j.settings.strategies[s.id],id=paperEscape(s.id);return '<div class="alert-item"><div class="alert-top"><div><div class="alert-name">'+paperEscape(s.label)+'</div><div class="alert-desc">'+(s.supported?'한투 모의계좌 주문 · OFF는 매수·매도 주문 중지':'한투 주문 미연결 · 서버 연구용 모의기록')+'</div></div><span class="badge '+(x.enabled?'on':'')+'">'+(x.enabled?'ON':'OFF')+'</span></div>'+
  '<div class="paper-controls"><label><input type="checkbox" id="paper_enabled_'+id+'" '+(x.enabled?'checked ':'')+(!s.supported?'disabled ':'')+'> 한투 모의주문</label><label>종목당 주문 예산(원) <input type="number" id="paper_budget_'+id+'" min="10000" max="100000000" step="10000" value="'+Number(x.budget)+'" '+(!s.supported?'disabled':'')+'></label><button type="button" data-paper-save="'+id+'" '+(!s.supported?'disabled':'')+'>저장</button></div></div>';}).join('')+'</div>';
 for(const button of root.querySelectorAll('[data-paper-save]'))button.addEventListener('click',()=>savePaperSetting(button.dataset.paperSave));
}
async function paperSettingsCall(patch,controller){
 const user=window.jkAuth?.currentUser;if(!user)throw Error('로그인 후 설정할 수 있습니다.');
 const epoch=PAPER_SETTINGS_EPOCH,token=await user.getIdToken();
 if(window.jkAuth?.currentUser!==user||PAPER_SETTINGS_EPOCH!==epoch)return null;
 const r=await fetch('/api/paper-trading-settings',{method:patch?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(patch?{'content-type':'application/json'}:{})},...(patch?{body:JSON.stringify(patch)}:{}) ,signal:controller.signal});
 const j=await r.json();if(window.jkAuth?.currentUser!==user||PAPER_SETTINGS_EPOCH!==epoch)return null;
 if(!r.ok||!j.ok)throw Error(j.error||'설정 처리 실패');return j;
}
async function loadPaperSettings(){
 if(PAPER_SETTINGS_BUSY||!window.jkAuth?.currentUser)return;
 PAPER_SETTINGS_BUSY=true;const seq=++PAPER_SETTINGS_REQUEST,controller=new AbortController();PAPER_SETTINGS_CONTROLLER=controller;
 const timer=setTimeout(()=>controller.abort(),12000),msg=document.getElementById('paperTradingMessage');msg.textContent='서버 설정 확인 중…';
 try{const j=await paperSettingsCall(null,controller);if(j&&seq===PAPER_SETTINGS_REQUEST){renderPaperSettings(j);msg.textContent='저장된 서버 설정 · 연구 계산과 이력 수집은 계속됩니다.';}}
 catch(e){if(seq===PAPER_SETTINGS_REQUEST){msg.textContent=e.name==='AbortError'?'서버 설정 확인 시간이 초과됐습니다. 다시 불러오세요.':e.message;PAPER_SETTINGS_DATA=null;document.getElementById('paperTradingSettings').innerHTML='';}}
 finally{clearTimeout(timer);if(seq===PAPER_SETTINGS_REQUEST){PAPER_SETTINGS_BUSY=false;PAPER_SETTINGS_CONTROLLER=null;}}
}
async function savePaperSetting(strategy,allOff=false){
 if(PAPER_SETTINGS_BUSY||!PAPER_SETTINGS_DATA)return;
 const patch=allOff?{allOff:true}:{strategy,enabled:document.getElementById('paper_enabled_'+strategy).checked,budget:Number(document.getElementById('paper_budget_'+strategy).value)};
 patch.expectedRevision=PAPER_SETTINGS_DATA.settings.revision;
 PAPER_SETTINGS_BUSY=true;const seq=++PAPER_SETTINGS_REQUEST,controller=new AbortController();PAPER_SETTINGS_CONTROLLER=controller;
 const timer=setTimeout(()=>controller.abort(),12000),msg=document.getElementById('paperTradingMessage');msg.textContent='서버에 저장 중…';
 for(const el of document.querySelectorAll('#paperTradingPanel input,#paperTradingPanel button'))el.disabled=true;
 try{const j=await paperSettingsCall(patch,controller);if(j&&seq===PAPER_SETTINGS_REQUEST){renderPaperSettings(j);msg.textContent=allOff?'모든 전략의 한투 모의주문을 OFF로 저장했습니다.':'저장했습니다. 다음 주문 처리부터 적용됩니다.';}}
 catch(e){if(seq===PAPER_SETTINGS_REQUEST){msg.textContent=(e.name==='AbortError'?'저장 결과를 확인하지 못했습니다.':e.message)+' 다시 불러온 뒤 저장해 주세요.';PAPER_SETTINGS_DATA=null;}}
 finally{clearTimeout(timer);if(seq===PAPER_SETTINGS_REQUEST){PAPER_SETTINGS_BUSY=false;PAPER_SETTINGS_CONTROLLER=null;document.getElementById('paperAllOff').disabled=false;document.getElementById('paperReload').disabled=false;}}
}
document.addEventListener('DOMContentLoaded',()=>{
 for(const b of document.querySelectorAll('[data-settings-tab]'))b.addEventListener('click',()=>showSettingsTab(b.dataset.settingsTab));
 document.getElementById('paperAllOff')?.addEventListener('click',()=>savePaperSetting(null,true));
 document.getElementById('paperReload')?.addEventListener('click',loadPaperSettings);
 if(location.hash==='#paper')showSettingsTab('paper');
});
window.addEventListener('jk-settings-auth',()=>{
 PAPER_SETTINGS_EPOCH++;PAPER_SETTINGS_REQUEST++;PAPER_SETTINGS_CONTROLLER?.abort();PAPER_SETTINGS_CONTROLLER=null;PAPER_SETTINGS_BUSY=false;PAPER_SETTINGS_DATA=null;
 document.getElementById('paperTradingSettings').innerHTML='';document.getElementById('paperAllOff').disabled=false;document.getElementById('paperReload').disabled=false;
 if(window.jkAuth?.currentUser)loadPaperSettings();else document.getElementById('paperTradingMessage').textContent='로그인 후 설정할 수 있습니다.';
});
