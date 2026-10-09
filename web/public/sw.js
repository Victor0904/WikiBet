// Service worker d'Aurelys : seulement les notifications de liquidation (aucun cache hors ligne).
// L'adresse de Supabase et la clé publique arrivent dans l'URL d'enregistrement (sw.js?u=…&k=…).
const q = new URLSearchParams(self.location.search), URL_SB = q.get("u"), KEY = q.get("k");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => e.waitUntil((async () => {
  let lines = [];
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const r = await fetch(`${URL_SB}/functions/v1/aurelys`, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ action: "push_info", endpoint: sub?.endpoint }) });
    lines = (await r.json()).lines ?? [];
  } catch { }
  await self.registration.showNotification(lines.length > 1 ? `${lines.length} positions liquidées` : "Position liquidée", {
    body: lines.length ? lines.join("\n") : "Une de tes positions Aurelys a été liquidée.",
    icon: "/favicon.svg", badge: "/favicon.svg", tag: "liquidation", renotify: true,
  });
})()));

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (all[0]) return all[0].focus();
    return self.clients.openWindow("/");
  })());
});
