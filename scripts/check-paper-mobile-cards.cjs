#!/usr/bin/env node
'use strict';
/* Mobile paper card regression without a second performance implementation.
   Executes the actual mobile renderer from index.html with a minimal DOM harness.
   All ATR/TR/MDD snippets must be copied verbatim from the desktop cells. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const b=html.indexOf('function paperBuildMobileCards(root){'),e=html.indexOf("let paperSortKey='', paperSortDir=1;",b);
assert(b>0&&e>b,'cannot locate actual mobile renderer source');
const code=html.slice(b,e);new Function(code);
assert.match(html,/class="paper-desktop-table"><div class="htable-wrap"><table class="htable narrow"/);
assert.match(html,/@media\(max-width:760px\)\{[\s\S]*?#paper_body \.paper-desktop-table\{display:none!important\}[\s\S]*?#paper_body \.paper-mobile-view\{display:block\}/);
assert.match(html,/body\.innerHTML=h;\s*if\(typeof paperBuildMobileCards==='function'\)paperBuildMobileCards\(body\);\s*void paperLoadTickerNames\(body\);/);
class Fake {
  constructor(tag='div'){
    this.tagName=tag.toUpperCase();this.children=[];this.className='';this.dataset={};
    this.style={};this.attrs={};this.textContent='';this.innerHTML='';this.id='';
  }
  append(...xs){xs.forEach(x=>this.appendChild(x));}
  appendChild(x){this.children.push(x);return x;}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(){}
  insertAdjacentElement(pos,node){assert.equal(pos,'afterend');this.after=node;}
  replaceChildren(...xs){this.children=[];this.append(...xs);}
  cloneNode(){const x=new Fake(this.tagName);x.innerHTML=this.innerHTML;x.textContent=this.textContent;x.className=this.className;return x;}
  querySelector(sel){if(sel==='.pcell')return this.pcell||null;return null;}
}
const rows=[];
function fixture(name,atr,tr,mdd,pending=false){
 const cells=[];
 const fst=new Fake('td');fst.pcell=new Fake('div');fst.pcell.innerHTML='<b>'+name+'</b><span>SOXL · 20분할 · LOC 3줄</span>';fst.pcell.textContent=name;
 cells.push(fst);
 if(pending){const x=new Fake('td');x.textContent='시세 계산 중';cells.push(x);cells.push(new Fake('td'),new Fake('td'));}
 else{
  for(let j=1;j<11;j++){
   const x=new Fake('td');
   x.innerHTML=j===1?'<b>+'+atr+'%</b><span class="cw">세금 10만원</span>':
     j===2?'<b>+'+tr+'%</b><span class="cw">원화 +200%</span>':
     j===3?'<b>−'+Math.abs(mdd)+'%</b>':'상세'+j;
   x.style.color=j<=2?'rgb(54, 211, 153)':j===3?'rgb(248, 123, 140)':'';
   cells.push(x);
  }
 }
 return{dataset:{name,atr:pending?'':String(atr),ret:pending?'':String(tr),mdd:pending?'':String(mdd),cagr:pending?'':'44.5'},cells};
}
rows.push(fixture('무매A',386.5,732.8,-46.5),fixture('무매B',163.5,225.5,-41.6),fixture('무매C',0,0,0,true));
const table={tBodies:[{rows}]},desktop=new Fake('div');
desktop.querySelector=sel=>sel==='table.htable.narrow'?table:null;
const root={querySelector:sel=>sel==='.paper-desktop-table'?desktop:null};
const doc={
  createElement:tag=>new Fake(tag),
  getElementById(id){
    if(id!=='paper_mobile_list')return null;
    return desktop.after?.children.find(x=>x.id===id)||null;
  }
};
const ctx={document:doc,console};vm.createContext(ctx);vm.runInContext(code,ctx);
ctx.paperBuildMobileCards(root);
const view=desktop.after;assert(view,'mobile view not inserted');
const list=doc.getElementById('paper_mobile_list');assert(list,'mobile list missing');
assert.equal(list.children.length,3);
for(let k=0;k<2;k++){
 const card=list.children[k],first=card.children[0],metrics=card.children[1],details=card.children[2];
 assert.equal(first.children[0].innerHTML,rows[k].cells[0].pcell.innerHTML,'strategy label copied without loss');
 assert.equal(metrics.children.length,3);
 for(let j=0;j<3;j++){
  assert.equal(metrics.children[j].children[1].innerHTML,rows[k].cells[j+1].innerHTML,'KPI values copied verbatim');
  assert.equal(metrics.children[j].children[1].style.color,rows[k].cells[j+1].style.color,'KPI colors preserved');
 }
 assert.equal(details.children[1].children.length,7,'all other performance fields available');
}
assert.equal(list.children[2].children[1].textContent,'시세 계산 중','pending row shows explicit status');
ctx.paperSortCards('ret');
assert.equal(list.children[0].dataset.name,'무매A','TR high first');
ctx.paperSortCards('mdd');
assert.equal(list.children[0].dataset.name,'무매B','smaller absolute MDD first');
ctx.paperSortCards('default');
assert.equal(list.children[0].dataset.name,'무매A','original order restored');
assert.equal(list.children[2].dataset.name,'무매C','pending never erased');
console.log('PAPER MOBILE CARD: 16 assertions groups PASS · visible strategy label, 3 KPIs, 7 details, pending, sortable');
