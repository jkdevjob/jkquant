// 부동산(클로드) 모의투자 장부 갱신 — node scripts/realestate_claude/paper.mjs
// series.json(원자료)을 읽어 전략 버전마다 자기 장부에 새 달의 결정·정산만 덧붙인다. 지난 기록은 고치지 않는다.
// 계산은 엔진의 paperUpdate 한 곳에서 한다(화면·백테와 같은 함수).
//   paper.json            — rec-wf-1 (지수 전략 첫 장부, 2026-08 자료부터)      realestate-claude-engine.js
//   paper-rec-wf-2.json   — rec-wf-2 (지수 전략 v2, 처음 만든 달 자료부터)     realestate-claude-engine.js
//   paper-apt-1.json      — apt-1   (아파트 단지 매매 전략, 처음 만든 달 자료부터) realestate-claude-apt.js
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const E = req(path.join(ROOT, 'realestate-claude-engine.js'));
const X = req(path.join(ROOT, 'realestate-claude-apt.js'));
const DIR = path.join(ROOT, 'data', 'realestate', 'claude');
const LEDGERS = [
  { file: 'paper.json', sv: 'rec-wf-1' },
  { file: 'paper-rec-wf-2.json', sv: 'rec-wf-2' },
];

const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'series.json'), 'utf8'));
const D = E.prepare(doc);
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
let bad = 0;
for (const { file, sv } of LEDGERS) {
  const p = path.join(DIR, file);
  const old = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  if (old && old.strategyVersion !== sv) {
    // 파일과 전략 버전이 어긋나면 덮어쓰지 않는다
    console.error(`${file}: 장부 전략 버전(${old.strategyVersion}) ≠ ${sv} — 건드리지 않습니다.`);
    bad++;
    continue;
  }
  const { ledger, added } = E.paperUpdate(old, D, { strategy: sv }, now);
  if (old) {
    // 덧붙이기만 했는지 다시 확인 — 지난 기록이 하나라도 바뀌면 저장하지 않는다.
    const same = (a, b) => a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    if (!same(old.decisions, ledger.decisions) || !same(old.marks, ledger.marks)) {
      console.error(`${file}: 지난 장부 기록이 바뀌었습니다 — 저장하지 않습니다.`);
      bad++;
      continue;
    }
  }
  if (!old || added.decisions || added.marks) fs.writeFileSync(p, JSON.stringify(ledger, null, 1) + '\n');
  console.log(`${sv} 장부: 결정 +${added.decisions} · 정산 +${added.marks} · 평가액 ${Math.round(ledger.acct.nav).toLocaleString('ko-KR')}원 · 보유 ${ledger.acct.pos || '현금'}`);
}
// 아파트 단지 매매 장부(apt-1)
{
  const file = 'paper-apt-1.json', p = path.join(DIR, file);
  const old = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  const apt = JSON.parse(fs.readFileSync(path.join(DIR, 'apt.json'), 'utf8'));
  const ev = JSON.parse(fs.readFileSync(path.join(DIR, 'events.json'), 'utf8'));
  const A = X.prepareApt(apt, D, ev);
  if (old && old.strategyVersion !== X.STRATEGY) {
    console.error(`${file}: 장부 전략 버전(${old.strategyVersion}) ≠ ${X.STRATEGY} — 건드리지 않습니다.`);
    bad++;
  } else {
    const { ledger, added } = X.paperUpdate(old, A, {}, now);
    const same = (a, b) => a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    if (old && (!same(old.months, ledger.months) || !same(old.trades, ledger.trades))) {
      console.error(`${file}: 지난 장부 기록이 바뀌었습니다 — 저장하지 않습니다.`);
      bad++;
    } else {
      if (!old || added) fs.writeFileSync(p, JSON.stringify(ledger, null, 1) + '\n');
      console.log(`${X.STRATEGY} 장부: 달 +${added} · 평가액 ${Math.round(ledger.acct.eq).toLocaleString('ko-KR')}만원 · 보유 ${ledger.acct.pos ? ledger.acct.pos.meta.name : '현금'}`);
    }
  }
}
process.exit(bad ? 3 : 0);
