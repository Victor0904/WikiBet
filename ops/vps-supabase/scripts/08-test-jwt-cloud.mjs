// Vérifie qu'une session émise par le Cloud (ES256) reste valable sur la stack du VPS, puis qu'un rafraîchissement
// donne un jeton HS256 accepté partout. N'affiche aucun jeton. Écrit seulement en base locale (rotation du refresh token).
//   node scripts/08-test-jwt-cloud.mjs <session.json> [--url http://127.0.0.1:PORT]
// session.json : la valeur de la clé sb-urivyzajsfcbtbfrvjcs-auth-token du localStorage (access_token, refresh_token).
// La session doit exister dans la base restaurée : l'exporter (01) après l'avoir ouverte, moins d'une heure avant le test.
import fs from "node:fs";

const ici = new URL("..", import.meta.url);
const env = Object.fromEntries(fs.readFileSync(new URL("stack/.env", ici), "utf8").split("\n")
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const [fichier, ...opts] = process.argv.slice(2);
const base = opts.includes("--url") ? opts[opts.indexOf("--url") + 1] : `http://127.0.0.1:${env.API_GW_PORT}`;
const session = JSON.parse(fs.readFileSync(fichier, "utf8"));
const anon = env.ANON_KEY;
const head = t => JSON.parse(Buffer.from(t.split(".")[0], "base64url"));
const claims = t => JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
let echecs = 0;
const verdict = (ok, nom, detail) => { if (!ok) echecs++; console.log(`${ok ? "✓" : "✗"} ${nom.padEnd(44)} ${detail}`); };

const rest = t => fetch(`${base}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${t}` } }).then(r => r.status);
const user = t => fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${t}` } }).then(async r => [r.status, (await r.json()).id]);
// Action inconnue : 400 si le jeton passe le routeur et getUser (dans la fonction), 401 sinon.
const fn = t => fetch(`${base}/functions/v1/aurelys`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  body: JSON.stringify({ action: "test_jwt" }) }).then(r => r.status);
const realtime = t => new Promise(res => {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${anon}&vsn=1.0.0`);
  const fin = v => { clearTimeout(minuterie); try { ws.close(); } catch {} res(v); };
  const minuterie = setTimeout(() => fin("pas de réponse"), 8000);
  ws.onopen = () => ws.send(JSON.stringify({ topic: "realtime:test-jwt", event: "phx_join", ref: "1",
    payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [] }, access_token: t } }));
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.event === "phx_reply" && d.ref === "1") fin(d.payload.status === "ok" ? "ok" : JSON.stringify(d.payload.response).slice(0, 80)); };
  ws.onerror = () => fin("erreur WebSocket");
});

async function tout(t, etiquette) {
  const sub = claims(t).sub;
  const r = await rest(t); verdict(r === 200, `${etiquette} : REST`, r);
  const [s, id] = await user(t); verdict(s === 200 && id === sub, `${etiquette} : auth /user (getUser)`, `${s}${id === sub ? ", même joueur" : ""}`);
  const f = await fn(t); verdict(f === 400, `${etiquette} : fonction aurelys`, `${f} (400 attendu : jeton accepté, action inconnue)`);
  const w = await realtime(t); verdict(w === "ok", `${etiquette} : Realtime (phx_join)`, w);
}

const t0 = session.access_token, h0 = head(t0), c0 = claims(t0);
console.log(`Jeton du Cloud : ${h0.alg}, kid ${h0.kid?.slice(0, 8)}…, expire dans ${Math.round(c0.exp - Date.now() / 1000)} s, ${c0.is_anonymous ? "anonyme" : "compte"}`);
if (c0.exp * 1000 < Date.now()) { console.log("✗ jeton expiré : en reprendre un (moins d'une heure)"); process.exit(1); }
await tout(t0, "ES256 Cloud");

// Témoin : le même jeton avec une signature abîmée doit être refusé partout.
const faux = t0.slice(0, -4) + (t0.endsWith("AAAA") ? "BBBB" : "AAAA");
verdict(await rest(faux) === 401, "témoin, signature fausse : REST refusé", "");
verdict([401, 403].includes((await user(faux))[0]), "témoin : auth refusé", "");
verdict(await fn(faux) === 401, "témoin : fonction refusée", "");
verdict(await realtime(faux) !== "ok", "témoin : Realtime refusé", "");

const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: session.refresh_token }) });
const neuf = await r.json();
verdict(r.status === 200 && !!neuf.access_token, "rafraîchissement de la session", r.status + (neuf.error_code ? ` ${neuf.error_code}` : ""));
if (neuf.access_token) {
  const h1 = head(neuf.access_token), c1 = claims(neuf.access_token);
  verdict(h1.alg === "HS256" && c1.sub === c0.sub && c1.session_id === c0.session_id, "nouveau jeton : HS256, même joueur et session", `${h1.alg}, kid ${h1.kid}`);
  await tout(neuf.access_token, "HS256 VPS");
}
console.log(echecs ? `${echecs} échec(s)` : "tout est vert");
process.exit(echecs ? 1 : 0);
