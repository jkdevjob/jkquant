# 인스타·유튜브 자동 발행 연결 방법

매일 저녁 예약 작업이 `node reel/publish-social.mjs` 를 실행해서
`reel/queue/queue.json` 의 영상을 하루 한 편씩 **인스타 릴스 + 유튜브 쇼츠**로 올린다.
키가 없으면 아무것도 올리지 않고 "키 미설정"으로 보고만 한다.

키는 **채팅에 붙여 넣지 말고, 저장소에도 넣지 말고**, Claude Code 웹의
**환경 설정 → 환경 변수**에만 넣는다. 예약 작업은 같은 환경에서 돌아서 그 값을 그대로 쓴다.

| 환경 변수 | 어디서 | 필수 |
|---|---|---|
| `IG_ACCESS_TOKEN` | 메타 개발자 앱 → 인스타 장기 토큰 | 인스타 |
| `IG_USER_ID` | 토큰 만들 때 같이 보이는 인스타 계정 ID | 선택(없으면 `me`) |
| `GOOGLE_CLIENT_ID` | 구글 클라우드 → OAuth 클라이언트 | 유튜브 |
| `GOOGLE_CLIENT_SECRET` | 위와 같은 곳 | 유튜브 |
| `YT_REFRESH_TOKEN` | OAuth Playground에서 발급 | 유튜브 |

---

## 1. 인스타그램 (약 10분)

1. **프로페셔널 계정으로 전환** — 인스타 앱 → 설정 → 계정 유형 및 도구 →
   프로페셔널 계정으로 전환(크리에이터 또는 비즈니스). 페이스북 페이지는 없어도 된다.
2. **메타 개발자 앱 만들기** — <https://developers.facebook.com/apps> → 앱 만들기 →
   사용 사례에서 **"Instagram에서 메시지 및 콘텐츠 관리"** 선택.
3. **권한** — 앱의 Instagram → *Instagram 로그인을 통한 API 설정* 화면에서
   `instagram_business_basic`, `instagram_business_content_publish` 가 들어 있는지 확인.
4. **계정 연결 + 토큰** — 같은 화면의 *액세스 토큰 생성* → 계정 추가 → `retire.note` 로 로그인 →
   **토큰 생성**. 나온 토큰(60일짜리 장기 토큰)을 `IG_ACCESS_TOKEN` 에, 옆에 보이는 숫자 ID를 `IG_USER_ID` 에 넣는다.
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
   왼쪽 입력칸에 `https://www.googleapis.com/auth/youtube.upload` 입력 → **Authorize APIs** →
   은퇴노트 유튜브 채널이 있는 구글 계정(브랜드 계정이면 그 채널)으로 로그인 →
   **Exchange authorization code for tokens** → 나온 **Refresh token** 을 `YT_REFRESH_TOKEN` 에.

## 3. 확인

키를 넣은 뒤 새 세션에서:

```
cd reel && node publish-social.mjs --dry
```

"키 있음"이 보이면 연결 끝. 실제 게시는 매일 예약 시간에 자동으로 된다.
결과(게시 주소)는 `reel/queue/published.json` 에 남고, 예약 작업이 커밋한다.

## 영상 추가

`reel/queue/` 아래에 mp4를 두고 `queue.json` 의 `items` 에 항목을 더한다
(`id`, `date`(한국 날짜), `file`, `caption`, `yt_title`(끝에 `#Shorts`), `tags`).
커밋·푸시돼 있어야 인스타가 영상을 내려받을 수 있다(저장소가 공개라 jsDelivr 주소로 연다).
