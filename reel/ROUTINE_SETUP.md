# 매일 자동 작업을 "새 세션" 루틴으로 돌리기

지금 매일 작업은 기존 대화(세션)를 깨우는 방식이라, 그 대화가 오래 쉬면 깨어나지 못해 빠지는 날이 생긴다(11/1·11/2).
claude.ai 에서 루틴을 직접 만들면 매일 새 세션이 떠서 돌기 때문에 이 문제가 없다.
또 지금 방식은 매일 아주 긴 대화 기록을 통째로 들고 돌아서 사용량이 크다(주간 한도에 걸리면 그날 작업이 통째로 멈춘다).
새 세션은 저장소의 안내 파일만 읽고 시작하니 훨씬 가볍다.
(Claude 가 도구로 만드는 루틴에는 Metricool 커넥터를 붙일 수 없어서 사람이 한 번 만들어야 한다.)

## 만드는 법 (한 번만)

1. claude.ai/code 에서 **루틴(Routines) → 새로 만들기**
2. 저장소: `jkdevjob/jkquant`, 브랜치: `claude/instagram-reel-video-creation-wl16ee`
3. 커넥터: **Metricool** 켜기
4. 일정: 매일 **06:37** (Asia/Seoul)
5. 지시문: 아래 상자 내용을 그대로 붙여 넣기
6. 따로 알려 줄 필요 없다. 다음 아침 작업이 새 루틴을 찾으면 예전 방식(대화 깨우기)을 스스로 꺼서 두 번 돌지 않는다.

## 붙여 넣을 지시문

```
은퇴노트(인스타 retire.note / 유튜브 쇼츠 은퇴노트) 매일 영상 2편 제작 + Metricool 예약. 보고는 한국어로만.
사용자 요청: 매일 다른 인기 영상을 보고 트렌드·기법을 학습해서 영상 만들기, 같은 분야 인기 영상의 주제·구조 참고(베끼지 않고),
전날 가장 핫한 이슈를 은퇴 관점으로, 제목은 어그로 있게, AI 티 안 나게 자연스럽게, 목소리는 최대한 자연스럽게.

0. 브랜치 claude/instagram-reel-video-creation-wl16ee 에서 작업한다(main 금지, 강제 푸시 금지). cd reel && npm install.
   지금 시각(Asia/Seoul)이 12:30 을 넘었으면 동향 영상은 다음 빈 12:30, 20:00 을 넘었으면 이슈 영상은 다음 날 20:00 으로 잡는다.
1. reel/TREND_GUIDE.md 1·1-1: node trends/scan-youtube.mjs → node trends/frames.mjs --n 6 → sheet.jpg 를 직접 보고 기법 분석 → trends/LEARNINGS.md 에 기록.
2. 동향 영상(TREND_GUIDE 3·4, 예시 queue/issues/2026-11-02-t.note.json): 손글씨 노트 + 목소리 → --preview 확인 → 렌더 → queue.json tYYYYMMDD(date=게시일) → 커밋·푸시 → Metricool 12:30.
3. 이슈 영상(reel/ISSUE_GUIDE.md, 예시 queue/issues/2026-11-02.note.json): 전날 최대 이슈(은퇴·노후와 닿는 것 우선, 동향과 겹치지 않게) → 조사(출처 2곳 이상) → 노트 + 목소리 → 확인 → 렌더 → queue.json iYYYYMMDD → 커밋·푸시 → Metricool 20:00.
   목소리는 ISSUE_GUIDE 4-1(구어체, 숫자는 한글로 읽는 대로, 화면 시각은 "@줄id"). 그 게시일 항목에 이미 metricool 기록이 있으면 건너뛴다.
4. Metricool: blogId 7749250, getBrandSettings 로 인스타 retire.note·유튜브 UCDkP-ixGx6r26fnfML_FAVA 확인 → 푸시한 커밋 고정 jsDelivr 주소(HEAD 200·video/mp4) →
   getScheduledPosts 로 중복 확인 → createScheduledPost(youtube short isAiGeneratedContent false + instagram REEL isAiGenerated true(목소리 넣은 영상)).
   결과(id, uuid, at)를 queue.json 에 적고 커밋·푸시.
5. 예비 영상(ISSUE_GUIDE 6-1, queue.json kind "buffer"): 오늘 12:30 에 예비가 잡혀 있는데 새 동향 영상을 예약했으면 그 예비를 updateScheduledPost 로
   맨 뒤 예비 다음 날 12:30 으로 옮긴다. 예약된 예비가 2편 아래면 시기 안 타는 주제로 하나 더 만든다.
6. 확인 못 한 숫자·인용은 쓰지 않는다. 남의 대본·화면·클립·음악은 쓰지 않는다(기법만). 지어낸 경험·사연 금지. 제목은 내용과 다르게 쓰지 않는다.
7. 일요일엔 TREND_GUIDE 5번(지난주 성과 정리)도 한다.
8. 끝나면 짧게 보고: 배운 기법 · 두 편 주제·유튜브 제목·예약 시각 · 출처 · 커밋 해시 · 남은 예비 수. 실패하면 이유와 사람이 할 일.
```
