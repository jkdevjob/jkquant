import { chromium } from 'playwright';
const BASE=process.env.JKQUANT_URL||'https://jkquant.pages.dev';
const ROWS=Array.from({length:21},(_,i)=>i);
const CAPS=[10000,100000];
function years(a,b){return Math.max(.05,(new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/(365.25*864e5));}
function cagr(fin,cap,a,b){return (Math.pow(Math.max(fin,1)/cap,1/years(a,b))-1)*100;}
function clean(o){if(Array.isArray(o))return o.map(clean);if(o&&typeof o==='object')return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,clean(v)]));return typeof o==='number'&&Number.isFinite(o)?Math.round(o*10000)/10000:o;}
const browser=await chromium.launch({headless:true});
try{
  const p=await browser.newPage();
  await p.goto(BASE+'/backtest.html',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForFunction(()=>typeof fetchTickerInto==='function'&&typeof runIM==='function'&&typeof commonDays==='function',{timeout:120000});
  const out=await p.evaluate(async ({ROWS,CAPS})=>{
    M={};DIV={};RAW={};ADJ={};DIVMAP={};PBASIS={};
    if(!(await fetchTickerInto('SOXL','2009-01-01')))throw new Error('SOXL load fail');
    imEngine='v40'; imReverse=false; imAutoTp=false; imTgtDyn=false; imCostOn=true; imTarget=20; imDiv=20;
    function patchOnce(src,oldv,newv,label){const n=src.split(oldv).length-1;if(n!==1)throw new Error(label+' '+n);return src.replace(oldv,newv);}
    let src=runIM.toString();
    src=patchOnce(src,'function runIM(days,tkr,cap,divs,targetPct,compound=true,bigOverride){',
      'function runIMRows(days,tkr,cap,divs,targetPct,compound=true,bigOverride,rowsOverride=3){','sig');
    src=patchOnce(src,'imRowsOf({})','imRowsOf({rows:rowsOverride})','rows');
    const runIMRows=eval('('+src+')');

    const all=commonDays('2009-01-01','2099-12-31',['SOXL']);
    const first=all[0],last=all.at(-1),d2020=all.find(d=>d>='2020-01-01')||first;
    const full=all, post=all.filter(d=>d>=d2020);
    // rows=3 parity with production runIM
    const a=runIM(full,'SOXL',100000,20,20,true,20);
    const b=runIMRows(full,'SOXL',100000,20,20,true,20,3);
    const parity={final:Math.abs(a.final-b.final),mdd:Math.abs(a.mdd-b.mdd),cycles:Math.abs(a.cycles-b.cycles),fees:Math.abs(a.fees-b.fees),tax:Math.abs(a.tax-b.tax)};
    if(parity.final>1e-7||parity.mdd>1e-9||parity.cycles||parity.fees>1e-7||parity.tax>1e-7)throw new Error('parity '+JSON.stringify(parity));
    const res={meta:{first,last,d2020,n:all.length,basis:PBASIS.SOXL},parity,config:{ticker:'SOXL',div:20,tp:20,compound:true,reverse:false,big:20,costOn:true,rows:ROWS},caps:{}};
    for(const cap of CAPS){
      const one=(days,r)=>{
        const z=runIMRows(days,'SOXL',cap,20,20,true,20,r);
        return {rows:r,from:days[0],to:days.at(-1),final:z.final,ret:z.ret,cagr:(Math.pow(Math.max(z.final,1)/cap,1/Math.max(.05,(new Date(days.at(-1)+'T00:00:00Z')-new Date(days[0]+'T00:00:00Z'))/(365.25*864e5)))-1)*100,mdd:z.mdd,cycles:z.cycles,fees:z.fees,tax:z.tax,endCash:z.endCash,endShares:z.endShares};
      };
      const F=ROWS.map(r=>one(full,r)),P=ROWS.map(r=>one(post,r));
      const sort=(a,key,desc=true)=>[...a].sort((x,y)=>desc?y[key]-x[key]:x[key]-y[key]);
      res.caps[cap]={full:F,post2020:P,
        bestFullFinal:sort(F,'final').slice(0,5),
        bestFullCagr:sort(F,'cagr').slice(0,5),
        bestFullMdd:sort(F,'mdd',false).slice(0,5),
        bestPostFinal:sort(P,'final').slice(0,5),
        bestPostCagr:sort(P,'cagr').slice(0,5),
        bestPostMdd:sort(P,'mdd',false).slice(0,5)};
    }
    return res;
  },{ROWS,CAPS});
  console.log('===SOXL_LOC_ROWS_JSON===');
  console.log(JSON.stringify(clean(out),null,2));
  console.log('===END_SOXL_LOC_ROWS_JSON===');
}finally{await browser.close();}
