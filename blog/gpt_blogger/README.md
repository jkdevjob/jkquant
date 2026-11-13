# GPT → 구글 블로거 '매니악 브리핑' 자동 게시 연결 (2026-11-13)

사용자 지시: "블로거에 매니악브리핑 만들어서 지피티한테 자동으로 올리라고 시키려고 하니까 지시서 만들어줘"

- 은퇴노트(retire-note.blogspot.com) = 클로드가 GitHub Actions 로 매일 05:00 게시. **매니악 브리핑(블로거) = GPT 가 직접 게시.** 서로 다른 블로그다.
- GPT 는 'GPT 만들기'의 **작업(Actions)** 으로 Blogger API 를 부른다. 키는 OpenAI 쪽(GPT 설정)에만 들어가고 이 저장소·채팅에는 쓰지 않는다.
- 파일: `instructions.md`(GPT 지침에 붙일 글) · `openapi.yaml`(작업 스키마 — 매니악 브리핑 블로그 ID 하나만 허용, 삭제·수정 기능 없음).

## 연결 순서

1. **블로그 만들기** — https://www.blogger.com → 왼쪽 위 블로그 이름 옆 ▼ → '새 블로그' → 이름 `매니악 브리핑`, 주소(예: `maniac-briefing`).
   관리 화면 주소 `blogger.com/blog/posts/긴숫자` 의 숫자가 **블로그 ID**다(비밀값 아님).
2. **GPT 전용 OAuth 클라이언트** — 구글 클라우드 `retire-note-blog` → Google 인증 플랫폼 → 클라이언트 → '클라이언트 만들기' →
   웹 애플리케이션, 이름 `gpt-maniac`. 리디렉션 URI 는 5번에서 넣는다. 클라이언트 ID·보안 비밀번호를 복사해 둔다.
   (은퇴노트용 `blog-publisher` 와 따로 두면, GPT 쪽에 문제가 생겼을 때 이것만 지우면 된다.)
3. **GPT 만들기** — ChatGPT → GPT → '만들기' → '구성' 탭: 이름 `매니악 브리핑 작성기`, 지침 칸에 `instructions.md` 의 ``` 안 글,
   기능은 **웹 검색 켬**(이미지 생성은 끔). 공개 범위는 **나만 보기**.
4. **작업(Actions) 추가** — '새 작업 만들기':
   - 인증: **OAuth** · 클라이언트 ID/보안 비밀번호: 2번 값 · 인증 URL `https://accounts.google.com/o/oauth2/v2/auth`
     · 토큰 URL `https://oauth2.googleapis.com/token` · 범위 `https://www.googleapis.com/auth/blogger` · 토큰 교환 방법: 기본(POST)
   - 스키마: 'URL에서 가져오기'에 `https://raw.githubusercontent.com/jkdevjob/jkquant/claude/blog-daily/blog/gpt_blogger/openapi.yaml`
     (또는 파일 내용 붙여넣기). `enum` 의 `여기에_매니악브리핑_블로그ID_숫자` 를 1번의 블로그 ID 로 바꾼다.
   - 개인정보 처리방침 URL 칸이 필수로 나오면 블로그 주소(1번)를 넣는다.
5. **콜백 주소 등록** — 저장하면 GPT 설정에 '콜백 URL'(`https://chatgpt.com/aip/…/oauth/callback` 모양)이 나온다.
   이것을 2번 클라이언트 `gpt-maniac` 의 '승인된 리디렉션 URI' 에 넣고 저장한다(적용까지 몇 분 걸릴 수 있다).
6. **첫 시험** — GPT 미리보기에서 `오늘 글` → 'Sign in with googleapis.com' → 블로그 주인 계정으로 로그인 → 허용
   ('확인되지 않은 앱'이 나오면 고급 → 이동). 게시 뒤 GPT 가 보고한 주소를 열어 확인한다.
7. **매일 자동** — ChatGPT 의 '예약 작업(Tasks)'을 이 GPT 에서 쓸 수 있으면 "매일 07:00 '오늘 글'"로 예약한다.
   쓸 수 없으면 하루 한 번 GPT 를 열어 `오늘 글` 이라고만 보낸다. (ChatGPT 기능 범위는 이쪽에서 확인할 수 없다.)

## 주의

- 범위 `blogger` 는 그 구글 계정의 모든 블로그에 권한을 준다. 스키마가 블로그 ID 하나만 허용해 은퇴노트에는 쓰지 못하게 막았지만,
  완전히 떼어 놓으려면 매니악 브리핑을 **다른 구글 계정**으로 만들고 그 계정으로 6번 로그인을 한다.
- 구글 클라우드 '대상'이 '프로덕션'이어야 로그인이 7일마다 풀리지 않는다(은퇴노트 때 확인한 설정 그대로).
- 클라이언트 보안 비밀번호는 GPT 설정(OpenAI)에 저장된다. 채팅·저장소에는 쓰지 않는다.
