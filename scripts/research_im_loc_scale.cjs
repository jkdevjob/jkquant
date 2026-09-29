#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

const root=path.resolve(__dirname,'..');
const all=fs.readFileSync(path.join(root,'regression-check.js'),'utf8');
const append=fs.readFileSync(path.join(__dirname,'research_im_loc_scale_append.inc.js'),'utf8');
const marker='/* ════ 1. 문서 수치 재현';
const cut=all.indexOf(marker);
if(cut<0) throw new Error('regression setup cut marker not found');
const tmp=path.join(root,'.tmp-im-loc-scale-run.cjs');
fs.writeFileSync(tmp,all.slice(0,cut)+'\nconst DAYS={};\n'+append+'\n');
const r=spawnSync(process.execPath,[tmp],{cwd:root,stdio:'inherit',timeout:20*60*1000});
try{fs.unlinkSync(tmp);}catch(e){}
if(r.error) throw r.error;
process.exit(r.status==null?1:r.status);
