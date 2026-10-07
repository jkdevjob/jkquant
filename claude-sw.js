// 단타(클로드) 매수·매도 웹 알림 받기 전용 — 요청을 가로채지 않는다(fetch 처리 없음, 저장소 없음).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "JK 투자 단타", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "/icons/jk-invest-192.png", badge: "/icons/jk-invest-192.png", data: { url: d.url || "/claude" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/claude";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.includes("/claude") && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
