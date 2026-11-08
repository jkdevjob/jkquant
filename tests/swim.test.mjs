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
  status: 'scheduled', adult_ok: true, student_ok: true, first_seen: '2026-11-01', last_changed: '2026-11-01', changes: [], ...o });

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
      start_date: '2026-11-12', end_date: '2026-11-14', apply_open: '', apply_close: '2026-11-02', adult_ok: false, student_ok: null, first_seen: '2026-11-03', last_changed: '2026-11-03' }),
  E({ id: 'c', title: '2026 성북구 체육회장배 수영대회', kind: 'other', kinds: ['other'], sido: '서울', sigungu: '성북구', region: '서울 성북구', venue: '성북레포츠센터',
      start_date: '2026-11-08', end_date: '2026-11-08', apply_open: '2026-10-20', apply_close: '2026-11-05', adult_ok: true, student_ok: null,
      first_seen: '2026-10-01', last_changed: '2026-11-02', changes: [{ date: '2026-11-02', type: 'updated', fields: { start_date: ['2026-11-01', '2026-11-08'] } }] }),
  E({ id: 'd', title: '제4회 김천 전국 마스터즈 수영대회', sido: '경북', sigungu: '김천시', region: '경북 김천시', start_date: '2026-08-29', end_date: '2026-08-30',
      apply_open: '2026-07-01', apply_close: '2026-08-14', }),
  E({ id: 'e', title: '제22회 꿈나무 전국수영대회', kind: 'elite', kinds: ['elite', 'student'], sido: '경북', sigungu: '김천시', region: '경북 김천시', venue: '김천실내수영장', start_date: '2027-01-20', end_date: '2027-01-22',
      apply_open: '', apply_close: '', adult_ok: false, student_ok: true, first_seen: '2026-11-03' }),
];

test('필터 — 지역 · 구분 · 종목 · 기간 · 상태 · 자격 · 검색을 함께 적용', () => {
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
  assert.deepEqual(ids({ q: '김천 마스터즈', period: 'all' }), ['d'], '여러 낱말은 모두 포함');
  assert.deepEqual(ids({ q: '한밭' }), ['a'], '장소 검색');
  assert.deepEqual(ids({ quick: 'masters' }), ['a']);
  assert.deepEqual(ids({ quick: 'elite' }), ['b', 'e']);
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
  for (const q of ['', 'masters', 'elite', 'open', 'new', 'results']) assert.ok(html.includes(`data-quick="${q}"`), q);
  assert.equal((html.match(/data-quick="/g) || []).length, 6, '빠른 검색 6종(자유형 50·100 삭제 2026-11-04 · 지난 대회 결과 추가 2026-11-08)');
  assert.doesNotMatch(html, /자유형 50m|free50|id="free"/, '자유형 50·100 기능은 화면에서 완전히 뺀다');
  for (const id of ['q', 'sido', 'sigungu', 'kind', 'sport', 'period', 'status', 'elig', 'sort', 'reset', 'pager', 'detail', 'health'])
    assert.ok(html.includes(`id="${id}"`), id);
  const sorts = [...html.matchAll(/<select id="sort">([\s\S]*?)<\/select>/g)][0][1].match(/<option /g).length;
  assert.equal(sorts, 7);
  for (const p of ['upcoming', 'month', 'next', '3m', 'all']) assert.ok(html.includes(`value="${p}"`), p);
  assert.match(html, /id="swimVer">v\d+\.\d+\.\d+<\/span>/);
  assert.ok(html.includes('/swim-core.js?v='));
  assert.ok(html.includes("searchParams.get('id')"), '알림 링크 ?id= 로 상세 바로 열기');
  assert.match(html, /\(e\.guide_links\|\|\[\]\)/, '공식 주소가 아닌 요강 링크(연맹 카페 등)도 상세에 버튼으로');
  assert.match(html, /\(e\.related\|\|\[\]\)/, '검색으로 찾은 관련 글을 상세에');
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

// ── 웹 알림(설정 → 알림 → '전국 수영대회 신규·변경') — 실제 푸시 Worker 의 구독 · 확인 경로를 실행한다(전송은 가짜) ──
async function swimWorker(file = '../worker/presale-alert/src/index.js') {
  const { PresaleAlertStore } = await import(file);
  const values = new Map(), calls = [];
  const storage = { get: async k => values.get(k), put: async (k, v) => values.set(k, v), delete: async k => values.delete(k),
    list: async ({ prefix } = {}) => new Map([...values].filter(([k]) => !prefix || k.startsWith(prefix))), getAlarm: async () => null };
  const app = new PresaleAlertStore({ storage }, { MONITOR_KEY: 'k' });
  app.pushOne = async (endpoint, topic) => { calls.push({ endpoint, topic }); return { ok: true, status: 201 }; };
  const req = (path, body) => new Request('https://alerts.example' + path, { method: 'POST', headers: { origin: 'https://jkquant.pages.dev', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  await app.fetch(req('/subscribe', { subscription: { endpoint: 'https://push.example/swim' }, topics: ['swim'], topicSchemaVersion: 2 }));
  await app.fetch(req('/subscribe', { subscription: { endpoint: 'https://push.example/job' }, topics: ['job'], topicSchemaVersion: 2 }));
  const check = async doc => (await app.checkSwim(req('/check-swim'), doc)).json();
  return { app, calls, check, values };
}
const kst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const comp = (id, o = {}) => ({ id, title: '대회 ' + id, region: '대전 중구', venue: '한밭수영장', start_date: plus(20), end_date: plus(21),
  apply_open: plus(5), apply_close: plus(10), status: 'scheduled', ...o });
const DOC = list => ({ schema_version: 2, competitions: list });

async function swimAlertFlow(file) {
  const w = await swimWorker(file);
  const base = [comp('aaaaaaaaaaaa'), comp('bbbbbbbbbbbb'), comp('cccccccccccc', { start_date: '2026-01-01', end_date: '2026-01-01' })];
  const r0 = await w.check(DOC(base));
  assert.equal(r0.baseline, true, '첫 확인은 기준선');
  assert.equal(w.calls.length, 0, '기준선에서는 보내지 않는다');
  assert.equal((await w.check(DOC(base))).newCount, 0);
  assert.equal(w.calls.length, 0, '바뀐 것 없으면 안 보낸다');
  const next = [comp('aaaaaaaaaaaa', { venue: '용운국제수영장' }), comp('bbbbbbbbbbbb', { title: '대회 b (이름만 고침)' }),
    comp('dddddddddddd'), comp('eeeeeeeeeeee', { start_date: '2025-05-01', end_date: '2025-05-01' })];
  const r1 = await w.check(DOC(next));
  assert.equal(r1.newCount, 1, '새 대회 1(끝난 대회 e 는 제외)');
  assert.equal(r1.changedCount, 1, '장소 바뀐 a 만 변경(이름만 고친 b 는 아님)');
  assert.equal(r1.alert.type, 'swim');
  assert.equal(r1.alert.url, 'https://jkquant.pages.dev/swim?id=dddddddddddd', '알림을 누르면 그 대회 상세');
  assert.match(r1.alert.title, /신규 1 · 변경 1/);
  assert.deepEqual(w.calls.map(c => c.endpoint), ['https://push.example/swim'], '수영대회를 켠 기기만 한 번');
  assert.equal((await w.check(DOC(next))).newCount, 0);
  assert.equal(w.calls.length, 1, '같은 내용은 다시 보내지 않는다');
  const r2 = await w.check(DOC([...next.slice(0, 3), comp('dddddddddddd', { status: 'cancelled' })].slice(1)));
  assert.equal(r2.changedCount, 1, '취소도 변경으로 알린다');
  return w;
}
test('웹 알림 — 수영대회 신규·변경: 기준선 · 변경 항목 · 켠 기기만 · 반복 금지 · 상세 링크', async () => {
  const w = await swimAlertFlow();
  const health = await (await w.app.fetch(new Request('https://alerts.example/health', { headers: { origin: 'https://jkquant.pages.dev' } }))).json();
  assert.equal(health.topicSubscriptions.swim, 1);
  assert.ok(health.lastChecks.swim);
  const sw = fs.readFileSync('jk-sw.js', 'utf8'), st = fs.readFileSync('settings-notifications.js', 'utf8');
  assert.match(sw, /VALID_TOPICS=new Set\(\[[^\]]*"swim"/, '서비스워커가 수영대회 알림을 표시한다');
  assert.match(st, /\{topic:"swim",href:"\/swim",icon:"🏊",name:"전국 수영대회 신규·변경"/, '설정 메뉴에 항목');
  const wsrc = fs.readFileSync('worker/presale-alert/src/index.js', 'utf8');
  assert.match(wsrc, /stub\.fetch\(new Request\("https:\/\/internal\/check-swim"/, '정기 확인(:07 · :37)에 포함');
});

test('웹 알림 — 변이: 기준선 없음 · 장소를 변경으로 안 봄 · 끝난 대회 포함 → 빨간불', async () => {
  const src = fs.readFileSync('worker/presale-alert/src/index.js', 'utf8');
  const mutants = [
    ['기준선 없음(기록이 없으면 빈 기록으로 시작)', 'const key="seen:swim",seen=await this.state.storage.get(key);', 'const key="seen:swim",seen=(await this.state.storage.get(key))||{};'],
    ['장소 변경 무시', 'return [c.start_date,c.end_date,c.venue,', 'return [c.start_date,c.end_date,'],
    ['끝난 대회 포함', 'if(!end||end<today)continue;', 'if(!end)continue;'],
  ];
  for (const [name, a, b] of mutants) {
    assert.equal(src.split(a).length - 1, 1, name + ' 변이 위치');
    const file = new URL('../worker/presale-alert/src/__mut_swim_' + process.pid + '.mjs', import.meta.url);
    fs.writeFileSync(file, src.replace(a, b));
    try { await assert.rejects(swimAlertFlow(file.href), assert.AssertionError, name + ' 변이를 잡아야 한다'); }
    finally { fs.unlinkSync(file); }
  }
});

// ── 지난 대회 결과(2026-11-08 사용자: "결과지 다운로드 또는 파일 읽어서 내용 볼 수 있게") ──
// 결과지 내용은 저장소에 없다. 화면은 이름 · 주소만 받아 /api/swim-file · /api/swim-result 로 원래 사이트에서 가져온다.
const RS = require('../swim-results.js');
const PAST = E({ id: 'p', title: '제7회 성동구수영연맹회장배 수영대회', start_date: '2026-04-12', end_date: '2026-04-12', apply_open: '', apply_close: '',
  results: [
    { kind: 'system', source: 'sports_result_sw', source_name: '대한수영연맹 경기결과', tier: 'official', title: 'x', url: 'https://result.sports.or.kr/SW/INF201.do', sys: 'SW', classCd: 'D2', toCd: '202616053' },
    { kind: 'files', source: 'seoulswim_result', source_name: '서울 결과', tier: 'official', title: '성동구 경기결과 <b>', url: 'http://www.seoulswim.or.kr/bbs/board.php?bo_table=result&wr_id=104', posted: '2026-04-13',
      files: [{ name: '결과.pdf', url: 'http://www.seoulswim.or.kr/bbs/download.php?bo_table=result&wr_id=104&no=0', ext: 'pdf' },
              { name: '결과.hwp', url: 'http://www.seoulswim.or.kr/bbs/download.php?bo_table=result&wr_id=104&no=1', ext: 'hwp' }] },
    { kind: 'link', source: 'whoisfast_records', source_name: 'Whoisfast 기록 검색', tier: 'secondary', title: '기록 검색', url: 'https://whoisfast.com/search?qtype=meet&q=a' },
    { kind: 'link', source: 'x', title: '나쁜 링크', url: 'javascript:alert(1)' },
    { kind: 'system', sys: 'XX', classCd: 'D2', toCd: '1' },
  ] });

test('결과 — 필터: 결과 있음 · 빠른 검색(지난 대회 결과)은 기간을 따로 안 골랐으면 이력 전체에서', () => {
  const L = [...LIST, PAST];
  const ids = f => L.filter(e => C.matches(e, f, T, '2026-11-02')).map(e => e.id);
  assert.deepEqual(ids({ status: 'result' }), ['p']);
  assert.deepEqual(ids({ quick: 'results' }), ['p']);
  assert.deepEqual(ids({ quick: 'results', period: 'month' }), [], '기간을 고르면 그 기간 안에서만');
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'e'], '기본 목록은 그대로');
  assert.equal(C.hasResults(PAST), true);
  assert.equal(C.hasResults(E()), false);
});

test('결과 — 상세 칸: 결과 시스템 · 파일(보기 · 받기) · 기록 검색, 형식이 틀린 항목은 버린다', () => {
  assert.equal(RS.list(PAST).length, 3, '자바스크립트 주소 · 모르는 결과 시스템은 버린다');
  const h = RS.section(PAST, '2026-11-08');
  assert.match(h, /🏁 대회 결과/);
  assert.match(h, /data-res="sys" data-i="0"/);
  assert.match(h, /data-res="view" data-i="1" data-j="0"/, 'PDF 는 보기');
  assert.doesNotMatch(h, /data-res="view" data-i="1" data-j="1"/, '한글 파일은 받기만');
  assert.ok(h.includes('href="/api/swim-file?u=' + encodeURIComponent('http://www.seoulswim.or.kr/bbs/download.php?bo_table=result&wr_id=104&no=1').replace(/&/g, '&amp;') + '"'), '받기는 중계 함수로');
  assert.ok(h.includes('성동구 경기결과 &lt;b&gt;'), '글 제목은 글자로만');
  assert.ok(h.includes('https://whoisfast.com/search?qtype=meet&amp;q=a'));
  assert.doesNotMatch(h, /javascript:/);
  assert.match(RS.section(E({ start_date: '2026-04-01', end_date: '2026-04-01', results: [] }), '2026-11-08'), /아직 결과지를 찾지 못했습니다/, '지난 대회인데 결과가 없으면 안내');
  assert.equal(RS.section(E(), '2026-11-03'), '', '열리지 않은 대회에는 결과 칸이 없다');
  assert.equal(RS.sysQuery(PAST.results[0], 'round', { kind: 'S', dc: 'D2S01', rh: '9' }), '/api/swim-result?sys=SW&classCd=D2&toCd=202616053&op=round&kind=S&dc=D2S01&rh=9');
  assert.deepEqual(['pdf', 'xlsx', 'xls', 'png', 'hwp', 'zip'].map(RS.viewKind), ['pdf', 'sheet', 'sheet', 'image', '', '']);
});

test('결과 — 페이지: 빠른 검색 · 상태 필터 · 상세 결과 칸 · 보기 창 연결 · 카드 표시', () => {
  assert.ok(html.includes('data-quick="results"'));
  assert.ok(html.includes('<option value="result">결과 있음(지난 대회)</option>'));
  assert.ok(html.includes('<script src="/swim-results.js?v='));
  assert.match(html, /h\+=R\.section\(e,T\);/);
  assert.match(html, /\$\('dBody'\)\.addEventListener\('click',ev=>\{if\(cur&&R\.click\(ev,cur\)\)/, '상세 본문에 한 번만 붙인 위임 처리기');
  assert.match(html, /tag res">🏁 결과/);
  const src = fs.readFileSync('swim-results.js', 'utf8');
  assert.ok(src.includes("const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/'"), 'pdf.js 판 고정(한글 CMap 포함)');
  assert.ok(src.includes("cMapUrl:PDFJS+'cmaps/'"), '한글 PDF 는 CMap 이 있어야 글자가 보인다');
  assert.ok(src.includes("const XLSXJS='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'"));
  assert.doesNotMatch(src, /innerHTML\s*=\s*[^;]*\b(?:html|text)\b\s*[;+]/, '원래 사이트의 HTML 을 그대로 넣지 않는다');
});

// ── 결과 중계 함수: 공개 자료에 있는 결과만 · 그누보드 글 → 파일 · 안내 화면 거르기 · 결과 시스템 표 풀기 ──
const DOCX = { schema_version: 2, competitions: [PAST, E({ id: 'q', results: [{ kind: 'files', direct: true, url: 'http://www.busanswimming.kr/data01.asp',
  files: [{ name: '부산 기록지.pdf', url: 'http://www.busanswimming.kr/data/26-04.pdf', ext: 'pdf' }] }] })] };
const PDFB = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(200));
function upstream(map) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const v = map[String(url)];
    if (!v) return new Response('nf', { status: 404 });
    return typeof v === 'function' ? v(init) : v.clone();
  };
  return { calls, fetchImpl };
}
async function fileFlow(file = '../functions/api/swim-file.js') {
  const F = await import(file);
  const loader = async () => DOCX;
  const get = (u, up) => F.handle(new Request('https://jkquant.pages.dev/api/swim-file?u=' + encodeURIComponent(u)), { fetchImpl: up.fetchImpl, docLoader: loader });
  const post = 'http://www.seoulswim.or.kr/bbs/board.php?bo_table=result&wr_id=104', pdf = 'http://www.seoulswim.or.kr/bbs/download.php?bo_table=result&wr_id=104&no=0';
  // ① 그누보드: 글을 먼저 열어 받은 쿠키로 파일을 받는다
  // 경기도 연맹처럼 글을 열며 세션 쿠키를 새로 바꿔 두 번 보내면 나중 값만 써야 한다(앞의 값을 함께 보내면 PHP 가 버려진 세션을 읽음)
  const sessOk = init => { const ck = (init.headers && init.headers.cookie) || ''; return /(^|; )PHPSESSID=abc123(;|$)/.test(ck) && !/PHPSESSID=old/.test(ck) && /(^|; )v=1(;|$)/.test(ck); };
  let up = upstream({ [post]: new Response('<html>글</html>', { headers: [['set-cookie', 'PHPSESSID=old; path=/'], ['set-cookie', 'v=1; path=/'], ['set-cookie', 'PHPSESSID=abc123; path=/; HttpOnly']] }),
    [pdf]: init => (sessOk(init) && init.headers.referer === post) ? new Response(PDFB, { headers: { 'content-type': 'file/unknown' } })
      : new Response('<script>alert("잘못된 접근입니다.")</script>', { headers: { 'content-type': 'text/html' } }) });
  let r = await get(pdf, up);
  assert.equal(r.status, 200, '글 → 파일 순서로 받는다');
  assert.deepEqual(up.calls.map(c => c.url), [post, pdf]);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="[^"]*\.pdf"; filename\*=UTF-8''%EA%B2%B0%EA%B3%BC\.pdf$/);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(new TextDecoder().decode((await r.arrayBuffer()).slice(0, 4)), '%PDF');
  // ② 원래 사이트가 파일 대신 안내 화면을 보내면 넘기지 않는다
  up = upstream({ [post]: new Response('글'), [pdf]: new Response('<script>alert("잘못된 접근입니다.")</script>', { headers: { 'content-type': 'text/html' } }) });
  r = await get(pdf, up);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).source, post, '원문 글로 가는 길을 알려 준다');
  // ③ 공개 자료에 없는 주소는 대신 받아 주지 않는다(열린 중계 금지)
  up = upstream({ 'https://evil.example/x.pdf': new Response(PDFB) });
  r = await get('https://evil.example/x.pdf', up);
  assert.equal(r.status, 403);
  assert.equal(up.calls.length, 0);
  // ④ 바로 받아지는 파일(부산 기록지)은 글을 거치지 않는다
  up = upstream({ 'http://www.busanswimming.kr/data/26-04.pdf': new Response(PDFB) });
  r = await get('http://www.busanswimming.kr/data/26-04.pdf', up);
  assert.equal(r.status, 200);
  assert.deepEqual(up.calls.map(c => c.url), ['http://www.busanswimming.kr/data/26-04.pdf']);
  // ⑤ 글 주소가 다른 주소로 넘기면(302) 그 사이에 받은 쿠키도 모은다
  const moved = 'http://www.seoulswim.or.kr/bbs/board.php?bo_table=result&wr_id=104&v=2';
  up = upstream({ [post]: new Response('', { status: 302, headers: [['location', moved], ['set-cookie', 'v=1; path=/']] }),
    [moved]: init => new Response('글', { headers: [['set-cookie', 'PHPSESSID=abc123; path=/']] }),
    [pdf]: init => sessOk(init) ? new Response(PDFB) : new Response('<script>alert("잘못된 접근입니다.")</script>', { headers: { 'content-type': 'text/html' } }) });
  r = await get(pdf, up);
  assert.equal(r.status, 200, '넘겨진 주소에서 받은 쿠키까지 모아 보낸다');
  assert.deepEqual(up.calls.map(c => c.url), [post, moved, pdf]);
  return F;
}
test('결과 중계(파일) — 그누보드 글 → 파일 · 안내 화면 거르기 · 목록에 없는 주소 거절 · 바로 받기', async () => {
  const F = await fileFlow();
  assert.equal(F.sniffOk('pdf', PDFB), true);
  assert.equal(F.sniffOk('xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 0])), true);
  assert.equal(F.sniffOk('xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), true);
  assert.equal(F.sniffOk('pdf', new TextEncoder().encode('<html>점검 중</html>')), false);
  assert.equal(F.cookieHeader(new Headers([['set-cookie', 'a=1; path=/'], ['set-cookie', 'b=2; HttpOnly']])), 'a=1; b=2');
  assert.equal(F.cookieHeader(new Headers([['set-cookie', 's=old'], ['set-cookie', 'b=2'], ['set-cookie', 's=new']])), 'b=2; s=new', '같은 이름은 나중 값');
});

const EV_HTML = `<table><tbody><!-- <tr onclick="javascript:fnEventSchedule(&#34;Q&#34;,&#34;D2Q99&#34;)"><td>주석</td></tr> -->
<tr style="cursor:pointer;" onclick="javascript:fnEventSchedule(&#34;S&#34;,&#34;D2S01&#34;)"><td>남자유년부</td><td>자유형50m</td><td>개인</td><td class="tar">58</td><td></td></tr>
<tr onclick="javascript:fnEventSchedule(&#34;U&#34;,&#34;D2U64&#34;)"><td>남자초등부</td><td>혼계영200m</td><td>단체</td><td>33</td><td>8</td></tr></tbody></table>`;
const RO_HTML = `<table><tbody><tr><td> 2026.11.06 </td><td class="tac"> 예선 </td><td><button onclick="fnStartList(&#34;1&#34;)">보기</button></td>
<td><button onclick="fnGameResult(&#34;1&#34;)">보기</button></td></tr><tr><td>2026.11.06</td><td>결승</td><td></td><td><button onclick="fnGameResult(&#34;9&#34;)">보기</button></td></tr>
<tr><td>2025.11.02</td><td>결승Final</td><td><button onclick="fnGameResult(
  '379000',
  '37OTA', 'O')">보기</button></td></tr></tbody></table>`;
const RD_HTML = `<table class="mob-table"><caption>경기정보</caption><tbody><tr><th>종별/세부종목</th><td>자유형50m</td></tr></tbody></table>
<table class="table-hover"><caption> </caption><thead><tr><th>순위</th><th>레인</th><th colspan="3">소속(시도)</th><th colspan="2">이름(학년)</th><th>예선기록</th><th>기록</th><th>비고</th></tr></thead>
<tbody><!-- <tr><td colspan="6"><strong>결승</strong></td></tr> -->
<tr><td>1</td><td>4</td><td colspan="3">가나스포츠(인천)</td><td colspan="2"><a href="javascript:fnViewHistory('1');"> 홍길동(4) </a></td><td>00:30.28</td><td><a href="#">00:30.13</a></td><td></td></tr>
<tr id="subResultHeader01_1" style="display: none;"><th>50M</th><th>100M</th></tr><tr id="subResultBody01_1" style="display: none;"><td>00:30.13</td><td></td></tr>
<tr><td colspan="10" class="left"><strong>결승Final</strong></td></tr>
<tr><td>2</td><td>5</td><td colspan="3">다라클럽(서울)</td><td colspan="2">김가람(4)</td><td>00:31.00</td><td>00:30.90</td><td>&nbsp;</td></tr></tbody></table>`;
async function resultFlow(file = '../functions/api/swim-result.js') {
  const M = await import(file);
  const loader = async () => DOCX;
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: init && init.body }); return new Response(/INF202/.test(url) ? EV_HTML : /INF301/.test(url) ? RO_HTML : RD_HTML); };
  const get = q => M.handle(new Request('https://jkquant.pages.dev/api/swim-result?' + q), { fetchImpl, docLoader: loader });
  let r = await get('sys=SW&classCd=D2&toCd=202616053&op=events');
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.events.map(e => [e.kind, e.dc, e.group, e.event, e.type, e.entries, e.teams]),
    [['S', 'D2S01', '남자유년부', '자유형50m', '개인', '58', ''], ['U', 'D2U64', '남자초등부', '혼계영200m', '단체', '33', '8']], '주석 처리된 줄은 읽지 않는다');
  j = await (await get('sys=SW&classCd=D2&toCd=202616053&op=rounds&kind=S&dc=D2S01')).json();
  assert.deepEqual(j.rounds, [{ rh: '1', dc: '', kind: '', date: '2026.11.06', label: '예선' }, { rh: '9', dc: '', kind: '', date: '2026.11.06', label: '결승' },
    { rh: '379000', dc: '37OTA', kind: 'O', date: '2025.11.02', label: '결승Final' }], 'SW 열쇠 하나 · UW 열쇠 셋');
  j = await (await get('sys=SW&classCd=D2&toCd=202616053&op=round&kind=S&dc=D2S01&rh=9')).json();
  assert.equal(j.tables.length, 1, '경기정보 표는 결과 표가 아니다');
  assert.deepEqual(j.tables[0].head, ['순위', '레인', '소속(시도)', '이름(학년)', '예선기록', '기록', '비고']);
  assert.deepEqual(j.tables[0].rows, [{ cells: ['1', '4', '가나스포츠(인천)', '홍길동(4)', '00:30.28', '00:30.13', ''] }, { section: '결승Final' },
    { cells: ['2', '5', '다라클럽(서울)', '김가람(4)', '00:31.00', '00:30.90', ''] }], '숨긴 구간 기록 줄은 빼고 · 구역 이름은 따로');
  assert.match(calls.at(-1).body, /rhCd=9/);
  assert.match(calls.at(-1).body, /gubun=T/);
  assert.equal(calls.at(-1).url, 'https://result.sports.or.kr/SW/INF306.do');
  r = await get('sys=SW&classCd=D2&toCd=999999999&op=events');
  assert.equal(r.status, 403, '공개 자료에 없는 대회는 중계하지 않는다');
  r = await get('sys=SW&classCd=D2&toCd=202616053&op=round&kind=S&dc=D2S01&rh=1;drop');
  assert.equal(r.status, 400, '열쇠 형식 검사');
  r = await get('sys=SW&classCd=D2&toCd=202616053&op=delete');
  assert.equal(r.status, 400);
  return calls;
}
test('결과 중계(결과 시스템) — 종목 · 경기 · 순위표를 글자로만 풀기 · 목록에 없는 대회 거절 · 열쇠 형식 검사', async () => {
  await resultFlow();
});

test('결과 중계 — 변이: 목록 확인 없음 · 글을 안 거침 · 안내 화면을 그대로 · 숨긴 줄 포함 → 빨간불', async () => {
  const cases = [
    ['functions/api/swim-file.js', fileFlow, '목록 확인 없음(열린 중계)', '  if (!ent) return json({ ok: false, error: "수영대회 결과 목록에 없는 파일입니다" }, 403);',
      '  if (!ent) { const x = new URL(want); return new Response(await (await fetchImpl(want)).arrayBuffer(), { status: 200 }); }'],
    ['functions/api/swim-file.js', fileFlow, '글을 거치지 않음', '  if (ent.post) {', '  if (false) {'],
    ['functions/api/swim-file.js', fileFlow, '안내 화면을 결과지로', '    if (!sniffOk(ext, buf))', '    if (false)'],
    ['functions/api/swim-file.js', fileFlow, '같은 이름 쿠키의 앞 값을 씀(둘 다 보내면 PHP 가 앞 값을 읽는 것과 같음)',
      '    jar.delete(kv.slice(0, i));                    // 같은 이름은 나중 값(자리도 뒤로)\n    jar.set(kv.slice(0, i), kv.slice(i + 1));',
      '    if (!jar.has(kv.slice(0, i))) jar.set(kv.slice(0, i), kv.slice(i + 1));'],
    ['functions/api/swim-file.js', fileFlow, '넘겨진 주소를 안 따라감(중간 쿠키 버림)', '      if (!loc) break;', '      break;'],
    ['functions/api/swim-result.js', resultFlow, '숨긴 구간 기록 줄 포함', '      if (/\\bid\\s*=\\s*["\']?subResult/i.test(r[1]) || /display\\s*:\\s*none/i.test(r[1])) continue;', ''],
    ['functions/api/swim-result.js', resultFlow, '목록에 없는 대회도 중계', '  if (!findSystem(doc, p.sys, p.toCd, p.classCd)) return', '  if (false) return'],
  ];
  for (const [path, flow, name, a, b] of cases) {
    const src = fs.readFileSync(path, 'utf8');
    assert.equal(src.split(a).length - 1, 1, name + ' 변이 위치');
    const file = new URL('../' + path.replace(/[^/]+$/, '__mut_swim_' + process.pid + '.mjs'), import.meta.url);
    fs.writeFileSync(file, src.replace(a, b));
    try { await assert.rejects(flow(file.href), assert.AssertionError, name + ' 변이를 잡아야 한다'); }
    finally { fs.unlinkSync(file); }
  }
});
