const KOREAN_COUNT=['','일','이','삼','사','오'];

// All activation calls run synchronously inside the start/test button gesture.
// The timer must keep running even when an audio resume promise never resolves.
export class WorkoutAudio {
  constructor(platform=globalThis,onProblem=()=>{}){
    this.platform=platform;this.onProblem=onProblem;this.context=null;
    this.settings={sound:true,countdown:true,voice:false};
    this.sources=new Set();this.previewTimers=[];this.phaseTimer=null;
    this.speechPrimed=false;this.lastCountKey='';this.toneUntil=0;this.reported=new Set();
  }
  configure(settings){
    this.settings={sound:settings.sound!==false,countdown:settings.countdown!==false,voice:settings.voice===true};
    if(!this.settings.sound)this.stop();
  }
  problem(message){if(!this.reported.has(message)){this.reported.add(message);this.onProblem(message);}}
  visible(){return !this.platform.document||this.platform.document.visibilityState==='visible';}
  unlockFromGesture({prime=true}={}){
    if(!this.settings.sound)return Promise.resolve(false);
    const p=this.platform;
    // Safari's Web Audio default may obey the ringer switch. Playback uses media audio.
    try{if(p.navigator?.audioSession)p.navigator.audioSession.type='playback';}catch{}
    let resumed=Promise.resolve(true);
    try{
      const Audio=p.AudioContext||p.webkitAudioContext;
      if(Audio){
        if(!this.context||this.context.state==='closed')this.context=new Audio({latencyHint:'interactive'});
        const ctx=this.context;
        if(ctx.state==='suspended'||ctx.state==='interrupted')resumed=Promise.resolve(ctx.resume()).then(()=>{const ready=ctx.state==='running';if(!ready)this.problem('기기에서 소리가 중단됐어요. 소리 확인 버튼을 다시 눌러 주세요.');return ready;});
        // A real source is started in the gesture, including on older Safari.
        const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,22050);
        source.connect(ctx.destination);source.onended=()=>source.disconnect();source.start(0);
      }else{resumed=Promise.resolve(false);this.problem('현재 브라우저에서 비프음을 사용할 수 없어요.');}
    }catch{resumed=Promise.resolve(false);this.problem('소리를 켜지 못했어요. 소리 확인 버튼을 다시 눌러 주세요.');}
    // Prime speech separately: countdown is enabled even when phase narration is off.
    if(prime&&!this.speechPrimed&&(this.settings.countdown||this.settings.voice))this.speechPrimed=this.speak('시작');
    return resumed.catch(()=>{this.problem('소리 재생이 차단됐어요. 소리 확인 버튼을 눌러 주세요.');return false;});
  }
  speak(text){
    if(!this.settings.sound||!this.visible())return false;
    const p=this.platform,synth=p.speechSynthesis;
    if(!synth||!p.SpeechSynthesisUtterance)return false;
    try{
      synth.cancel();if(synth.paused)synth.resume();
      const utterance=new p.SpeechSynthesisUtterance(text);
      utterance.lang='ko-KR';utterance.rate=1.2;utterance.pitch=1;utterance.volume=1;
      const voices=synth.getVoices?.()||[],voice=voices.find(v=>/^ko(?:[-_]|$)/i.test(v.lang));
      if(voice)utterance.voice=voice;
      utterance.onerror=event=>{
        if(event.error==='canceled'||event.error==='interrupted')return;
        this.speechPrimed=false;this.tone(.12,660);this.problem('음성 안내를 재생하지 못했어요. 기기 음량과 소리 확인 버튼을 확인해 주세요.');
      };
      synth.speak(utterance);return true;
    }catch{this.problem('음성 안내를 켜지 못했어요. 소리 확인 버튼을 다시 눌러 주세요.');return false;}
  }
  countdown(second,key,preview=false){
    if(!this.settings.sound||(!this.settings.countdown&&!preview)||!this.visible()||!Number.isInteger(second)||second<1||second>5)return false;
    if(key===this.lastCountKey)return false;this.lastCountKey=key;
    this.clearPhase();
    if(!this.speak(KOREAN_COUNT[second])){
      this.tone(.12,660);this.problem('한국어 음성을 사용할 수 없어 짧은 비프음으로 안내합니다.');
    }
    return true;
  }
  tone(seconds,frequency){
    if(!this.settings.sound||!this.visible()||!this.context||this.context.state==='closed')return false;
    const ctx=this.context;
    try{
      const oscillator=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;
      oscillator.type='sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.35,t+.012);
      gain.gain.setValueAtTime(.35,t+Math.max(.02,seconds-.08));gain.gain.exponentialRampToValueAtTime(.001,t+seconds);
      oscillator.connect(gain);gain.connect(ctx.destination);this.sources.add(oscillator);
      oscillator.onended=()=>{this.sources.delete(oscillator);oscillator.disconnect();gain.disconnect();};
      oscillator.start(t);oscillator.stop(t+seconds+.02);return true;
    }catch{this.problem('비프음을 재생하지 못했어요. 소리 확인 버튼을 다시 눌러 주세요.');return false;}
  }
  boundary(type='phase'){
    if(!this.settings.sound||!this.visible())return false;
    this.clearPhase();this.platform.speechSynthesis?.cancel();
    const seconds=type==='done'?.9:.7;this.toneUntil=Date.now()+seconds*1000;
    return this.tone(seconds,1046);
  }
  announce(text){
    if(!this.settings.sound||!this.settings.voice||!this.visible())return;
    this.clearPhase();const delay=Math.max(0,this.toneUntil-Date.now()+60);
    if(delay>60)this.phaseTimer=this.platform.setTimeout(()=>{this.phaseTimer=null;this.speak(text);},delay);
    else this.speak(text);
  }
  clearPhase(){if(this.phaseTimer!==null)this.platform.clearTimeout(this.phaseTimer);this.phaseTimer=null;}
  stop(){
    for(const id of this.previewTimers)this.platform.clearTimeout(id);this.previewTimers=[];this.clearPhase();
    this.platform.speechSynthesis?.cancel();
    for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();
  }
  reset(){this.stop();this.lastCountKey='';this.toneUntil=0;}
  preview(){
    this.reset();if(!this.settings.sound)return;
    void this.unlockFromGesture({prime:false});
    this.countdown(5,'preview:5',true);
    for(let elapsed=1;elapsed<5;elapsed++)this.previewTimers.push(this.platform.setTimeout(()=>this.countdown(5-elapsed,'preview:'+(5-elapsed),true),elapsed*1000));
    this.previewTimers.push(this.platform.setTimeout(()=>this.boundary('done'),5000));
  }
}
