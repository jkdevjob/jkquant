/* 부동산 🤖 클로드 — 내 경매 모의입찰 장부를 내 계정에 저장한다(승인된 본인만 · Firestore 규칙 users/{uid}/**).
   페이지 맨 앞 모듈(로그인 · 이용 승인)이 만든 Firebase 앱을 그대로 쓴다(getApp) — 그 코드와 지피티 칸은 건드리지 않는다.
   저장할 때 revision 을 확인한다: 다른 기기에서 먼저 바뀌었으면 덮어쓰지 않고 다시 불러오라고 한다.
   화면은 window.REC_ACCOUNT 와 'rec-account' 이벤트만 본다. */
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const COL = "realestateClaude", DOC = "auction";
const empty = () => ({ schemaVersion: 1, revision: 0, cases: [] });
let app = null;
try { app = getApp(); } catch (e) { app = null; }
if (app) {
  const auth = getAuth(app), db = getFirestore(app);
  onAuthStateChanged(auth, user => {
    if (!user) { window.REC_ACCOUNT = null; window.dispatchEvent(new CustomEvent("rec-account")); return; }
    const ref = doc(db, "users", user.uid, COL, DOC);
    const mine = () => { if (auth.currentUser?.uid !== user.uid) throw new Error("로그인 계정이 바뀌었습니다. 다시 불러오세요."); };
    window.REC_ACCOUNT = {
      uid: user.uid,
      async load() { mine(); const s = await getDoc(ref); mine(); return s.exists() ? s.data() : empty(); },
      async save(next, expectedRevision) {
        mine();
        return runTransaction(db, async tx => {
          mine();
          const s = await tx.get(ref), revision = s.exists() ? (s.data().revision || 0) : 0;
          mine();
          if (revision !== expectedRevision) throw new Error("다른 기기에서 장부가 바뀌었습니다. 다시 불러온 뒤 저장하세요.");
          const saved = { ...next, schemaVersion: 1, revision: revision + 1, updatedAt: new Date().toISOString() };
          tx.set(ref, saved);
          return saved;
        });
      }
    };
    window.dispatchEvent(new CustomEvent("rec-account"));
  });
}
