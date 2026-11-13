# 인스타·유튜브 자동 발행 연결 방법

**지금 방식(11/13 결정)**: 인스타는 이 저장소의 업로더(`reel/publish-social.mjs`)가 **GitHub Actions**로 한국 시간
09·12·18시 직후에 올린다(`.github/workflows/publish-social.yml`, main 브랜치 — 정해진 시각 실행은 기본 브랜치에서만 된다).
유튜브는 당분간 **Metricool**(무료 월 20건)로만 올린다. 유튜브 API 는 구글 감사를 통과하기 전까지 올린 영상이
**비공개로 잠기기** 때문(구글 공식 문서). 감사 통과 뒤 `reel/queue/publish.config.json` 의 `targets` 에 `"yt"` 를 더한다.

업로더가 고르는 것: `queue.json` 항목 중 게시 시각(`plan_at` → `metricool.at` → `date`+`slot`)이 **오늘**이고 지금 이전이며
아직 안 올린 것. 150분보다 늦었으면 건너뛴다. 결과는 `reel/queue/published.json`·`last_run.txt` 로 이 브랜치에 커밋된다.

키는 **채팅에 붙여 넣지 말고, 저장소 파일에도 넣지 말고**, GitHub 저장소의
**Settings → Secrets and variables → Actions → New repository secret** 에만 넣는다.

| 비밀값 이름 | 어디서 | 필요 |
|---|---|---|
| `IG_ACCESS_TOKEN` | 메타 개발자 앱 → 인스타 장기 토큰 | 인스타 |
| `IG_USER_ID` | 토큰 만들 때 계정 옆에 보이는 숫자 ID | 인스타(권장) |
| `GOOGLE_CLIENT_ID` | 구글 클라우드 → OAuth 클라이언트 | 유튜브(감사 뒤) |
| `GOOGLE_CLIENT_SECRET` | 위와 같은 곳 | 유튜브(감사 뒤) |
| `YT_REFRESH_TOKEN` | OAuth Playground에서 발급 | 유튜브(감사 뒤) |

---

## 1. 인스타그램 (약 10분)

1. **프로페셔널 계정으로 전환** — 인스타 앱 → 설정 → 계정 유형 및 도구 →
   프로페셔널 계정으로 전환(크리에이터 또는 비즈니스). 페이스북 페이지는 없어도 된다.
2. **메타 개발자 앱 만들기** — <https://developers.facebook.com/apps> → 앱 만들기 →
   사용 사례에서 **"Instagram에서 메시지 및 콘텐츠 관리"** 선택.
3. **권한** — 앱의 Instagram → *Instagram 로그인을 통한 API 설정* 화면에서
   `instagram_business_basic`, `instagram_business_content_publish` 가 들어 있는지 확인.
4. **계정 연결 + 토큰** — 같은 화면의 *액세스 토큰 생성* → 계정 추가 → `retire.note` 로 로그인 →
   **토큰 생성**. 나온 토큰(60일짜리 장기 토큰)을 GitHub 비밀값 `IG_ACCESS_TOKEN` 에, 옆에 보이는 숫자 ID를 `IG_USER_ID` 에 넣는다.
   - 이미 만든 앱(예: '은퇴노트', 개발 중)이 있으면 새로 만들지 말고 그 앱의 **사용 사례 → 맞춤 설정**에서 한다.
   - 계정 추가가 막히면: 앱 역할 → Instagram 테스터로 `retire.note` 추가 →
     인스타 앱(또는 웹) 설정 → 앱 및 웹사이트 → 테스터 초대 수락 후 다시 시도.
5. 내 계정에만 올리는 용도라 **앱 검수(App Review)는 필요 없다.**

**토큰 만료**: 장기 토큰은 60일. 스크립트가 7일마다 연장 요청을 보내고 남은 날짜를 보고한다.
"토큰 만료·무효(code 190)"가 보고되면 4번을 다시 해서 토큰만 바꾸면 된다.

## 2. 유튜브 (약 15분)

1. <https://console.cloud.google.com> → 새 프로젝트(예: `retire-note`).
2. **API 및 서비스 → 라이브러리 → "YouTube Data API v3" → 사용**.
3. **OAuth 동의 화면**(Google 인증 플랫폼) → 외부 → 앱 이름·이메일 입력 →
   대상(Audience)에서 **앱 게시 → 프로덕션**으로 바꾼다.
   - "테스트" 상태로 두면 갱신 토큰이 **7일마다 만료**돼 자동 발행이 멈춘다.
   - 검수 전 앱이라 로그인할 때 "확인되지 않은 앱" 경고가 뜬다. 내 앱이니 *고급 → 이동*으로 진행.
4. **클라이언트 → OAuth 클라이언트 ID 만들기** → 웹 애플리케이션 →
   승인된 리디렉션 URI에 `https://developers.google.com/oauthplayground` 추가 →
   만들어진 클라이언트 ID/보안 비밀을 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 에.
   (블로그 방에서 만든 클라이언트가 있으면 같은 걸 써도 된다. 리디렉션 URI만 들어 있으면 됨.)
5. **갱신 토큰 받기** — <https://developers.google.com/oauthplayground> →
   오른쪽 위 톱니바퀴 → *Use your own OAuth credentials* 체크 → 4번의 ID/비밀 입력 →
   왼쪽 입력칸에 아래 두 범위를 **띄어쓰기로 이어서** 입력 → **Authorize APIs** →
   `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly`
   (**두 범위 모두 필수.** readonly 는 같은 영상을 두 번 올리지 않도록 최근 업로드 제목을 확인하는 데만 쓴다) →
   은퇴노트 유튜브 채널이 있는 구글 계정(브랜드 계정이면 그 채널)으로 로그인 →
   **Exchange authorization code for tokens** → 나온 **Refresh token** 을 GitHub 비밀값 `YT_REFRESH_TOKEN` 에.
6. **감사 신청** — YouTube API Services 감사 신청서(support.google.com/youtube/contact/yt_api_form).
   통과 전 API 업로드는 비공개로 잠기고, 잠긴 영상은 나중에 공개로 못 바꾼다(다시 올려야 함). 통과 전에는 유튜브 API 로 올리지 않는다.

## 3. 확인

- GitHub 저장소 → **Actions → 은퇴노트 인스타 자동 발행 → Run workflow**(점검만 체크) → 로그에 "키 있음"이 보이면 연결 끝.
- 로컬 점검: `cd reel && node publish-social.mjs --dry --date 2026-11-13 --now 12:05`
- 매 실행 결과는 `reel/queue/last_run.txt`, 게시 주소는 `reel/queue/published.json` 에 남는다.
  올리기 전에 계정의 최근 게시물(인스타 캡션 첫 줄)을 확인해서 같은 영상을 다시 올리지 않는다.
- 인스타 API 로는 'AI 정보' 표시를 켤 수 없어서, 캡션 해시태그 줄 앞에 `publish.config.json` 의 `ig_ai_note` 한 줄을 넣는다.

## 영상 추가

`reel/queue/` 아래에 mp4를 두고 `queue.json` 의 `items` 에 항목을 더한다
(`id`, `date`(한국 날짜), `slot`("09:00" 등) 또는 `plan_at`, `file`, **`caption`(필수 — 인스타가 이 문구로 올라감)**, `yt_title`, `tags`).
커밋·푸시돼 있어야 인스타가 영상을 내려받을 수 있다(저장소가 공개라 jsDelivr 주소로 연다).
