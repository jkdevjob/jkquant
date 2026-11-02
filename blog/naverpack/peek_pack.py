"""드라이브에 있는 다른 패키지(예: GPT가 올린 같은 날 패키지)의 제목·태그를 본다.

download_file_content(fileId) 를 먼저 호출한 뒤 실행한다. 결과는 대화 기록(jsonl)에만
남으므로 기록에서 찾아 post.json 을 읽는다. 주제가 겹치지 않게 고를 때 쓴다.
사용: python3 -I peek_pack.py <드라이브 fileId>
"""
import base64, glob, io, json, os, re, sys, zipfile

fid = sys.argv[1]
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
post = json.loads(zipfile.ZipFile(io.BytesIO(got)).read('post.json').decode('utf-8'))
print('title:', post.get('title'))
print('tags:', ', '.join(post.get('tags', [])))
heads = [b['text'].split('\n')[0] for b in post.get('blocks', []) if b.get('type') == 'paragraph']
print('heads:', ' / '.join(heads[:16]))
