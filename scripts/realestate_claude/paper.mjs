// 부동산(클로드) 모의투자 장부 갱신 — node scripts/realestate_claude/paper.mjs
// series.json(원자료)을 읽어 전략 버전마다 자기 장부에 새 달의 결정·정산만 덧붙인다. 지난 기록은 고치지 않는다.
// 계산은 realestate-claude-engine.js 의 paperUpdate 한 곳에서 한다(화면·백테와 같은 함수).
//   paper.json            — rec-wf-1 (첫 장부, 2026-08 자료부터)
//   paper-rec-wf-2.json   — rec-wf-2 (입주·매수우위 후보 추가, 처음 만든 달 자료부터)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = createRequire(import.meta.url)(path.join(ROOT, 'realestate-claude-engine.js'));
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
process.exit(bad ? 3 : 0);
