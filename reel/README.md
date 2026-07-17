# 릴스 자동 생성기 (JK 퀀트)

종목 하나만 넣으면 **적립식(DCA) 백테스트 → 세로 릴스 mp4**가 자동으로 나옵니다.
인스타 `exitantai` 스타일: "○○에 매일 1만원씩 샀다면?" → 원금·평가액·수익률 숫자
카운트업 애니메이션 + 자산곡선 차트.

- 출력 규격: **1080×1920, 30fps, H.264(mp4) + AAC** — 인스타 릴스/유튜브 쇼츠/틱톡 그대로 업로드 가능
- 색: 한국 관례(수익=빨강, 손실=파랑) 자동
- 데이터: Yahoo Finance (미국 티커 + 한국 6자리 종목코드 자동 `.KS/.KQ`)

## 설치

```bash
cd reel
npm install
npx playwright install chromium   # 최초 1회 (Chromium 렌더러)
```

> 이 저장소의 웹 세션 환경에는 Chromium과 폰트가 이미 준비돼 있어 별도 설치가 필요 없습니다.
> 한글 폰트(나눔고딕)는 `fonts/`에 포함돼 있어 서버/헤드리스에서도 글자가 깨지지 않습니다.

## 사용법

### 한 편 만들기

```bash
# 카카오에 2021.07부터 매일 1만원씩 (16초)
node make-reel.mjs --symbol 035720 --name 카카오 --amount 10000 \
  --interval daily --start 2021-07-01 --duration 16 --handle "@jkquant"

# 삼성전자에 매주 5만원씩, 최근 3년
node make-reel.mjs --symbol 005930 --name 삼성전자 --amount 50000 \
  --interval weekly --range 3y

# 미국 TQQQ에 매일 $100
node make-reel.mjs --symbol TQQQ --amount 100 --start 2021-01-01
```

결과: `out/<종목>_<날짜>.mp4`

### 여러 편 일괄 생성

```bash
node make-reel.mjs --config reels.config.json
```

`reels.config.json` 의 `reels` 배열에 종목을 나열하면 순차로 뽑습니다.

## 옵션

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--symbol` | 종목(미국 티커 또는 한국 6자리 코드) | (필수) |
| `--name` | 화면 표시 이름 | 종목명 자동 |
| `--amount` | 회당 적립 금액 | 10000 |
| `--interval` | `daily` / `weekly` / `monthly` | daily |
| `--start` `--end` | 기간(YYYY-MM-DD) | — |
| `--range` | start 없을 때 기간(`1y`,`3y`,`5y`,`10y`,`max`) | 5y |
| `--duration` | 영상 길이(초) | 16 |
| `--fps` | 프레임레이트 | 30 |
| `--hook` | 오프닝 문구 | 자동 생성 |
| `--punch` | 마지막 펀치라인 | 자동 생성 |
| `--handle` | 하단 워터마크 | — |
| `--music` | 배경음악 파일 경로(mp3 등) | 무음 트랙 |
| `--out` | 출력 경로 지정 | out/... |

> 음악을 넣으려면 저작권 걱정 없는 트랙(YouTube 오디오 보관함, Pixabay 등)을
> `--music path/to/bgm.mp3` 로 지정하세요. 없으면 무음 오디오 트랙만 넣습니다.

## 구조

```
reel/
├── make-reel.mjs      # 오케스트레이터: 데이터→계산→프레임캡처→ffmpeg mp4
├── template.html      # 9:16 캔버스 애니메이션(시간 함수 기반, 결정론적 렌더)
├── lib/
│   ├── data.mjs       # Yahoo 일간 시세 수집
│   └── dca.mjs        # 적립식 백테스트 계산
├── fonts/             # 나눔고딕(한글) — 헤드리스 렌더용 임베드
└── reels.config.json  # 일괄 생성 목록
```

## 동작 원리

1. **데이터**: Yahoo Finance에서 조정종가 일간 시세 수집
2. **계산**: 매 주기마다 정액 매수 → 원금/평가액/수익/수익률 + 자산곡선
3. **렌더**: `template.html`의 `renderAt(t)`가 시간 t(초)마다 전체 화면을
   캔버스에 그림. CSS 애니메이션을 쓰지 않아 프레임 단위로 정확히 재현됨
4. **캡처**: Playwright(Chromium)로 매 프레임 스크린샷
5. **인코딩**: ffmpeg로 PNG 시퀀스 → mp4(H.264/yuv420p) + 페이드아웃 + faststart

## 커스터마이즈

- 색/레이아웃/문구: `template.html`의 각 `draw*` 함수 수정
- 타임라인: `template.html` 상단 주석의 초 단위 구간(`seg`, `fade`) 조정
- 계산 규칙(수수료·환율 등): `lib/dca.mjs`
