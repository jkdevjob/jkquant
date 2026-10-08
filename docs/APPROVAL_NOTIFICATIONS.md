# JK 투자 사용자 승인 알림 운영 기준

## 동작
관리자 > 사용자에서 승인을 누르면 Firestore의 profiles/{uid}에 approved:true 와 approvedAt을 저장한 뒤 Worker POST /approval/notify 를 호출합니다. Worker가 관리자 Firebase ID 토큰 서명을 검증하고 Firestore 승인 상태 및 차단 상태를 직접 재확인합니다.

- 이메일: 사용자 본인이 신청한 Google 로그인 이메일로 승인 완료 안내. Resend API 키와 인증된 발신 도메인이 모두 필요합니다.
- 개인 웹알림: 승인 대기 화면에서 사용자가 알림을 허용하고 등록한 기기에만 전송합니다. 등록은 로그인 토큰으로 자신의 UID에 연결합니다.
- 중복방지: UID + approvedAt 건별로 이미 성공한 채널은 다시 발송하지 않습니다. 관리자에서 재시도할 때 실패한 채널만 다시 시도합니다.
- 결과: 관리자 사용자 목록에서 이메일/웹알림 채널별 접수 결과를 확인합니다. 성공은 제공자의 발송 요청 접수를 뜻하며 실제 수신함 도착이나 열람까지 증명하지는 않습니다.

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
