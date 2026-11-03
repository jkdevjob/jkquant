// 수영대회 화면 — 공용 계산(swim-core.js) · 페이지 구조 · 텔레그램 중계 함수를 값으로 확인한다.
// 실행: node --test tests/swim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../swim-core.js');
const T = '2026-11-03';

const E = (o = {}) => ({ id: 'a', title: '제31회 대전 전국마스터즈수영대회', kind: 'masters', kinds: ['masters'], sports: ['경영'], sido: '대전', sigungu: '중구',
  region: '대전 중구', venue: '한밭수영장', start_date: '2026-12-05', end_date: '2026-12-06', apply_open: '2026-11-09', apply_close: '2026-11-16',
  status: 'scheduled', free50: null, free100: null, adult_ok: true, student_ok: true, first_seen: '2026-11-01', last_changed: '2026-11-01', changes: [], ...o });

test('접수 상태 — 예정 · 접수중 · 마감 · 미확정 · 종료 · 취소/연기', () => {
  assert.equal(C.applyStatus(E(), T), 'soon');
  assert.equal(C.applyStatus(E(), '2026-11-09'), 'open');
  assert.equal(C.applyStatus(E(), '2026-11-16'), 'open');
  assert.equal(C.applyStatus(E(), '2026-11-17'), 'closed');
  assert.equal(C.applyStatus(E({ apply_closed: true }), '2026-11-10'), 'closed', '공식 조기 마감');
  assert.equal(C.applyStatus(E({ apply_open: '', apply_close: '' }), T), 'unknown');
  assert.equal(C.applyStatus(E({ apply_open: '', apply_close: '2026-11-20' }), T), 'unknown', '마감일만 알면 접수중이라 단정하지 않는다');
  assert.equal(C.applyStatus(E({ end_date: '2026-11-01', start_date: '2026-11-01' }), T), 'ended');
  assert.equal(C.applyStatus(E({ status: 'cancelled' }), T), 'cancelled');
  assert.equal(C.applyStatus(E({ status: 'postponed' }), T), 'postponed');
});

const LIST = [
  E(),
  E({ id: 'b', title: '2027년 수영(다이빙) 국가대표 선발대회', kind: 'elite', kinds: ['elite'], sports: ['다이빙'], sido: '경북', sigungu: '김천시', region: '경북 김천시', venue: '김천실내수영장',
      start_date: '2026-11-12', end_date: '2026-11-14', apply_open: '', apply_close: '2026-11-02', free50: false, free100: false, adult_ok: false, student_ok: null, first_seen: '2026-11-03', last_changed: '2026-11-03' }),
  E({ id: 'c', title: '2026 성북구 체육회장배 수영대회', kind: 'other', kinds: ['other'], sido: '서울', sigungu: '성북구', region: '서울 성북구', venue: '성북레포츠센터',
      start_date: '2026-11-08', end_date: '2026-11-08', apply_open: '2026-10-20', apply_close: '2026-11-05', free50: true, free100: true, adult_ok: true, student_ok: null,
      first_seen: '2026-10-01', last_changed: '2026-11-02', changes: [{ date: '2026-11-02', type: 'updated', fields: { start_date: ['2026-11-01', '2026-11-08'] } }] }),
  E({ id: 'd', title: '제4회 김천 전국 마스터즈 수영대회', sido: '경북', sigungu: '김천시', region: '경북 김천시', start_date: '2026-08-29', end_date: '2026-08-30',
      apply_open: '2026-07-01', apply_close: '2026-08-14', free50: true, free100: true }),
  E({ id: 'e', title: '제22회 꿈나무 전국수영대회', kind: 'elite', kinds: ['elite', 'student'], sido: '경북', sigungu: '김천시', region: '경북 김천시', venue: '김천실내수영장', start_date: '2027-01-20', end_date: '2027-01-22',
      apply_open: '', apply_close: '', adult_ok: false, student_ok: true, first_seen: '2026-11-03' }),
];

test('필터 — 지역 · 구분 · 종목 · 기간 · 상태 · 자격 · 자유형 · 검색을 함께 적용', () => {
  const ids = f => LIST.filter(e => C.matches(e, f, T, '2026-11-02')).map(e => e.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'e'], '기본은 끝나지 않은 대회');
  assert.deepEqual(ids({ period: 'all' }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ period: 'past' }), ['d']);
  assert.deepEqual(ids({ period: 'month' }), ['b', 'c']);
  assert.deepEqual(ids({ period: 'next' }), ['a']);
  assert.deepEqual(ids({ period: '3m' }), ['a', 'b', 'c', 'e']);
  assert.deepEqual(ids({ sido: '경북' }), ['b', 'e']);
  assert.deepEqual(ids({ sido: '경북', sigungu: '김천시', kind: 'elite', period: 'all' }), ['b', 'e']);
  assert.deepEqual(ids({ kind: 'student' }), ['e'], '여러 구분 중 하나만 맞아도');
  assert.deepEqual(ids({ sport: '다이빙' }), ['b']);
  assert.deepEqual(ids({ status: 'soon' }), ['a']);
  assert.deepEqual(ids({ status: 'closed' }), ['b']);
  assert.deepEqual(ids({ status: 'unknown' }), ['e']);
  assert.deepEqual(ids({ elig: 'adult' }), ['a', 'c']);
  assert.deepEqual(ids({ elig: 'student' }), ['a', 'e']);
  assert.deepEqual(ids({ elig: 'elite' }), ['b', 'e']);
  assert.deepEqual(ids({ free: '50' }), ['c']);
  assert.deepEqual(ids({ free: 'both', period: 'all' }), ['c', 'd']);
  assert.deepEqual(ids({ free: 'unknown' }), ['a', 'e']);
  assert.deepEqual(ids({ q: '김천 마스터즈', period: 'all' }), ['d'], '여러 낱말은 모두 포함');
  assert.deepEqual(ids({ q: '한밭' }), ['a'], '장소 검색');
  assert.deepEqual(ids({ quick: 'masters' }), ['a']);
  assert.deepEqual(ids({ quick: 'elite' }), ['b', 'e']);
  assert.deepEqual(ids({ quick: 'free' }), ['c']);
  assert.deepEqual(ids({ quick: 'open' }), ['c']);
  assert.deepEqual(ids({ status: 'open' }), ['c']);
  assert.deepEqual(ids({ quick: 'new' }), ['b', 'c', 'e'], '기준선 뒤 신규 + 최근 변경');
  assert.deepEqual(ids({ quick: 'masters', sido: '서울' }), [], '빠른 검색도 다른 필터와 함께');
});

test('정렬 7종', () => {
  const ord = k => C.sortList(LIST, k, T).map(e => e.id).join('');
  assert.equal(ord('date'), 'dcbae', '개최일 빠른 순');
  assert.equal(ord('date_desc'), 'eabcd', '개최일 늦은 순');
  assert.equal(ord('deadline'), 'cadbe', '마감 안 지난 것(c 11/5 · a 11/16) 먼저 · 나머지는 개최일순');
  assert.equal(ord('recent'), 'bedac', '최근 등록순(같은 날은 개최일순)');
  assert.equal(ord('changed'), 'bcdae', '최근 변경순');
  assert.equal(ord('region'), 'dbeac', '시·도 → 시·군·구 → 개최일');
  assert.equal(ord('name'), 'cbead', '대회명순');
});

test('통계 · 지역 목록 · 페이지 나눔', () => {
  const s = C.stats(LIST, T, '2026-11-02');
  assert.deepEqual(s, { total: 5, upcoming: 4, open: 1, fresh: 2, changed: 1 });
  assert.deepEqual(C.regions(LIST), { 경북: ['김천시'], 대전: ['중구'], 서울: ['성북구'] });
  const many = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(C.paginate(many, 1, 20).items.length, 20);
  assert.deepEqual(C.paginate(many, 3, 20), { page: 3, pages: 3, items: many.slice(40), from: 41, to: 45 });
  assert.equal(C.paginate(many, 99, 20).page, 3, '범위 밖 페이지는 마지막으로');
  assert.equal(C.paginate([], 1, 20).from, 0);
});

const html = fs.readFileSync('swim.html', 'utf8');
test('페이지 — 로그인 승인 가드를 실제로 부른다(이전 판: 화면 전체가 비어 있던 회귀)', () => {
  assert.match(html, /<script src="\/jk-access\.js" data-guard="1"><\/script>/);
  assert.match(html, /JKAccess\.guard\(\{auth,db,doc,getDoc,setDoc,onAuthStateChanged,signInWithPopup,GoogleAuthProvider,signOut\}/);
  const mutated = html.replace(/JKAccess\.guard\([^\n]*\n/, '\n');
  assert.doesNotMatch(mutated, /JKAccess\.guard\(/, '변이: guard 호출을 빼면 이 시험이 잡는다');
});

test('페이지 — 빠른 검색 6종 · 필터 · 정렬 7종 · 버전 · 공용 계산 · 상세 링크', () => {
  for (const q of ['', 'masters', 'elite', 'free', 'open', 'new']) assert.ok(html.includes(`data-quick="${q}"`), q);
  for (const id of ['q', 'sido', 'sigungu', 'kind', 'sport', 'period', 'status', 'elig', 'free', 'sort', 'reset', 'pager', 'detail', 'health'])
    assert.ok(html.includes(`id="${id}"`), id);
  const sorts = [...html.matchAll(/<select id="sort">([\s\S]*?)<\/select>/g)][0][1].match(/<option /g).length;
  assert.equal(sorts, 7);
  for (const p of ['upcoming', 'month', 'next', '3m', 'all']) assert.ok(html.includes(`value="${p}"`), p);
  assert.match(html, /id="swimVer">v\d+\.\d+\.\d+<\/span>/);
  assert.ok(html.includes('/swim-core.js?v='));
  assert.ok(html.includes("searchParams.get('id')"), '알림 링크 ?id= 로 상세 바로 열기');
  assert.match(html, /if\(id\)whenApproved\(\(\)=>openDetail\(id,false\)\)/, '승인 전에는 상세 창(배경막)이 로그인 화면을 덮지 않게');
  assert.ok(html.includes('https://raw.githubusercontent.com/jkdevjob/jkquant/main/data/swim/'), '[skip ci] 데이터 커밋도 바로 보이게 저장소 원본을 읽는다');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  new vm.Script(inline, { filename: 'swim.html(inline)' });
});

test('텔레그램 중계 — 인증 · 본문 형식 · 링크 제한 · 방 선택', async () => {
  const M = await import('../functions/api/swim-alert.js');
  const req = k => ({ headers: { get: h => (h === 'x-monitor-key' ? k : '') } });
  assert.equal(M.authorized(req('k1'), { AUTOTRADE_KEY: 'k1' }), true);
  assert.equal(M.authorized(req('x'), { AUTOTRADE_KEY: 'k1' }), false);
  assert.equal(M.authorized(req(''), {}), false, '키가 없으면 거절');
  const ok = '<b>[수영대회] 🏊 새 소식 1건</b>\n• <a href="https://jkquant.pages.dev/swim?id=abc123def456">대회</a>\n<a href="https://jkquant.pages.dev/swim">전체</a>';
  assert.equal(M.validText(ok), true);
  assert.equal(M.validText(ok.replace('[수영대회]', '[기타]')), false);
  assert.equal(M.validText(ok.replace('https://jkquant.pages.dev/swim?id=abc123def456', 'https://evil.example/')), false);
  assert.equal(M.chatOf({ TELEGRAM_SWIM_CHAT_ID: '-1', TELEGRAM_JOB_CHAT_ID: '-2' }), '-1');
  assert.equal(M.chatOf({ TELEGRAM_JOB_CHAT_ID: '-2' }), '-2');
  const long = Array.from({ length: 300 }, (_, i) => '줄 ' + i + ' '.repeat(20)).join('\n');
  assert.ok(M.splitText(long).every(x => x.length <= 3900));
  const r = await M.onRequestPost({ request: { headers: { get: () => 'bad' }, json: async () => ({}) }, env: { AUTOTRADE_KEY: 'k' } });
  assert.equal(r.status, 401);
});

test('메뉴 — 수영대회가 공용 메뉴 정책에 등록(공개 · JOB 아래)', () => {
  const acc = fs.readFileSync('jk-access.js', 'utf8'), ui = fs.readFileSync('jk-ui.js', 'utf8');
  assert.match(acc, /\{path:'\/swim',label:'수영대회',mode:'public',order:81,after:'\/job'\}/);
  assert.ok(ui.includes("'/swim':'수영대회'"));
});
