"""드라이브에 올린 ZIP 이 원본과 같은지 확인한다.

download_file_content(fileId) 결과는 대화 기록(jsonl)에만 남으므로, 기록에서
그 파일의 마지막 내려받기 결과를 찾아 원본 ZIP 과 sha256 을 비교한다.
사용: python3 -I check_upload.py <드라이브 fileId> <원본.zip>
"""
import base64, glob, hashlib, os, re, sys

fid, local = sys.argv[1], sys.argv[2]
want = hashlib.sha256(open(local, 'rb').read()).hexdigest()
pat = re.compile(r'\\?"content\\?":\\?"(UEsDB[A-Za-z0-9+/=]+)')
got = None
# 작은 결과는 대화 기록(jsonl)에, 큰 결과는 tool-results 파일에 남는다
files = [f for f in glob.glob('/root/.claude/projects/**', recursive=True)
         if f.endswith(('.jsonl', '.txt', '.json')) and os.path.isfile(f)]
for f in sorted(files, key=os.path.getmtime):
    for line in open(f, encoding='utf-8', errors='replace'):
        if fid in line and 'UEsDB' in line:
            m = pat.search(line)
            if m:
                got = base64.b64decode(m.group(1))
if got is None:
    print('내려받기 결과를 기록에서 찾지 못함 — download_file_content 를 먼저 호출할 것')
    raise SystemExit(2)
have = hashlib.sha256(got).hexdigest()
print('drive', len(got), 'bytes', have)
print('local', os.path.getsize(local), 'bytes', want)
print('MATCH' if have == want else 'MISMATCH')
raise SystemExit(0 if have == want else 1)
