// 로그인된 브라우저(CDP 9222)에서 네이버 블로그 통계를 읽어 stats_inflow.md 에 덧붙인다(MONEY_PLAN 3-7).
// 순방문자(최근 15일) · 어제 유입 경로와 검색어 · 어제 조회수 상위 글. 공개 통계로는 알 수 없는 '어디서 왔나'를 남긴다.
// usage: node stats_inflow.js [YYYY-MM-DD(기준일, 기본=어제 KST)]
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const OUT=path.join(__dirname,'stats_inflow.md');
const day=process.argv[2]||new Date(Date.now()+9*3600e3-86400e3).toISOString().slice(0,10);

(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0]; const p=await ctx.newPage();
  await p.goto('https://blog.stat.naver.com/blog/daily/daily/cv?blogId=maniacjk',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2000);
  const api=async q=>p.evaluate(async q=>{const r=await fetch('https://blog.stat.naver.com/api/blog/'+q,{credentials:'include'}); return r.ok?r.json():{err:r.status};},q);
  const rowsOf=(j,id)=>{ const d=((j.result||{}).statDataList||[]).find(x=>x.dataId===id); return d&&d.data&&d.data.rows; };
  const uv=rowsOf(await api(`visit/uv?timeDimension=DATE&startDate=${day}&exclude=`),'uv');
  const ref=await api(`user/referer/total?timeDimension=DATE&startDate=${day}&exclude=`);
  const tot=rowsOf(ref,'refererTotal'), det=rowsOf(ref,'refererDetail');
  const rank=rowsOf(await api(`rank/cvContentPc?timeDimension=DATE&startDate=${day}&exclude=`),'rankCv');
  await p.close(); await b.close();

  const L=[`\n## ${day} (읽은 시각 ${new Date(Date.now()+9*3600e3).toISOString().slice(0,16).replace('T',' ')} KST)`];
  if(uv) L.push('- 순방문자(최근 15일, 새것부터): '+uv.date.map((d,i)=>`${d.slice(5)} ${uv.total[i]}`).join(' · '));
  if(tot&&tot.date) L.push('- 유입 경로: '+tot.referrerDomain.map((d,i)=>`${d} ${tot.cv[i]}`).join(' · '));
  else L.push('- 유입 경로: 없음');
  if(det&&det.referrerUrl){
    const kw=det.referrerUrl.map((u,i)=>{ let q=''; try{ const x=new URL(u); q=x.searchParams.get('query')||x.searchParams.get('q')||''; }catch(e){} return q?`'${q}' ${det.cv[i]}`:''; }).filter(Boolean);
    L.push('- 검색어: '+(kw.length?kw.join(' · '):'(검색어가 담긴 유입 없음)'));
    L.push('- 유입 주소: '+det.referrerUrl.map((u,i)=>`${u.slice(0,90)} ${det.cv[i]}`).join(' · '));
  }
  if(rank&&rank.title) L.push('- 조회수 상위 글(PC): '+rank.title.map((t,i)=>`${t.slice(0,30)}… ${rank.cv[i]}`).join(' · '));
  if(!fs.existsSync(OUT)) fs.writeFileSync(OUT,'# 네이버 블로그 유입 기록 (로그인 통계)\n\n`node stats_inflow.js` 가 로그인된 김에 남긴다. 검색 유입이 생기는지, 어떤 검색어로 들어오는지 본다(MONEY_PLAN 3-7).\n');
  fs.appendFileSync(OUT,L.join('\n')+'\n');
  console.log(L.join('\n'));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
