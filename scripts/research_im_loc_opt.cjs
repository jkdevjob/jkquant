#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

const root=path.resolve(__dirname,'..');
const regressionPath=path.join(root,'regression-check.js');
const appendPath=path.join(__dirname,'research_im_loc_opt_append.inc.js');
const tmpPath=path.join(root,'.tmp-im-loc-opt-run.cjs');

let src=fs.readFileSync(regressionPath,'utf8');
const append=fs.readFileSync(appendPath,'utf8');
const exitRe=/process\.exit\(fail===0\?0:1\);\s*$/;
if(!exitRe.test(src)) throw new Error('regression-check final exit marker not found');
src=src.replace(exitRe,'');
fs.writeFileSync(tmpPath,src+'\n'+append+'\n');

const r=spawnSync(process.execPath,[tmpPath],{
  cwd:root,
  stdio:'inherit',
  timeout:25*60*1000
});
try{fs.unlinkSync(tmpPath);}catch(e){}
if(r.error) throw r.error;
process.exit(r.status==null?1:r.status);
