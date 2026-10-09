// Service worker d'Aurelys : seulement les notifications de liquidation, et d'alerte avant (aucun cache hors ligne).
// L'adresse de Supabase et la clé publique arrivent dans l'URL d'enregistrement (sw.js?u=…&k=…).
const q = new URLSearchParams(self.location.search), URL_SB = q.get("u"), KEY = q.get("k");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => e.waitUntil((async () => {
  let lines = [], title = null;
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const r = await fetch(`${URL_SB}/functions/v1/aurelys`, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ action: "push_info", endpoint: sub?.endpoint }) });
    const j = await r.json(); lines = j.lines ?? []; title = j.title;
  } catch { }
  await self.registration.showNotification(title ?? "Aurelys", {
    body: lines.length ? lines.join("\n") : "Une de tes positions Aurelys approche de la liquidation, ou a été liquidée.",
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
