/**
 * JK 투자 — 개인 Gmail로 이용 승인 메일 발송.
 * Google Apps Script에 이 파일을 붙여넣고:
 *  1. 프로젝트 설정 > 스크립트 속성: JK_APPROVAL_SHARED_SECRET = 긴 임의 문자열
 *  2. authorizeMail() 1회 실행해서 본인 Gmail 발송 권한 허용
 *  3. 배포 > 새 배포 > 웹 앱 / 실행 사용자: 나 / 액세스: 모든 사용자
 *  4. 나온 /exec URL과 같은 비밀키를 GitHub Secrets
 *     GMAIL_SCRIPT_URL, GMAIL_SCRIPT_SECRET 에 등록
 *
 * 웹 앱 URL이 공개되어도 올바른 비밀키 없이는 메일을 보내지 않는다.
 * 재시도/타임아웃 중복 발송을 막기 위해 승인 ID별 송신 기록을 보관한다.
 */
const APPROVAL_URL = 'https://jkquant.pages.dev/';

function result_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorizeMail() {
  // 이 함수를 Apps Script 편집기에서 직접 1회 실행한다.
  // Google이 "메일 보내기" 권한을 요청한다.
  const left = MailApp.getRemainingDailyQuota();
  Logger.log('JK 투자 승인 메일 발송 권한 확인. 오늘 남은 수신자 수: ' + left);
  return left;
}

function doPost(e) {
  let lock;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 4096) return result_({ok:false,error:'bad request'});
    const v = JSON.parse(raw);
    const secret = PropertiesService.getScriptProperties().getProperty('JK_APPROVAL_SHARED_SECRET');
    if (!secret || secret.length < 32 || String(v.secret || '') !== secret)
      return result_({ok:false,error:'unauthorized'});

    const email = String(v.to || '').trim();
    const id = String(v.id || '');
    if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,240}\.[A-Za-z]{2,24}$/.test(email)
        || !/^[A-Za-z0-9_-]{16,80}$/.test(id))
      return result_({ok:false,error:'invalid recipient or id'});

    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    const props = PropertiesService.getScriptProperties();
    const key = 'approval_sent_' + id;
    if (props.getProperty(key))
      return result_({ok:true,alreadySent:true});

    if (MailApp.getRemainingDailyQuota() < 1)
      return result_({ok:false,error:'daily quota exhausted'});

    MailApp.sendEmail({
      to:email,
      subject:'[JK 투자] 이용 신청이 승인되었습니다',
      body:'JK 투자 이용이 승인되었습니다.\n\n이제 JK 투자에 로그인해 서비스를 이용하실 수 있습니다.\n\n' + APPROVAL_URL + '\n\n본인이 신청하지 않은 경우 이 메일을 무시해 주세요.',
      htmlBody:'<div style="font-family:Arial,sans-serif;line-height:1.8;color:#172033">'
        +'<h2>JK 투자 이용 승인 완료</h2>'
        +'<p>신청하신 계정의 이용이 승인되었습니다.</p>'
        +'<p>이제 JK 투자에 로그인해 서비스를 이용하실 수 있습니다.</p>'
        +'<p><a href="' + APPROVAL_URL + '">JK 투자 바로가기</a></p>'
        +'<p style="font-size:12px;color:#687287">본인이 신청하지 않았다면 이 메일을 무시해 주세요.</p>'
        +'</div>',
      name:'JK 투자'
    });
    props.setProperty(key, String(Date.now()));
    return result_({ok:true,sent:true});
  } catch (err) {
    // 비밀키·수신자·요청 전문 등은 오류 로그에 남기지 않는다.
    return result_({ok:false,error:'send failed'});
  } finally {
    try { if (lock) lock.releaseLock(); } catch (_) {}
  }
}
