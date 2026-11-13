# ③ ETH 실투자 봇 — 설치 안내

**하는 일**
- 업비트 KRW-ETH 를 연구(클로드) ③ 고정 메인(`g_coin_ma15_s99_hi7_eth`)대로 **실제로 사고팝니다.**
- 규칙: 어제 종가가 15일 평균보다 높은 날, 그날(09:00 시작) 가격이 최근 7일 고가를 넘으면 시장가로 삽니다. 다음 날 09:00 에 시장가로 팝니다. 손절은 없습니다.
- 판단은 연구 화면(모의)과 **같은 함수**로 합니다. 체결은 업비트 알림과 Worker 장부에 실투자 기록으로 남습니다.

**왜 따로 서버가 필요한가**
- 업비트는 **주문 권한이 있는 API 키에 허용 IP 를 꼭 등록**해야 합니다.
- 우리 시스템(Cloudflare · GitHub)은 IP 가 매번 바뀌어서 주문을 낼 수 없습니다.
- 그래서 IP 가 고정된 무료 서버 한 대에서 이 봇만 돌립니다.

**걸리는 시간**: 처음 한 번 30분~1시간. 그 뒤로는 손댈 일이 없습니다.

> ⚠️ 업비트 키 · 보고 키는 **서버의 설정 파일에만** 넣습니다. 대화창 · 깃 · 메신저에 붙이지 마세요.

---

## 1. 오라클 클라우드 가입 (무료)

1. https://www.oracle.com/kr/cloud/free/ → **무료로 시작하기**
2. 홈 리전은 **한국(서울) 또는 한국(춘천)**을 고르세요. 나중에 바꿀 수 없고, 무료 서버는 홈 리전에서만 만들 수 있습니다.
3. 카드 인증이 있습니다. 무료 범위(Always Free)만 쓰면 청구되지 않습니다.
4. (권장) 가입 뒤 **종량제(Pay As You Go)로 업그레이드**하세요.
   - 오라클은 사용량이 아주 적은 무료 서버를 '쉬는 서버'로 보고 멈출 수 있는데, 업그레이드하면 그러지 않습니다.
   - 무료 범위는 업그레이드해도 계속 0원입니다. 이 봇 말고 다른 것은 만들지 마세요.

## 2. 서버 만들기

1. 메뉴 → **컴퓨트(Compute) → 인스턴스(Instances) → 인스턴스 생성(Create instance)** 을 엽니다.
2. 다음처럼 설정합니다.
   - 이름: `coinbot`
   - 이미지: **Canonical Ubuntu 24.04**
   - 구성(Shape): **VM.Standard.E2.1.Micro** ('Always Free 적격' 표시가 있는 것). Ampere A1 도 됩니다.
   - 네트워킹: 공용 IPv4 주소 지정(Assign a public IPv4 address) 켜기
   - SSH 키: **키 쌍 생성(Generate a key pair)** → **개인 키 저장**. `coinbot.key` 같은 이름으로 잘 보관하세요.
3. **생성**을 누르고 상태가 '실행 중(Running)'이 될 때까지 기다립니다.

## 3. IP 고정하기 (예약된 공용 IP)

서버를 지웠다 다시 만들어도 IP 가 바뀌지 않게 '예약된 공용 IP'로 바꿉니다.

1. 인스턴스 → **연결된 VNIC(Attached VNICs)** → VNIC 이름 클릭 → **IPv4 주소(IPv4 Addresses)**
2. 줄 끝 ⋮ → **편집(Edit)** → 공용 IP 를 **공용 IP 없음(No public IP)**으로 바꿔 저장합니다.
3. 다시 **편집** → **예약된 공용 IP(Reserved public IP)** → **새 예약 IP 생성** → 저장합니다.
4. 화면의 공용 IP 주소(예: `152.69.x.x`)를 적어 둡니다. 이 IP 를 업비트에 등록합니다.

(메뉴 이름은 화면 언어에 따라 조금 다를 수 있습니다.)

## 4. 서버 접속

**Windows (PowerShell)** — 키 파일이 있는 폴더에서:
```powershell
icacls coinbot.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i coinbot.key ubuntu@<서버 IP>
```

**Mac (터미널)**:
```bash
chmod 600 coinbot.key
ssh -i coinbot.key ubuntu@<서버 IP>
```

처음에 `yes` 를 묻으면 `yes` 를 입력합니다. `ubuntu@coinbot:~$` 가 보이면 접속된 것입니다.

## 5. 봇 설치

서버에서 아래 두 줄을 붙여 넣습니다.
```bash
git clone --depth 1 https://github.com/jkdevjob/jkquant.git ~/jkquant
bash ~/jkquant/bots/claude-coinbot/install.sh
```

- 마지막에 **보고 키**(64자)가 나옵니다. 8단계에서 Cloudflare 에 넣을 값입니다(대화창에 붙이지 마세요).
- 나중에 다시 보려면: `grep COINBOT_REPORT_KEY ~/.claude-coinbot/env`

## 6. 업비트 API 키 만들기

1. 업비트 웹(upbit.com) → **마이페이지 → Open API 관리**로 갑니다.
2. 권한은 **자산조회 · 주문조회 · 주문하기 만** 체크합니다. 출금 · 입금 관련은 모두 뺍니다.
3. 허용 IP 에 **3단계의 서버 IP** 를 넣습니다.
4. 발급(인증)이 끝나면 **Access Key** 와 **Secret Key** 가 나옵니다. Secret Key 는 한 번만 보입니다.
5. 키 유효기간은 1년입니다. 만료 전에 다시 발급해 7단계처럼 바꿔 넣으세요.

## 7. 키를 서버에 넣기

```bash
nano ~/.claude-coinbot/env
```

1. `UPBIT_ACCESS_KEY=` 뒤에 Access Key 를, `UPBIT_SECRET_KEY=` 뒤에 Secret Key 를 붙여 넣습니다(띄어쓰기 없이).
2. 저장: `Ctrl+O` → `Enter` → `Ctrl+X`.

나머지 줄은 그대로 둡니다.
- `BUDGET_KRW=600000`: 한 번에 사는 금액. 원화 잔고가 적으면 잔고만큼만 삽니다.
- `DRY_RUN=1`: 시험 모드. 주문을 내지 않습니다.

## 8. Cloudflare 에 보고 키 넣기

1. Cloudflare 대시보드 → **Workers & Pages → jkquant(Pages)** → **설정(Settings) → 변수 및 비밀(Variables and Secrets)**
2. **추가**: 이름 `CLAUDE_COINBOT_KEY`, 종류 **비밀(Secret/암호화)**, 값 = 5단계의 보고 키 → 저장합니다.
3. **배포(Deployments)** → 가장 최근 배포 ⋮ → **다시 배포(Retry deployment)**. 환경 변수는 다음 배포부터 적용됩니다.

## 9. 설치 확인

```bash
bash ~/jkquant/bots/claude-coinbot/check.sh
```

모든 줄이 ✅ 이면 됩니다. 텔레그램에 `[클로드 연구 비트코인] 🔧 ETH 실투자 봇 설치 확인` 이 옵니다.

- 주문 권한은 **최소 금액(5,000원)보다 작은 1,000원 시험 주문을 보내, 업비트가 거절하는지**로 확인합니다. 체결되지 않습니다.
- ❌ 가 있으면 13단계를 보세요.

## 10. 시험 모드로 켜기

```bash
sudo systemctl enable --now claude-coinbot
```

- 텔레그램에 `🤖 ETH 실투자 봇 시작 — 시험 모드` 가 옵니다.
- 시험 모드에서는 돌파가 나면 `🧪 ETH 시험 — 실전이면 지금 매수` 처럼 **알림만** 옵니다.
- 하루 이틀 지켜보세요. 지금(11/13)은 ETH 가 15일 평균 아래라 쉬는 날이 이어질 수 있습니다.

## 11. 실전으로 바꾸기

1. 업비트에 원화 **60만 원**을 넣습니다.
2. 설정을 바꾸고 봇을 다시 켭니다.
   ```bash
   sed -i 's/^DRY_RUN=1/DRY_RUN=0/' ~/.claude-coinbot/env
   sudo systemctl restart claude-coinbot
   ```
3. 텔레그램에 `🤖 ETH 실투자 봇 시작 — 실전` 이 오면 끝입니다.

이제부터 다음 알림이 옵니다.
- 매수 · 매도: `🟢 ETH 실투자 매수` · `🔴 ETH 실투자 매도`
- 연구 장부와 다른 날: `⏭️`
- 실패: `⚠️`
- 매주 월요일: `🤖 봇 정상`

## 12. 평소에 쓰는 명령

| 하고 싶은 것 | 명령 |
|---|---|
| 새로 사지 않기(보유분은 09:00 에 팖) | `touch ~/.claude-coinbot/PAUSE` |
| 다시 사기 시작 | `rm ~/.claude-coinbot/PAUSE` |
| 봇 완전히 끄기 / 켜기 | `sudo systemctl stop claude-coinbot` / `sudo systemctl start claude-coinbot` |
| 지금 상태(보유 · 오늘 계획) | `bash ~/jkquant/bots/claude-coinbot/check.sh --status` · 기록 `journalctl -u claude-coinbot -n 30` |
| 설치 다시 확인(키 · IP · 알림) | `bash ~/jkquant/bots/claude-coinbot/check.sh` |
| 체결 기록 | `cat ~/.claude-coinbot/fills.csv` |
| 새 판 받기 | `bash ~/jkquant/bots/claude-coinbot/update.sh` |

업비트 앱에서 직접 팔아도 됩니다. 봇은 계좌에 ETH 가 없으면 팔지 않고 넘어갑니다.

## 13. 문제가 있을 때

| 보이는 것 | 뜻 · 할 일 |
|---|---|
| `no_authorization_ip` | 업비트 허용 IP 에 이 서버 IP 가 없음 → 6단계 IP 확인(3단계 예약 IP) |
| `out_of_scope` | 키 권한 부족 → 자산조회 · 주문조회 · 주문하기 체크한 키로 다시 발급 |
| `invalid_access_key` · `jwt_verification` | 키를 잘못 붙여 넣음 → 7단계(앞뒤 띄어쓰기 없이) |
| 서버 시계 차이 ❌ | `sudo timedatectl set-ntp true` |
| 알림 보내기 ❌ 401 | Cloudflare `CLAUDE_COINBOT_KEY` 값이 설정 파일의 보고 키와 다르거나 다시 배포를 안 함 → 8단계 |
| ③ 메인 ❌ | 연구 ③ 메인이 고정 전략과 다름(고정을 풀었을 때) — 봇은 사지 않고 기다림. 사용자 확인 뒤 봇 전략을 바꿔야 함 |
| 텔레그램 `⚠️ … 주문 실패` | 봇은 **자동으로 다시 주문하지 않습니다.** 업비트 앱에서 확인하고, 필요하면 직접 사고파세요 |

## 14. 봇이 지키는 것

- **금액**: 예산(60만 원)과 원화 잔고 중 작은 쪽만 삽니다. 판 때는 봇이 산 수량만 팝니다. 계좌의 다른 ETH 는 건드리지 않습니다.
- **횟수**: 하루(09:00~다음 09:00)에 매수 한 번 · 매도 한 번입니다.
  - 주문마다 고유 번호(`jkq-c3-날짜-buy|sell`)가 붙고, 업비트는 같은 번호를 두 번 받지 않습니다.
- **다시 주문하지 않기**: 보내기 전에 상태를 먼저 저장합니다.
  - 응답이 끊기면 그 번호로 조회만 합니다. 2분이 지나도 없으면 실패로 알립니다.
  - 상태 파일을 잃어도 업비트 주문 기록으로 보유를 되살립니다.
- **늦게 본 돌파**: 서버가 꺼졌다 켜져 돌파를 늦게 봤을 때, 기준가보다 1% 넘게 오른 값으로는 따라 사지 않습니다.
  - 기준가는 그날 시가와 7일 고가 중 높은 쪽입니다. 1% 안으로 내려오면 삽니다.
  - 이것은 실행 안전장치이고 전략 규칙이 아닙니다. 끝내 못 사면 `⏭️` 로 알립니다.
- **전략 고정**: 연구 ③ 메인이 고정 전략과 다르면 사지 않습니다. 실투자 전략은 사용자 확인 없이 바뀌지 않습니다.
- **알림 실패**: 알림 · 기록이 실패해도 주문은 막히지 않습니다. 보낼 것은 쌓아 두고 다시 보냅니다.
