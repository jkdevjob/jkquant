/* 표시 전용 USD/KRW 공용 포맷터. 주문·원장·백테 계산에 환율을 넣지 않는다. */
(function(g){
  'use strict';
  if(g.JKMoney)return;
  var fx=null,inflight=null,attemptAt=0;
  function number(v){return v==null||v===''?null:Number.isFinite(+v)?+v:null;}
  function rate(opt){var r=opt&&number(opt.rate);return r>0?r:fx&&fx.rate>0?fx.rate:null;}
  function wonValue(v,opt){
    if(opt&&Object.prototype.hasOwnProperty.call(opt,'won'))return number(opt.won);
    var r=rate(opt);return r>0?v*r:null;
  }
  function nativeUsd(v,d){return '$'+v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
  function won(v){return v==null?'원화 환산 대기':Math.round(v).toLocaleString('ko-KR')+'원';}
  function usdText(v,opt){
    v=number(v);if(v==null)return '—';opt=opt||{};
    return nativeUsd(v,opt.digits==null?2:opt.digits)+' ('+won(wonValue(v,opt))+')';
  }
  function usdHtml(v,opt){
    v=number(v);if(v==null)return '—';opt=opt||{};
    var attrs=' data-usd="'+v+'" data-digits="'+(opt.digits==null?2:opt.digits)+'"';
    if(Object.prototype.hasOwnProperty.call(opt,'won'))attrs+=' data-won="'+(number(opt.won)==null?'':number(opt.won))+'"';
    else if(number(opt.rate)>0)attrs+=' data-rate="'+number(opt.rate)+'"';
    return '<span class="jk-money-pair"'+attrs+'><span class="jk-money-native">'+nativeUsd(v,opt.digits==null?2:opt.digits)+'</span><span class="jk-money-krw">'+won(wonValue(v,opt))+'</span></span>';
  }
  function paint(){
    if(!g.document||!document.querySelectorAll)return;
    document.querySelectorAll('.jk-money-pair[data-usd]').forEach(function(el){
      var v=number(el.getAttribute('data-usd')),opt={};
      if(el.hasAttribute('data-won'))opt.won=number(el.getAttribute('data-won'));
      else if(el.hasAttribute('data-rate'))opt.rate=number(el.getAttribute('data-rate'));
      var sub=el.querySelector('.jk-money-krw');if(sub&&v!=null){sub.textContent=won(wonValue(v,opt));sub.title=el.hasAttribute('data-won')?'입력·원장에 기록된 원화 금액':fx?'원화 참고환산 · USD/KRW '+rate(opt)+' · '+(fx.asof||fx.date||'조회 시점'):'환율 미확인';}
    });
  }
  function loadFX(force){
    if(inflight)return inflight;
    if(!force&&Date.now()-attemptAt<300000)return Promise.resolve(fx);
    attemptAt=Date.now();
    inflight=(async function(){
      var ac=typeof AbortController==='function'?new AbortController():null,timer=ac?setTimeout(function(){ac.abort();},5000):null;
      try{
        var r=await fetch('/api/fx',{headers:{Accept:'application/json'},...(ac?{signal:ac.signal}:{})});
        if(!r.ok)return fx;var j=await r.json();
        if(j&&number(j.rate)>0&&!j.error){fx={rate:+j.rate,date:j.date||'',asof:j.asof||'',src:j.src||''};paint();
          if(g.dispatchEvent&&typeof CustomEvent==='function')g.dispatchEvent(new CustomEvent('jk-money-ready',{detail:{...fx}}));}
        return fx;
      }catch(e){return fx;}finally{if(timer)clearTimeout(timer);}
    })().finally(function(){inflight=null;});
    return inflight;
  }
  g.JKMoney={usdText:usdText,usdHtml:usdHtml,wonText:won,loadFX:loadFX,paint:paint,getFX:function(){return fx?{...fx}:null;}};
  if(g.document){var style=document.createElement('style');style.textContent='.jk-money-pair{display:inline-flex;flex-direction:column;vertical-align:top;line-height:1.45}.jk-money-native{white-space:nowrap}.jk-money-krw{font-size:.78em;opacity:.7;white-space:normal}';(document.head||document.documentElement).appendChild(style);}
  if(typeof fetch==='function')void loadFX();
})(typeof window!=='undefined'?window:globalThis);
