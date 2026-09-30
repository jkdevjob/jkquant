import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../functions/api/kis.js',import.meta.url),'utf8');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(s+'\nexport {validMinuteHistoryCode,KRCODE};').toString('base64'));
function probe(m){
  for(const code of ['005930','0123A0','45014K'])assert.equal(m.validMinuteHistoryCode(code),true,code);
  for(const code of ['AAPL','45014K0','../abc','ABCDEF','45014!'])assert.equal(m.validMinuteHistoryCode(code),false,code);
  assert.equal(m.KRCODE.test('45014K'),false,'shared order validation remains unchanged');
}
probe(await load(source));
const old=source.replace('return KRCODE.test(code)||/^\\d{5}[A-Z]$/.test(code);','return KRCODE.test(code);');
assert.notEqual(source,old);
const mutant=await load(old);
assert.throws(()=>probe(mutant));
assert(source.includes('if (!validMinuteHistoryCode(code))'));
console.log('KIS historical preferred-code values + old-code mutation: ALL PASS');
