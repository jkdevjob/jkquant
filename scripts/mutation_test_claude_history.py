"""단타(클로드) 전략별 매매 이력 조회 API(functions/api/claude-history.js) 변이 시험.
변이마다 tests/claude-history.test.mjs 가 실패해야 한다. 작업 파일은 건드리지 않는다(사본을 고쳐 경로를 넘김)."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "functions" / "api"
MUT = [
    ("any tab", 'if (!HIST_TABS.includes(tab)) return { error: "tab 오류" };', ""),
    ("loose version", "export const VERSION_RE = /^[A-Za-z0-9_.+:-]{1,80}$/;", "export const VERSION_RE = /^.{1,200}$/;"),
    ("dots allowed", ' || version.includes(".."))', ")"),
    ("no encode", 'return { path: tab + "/" + encodeURIComponent(version) + ".json" };', 'return { path: tab + "/" + version + ".json" };'),
    ("no auth", '  if (!(await claudeAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);\n', ""),
    ("404 as error", '    if (r.status === 404) return json({ ok: false, error: "아직 기록 없음 — 밤 계산 뒤 생깁니다" }, 404);\n', ""),
]
for label, before, after in MUT:
    with tempfile.TemporaryDirectory() as tmp:
        for name in ("claude-history.js", "_claude_auth.js", "_firebase_token.js"):
            shutil.copy(API / name, Path(tmp) / name)
        path = Path(tmp) / "claude-history.js"
        src = path.read_text(encoding="utf-8")
        assert src.count(before) == 1, label + ": target missing or not unique"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        env = {**os.environ, "JKQ_HISTORY_SRC": str(path)}
        r = subprocess.run(["node", "--test", str(ROOT / "tests" / "claude-history.test.mjs")], capture_output=True, text=True, encoding="utf-8", env=env)
        out = r.stdout + r.stderr
        assert r.returncode != 0 and "# fail 0" not in out, label + ": survived\n" + out[-800:]
        print("PASS killed:", label)
print("claude-history mutations: ALL PASS")
