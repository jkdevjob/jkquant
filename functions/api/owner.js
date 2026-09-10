// Cloudflare Pages Function — /api/owner
// 단타 화면처럼 "나만 보는" 페이지의 허용 계정을 서버에서 정한다.
// 이메일을 저장소(공개)에 박지 않고 환경변수로 바꿀 수 있게 하려는 것.
//
//   OWNER_EMAIL      : 허용 계정(쉼표로 여러 개). 없으면 KIS_OWNER_EMAIL → 기본값 순으로 폴백
//   KIS_OWNER_EMAIL  : KIS 주문 허용 계정(이미 쓰던 값) — 따로 안 넣으면 이걸 재사용
//
// 값이 하나도 없으면 저장소 규약의 관리자 계정으로 폴백한다(잠김 방지).

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];   // admin.html ADMIN_EMAILS 와 같은 규약

export async function onRequestGet({ env }) {
  const raw = String(env.OWNER_EMAIL || env.KIS_OWNER_EMAIL || "").trim();
  const owners = raw ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_OWNERS;
  return new Response(JSON.stringify({ owners, source: raw ? (env.OWNER_EMAIL ? "OWNER_EMAIL" : "KIS_OWNER_EMAIL") : "default" }), { headers: JH });
}
