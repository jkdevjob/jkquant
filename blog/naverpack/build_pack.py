"""post.json 과 images/ 를 네이버 업로더용 ZIP으로 묶는다.

사용: python3 -I build_pack.py <작업폴더> <출력.zip> [색 수, 기본 6]
작업폴더에는 post.json 과 images/01.png … 가 있어야 한다.
PNG 는 6색으로 줄여(글자는 그대로 보이게) 파일을 작게 만든다 — 드라이브 업로드 때
base64 를 도구 호출에 그대로 실어야 해서 작을수록 안전하다.
결과로 <출력.zip>.b64 (한 줄) 와 sha256 을 남긴다.
"""
import base64, hashlib, io, json, os, sys, zipfile
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
colors = int(sys.argv[3]) if len(sys.argv) > 3 else 6
post = json.load(open(os.path.join(src, 'post.json'), encoding='utf-8'))
files = [b['file'] for b in post['blocks'] if b['type'] == 'image']

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr('post.json', json.dumps(post, ensure_ascii=False, indent=1).encode('utf-8'))
    for f in files:
        im = Image.open(os.path.join(src, f)).convert('RGB')
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        buf = io.BytesIO()
        q.save(buf, 'PNG', optimize=True)
        z.writestr(f, buf.getvalue())
        print(f, im.size, len(buf.getvalue()), 'bytes')

data = open(out, 'rb').read()
b64 = base64.b64encode(data).decode()
open(out + '.b64', 'w').write(b64)
print('zip', len(data), 'bytes · base64', len(b64), 'chars')
print('sha256', hashlib.sha256(data).hexdigest())
