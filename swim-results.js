/* JK 투자 — 수영대회 '지난 대회 결과' (상세 창의 결과 칸 · 결과지 보기 창). 브라우저 · Node(시험) 공용.
   2026-11-08 사용자: "지난 대회는 결과지 다운로드 또는 파일 읽어서 내용 볼 수 있게".
   결과지 내용(선수 이름 · 기록)은 저장소에 두지 않는다 — 볼 때마다 /api/swim-file · /api/swim-result 가 원래 사이트에서 가져온다.
   보기: PDF(pdf.js) · 엑셀(SheetJS) · 그림 · 대한체육회 결과 시스템 표(종목별 예선 · 결승). 한글(HWP) · 압축 파일은 받기만. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SwimResults=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const XLSXJS='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const VIEW={pdf:'pdf',xlsx:'sheet',xls:'sheet',jpg:'image',png:'image',gif:'image'};
  const ICON={pdf:'📄',xlsx:'📊',xls:'📊',hwp:'📝',hwpx:'📝',doc:'📝',docx:'📝',zip:'🗜️',jpg:'🖼️',png:'🖼️',gif:'🖼️'};
  const CODE={sys:/^(SW|UW)$/,classCd:/^\w{1,4}$/,toCd:/^\d{6,14}$/};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.href:''}catch(e){return ''}};
  const ymd=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.replace(/-/g,'.'):'';
  const squash=s=>String(s||'').replace(/\s+/g,'');

  function viewKind(ext){return VIEW[String(ext||'').toLowerCase()]||'';}
  function fileHref(f){return '/api/swim-file?u='+encodeURIComponent(f.url);}
  function sysOk(r){return !!r&&CODE.sys.test(r.sys||'')&&CODE.classCd.test(r.classCd||'')&&CODE.toCd.test(r.toCd||'');}
  function sysQuery(r,op,x){
    const q=new URLSearchParams({sys:r.sys,classCd:r.classCd,toCd:r.toCd,op});
    if(x)for(const k of ['kind','dc','rh'])if(x[k])q.set(k,x[k]);
    return '/api/swim-result?'+q.toString();
  }
  function isPast(e,t){return (e.end_date||e.start_date||'9999')<t;}
  /* 화면에 쓸 결과만(형식이 맞는 것) */
  function list(e){
    return (e&&Array.isArray(e.results)?e.results:[]).filter(r=>r&&(r.kind==='system'?sysOk(r):r.kind==='files'?(r.files||[]).some(f=>f&&safeUrl(f.url)):r.kind==='link'?!!safeUrl(r.url):false));
  }
  function hasResults(e){return list(e).length>0;}

  function section(e,t){
    const L=list(e);
    if(!L.length&&!isPast(e,t))return '';
    let h='<div class="dsec res"><h4>🏁 대회 결과</h4>';
    if(!L.length)return h+'<p class="rnote">아직 결과지를 찾지 못했습니다. 아래 출처(주최 측 게시판)에서 확인하세요.</p></div>';
    L.forEach((r,i)=>{
      if(r.kind==='system'){
        h+='<div class="rbox"><div class="rtop"><b>'+esc(r.title||'종목별 경기결과')+'</b><small>종목별 경기결과 · '+esc(r.source_name)+' · 공식</small></div><div class="racts">'+
          '<button type="button" class="rbtn" data-res="sys" data-i="'+i+'">결과 보기</button>'+
          '<button type="button" class="rbtn sec" data-res="sysweb" data-i="'+i+'">공식 사이트 ↗</button></div></div>';
      }else if(r.kind==='files'){
        const u=safeUrl(r.url);
        h+='<div class="rbox"><div class="rtop">'+(u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"><b>'+esc(r.title)+'</b> ↗</a>':'<b>'+esc(r.title)+'</b>')+
          '<small>'+esc(r.source_name)+(r.posted?' · 게시 '+esc(ymd(r.posted)):'')+' · 공식</small></div><ul class="rfiles">'+
          (r.files||[]).map((f,j)=>safeUrl(f&&f.url)?'<li><span class="fn">'+(ICON[f.ext]||'📎')+' '+esc(f.name)+'</span><span class="racts">'+
            (viewKind(f.ext)?'<button type="button" class="rbtn" data-res="view" data-i="'+i+'" data-j="'+j+'">보기</button>':'<span class="rhint">받아서 열기</span>')+
            '<a class="rbtn sec" href="'+esc(fileHref(f))+'" download>받기</a></span></li>':'').join('')+'</ul></div>';
      }else{
        h+='<div class="rbox"><div class="rtop"><a href="'+esc(safeUrl(r.url))+'" target="_blank" rel="noopener noreferrer"><b>'+esc(r.title||'기록 검색')+'</b> ↗</a>'+
          '<small>'+esc(r.source_name)+' · 2차 자료(마스터즈 기록 · 이름 일부 가림)</small></div></div>';
      }
    });
    return h+'<p class="rnote">결과지 내용은 저장하지 않고 볼 때마다 원래 사이트에서 가져옵니다. 열리지 않으면 원문 글에서 직접 받으세요.</p></div>';
  }

  /* ───── 보기 창(브라우저만) ───── */
  let V=null;
  const loaded={};
  function loadScript(src){
    return loaded[src]||(loaded[src]=new Promise((ok,no)=>{
      const s=document.createElement('script');s.src=src;s.async=true;
      s.onload=ok;s.onerror=()=>{delete loaded[src];no(new Error('보기 도구를 불러오지 못했습니다(인터넷 연결 확인)'));};
      document.head.appendChild(s);
    }));
  }
  function viewer(){
    if(V)return V;
    const d=document.createElement('dialog');d.id='viewer';d.setAttribute('aria-labelledby','vTitle');
    d.innerHTML='<div class="dhead"><h3 id="vTitle"></h3><a id="vDl" class="rbtn sec" href="#" download hidden>받기</a>'+
      '<button type="button" class="dclose" id="vClose" aria-label="닫기">✕</button></div>'+
      '<div class="vtool" id="vTool"><input id="vq" type="search" placeholder="이름 · 소속 찾기" autocomplete="off" aria-label="결과에서 찾기"><span id="vInfo"></span></div>'+
      '<div id="vHits" class="vhits" hidden></div><div class="vbody" id="vBody"></div>';
    document.body.appendChild(d);
    V={d,title:d.querySelector('#vTitle'),dl:d.querySelector('#vDl'),tool:d.querySelector('#vTool'),q:d.querySelector('#vq'),info:d.querySelector('#vInfo'),
       hits:d.querySelector('#vHits'),body:d.querySelector('#vBody'),onq:null,gen:0,sub:0,obs:null,pdf:null,url:null};
    d.querySelector('#vClose').addEventListener('click',close);
    d.addEventListener('cancel',ev=>{ev.preventDefault();close();});
    let tm;V.q.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(()=>{if(V.onq)V.onq(V.q.value.trim());},250);});
    return V;
  }
  function cleanup(){
    if(!V)return;
    if(V.obs){V.obs.disconnect();V.obs=null;}
    if(V.pdf){try{V.pdf.destroy();}catch(e){}V.pdf=null;}
    if(V.url){URL.revokeObjectURL(V.url);V.url=null;}
    V.onq=null;V.body.onclick=null;V.hits.onclick=null;
  }
  function open(title,dl,search){
    const v=viewer();cleanup();v.gen++;v.sub=0;
    v.title.textContent=title;v.dl.hidden=!dl;if(dl)v.dl.href=dl;
    v.tool.hidden=!search;v.q.value='';v.info.textContent='';v.hits.hidden=true;v.hits.innerHTML='';
    v.body.innerHTML='<div class="vload">불러오는 중…</div>';
    if(!v.d.open){if(v.d.showModal)v.d.showModal();else v.d.setAttribute('open','');}
    return v.gen;
  }
  function close(){
    if(!V)return;
    V.gen++;cleanup();V.body.innerHTML='';
    if(V.d.open){if(V.d.close)V.d.close();else V.d.removeAttribute('open');}
  }
  function fail(gen,msg,src){
    if(!V||gen!==V.gen)return;
    const u=safeUrl(src);
    V.body.innerHTML='<div class="verr">'+esc(msg||'열지 못했습니다')+(u?'<br><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">원래 사이트에서 열기 ↗</a>':'')+'</div>';
  }
  async function getFile(f){
    const r=await fetch(fileHref(f));
    if(!r.ok){let j={};try{j=await r.json();}catch(e){}const err=new Error(j.error||('받기 실패('+r.status+')'));err.source=j.source;throw err;}
    return r.arrayBuffer();
  }
  async function api(url){
    const r=await fetch(url);let j={};try{j=await r.json();}catch(e){}
    if(!r.ok||!j.ok)throw new Error(j.error||('결과 시스템 응답 '+r.status));
    return j;
  }

  async function showPdf(gen,buf){
    await loadScript(PDFJS+'build/pdf.min.js');
    if(gen!==V.gen)return;
    const lib=window.pdfjsLib;lib.GlobalWorkerOptions.workerSrc=PDFJS+'build/pdf.worker.min.js';
    const pdf=await lib.getDocument({data:new Uint8Array(buf),cMapUrl:PDFJS+'cmaps/',cMapPacked:true,standardFontDataUrl:PDFJS+'standard_fonts/'}).promise;
    if(gen!==V.gen){pdf.destroy();return;}
    V.pdf=pdf;V.info.textContent=pdf.numPages+'쪽';
    const first=(await pdf.getPage(1)).getViewport({scale:1}),ratio=(first.width/first.height).toFixed(4);
    V.body.innerHTML='';
    const pages=[];
    for(let n=1;n<=pdf.numPages;n++){
      const div=document.createElement('div');div.className='vpage';div.dataset.n=n;div.style.aspectRatio=ratio;
      div.innerHTML='<span class="vpn">'+n+'쪽</span>';V.body.appendChild(div);pages.push(div);
    }
    const render=async div=>{
      if(div.dataset.done)return;div.dataset.done='1';
      const page=await pdf.getPage(+div.dataset.n),base=page.getViewport({scale:1});
      const w=div.clientWidth||V.body.clientWidth||360,dpr=Math.min(2,window.devicePixelRatio||1),vp=page.getViewport({scale:w/base.width*dpr});
      const c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
      await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
      if(gen!==V.gen)return;
      div.appendChild(c);div.classList.add('on');
    };
    V.obs=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting)render(x.target).catch(()=>{});}),{root:V.body,rootMargin:'800px 0px'});
    pages.forEach(p=>V.obs.observe(p));
    const texts={};
    const pageText=async n=>{
      if(texts[n])return texts[n];
      const raw=(await (await pdf.getPage(n)).getTextContent()).items.map(x=>x.str).join(' ').replace(/\s+/g,' ');
      let sq='';const at=[];for(let i=0;i<raw.length;i++)if(!/\s/.test(raw[i])){sq+=raw[i];at.push(i);}
      return (texts[n]={raw,sq,at});
    };
    V.onq=async q=>{
      const qn=squash(q);
      if(qn.length<2){V.hits.hidden=true;V.hits.innerHTML='';return;}
      V.hits.hidden=false;V.hits.textContent='찾는 중…';
      const out=[];
      for(let n=1;n<=pdf.numPages&&out.length<80;n++){
        const tx=await pageText(n);
        if(gen!==V.gen||squash(V.q.value)!==qn)return;
        let i=tx.sq.indexOf(qn);
        while(i>=0&&out.length<80){
          const a=tx.at[i],b=tx.at[i+qn.length-1];
          out.push({n,snip:tx.raw.slice(Math.max(0,a-24),b+32)});
          i=tx.sq.indexOf(qn,i+qn.length);
        }
      }
      V.hits.innerHTML=out.length?out.map(h=>'<button type="button" data-n="'+h.n+'"><b>'+h.n+'쪽</b> '+esc(h.snip)+'</button>').join(''):
        '<span>찾는 글자가 없습니다(그림으로 만든 PDF 는 글자 찾기가 안 됩니다)</span>';
    };
    V.hits.onclick=ev=>{const b=ev.target.closest('button[data-n]');if(b)pages[+b.dataset.n-1].scrollIntoView({block:'start'});};
  }

  async function showSheet(gen,buf){
    await loadScript(XLSXJS);
    if(gen!==V.gen)return;
    const X=window.XLSX,wb=X.read(new Uint8Array(buf),{type:'array'}),names=wb.SheetNames||[];
    let cur=0;const memo={};
    const rowsOf=i=>{
      if(memo[i])return memo[i];
      const rows=X.utils.sheet_to_json(wb.Sheets[names[i]],{header:1,raw:false,defval:''}).map(r=>r.map(x=>String(x??'').trim())).filter(r=>r.some(Boolean));
      let w=0;rows.forEach(r=>{for(let k=r.length-1;k>=0;k--)if(r[k]){w=Math.max(w,k+1);break;}});
      return (memo[i]=rows.map(r=>r.slice(0,w)));
    };
    const draw=()=>{
      const rows=rowsOf(cur),qn=squash(V.q.value),shown=qn?rows.filter(r=>squash(r.join('')).includes(qn)):rows;
      V.info.textContent=(qn?shown.length+' / ':'')+rows.length+'줄';
      V.body.innerHTML=(names.length>1?'<div class="vtabs">'+names.map((n,i)=>'<button type="button" data-s="'+i+'"'+(i===cur?' class="on"':'')+'>'+esc(n)+'</button>').join('')+'</div>':'')+
        '<div class="vtable"><table><tbody>'+shown.slice(0,3000).map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
        (shown.length>3000?'<p class="rnote">앞 3,000줄만 보입니다 — 찾기로 줄이거나 받아서 여세요.</p>':'')+(rows.length?'':'<p class="rnote">빈 시트입니다.</p>');
    };
    V.body.onclick=ev=>{const b=ev.target.closest('button[data-s]');if(b){cur=+b.dataset.s;draw();}};
    V.onq=()=>{if(gen===V.gen)draw();};
    draw();
  }

  function showImage(gen,buf,ext){
    if(gen!==V.gen)return;
    V.url=URL.createObjectURL(new Blob([buf],{type:'image/'+(ext==='jpg'?'jpeg':ext)}));
    V.body.innerHTML='<img class="vimg" alt="결과지" src="'+V.url+'">';
  }

  async function showSystem(gen,r){
    const ev=await api(sysQuery(r,'events'));
    if(gen!==V.gen)return;
    const events=ev.events||[];
    if(!events.length){fail(gen,'종목 목록이 없습니다');return;}
    const groups={};events.forEach((e,i)=>{(groups[e.group]=groups[e.group]||[]).push(i);});
    V.body.innerHTML='<div class="vsys"><select id="vEv" aria-label="종목 선택"><option value="">종목을 고르세요 ('+events.length+'개)</option>'+
      Object.keys(groups).map(g=>'<optgroup label="'+esc(g||'종별')+'">'+groups[g].map(i=>'<option value="'+i+'">'+esc(events[i].group+' '+events[i].event)+
        (events[i].entries?' · '+esc(events[i].entries)+(events[i].type==='단체'?'명(팀 '+esc(events[i].teams||'?')+')':'명'):'')+'</option>').join('')+'</optgroup>').join('')+
      '</select></div><div id="vRes" class="vres"><p class="rnote">종목을 고르면 예선 · 결승 순위와 기록을 보여 줍니다.</p></div>';
    const sel=V.body.querySelector('#vEv'),box=V.body.querySelector('#vRes');
    let tables=[];
    const draw=()=>{
      const qn=squash(V.q.value);let n=0,m=0;
      box.innerHTML=tables.map(t=>'<h5>'+esc(t.title)+'</h5><div class="vtable"><table><thead><tr>'+t.head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
        t.rows.filter(x=>{if(x.section)return !qn;n++;const ok=!qn||squash(x.cells.join('')).includes(qn);if(ok)m++;return ok;})
          .map(x=>x.section?'<tr class="sec"><td colspan="'+Math.max(1,t.head.length)+'">'+esc(x.section)+'</td></tr>':'<tr>'+x.cells.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+
        '</tbody></table></div>').join('')||'<p class="rnote">결과가 아직 없습니다.</p>';
      V.info.textContent=qn?m+' / '+n+'줄':n?n+'줄':'';
    };
    V.onq=()=>{if(gen===V.gen&&tables.length)draw();};
    sel.addEventListener('change',async()=>{
      const e=events[+sel.value];if(!e)return;
      const my=++V.sub;box.innerHTML='<div class="vload">불러오는 중…</div>';tables=[];
      try{
        const rounds=(await api(sysQuery(r,'rounds',{kind:e.kind,dc:e.dc}))).rounds||[];
        for(const rd of rounds){
          const t=await api(sysQuery(r,'round',{kind:rd.kind||e.kind,dc:rd.dc||e.dc,rh:rd.rh}));
          if(my!==V.sub||gen!==V.gen)return;
          (t.tables||[]).forEach(tb=>tables.push({title:[rd.date,rd.label,tb.caption&&tb.caption!==rd.label?tb.caption:''].filter(Boolean).join(' · ')||e.event,head:tb.head||[],rows:tb.rows||[]}));
        }
        if(my!==V.sub||gen!==V.gen)return;
        if(!rounds.length){box.innerHTML='<p class="rnote">이 종목의 경기결과가 아직 올라오지 않았습니다.</p>';return;}
        draw();
      }catch(err){if(my===V.sub&&gen===V.gen)box.innerHTML='<div class="verr">'+esc(err.message)+'</div>';}
    });
  }

  function openOfficial(r){
    if(!sysOk(r))return;
    const f=document.createElement('form');f.method='post';f.action='https://result.sports.or.kr/'+r.sys+'/INF202.do';f.target='_blank';
    for(const [k,v] of Object.entries({classCd:r.classCd,toCd:r.toCd,pageIndex:'1'})){const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i);}
    document.body.appendChild(f);f.submit();f.remove();
  }

  /* 상세 창의 클릭 하나를 처리(상세 본문에 한 번만 붙인 위임 처리기에서 부른다) */
  function click(ev,e){
    const b=ev.target.closest('[data-res]');if(!b)return false;
    const r=list(e)[+b.dataset.i];if(!r)return false;
    const act=b.dataset.res;
    if(act==='sysweb'){openOfficial(r);return true;}
    if(act==='sys'){
      const gen=open((r.title||e.title)+' — 종목별 결과','',true);
      showSystem(gen,r).catch(err=>fail(gen,err.message));
      return true;
    }
    if(act==='view'){
      const f=(r.files||[])[+b.dataset.j],kind=f&&viewKind(f.ext);if(!kind)return false;
      const gen=open(f.name,fileHref(f),kind!=='image');
      getFile(f).then(buf=>{
        if(gen!==V.gen)return;
        if(kind==='pdf')return showPdf(gen,buf);
        if(kind==='sheet')return showSheet(gen,buf);
        return showImage(gen,buf,String(f.ext).toLowerCase());
      }).catch(err=>fail(gen,err.message,err.source||r.url));
      return true;
    }
    return false;
  }

  return {section,list,hasResults,isPast,viewKind,fileHref,sysQuery,sysOk,click,close,PDFJS,XLSXJS};
});
