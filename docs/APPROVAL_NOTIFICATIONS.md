# JK 투자 사용자 승인 알림 운영 기준

## 동작
관리자 > 사용자에서 승인을 누르면 Firestore의 profiles/{uid}에 approved:true 와 approvedAt을 저장한 뒤 Worker POST /approval/notify 를 호출합니다. Worker가 관리자 Firebase ID 토큰 서명을 검증하고 Firestore 승인 상태 및 차단 상태를 직접 재확인합니다.

- 이메일: 사용자 본인이 신청한 Google 로그인 이메일로 승인 완료 안내. Resend API 키와 인증된 발신 도메인이 모두 필요합니다.
- 개인 웹알림: 승인 대기 화면에서 사용자가 알림을 허용하고 등록한 기기에만 전송합니다. 등록은 로그인 토큰으로 자신의 UID에 연결합니다.
- 중복방지: UID + approvedAt 건별로 이미 성공한 채널은 다시 발송하지 않습니다. 관리자에서 재시도할 때 실패한 채널만 다시 시도합니다.
- 결과: 관리자 사용자 목록에서 이메일/웹알림 채널별 접수 결과를 확인합니다. 성공은 제공자의 발송 요청 접수를 뜻하며 실제 수신함 도착이나 열람까지 증명하지는 않습니다.

## 내 Gmail로 자동 발송 (추천: 별도 도메인·Resend 불필요)

기존 Resend 방식과 별도로 **Google Apps Script + MailApp** 이메일 발신을 지원합니다.
브라우저의 구글 로그인 상태와 Apps Script 발송 계정은 별개입니다.
승인 상태는 Cloudflare Worker에서 관리자의 Firebase 토큰과 Firestore 원장을 재검증하며,
메일 발송은 소유자가 1회 승인한 Google Apps Script 웹앱만 수행합니다.

1. 승인메일을 보내려는 Gmail 계정으로 [Google Apps Script](https://script.google.com/home/projects/create)에 접속해 새 프로젝트를 만듭니다.
2. 저장소 [integrations/gmail-approval/Code.gs](../integrations/gmail-approval/Code.gs)의 코드를 스크립트 편집기에 붙여넣고 저장합니다.
3. 왼쪽 **프로젝트 설정(톱니바퀴) → 스크립트 속성** 에
   `JK_APPROVAL_SHARED_SECRET` 이름으로 **영문/숫자 32자 이상의 추측하기 어려운 임의 문자열**을 설정합니다.
   이 값을 메시지로 보내거나 공개 코드에 붙여넣지 마세요.
4. 편집기에서 `authorizeMail` 함수를 실행하고 본인 Gmail 계정의 **메일 보내기 권한**을 허용합니다.
5. **배포 → 새 배포 → 웹 앱** 에서 **다음 사용자 인증 정보로 실행: 나**, **액세스 권한: 모든 사용자**로 설정해 배포합니다.
   외부 호출을 위한 공개 URL이지만 실제 발송은 비밀키를 확인하므로 임의의 방문자가 메일을 보낼 수 없습니다.
6. 생성된 **https://script.google.com/macros/s/.../exec** 형태의 배포 URL을 복사합니다.
7. GitHub 저장소 **Settings → Secrets and variables → Actions** 에 두 비밀값을 등록합니다.
   - `GMAIL_SCRIPT_URL` = 6번의 `/exec` URL
   - `GMAIL_SCRIPT_SECRET` = 3번의 동일한 비밀키
8. 저장소 **Actions → 신규분양 웹푸시 Worker 배포 → Run workflow**를 실행하여 Cloudflare Worker에 값을 반영합니다.
9. 관리자 화면에서 가입자 승인 또는 **알림 재시도**를 이용해 전송 상태를 확인합니다.
   성공이면 해당 Gmail 발신 계정에서 발송됩니다.

이메일은 `GMAIL_SCRIPT_URL`과 `GMAIL_SCRIPT_SECRET`이 모두 있는 경우 Gmail을 **우선** 사용하며,
둘 다 없다면 기존 Resend 키/인증 도메인이 구성된 경우에만 Resend를 사용합니다.
서버에 아무 발송 수단도 설정하지 않으면 `이메일 발신 설정 필요` 상태를 명확히 보여 줍니다.

보안: Gmail 비밀번호, 앱 비밀번호, Google OAuth refresh token을 서버에 저장하지 않습니다.
Gmail의 권한은 본인 Google Apps Script 프로젝트에만 부여되며, Worker는 제한된 승인 이메일 발송 웹앱만 호출합니다.
`Script Properties` 비밀키와 GitHub Secrets는 다른 위치에 같은 값을 등록합니다.
기존 승인 알림의 사용자별/승인별 중복방지에 더해 Apps Script도 동일 승인 ID를 다시 보내지 않도록 처리합니다.

일반 Gmail의 Apps Script MailApp 발송 한도는 Google 정책상 보통 **하루 100명 수신자**이며 변경될 수 있습니다.
메일 발송 성공은 메일 서비스의 전송 요청이 처리된 결과이며, 모든 수신함의 실제 수신·열람을 보장하지 않습니다.

## 이메일 설정 (필수)
Resend에서 소유한 발신 도메인을 검증한 뒤 GitHub 저장소 Actions Secrets에 아래 두 값을 등록합니다.

1. RESEND_API_KEY: Resend 이메일 발송 API 키.
2. APPROVAL_FROM_EMAIL: Resend에 인증된 도메인의 이메일 주소 (예: JK 투자 <notice@your-verified-domain.example>).

값을 공개 GitHub 소스나 HTML 파일에 넣으면 안 됩니다. 신규분양 웹푸시 Worker 배포 workflow가 두 Secrets가 모두 있을 때만 Cloudflare Worker의 비밀변수로 안전하게 반영합니다. 없으면 메일은 실제 발송되지 않고 관리자 화면에 '이메일 발신 설정 필요'로 표시됩니다.

Secrets를 등록한 후 GitHub Actions의 '신규분양 웹푸시 Worker 배포'를 수동 실행하고 신규 사용자 테스트 또는 승인알림 재시도 버튼으로 검증합니다.

## 모바일 웹알림
iPhone에서는 Safari에서 JK 투자를 홈 화면에 추가한 다음 홈 화면의 앱으로 실행하여 승인 대기 페이지의 '승인 완료 웹알림 켜기'를 눌러야 합니다. 권한이 거부된 기기에는 웹알림을 보낼 수 없습니다. 이메일 발송은 독립적으로 진행합니다.

## 보안과 테스트
- POST /approval/subscribe: Firebase ID 토큰 서명 확인 후 해당 UID와 기기 구독 연결.
- POST /approval/notify 및 POST /approval/status: 관리자 토큰 검증 후 송신/발송이력 조회.
- POST /approval/event: 고유 기기 endpoint로 연결된 승인 이벤트만 조회하며 이메일이나 UID는 노출하지 않음.
- node --test tests/approval-notification.test.mjs: 인증, 차단, 수신자, 중복방지, 개인 웹푸시, 이메일 설정 미완료 검사.
