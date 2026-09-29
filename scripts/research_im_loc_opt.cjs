#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

const root=path.resolve(__dirname,'..');
const regressionPath=path.join(root,'regression-check.js');
const appendPath=path.join(__dirname,'research_im_loc_opt_append.inc.js');
const tmpPath=path.join(root,'.tmp-im-loc-opt-run.cjs');

const all=fs.readFileSync(regressionPath,'utf8');
const append=fs.readFileSync(appendPath,'utf8');
const marker='/* ════ 1. 문서 수치 재현';
const cut=all.indexOf(marker);
if(cut<0) throw new Error('regression setup cut marker not found');

/* regression-check의 실제 HTML 함수 추출/엔진 초기화 구간만 그대로 실행한다.
   전체 회귀 2천여 개는 연구 그리드마다 필요하지 않다.
   연구 본문에서 production alpha=1,row=3과 실험식 alpha=1,row=3의 final/MDD/cycle 완전 패리티를 다시 검증한다. */
const setup=all.slice(0,cut);
fs.writeFileSync(tmpPath,setup+'\nconst DAYS={};\n'+append+'\n');

const r=spawnSync(process.execPath,[tmpPath],{
  cwd:root,
  stdio:'inherit',
  timeout:20*60*1000
});
try{fs.unlinkSync(tmpPath);}catch(e){}
if(r.error) throw r.error;
process.exit(r.status==null?1:r.status);
