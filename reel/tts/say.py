#!/usr/bin/env python3
# 한국어 내레이션 — Microsoft Edge 신경망 음성(무료, 키 없음)으로 줄마다 mp3 를 만든다.
#   python3 tts/say.py <요청.json>
#   요청: {"voice":"ko-KR-HyunsuMultilingualNeural","rate":"+6%","pitch":"+0Hz","lines":[{"text":"…","out":"…/abc.mp3"}]}
#   이미 만들어 둔 파일(out)이 있으면 건너뛴다. edge-tts 가 없으면 설치부터 한다.
import asyncio, importlib, json, os, ssl, subprocess, sys

def load():
    try:
        return importlib.import_module("edge_tts")
    except ImportError:
        base = [sys.executable, "-m", "pip", "install", "-q", "edge-tts"]
        if subprocess.call(base) != 0:
            subprocess.check_call(base + ["--break-system-packages"])
        importlib.invalidate_caches()
        return importlib.import_module("edge_tts")

edge_tts = load()
import edge_tts.communicate as comm

# 이 환경은 프록시가 TLS 를 다시 맺어서 그 인증서 묶음을 믿어야 한다(edge-tts 는 certifi 만 본다)
CA = "/root/.ccr/ca-bundle.crt"
if os.path.exists(CA):
    comm._SSL_CTX = ssl.create_default_context(cafile=CA)
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")

async def one(req, line):
    for attempt in range(4):
        try:
            c = edge_tts.Communicate(line["text"], req["voice"], rate=req.get("rate", "+0%"),
                                     pitch=req.get("pitch", "+0Hz"), proxy=PROXY)
            tmp = line["out"] + ".part"
            await c.save(tmp)
            if os.path.getsize(tmp) < 1000:
                raise RuntimeError("빈 음성")
            os.replace(tmp, line["out"])
            return
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  다시 시도({attempt + 1}): {e}", file=sys.stderr)
            await asyncio.sleep(2 * (attempt + 1))

async def main():
    req = json.load(open(sys.argv[1], encoding="utf8"))
    for line in req["lines"]:
        if not os.path.exists(line["out"]):
            await one(req, line)

asyncio.run(main())
