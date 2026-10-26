"""한투 접근 토큰 하루 한 번(functions/api/kis.js · 정시 스케줄러 Worker 저장소) 변이 시험.
변이마다 tests/kis-token.test.mjs 가 실패해야 한다. 작업 파일은 건드리지 않는다(사본을 고쳐 경로를 넘김)."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
KIS = ROOT / "functions" / "api" / "kis.js"
WORKER = ROOT / "worker" / "opening-scheduler" / "src" / "index.js"
MUT = [
    ("central GET skipped", "kis", '  if (mk) {\n    const c = await central(mk, "GET", null, k);', '  if (false) {\n    const c = await central(mk, "GET", null, k);'),
    ("central POST skipped", "kis", '  if (mk) await central(mk, "POST", { k, token: t.token, exp: t.exp }, k);', ''),
    ("real token sent to worker", "kis", 'const mk = isReal(env) ? "" : monitorKey(env);', 'const mk = monitorKey(env);'),
    ("no renewal margin", "kis", "const TOK_MARGIN_MS = 60 * 60 * 1000;", "const TOK_MARGIN_MS = 0;"),
    ("6h life again", "kis", "at > now ? at : now + life, now + 864e5)", "at > now ? at : now + life, now + 6 * 3600e3)"),
    ("kis expiry time ignored", "kis", "exp: Math.min(at > now ? at : now + life, now + 864e5)", "exp: Math.min(now + life, now + 864e5)"),
    ("kis expiry not capped", "kis", "exp: Math.min(at > now ? at : now + life, now + 864e5)", "exp: at > now ? at : now + life"),
    ("edge ttl 6h again", "kis", 'const sec = Math.max(60, Math.floor((t.exp - TOK_MARGIN_MS - now) / 1000));', "const sec = 6 * 3600;"),
    ("edge stale accepted", "kis", "  if (tokFresh(e, now)) return keep(e);", "  if (e && e.token) return keep(e);"),
    ("memory keyed by env only", "kis", 'id = b + "|" + String(env.KIS_APPKEY || "")', "id = b"),
    ("edge keyed by host", "kis", "const e = await edgeRead(k);", "const e = await edgeRead(await tokenId({ ...env, KIS_APPKEY: '' }));"),
    ("read drop removed", "kis", "if (TOKEN_BAD(j)) { await dropToken(bearerOf(init)); return j; }", "if (TOKEN_BAD(j)) { return j; }"),
    ("read retried on bad token", "kis", "if (TOKEN_BAD(j)) { await dropToken(bearerOf(init)); return j; }", "if (TOKEN_BAD(j)) { await dropToken(bearerOf(init)); continue; }"),
    ("drop any token", "kis", "    if (t.token !== token) continue;\n", ""),
    ("edge drop unconditional", "kis", "if (e && e.token === token) await edge().delete(TOKKEY(t.k));", "await edge().delete(TOKKEY(t.k));"),
    ("central drop skipped", "kis", '    if (t.mk) await central(t.mk, "POST", { k: t.k, drop: token }, t.k);\n', ""),
    ("kr order drop removed", "kis", '    if (TOKEN_BAD(j)) await dropToken(token);                 // 토큰 거절', '    // 토큰 거절'),
    ("us order drop removed", "kis", '      if (TOKEN_BAD(j)) await dropToken(token);               // 토큰 거절', '      // 토큰 거절'),
    ("us fallback on bad token", "kis", ' && !RATE_LIMITED(j) && !TOKEN_BAD(j)) {', ' && !RATE_LIMITED(j)) {'),
    ("appkey in worker body", "kis", '{ k, token: t.token, exp: t.exp }', '{ k, token: t.token, exp: t.exp, appkey: env.KIS_APPKEY }'),
    ("worker route without auth", "worker", '    if(u.pathname==="/kis-token"){\n      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);', '    if(u.pathname==="/kis-token"){'),
    ("worker drop ignores token", "worker", "if(all[r.k]&&all[r.k].token===r.drop)delete all[r.k];", "delete all[r.k];"),
    ("worker returns expired", "worker", "for(const k of Object.keys(all))if(!(+all[k].exp>now))delete all[k];", ""),
    ("worker accepts any name", "worker", 'if(!b||!/^[0-9a-f]{16}$/.test(String(b.k||"")))return null;', "if(!b||!b.k)return null;"),
    ("worker accepts long exp", "worker", "if(!(exp>now+60e3)||exp>now+25*36e5)return null;", "if(!(exp>now+60e3))return null;"),
    ("worker accepts short token", "worker", "if(token.length<20||token.length>4096||/\\s/.test(token))return null;", "if(!token)return null;"),
]

for label, which, before, after in MUT:
    with tempfile.TemporaryDirectory() as tmp:
        kis, worker = Path(tmp) / "kis.js", Path(tmp) / "worker_index.js"
        shutil.copy(KIS, kis)
        shutil.copy(KIS.parent / "_market-day-cache.js", Path(tmp) / "_market-day-cache.js")
        shutil.copy(WORKER, worker)
        path = kis if which == "kis" else worker
        src = path.read_text(encoding="utf-8")
        assert src.count(before) == 1, label + ": target missing or not unique"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        env = {**os.environ, "JKQ_KIS_SRC": str(kis), "JKQ_WORKER_SRC": str(worker)}
        r = subprocess.run(["node", "--test", str(ROOT / "tests" / "kis-token.test.mjs")], capture_output=True, text=True, encoding="utf-8", env=env)
        out = r.stdout + r.stderr
        assert r.returncode != 0 and "# fail 0" not in out, label + ": survived\n" + out[-800:]
        print("PASS killed:", label)
print("KIS token mutations: ALL PASS")
