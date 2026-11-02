"""네이버 업로더용 패키지(.naverpack.zip)를 검사한다.

사용: python3 -I verify_pack.py <zip> [--nums '63억|15억|...'] [--date YYYYMMDD]
--date 는 밀린 날짜 몫을 나중에 만들 때만 준다(기본: 오늘 한국 날짜).
--nums 에 준 숫자(도표에 쓴 숫자)는 본문에도 있어야 한다.
"""
import argparse, datetime, io, json, os, re, zipfile
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('zip')
ap.add_argument('--nums', default='')
ap.add_argument('--date', default='')
a = ap.parse_args()

errs = []
def ok(cond, msg):
    if not cond:
        errs.append(msg)

p = a.zip
fn = os.path.basename(p)
kst = a.date or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d')
ok(re.match(rf'^{kst}_hotissue[-a-z0-9]*\.naverpack\.zip$', fn) is not None, f'filename/date mismatch {fn} vs {kst}')
ok(os.path.getsize(p) <= 100 * 1024 * 1024, 'zip >100MB')
z = zipfile.ZipFile(p)
ok(z.testzip() is None, 'zip CRC error')
names = z.namelist()
print('entries', names)
ok('post.json' in names, 'post.json not at top level')
ok(all(not n.startswith(('/', '..')) and (n == 'post.json' or n.startswith('images/')) for n in names), 'unexpected paths/wrapper folder')

raw = z.read('post.json')
post = json.loads(raw.decode('utf-8'))
ok(post.get('schema_version') == 1 and type(post.get('schema_version')) is int, 'schema_version not int 1')
for k in ['id', 'date', 'blog_id', 'title', 'topic', 'tags', 'blocks']:
    ok(k in post, f'missing {k}')
ok(post.get('blog_id') == 'maniacjk', 'blog_id')
ok(post.get('date') == f'{kst[:4]}-{kst[4:6]}-{kst[6:]}', 'date field mismatch')
ok(str(post.get('id', '')).startswith(kst), 'id date prefix')
ok(30 <= len(post.get('title', '')) <= 45, f"title length {len(post.get('title', ''))} (30~45)")
ok(post.get('topic') in ['비즈니스·경제', 'IT·컴퓨터'], 'topic')
ok(all(k not in post for k in ['category_no', 'demo_only', 'already_published_url']), 'forbidden keys present')

tags = post.get('tags', [])
ok(5 <= len(tags) <= 8 and all(isinstance(t, str) and t and not re.search(r'[#\s,]', t) for t in tags), 'tags invalid (5~8, no # space comma)')

bl = post.get('blocks', [])
ok(all(b.get('type') in ('paragraph', 'image') for b in bl), 'bad block type')
paras = [b for b in bl if b.get('type') == 'paragraph']
imgs = [b for b in bl if b.get('type') == 'image']
ok(all(b.get('text', '').strip() for b in paras), 'empty paragraph')
ok(not any(re.search(r'<[a-zA-Z/][^>]*>|\*\*|^#|\[[^\]]+\]\(|https?://', b['text']) for b in paras), 'html/markdown/link in body text')
nums_p = [b for b in paras if re.match(r'^\d+\. ', b['text'])]
ok(8 <= len(nums_p) <= 15, f'numbered paragraphs {len(nums_p)} (8~15)')
ok(2 <= len(imgs) <= 3, f'images {len(imgs)} (2~3)')
bad_words = ['example.com', '여기에 이미지', '이미지 삽입', '제목 후보', 'TODO', 'replace-with']
ok(not any(w in raw.decode('utf-8') for w in bad_words), 'placeholder text remains')

for b in imgs:
    f = b.get('file', '')
    ok(f in names, f'missing image {f}')
    ok(not re.match(r'^(https?:|/|[A-Za-z]:)', f), 'non-relative path')
    if f not in names:
        continue
    data = z.read(f)
    ok(len(data) <= 20 * 1024 * 1024, f'{f} >20MB')
    im = Image.open(io.BytesIO(data)); im.verify(); im = Image.open(io.BytesIO(data))
    ext = f.rsplit('.', 1)[1].lower()
    ok({'png': 'PNG', 'jpg': 'JPEG', 'jpeg': 'JPEG'}.get(ext) == im.format, f'{f} format {im.format}')
    ok(b.get('caption', '').strip() != '', 'empty caption')
    ok(b.get('links') and all(l['url'].startswith('https://') and 'example' not in l['url'] for l in b['links']), 'links')
    print(f, im.format, im.size, len(data), 'bytes')

text = ''.join(b['text'] for b in paras)
print('title:', post.get('title'))
print('paragraphs', len(paras), 'numbered', len(nums_p), 'images', len(imgs), 'tags', len(tags), '| body chars', len(text))
ok(1800 <= len(text) <= 2500, f'body chars {len(text)} (1,800~2,500)')
for num in [n for n in a.nums.split('|') if n]:
    ok(num in text, f'chart number {num} not in body')
print('RESULT:', 'PASS' if not errs else 'FAIL')
for e in errs:
    print(' -', e)
raise SystemExit(0 if not errs else 1)
