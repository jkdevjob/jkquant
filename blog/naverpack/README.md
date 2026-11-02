# 네이버 업로더용 매일 패키지 (클로드 몫)

사용자 PC의 '매니악 블로그 업로더'가 구글 드라이브 폴더 **ManiacNaverInbox**
(`1z-fxebjUshk_dMZwGPdl02Dir8Gch2h7`)의 `.naverpack.zip` 을 읽어 네이버 블로그(maniacjk)에 올린다.
GPT가 매일 새벽 5시께 `YYYYMMDD_hotissue.naverpack.zip` 하나를, 클로드가 매일
`YYYYMMDD_hotissue-claude.naverpack.zip` 하나를 넣는다(사용자 지시 2026-11-02: "지피티도 하나 너도 매일 하나").

드라이브에 넣는 것까지가 이 작업이다. 네이버 게시는 업로더가 하고, PC가 잠자기면 깨어날 때 올라간다.
네이버 글 목록에서 직접 확인하기 전에는 '네이버 발행 완료'라고 쓰지 않는다.

## 규칙

- 같은 폴더에 이미 오늘 날짜 `_hotissue-claude` 패키지가 있으면 새로 만들지 않고 그 링크만 알린다.
- 밀린 날짜 몫을 나중에 만들 때는 파일 이름·`date` 를 그 날짜로 두고 `verify_pack.py --date YYYYMMDD` 로 검사한다.
- 내가 올리지 않은 파일(GPT 패키지 등)은 지우거나 덮어쓰지 않는다.
- 주제: blog/GUIDE.md '주제 고르기'를 따르되, **같은 날 GPT 패키지 주제와 지난 7일 네이버 글 주제는 피한다.**
  먼저 네이버 글 목록을 본다:
  `https://blog.naver.com/PostTitleListAsync.naver?blogId=maniacjk&currentPage=1&categoryNo=0&countPerPage=30`
  GPT의 오늘 글이 아직 목록에 없을 때만 GPT 패키지를 `download_file_content` 로 받아 `peek_pack.py` 로 제목을 본다
  (180KB 안팎이라 결과가 tool-results 파일로 저장되며, 스크립트가 그 파일도 찾는다).
- 숫자·인용은 서로 다른 출처 3곳 이상의 원문에서 확인한다. 확인 못 한 숫자·인용은 넣지 않는다.
  보도마다 다르면 범위로 쓰거나 '보도마다 차이'를 밝힌다.
- 종목 매매 추천, Anthropic 관련 이슈는 다루지 않는다.

## post.json

```json
{"schema_version": 1, "id": "YYYYMMDD-hotissue-claude-<영문>", "date": "YYYY-MM-DD",
 "blog_id": "maniacjk", "title": "30~45자", "topic": "비즈니스·경제",
 "tags": ["5~8개", "#·공백·쉼표 없이"],
 "blocks": [
  {"type": "paragraph", "text": "쉬운 도입(번호 없음)"},
  {"type": "paragraph", "text": "1. 소제목\n본문"},
  {"type": "image", "file": "images/01.png", "caption": "도표: … 단위·기준시점 … 블로그 직접 작성 도표",
   "links": [{"label": "출처 이름", "url": "https://…"}]}
 ]}
```

- 본문(문단 글자 합) 1,800~2,500자, 번호 문단 8~15개: 이슈→배경→원인→영향→반대 시나리오·확인할 지표.
- 비유 2~3개, 해석·전망 문단은 표시. 문단에 링크·HTML·마크다운 없음(출처 링크는 이미지 `links` 에만).
- 이미지 2~3개. 직접 그린 도표가 기본이다(`chart.js`). 도표 숫자는 본문에도 있어야 한다.
- 금지 키: `category_no`, `demo_only`, `already_published_url`.

## 순서

작업 폴더 W 를 하나 만들고(스크래치 폴더 아래), 도구는 이 폴더에서 받아 쓴다.

```
node chart.js W/charts.json W/images          # 도표(가로 막대, 음수면 양방향)
python3 -I build_pack.py W W/out/YYYYMMDD_hotissue-claude.naverpack.zip   # 6색 PNG + ZIP + .b64
python3 -I verify_pack.py W/out/…zip --nums '도표숫자1|도표숫자2|…'          # RESULT: PASS 여야 함
fold -w 2000 W/out/…zip.b64 > W/out/b64_folded.txt
```

1. 드라이브 `create_file`: title 최종 이름(`.partial` 쓰지 않음 — 업로더가 중간 이름을 보고 건너뛴 적이 있다),
   parentId 위 폴더, contentMimeType `application/zip`, disableConversionToGoogleType true,
   base64Content 는 b64_folded.txt 줄을 줄바꿈 없이 이어 붙인 값.
2. 결과 fileSize 가 ZIP 크기와 같은지 본다.
3. `download_file_content(fileId)` → `python3 -I check_upload.py <fileId> <zip>` 가 `MATCH` 여야 '드라이브 전달 완료'.
   MISMATCH 면 내가 방금 올린 그 파일만 휴지통으로 보내고 한 번 다시 올린다.
4. 보고(한국어): 제목·기준 날짜 / 문단·이미지·태그 수 / ZIP 이름 / 검증 결과 / 드라이브 링크 / 주요 출처.

지난 원고는 `posts/` 에 날짜별로 남긴다(새 세션 예약은 저장소에 푸시하지 못하므로 그날 원고는 드라이브 ZIP 이 원본이다).
