// 부동산(클로드) 모의투자 장부 갱신 — node scripts/realestate_claude/paper.mjs
// series.json(원자료)을 읽어 paper.json 에 새 달의 결정·정산만 덧붙인다. 지난 기록은 고치지 않는다.
// 계산은 realestate-claude-engine.js 의 paperUpdate 한 곳에서 한다(화면·백테와 같은 함수).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = createRequire(import.meta.url)(path.join(ROOT, 'realestate-claude-engine.js'));
const SERIES = path.join(ROOT, 'data', 'realestate', 'claude', 'series.json');
const PAPER = path.join(ROOT, 'data', 'realestate', 'claude', 'paper.json');

const doc = JSON.parse(fs.readFileSync(SERIES, 'utf8'));
const old = fs.existsSync(PAPER) ? JSON.parse(fs.readFileSync(PAPER, 'utf8')) : null;
if (old && old.strategyVersion !== E.STRATEGY_VERSION) {
  // 전략이 바뀌면 옛 장부를 덮어쓰지 않는다 — 새 버전 장부는 따로 시작해야 한다.
  console.error(`장부 전략 버전(${old.strategyVersion})과 엔진(${E.STRATEGY_VERSION})이 다릅니다. 새 장부 파일을 따로 만드세요.`);
  process.exit(2);
}
const { ledger, added } = E.paperUpdate(old, E.prepare(doc), {}, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
if (old) {
  // 덧붙이기만 했는지 다시 확인 — 지난 기록이 하나라도 바뀌면 저장하지 않는다.
  const same = (a, b) => a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
  if (!same(old.decisions, ledger.decisions) || !same(old.marks, ledger.marks)) {
    console.error('지난 장부 기록이 바뀌었습니다 — 저장하지 않습니다.');
    process.exit(3);
  }
}
fs.writeFileSync(PAPER, JSON.stringify(ledger, null, 1) + '\n');
console.log(`장부 갱신: 결정 +${added.decisions} · 정산 +${added.marks} · 평가액 ${Math.round(ledger.acct.nav).toLocaleString('ko-KR')}원 · 보유 ${ledger.acct.pos || '현금'}`);
