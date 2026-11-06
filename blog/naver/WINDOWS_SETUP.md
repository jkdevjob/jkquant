# 노트북(윈도우) 자동 게시 설치

사용자 지시(2026-11-06): "전에 지피티가 하던 방식대로 너가 모든걸 자동으로 할수 없을까? 노트북 항상 켜놓으면".

- 클라우드 세션은 매일 아침 원고를 `posts/<날짜>_*.json` 으로 저장소(`claude/blog-daily`)에 올린다.
- 노트북의 작업 스케줄러는 07:30부터 13:30까지 30분마다 `run_daily.cmd` 를 실행한다. 이 파일은 `git pull` 한 뒤 `local_publish.js` 를 돌린다.
- `local_publish.js` 는 노트북 전용 크롬 프로필(`%USERPROFILE%\.maniac-naver-profile`)로 게시한다. 이 프로필은 '로그인 상태 유지'로 한 번 로그인해 둔다.
  - 이미 올라간 글이면 아무것도 하지 않는다. 같은 제목이 글 목록에 있으면 건너뛴다.
  - 원고와 다르게 채워졌거나 발행 설정이 다르면 게시하지 않는다.
  - 저장소 파일은 고치지 않는다. 결과는 `%USERPROFILE%\.maniac-naver-work\last_status.json` 과 `publish.log` 에 남긴다.

## 1. 설치 (한 번)

노트북의 Claude 데스크톱 앱(Claude Code)에 아래를 붙여 넣으면 대신 해 준다.

> PowerShell 로 해 줘. Node.js LTS 와 Git 이 없으면 `winget install OpenJS.NodeJS.LTS` 와 `winget install Git.Git` 로 설치해.
> 홈 폴더에 `git clone -b claude/blog-daily https://github.com/jkdevjob/jkquant.git` 하고, `jkquant\blog\naver` 에서 `npm install` 해.
> 그다음 `jkquant\blog\naver\WINDOWS_SETUP.md` 의 2~4단계를 진행해. 2단계 로그인은 내가 직접 할 테니 창을 띄우고 기다려.

직접 할 때는 PowerShell 에서 다음을 실행한다.

```
cd $HOME
git clone -b claude/blog-daily https://github.com/jkdevjob/jkquant.git
cd jkquant\blog\naver
npm install
```

- 크롬이 깔려 있으면 브라우저를 따로 받지 않는다.
- 크롬이 없으면 `npx playwright install chromium` 을 한 번 실행한다.

## 2. 네이버 로그인 (한 번, 사용자가 직접)

```
node local_publish.js --login
```

1. 크롬 창이 뜨면 폰 네이버 앱 렌즈로 노트북 화면의 QR 을 찍어 로그인한다. 아이디 로그인도 된다.
2. **'로그인 상태 유지'를 켠다.**
3. 끝나면 로그에 `LOGGED_IN (로그인 상태 유지 확인)` 이 찍힌다.
4. '주의' 문구가 나오면 아이디 로그인 쪽에서 '로그인 상태 유지'를 켜고 다시 한다.

## 3. 확인

```
node local_publish.js --check
```

- `CHECK_OK` 가 나오면 로그인과 오늘 원고가 모두 준비된 것이다.
- `NO_POST` 는 오늘 원고가 아직 저장소에 없다는 뜻이다(아침 원고 전이면 정상).
- `ALREADY` 는 오늘 글이 이미 올라갔다는 뜻이다.

## 4. 예약 등록

```
powershell -ExecutionPolicy Bypass -File .\setup_task.ps1
```

전원 설정도 바꾼다.
- 설정 → 시스템 → 전원: 전원 연결 시 절전 '안 함'
- 제어판 → 전원 옵션 → 덮개를 닫으면: 전원 연결 시 '아무 것도 안 함'
- 고급 전원 설정 → 절전 → 절전 모드 해제 타이머 허용: '사용'

작업은 '로그온한 경우에만' 실행된다. 화면 잠금은 괜찮지만, 재부팅한 뒤에는 한 번 로그인해 둬야 한다.

## 5. 끝나면

클라우드 대화에 "노트북 설치 끝"이라고 알려 준다. 클라우드 세션이 `local_publisher.json` 의 `enabled` 를 `true` 로 바꾼다.
그 뒤 아침 세션은 QR 링크를 바로 보내지 않는다. 약 1시간 뒤 글 목록을 보고, 안 올라갔을 때만 QR 링크로 대신 올린다.

## 문제가 생기면

- `last_status.json` 의 `result` 를 본다.
  - `LOGIN_NEEDED`: 2단계를 다시 한다.
  - `ERROR`: `publish.log` 마지막 줄을 클라우드 대화에 붙여 준다.
- 예약을 멈추려면 `Unregister-ScheduledTask -TaskName ManiacNaverPublish` 를 실행한다.
