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
# 2026-11-20 메르 형식(사용자 "메르 분석해서 하는 그대로"): 메르 제목 중앙값 26자(12~38) → 18~40자
ok(18 <= len(post.get('title', '')) <= 40, f"title length {len(post.get('title', ''))} (18~40)")
NAVER_TOPICS = ['문학·책', '영화', '미술·디자인', '공연·전시', '음악', '드라마', '스타·연예인', '만화·애니', '방송',
                '일상·생각', '육아·결혼', '반려동물', '좋은글·이미지', '패션·미용', '인테리어·DIY', '요리·레시피', '상품리뷰', '원예·재배',
                '게임', '스포츠', '사진', '자동차', '취미', '국내여행', '세계여행', '맛집',
                'IT·컴퓨터', '사회·정치', '건강·의학', '비즈니스·경제', '어학·외국어', '교육·학문']
CATEGORIES = ['경제', 'IT·과학', '사회·정치', '국제', '연예·방송', '스포츠', '생활·건강']  # 2026-11-18 사용자가 '사회'·'정치'를 '사회·정치'로 합침
ok(post.get('topic') in NAVER_TOPICS, f"topic {post.get('topic')} (네이버 주제 이름)")
if post.get('category') is not None:
    ok(post.get('category') in CATEGORIES, f"category {post.get('category')} (GUIDE 1장 표)")
ok(all(k not in post for k in ['category_no', 'demo_only', 'already_published_url']), 'forbidden keys present')

tags = post.get('tags', [])
ok(5 <= len(tags) <= 8 and all(isinstance(t, str) and t and not re.search(r'[#\s,]', t) for t in tags), 'tags invalid (5~8, no # space comma)')

bl = post.get('blocks', [])
ok(all(b.get('type') in ('paragraph', 'image') for b in bl), 'bad block type')
paras = [b for b in bl if b.get('type') == 'paragraph']
imgs = [b for b in bl if b.get('type') == 'image']
ok(all(b.get('text', '').strip() for b in paras), 'empty paragraph')
ok(not any(re.search(r'<[a-zA-Z/][^>]*>|\*\*|^#|\[[^\]]+\]\(|https?://', b['text']) for b in paras), 'html/markdown/link in body text')
# 2026-11-20 메르 형식(사용자 "메르 분석해서 하는 그대로 내일 제작해 내용 길게 이미지도 좀 더 넣고"):
# 메르 최근 12개 글 — 번호 줄 중앙값 48(상위 25% 67) · 한 줄 평균 51자 · '~임/~함/~음/~됨' 끝맺음 · 이미지 중앙값 8(상위 25% 11)
# · 글과 이미지가 번갈아 · 끝에 '한줄 코멘트' · 뉴스 주소 0. 우리는 '길게'라 번호 줄 55~90, 이미지 8~12.
nums_p = [b for b in paras if re.match(r'^\d+\. ', b['text'])]
ok(55 <= len(nums_p) <= 90, f'numbered lines {len(nums_p)} (55~90)')
ok([int(re.match(r'^(\d+)\. ', b['text']).group(1)) for b in nums_p] == list(range(1, len(nums_p) + 1)), 'numbered lines must run 1,2,3… without gaps')
ok(all('\n' not in b['text'] for b in nums_p), 'one numbered line per paragraph (no line breaks inside)')
lens = [len(b['text']) for b in nums_p]
ok(lens and 30 <= sum(lens) / len(lens) <= 90 and max(lens) <= 180, f'numbered line length avg {sum(lens) // max(len(lens), 1)} (30~90) / max {max(lens or [0])} (<=180)')
def m_end(t):  # 끝 글자가 받침 ㅁ·ㄻ(~음·~임·~함·~됨·~듦) 인지 — 끝의 마침표·(해석)·따옴표는 걷고 본다
    t = t.strip().rstrip('.!?"\'”’ ')
    t = re.sub(r'(\s*\([^()]*\))+$', '', t).rstrip('.!?"\'”’ ')
    return bool(t) and 0xAC00 <= ord(t[-1]) <= 0xD7A3 and (ord(t[-1]) - 0xAC00) % 28 in (16, 10)
ok(sum(m_end(b['text']) for b in nums_p) >= 0.7 * max(len(nums_p), 1), f"'~음/~임' endings {sum(m_end(b['text']) for b in nums_p)}/{len(nums_p)} (>=70%)")
others = [b for b in paras if b not in nums_p]
ok(bl and bl[0].get('type') == 'paragraph' and bl[0] in others and len(bl[0]['text']) <= 160, 'first block: short intro line without number (<=160 chars)')
ok(len(others) <= 4, f'non-numbered paragraphs {len(others)} (<=4: intro · 한줄 코멘트 · ※ note)')
# 2026-11-20 사용자 "글 맨끝에 한줄코멘트로 정리한 글 있던데 우리도 한줄정리 넣자": 메르 12개 중 10개가 '한줄 코멘트'로 끝남
# (맨 마지막 줄 · 26~205자, 중앙값 약 150자 · 1~3문장이 대부분 · 숫자 요약보다 '그래서 어떻게 보나' 판단 한마디)
last = bl[-1] if bl else {}
ok(last.get('type') == 'paragraph' and last.get('text', '').startswith('한줄 코멘트.'), "last block must be the '한줄 코멘트.' paragraph (맨 끝 한줄 정리)")
if last.get('text', '').startswith('한줄 코멘트.'):
    c = last['text'][len('한줄 코멘트.'):].strip()
    ok(60 <= len(c) <= 220, f'한줄 코멘트 length {len(c)} (60~220)')
    ok(len([x for x in re.split(r'(?<=[.!?])\s+', c) if x]) <= 3, '한줄 코멘트: 3 sentences max')
ok(8 <= len(imgs) <= 12, f'images {len(imgs)} (8~12)')
# 2026-11-20 사용자 "AI 느낌 덜나게 못할까?": 메르 10개 글과 비교(번호 줄 60개당) — (해석)·(계산) 꼬리표 0 · '보도됐' 0 ·
# 첫째/둘째 나열 0 · '그럼/이제' 이음말 0 · '개인적·생각·같음' 2.7. 우리 11/20 초안은 꼬리표 16 · 보도됐 3.7 · 자기 목소리 0 이었다.
# 해석은 꼬리표 대신 말투로 드러낸다('~같음·~보임·~라고 봄·개인적으로는'). 경험은 지어내지 않는다(생각·판단만).
alltext = '\n'.join(b['text'] for b in paras)
ok(not re.search(r'\((해석|계산|정리|계산·가정)\)', alltext), "no (해석)/(계산) tags — show opinion by wording instead")
ok(alltext.count('보도됐') <= 2, f"'보도됐' {alltext.count('보도됐')} (<=2)")
ok(sum(1 for b in nums_p if re.match(r'^\d+\.\s*(첫째|둘째|셋째|넷째|다섯째)', b['text'])) <= 1, "no 첫째/둘째/셋째 lists")
ok(sum(1 for b in nums_p if re.match(r'^\d+\.\s*(그럼|이제)\s', b['text'])) <= 2, "'그럼/이제' signpost lines <=2")
voice = sum(1 for b in paras if re.search(r'개인적|생각|같음|보임|라고 봄|듯함|싶음', b['text']))
ok(voice >= 3, f'own-voice lines {voice} (>=3: 개인적·생각·같음·보임 …)')
pos = [i for i, b in enumerate(bl) if b.get('type') == 'image']
ok(pos and pos[0] <= 1, 'thumbnail within the first 2 blocks')
ok(all(b - a >= 3 for a, b in zip(pos, pos[1:])), 'images must be spread: at least 2 paragraphs between images')
runs, cur = [], 0  # 이미지 없이 이어지는 번호 줄 수(끝의 한줄 코멘트·※ 줄은 세지 않음)
for b in bl:
    if b.get('type') == 'image':
        runs.append(cur); cur = 0
    elif b in nums_p:
        cur += 1
runs.append(cur)
ok(max(runs) <= 16, f'no more than 16 numbered lines in a row without an image (max {max(runs)})')
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
    if b.get('thumb'):
        ok(b is imgs[0], 'thumbnail must be the first image (네이버 대표 이미지)')
        ok(im.size[0] == im.size[1], f'thumbnail must be square {im.size}')
    else:
        ok(b.get('links') and all(l['url'].startswith('https://') and 'example' not in l['url'] for l in b['links']), 'links')
    print(f, im.format, im.size, len(data), 'bytes')

text = ''.join(b['text'] for b in paras)
print('title:', post.get('title'))
print('paragraphs', len(paras), 'numbered', len(nums_p), 'images', len(imgs), 'tags', len(tags), '| body chars', len(text))
ok(3500 <= len(text) <= 5500, f'body chars {len(text)} (3,500~5,500 — 메르 중앙값 2,945 · 상위 25% 3,881, 사용자 "내용 길게")')
for num in [n for n in a.nums.split('|') if n]:
    ok(num in text, f'chart number {num} not in body')
print('RESULT:', 'PASS' if not errs else 'FAIL')
for e in errs:
    print(' -', e)
raise SystemExit(0 if not errs else 1)
