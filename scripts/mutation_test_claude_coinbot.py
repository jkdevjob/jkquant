"""③ 실투자 봇(bots/claude-coinbot) · 기록 엔드포인트(functions/api/claude-coinbot.js · _claude_real.js) · Worker /claude-real 변이 시험.
변이마다 tests/claude-coinbot.test.mjs 가 실패해야 한다. 작업 파일은 건드리지 않는다(사본 뿌리를 JKQ_COINBOT_ROOT 로 넘김).
주문 경로 — 고친 곳 전부(판단 · 금액 · 수량 · identifier · 다시 안 냄 · 저장 먼저 · 시험 모드 · 일시정지 · 메인 확인 · 서명 · 키 · 기록 한 번)."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
BOT, EP, REAL, WK = "bots/claude-coinbot/bot.mjs", "functions/api/claude-coinbot.js", "functions/api/_claude_real.js", "worker/opening-scheduler/src/index.js"
MUT = [
    ("break-even buys (>= level)", BOT, "!(hi > plan.level)) return { buy: false };", "!(hi >= plan.level)) return { buy: false };"),
    ("chase cap off", BOT, "if (px > ref * (1 + chase / 100)) return", "if (false) return"),
    ("chase ref ignores open", BOT, "const ref = Math.max(op, plan.level);", "const ref = plan.level;"),
    ("budget cap off", BOT, "Math.min(+budget || 0, (+krwFree || 0) / (1 + (+fee || 0)))", "((+krwFree || 0) / (1 + (+fee || 0)))"),
    ("fee headroom off", BOT, "(+krwFree || 0) / (1 + (+fee || 0))) / 1000)", "(+krwFree || 0)) / 1000)"),
    ("min order off", BOT, "return a >= MIN_ORDER_KRW ? a : 0;", "return a;"),
    ("sells whole coin balance", BOT, "Math.floor(Math.min(+posVol || 0, +coinFree || 0) * 1e8)", "Math.floor((+coinFree || 0) * 1e8)"),
    ("identifier not per day", BOT, 'idOf(d, side) { return "jkq-c3-" + d + "-" + side; }', 'idOf(d, side) { return "jkq-c3-" + d + "-" + side + "-" + this.now(); }'),
    ("resend after failed buy", BOT, "plan.hold && !day.buy && !this.state.position", 'plan.hold && !(day.buy && day.buy.status !== "failed") && !this.state.position'),
    ("unknown concluded at once", BOT, "this.now() - (+o.at || 0) >= PENDING_MS", "true"),
    ("unknown resent", BOT, 'o.status = "failed"; o.error = "주문이 들어가지 않음(" + (o.error || "응답 없음") + ")";', "delete this.state.days[d][side]; continue;"),
    ("save after send", BOT, "    day.buy = { status: \"sending\", identifier: id, amount, ref: dec.ref, level: plan.level, at: this.now() };\n    await this.save();", "    day.buy = { status: \"sending\", identifier: id, amount, ref: dec.ref, level: plan.level, at: this.now() };"),
    ("dry default live", BOT, 'this.dry = String(env.DRY_RUN ?? "1") !== "0";', 'this.dry = String(env.DRY_RUN ?? "0") === "1";'),
    ("dry buy sends", BOT, "    if (this.dry) {\n      const amount = this.budget", "    if (false) {\n      const amount = this.budget"),
    ("pause ignored", BOT, "      if (this.paused()) {", "      if (false) {"),
    ("pause blocks sell", BOT, "if (pos && pos.day < D && !pos.sellFailed) await this.sell(pos);", "if (pos && pos.day < D && !pos.sellFailed && !this.paused()) await this.sell(pos);"),
    ("main check ignored", BOT, "!this.state.position && day.check && day.check.ok) {", "!this.state.position && day.check) {"),
    ("sell same day", BOT, "if (pos && pos.day < D && !pos.sellFailed)", "if (pos && pos.day <= D && !pos.sellFailed)"),
    ("recover off", BOT, "if (fresh && !this.dry) await this.recover();", ""),
    ("zero fill is a position", BOT, "    if (!(f.volume > 0)) {                                               // 끝났는데 체결이 없다", "    if (false) {                                               // 끝났는데 체결이 없다"),
    ("retry resends telegram", BOT, 'if (r.telegram === "sent") it.msg = { ...it.msg, tg: false };', ""),
    ("start notice every time", BOT, "const quiet = this.state.notes.startAt && this.now() - this.state.notes.startAt < 36e5;", "const quiet = false;"),
    ("skip record missing", BOT, "    y.skipRecorded = true;\n", "    return;\n"),
    ("jwt hs256", BOT, 'crypto.createHmac("sha512", secretKey)', 'crypto.createHmac("sha256", secretKey)'),
    ("jwt no query hash", BOT, "  if (query) Object.assign(payload, { query_hash:", "  if (false) Object.assign(payload, { query_hash:"),
    ("post hash over json", BOT, 'upbitJwt(accessKey, secretKey, method === "GET" ? q : queryOf(params || {}))', 'upbitJwt(accessKey, secretKey, method === "GET" ? q : JSON.stringify(params || {}))'),
    ("endpoint no key check", EP, '  if (!coinbotKeyOk(request, env)) return json({ ok: false, definite: true, error: "unauthorized" }, 401);\n', ""),
    ("endpoint short key ok", EP, "if (want.length < 32 || got.length !== want.length) return false;", "if (!want || got.length !== want.length) return false;"),
    ("endpoint telegram on duplicate", EP, "if (b.tg !== false && (fresh || !recorded))", "if (b.tg !== false)"),
    ("endpoint tg false ignored", EP, "if (b.tg !== false && (fresh || !recorded))", "if (fresh || !recorded)"),
    ("endpoint head check off", EP, "  const text = realText(b.text);\n  if (!text)", "  const text = String(b.text || \"\");\n  if (false)"),
    ("record date mismatch ok", REAL, "if (!m || m[1] !== date) return", "if (!m) return"),
    ("record payload unlimited", REAL, "if (!p || raw.length > REAL_PAYLOAD_MAX) return", "if (!p) return"),
    ("worker no auth", WK, '      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);\n      const v=realRecord(', "      const v=realRecord("),
    ("worker fresh always", WK, "return json({ok:true,fresh:(+j.added||0)>0});", "return json({ok:true,fresh:true});"),
]


def copy_root(tmp):
    for d in ("bots/claude-coinbot", "functions/api", "worker/opening-scheduler/src"):
        shutil.copytree(ROOT / d, tmp / d)


def run(root):
    env = {**os.environ, "JKQ_COINBOT_ROOT": str(root)}
    r = subprocess.run(["node", "--test", str(ROOT / "tests" / "claude-coinbot.test.mjs")], capture_output=True, text=True, encoding="utf-8", env=env)
    return r.returncode, r.stdout + r.stderr


def mutant(case):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        copy_root(tmp)
        if case is None:
            code, out = run(tmp)
            return "control", code == 0 and "# fail 0" in out, out
        label, rel, before, after = case
        path = tmp / rel
        src = path.read_text(encoding="utf-8")
        assert src.count(before) == 1, label + ": target missing or not unique"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        code, out = run(tmp)
        return label, code != 0 and "# fail 0" not in out, out


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as ex:
        results = list(ex.map(mutant, [None] + MUT))
    bad = []
    for label, good, out in results:
        print(("PASS " if good else "FAIL ") + ("control: 변이 없는 사본은 초록" if label == "control" else "killed: " + label))
        if not good:
            bad.append(label)
            print(out[-1500:])
    assert not bad, "survived/failed: " + ", ".join(bad)
    print(f"claude-coinbot mutations: ALL PASS ({len(MUT)} mutants + control)")
