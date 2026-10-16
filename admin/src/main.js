// Cité d'Aurelys : tableau de bord admin, local et privé. Clé anon + compte habituel ; tout passe par admin_snapshot()
// (lecture seule, refusée à tout autre id que celui de admin_config). Un seul appel toutes les 20 s, page visible seulement.
import { createClient } from "@supabase/supabase-js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { storageKey: "aurelys-admin" } });
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`); // les pseudos viennent des joueurs
const W = n => n == null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} W`;
const pct = (a, b) => b ? `${Math.round(100 * a / b)} %` : "—";
const ago = t => { if (!t) return "jamais"; const s = (Date.now() - new Date(t)) / 1000; return s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j` };
const row = (k, v, cls = "") => `<div class="row"><span class="muted">${k}</span><span class="num ${cls}">${v}</span></div>`;
const POLL = 20000, R = 32, ONLINE = 120000;

// ===== Connexion (pseudo + mot de passe, comme dans le jeu) =====
$("login").querySelector("form").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("err").textContent = "";
  const { data: email } = await sb.rpc("login_email", { p_pseudo: f.get("pseudo") });
  const { error } = email ? await sb.auth.signInWithPassword({ email, password: f.get("password") }) : { error: 1 };
  if (error) $("err").textContent = "Pseudo ou mot de passe incorrect.";
  else start();
};

// ===== Scène =====
let renderer, scene, camera, controls, clock, raf = 0, timer = 0, snap = null, selected = null, lastMs = 0;
const buildings = new Map(), people = new Map(), shared = [];
const geo = { body: new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), head: new THREE.SphereGeometry(0.28, 12, 8),
              ring: new THREE.RingGeometry(0.6, 0.8, 24).rotateX(-Math.PI / 2), box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0) };
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 360) / 360 };
const BOTS_AT = new THREE.Vector3(0, 0, R + 20);

function label(text, color = "#E6E8EF", size = 1) {
  const c = document.createElement("canvas"), x = c.getContext("2d");
  c.width = 256; c.height = 64; x.font = "600 34px system-ui"; x.fillStyle = color; x.textAlign = "center"; x.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(4 * size, size, 1);
  return s;
}
const disposeTree = o => o.traverse(m => { if (m.material) { m.material.map?.dispose(); m.material.dispose() } }); // géométries partagées : libérées à la fin

function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#08090D"); scene.fog = new THREE.Fog("#08090D", 90, 180);
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 400);
  camera.position.set(0, 60, 75);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.1; controls.target.set(0, 0, 8);
  scene.add(new THREE.HemisphereLight("#9aa8ff", "#10131a", 1.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6); sun.position.set(30, 60, 20); scene.add(sun);
  const add = (g, color, y = 0) => { const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color })); m.position.y = y; scene.add(m); shared.push(g); return m };
  add(new THREE.CircleGeometry(R + 34, 64).rotateX(-Math.PI / 2), "#0F1117");
  add(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2), "#161922", 0.01); // place centrale : joueurs sans position
  add(new THREE.PlaneGeometry(16, 12).rotateX(-Math.PI / 2), "#1a1d26", 0.01).position.copy(BOTS_AT).setY(0.01);
  const lb = label("Bots", "#6B7080"); lb.position.copy(BOTS_AT).setY(3); scene.add(lb);
  clock = new THREE.Timer();
  addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) });
  renderer.domElement.addEventListener("click", pick);
  addEventListener("pagehide", dispose);
}

function dispose() {
  cancelAnimationFrame(raf); clearTimeout(timer);
  scene?.traverse(m => { if (m.material) { m.material.map?.dispose(); m.material.dispose() } });
  [...Object.values(geo), ...shared].forEach(g => g.dispose());
  controls?.dispose(); renderer?.dispose();
}

// Sociétés en cercle, rangées par secteur ; hauteur selon l'exposition, toit vert ou rouge selon le sens net des joueurs.
function syncBuildings(stocks) {
  const sorted = [...stocks].sort((a, b) => a.sector.localeCompare(b.sector) || a.tk.localeCompare(b.tk));
  for (const [tk, b] of buildings) if (!stocks.some(s => s.tk === tk)) { scene.remove(b.g); disposeTree(b.g); buildings.delete(tk) }
  sorted.forEach((s, i) => {
    let b = buildings.get(s.tk);
    if (!b) {
      const g = new THREE.Group(), col = new THREE.Color().setHSL(hue(s.sector), 0.35, 0.42);
      const body = new THREE.Mesh(geo.box, new THREE.MeshStandardMaterial({ color: col })), roof = new THREE.Mesh(geo.box, new THREE.MeshStandardMaterial({ color: "#444", emissive: "#000" }));
      body.scale.set(4, 1, 4); roof.scale.set(4.2, 0.4, 4.2);
      const lb = label(s.tk, "#E6E8EF", 2.2);
      body.userData.tk = roof.userData.tk = s.tk;
      g.add(body, roof, lb); scene.add(g);
      b = { g, body, roof, lb, h: 1 }; buildings.set(s.tk, b);
    }
    const a = (i / sorted.length) * Math.PI * 2;
    b.pos = new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R);
    b.g.position.copy(b.pos); b.g.lookAt(0, 0, 0);
    b.h = 4 + 4 * Math.log10(1 + (s.long + s.short + s.bots) / 10000);
    const net = s.long - s.short, c = net > 0 ? "#1FCB8B" : net < 0 ? "#F04B5C" : "#444";
    b.roof.material.color.set(c); b.roof.material.emissive.set(c).multiplyScalar(net ? 0.35 : 0);
    b.data = s;
  });
}

const exposure = p => p.positions.reduce((s, x) => s + x.stake * x.lev, 0);
function syncPeople(players, alerts) {
  const flag = new Map(); // pseudo → couleur de l'anneau
  for (const a of alerts) for (const ps of a.kind === "mirror" ? a.pseudos : [a.pseudo]) flag.set(ps, a.kind === "gain" ? "#F5B83D" : a.kind === "mirror" ? "#ff8a3d" : "#F04B5C");
  const ids = new Set(players.map(p => p.id)), groups = new Map();
  for (const [id, m] of people) if (!ids.has(id)) { scene.remove(m.g); disposeTree(m.g); people.delete(id) }
  let bots = 0;
  for (const p of players) {
    let m = people.get(p.id);
    if (!m) {
      const g = new THREE.Group(), color = p.bot ? new THREE.Color("#6B7080") : new THREE.Color().setHSL(hue(p.id), 0.7, 0.6);
      const mat = new THREE.MeshStandardMaterial({ color, transparent: true });
      const body = new THREE.Mesh(geo.body, mat), head = new THREE.Mesh(geo.head, mat), ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: "#F04B5C", side: THREE.DoubleSide }));
      body.position.y = 0.65; head.position.y = 1.35; ring.position.y = 0.03;
      body.userData.id = head.userData.id = p.id;
      g.add(body, head, ring); scene.add(g);
      g.position.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
      m = { g, mat, ring, target: g.position.clone(), phase: Math.random() * 6 }; people.set(p.id, m);
    }
    m.data = p;
    const x = exposure(p);
    m.g.scale.setScalar(Math.min(2.6, 0.7 + 0.5 * Math.log10(1 + x / 1000)));
    m.mat.opacity = Date.now() - new Date(p.seen) < ONLINE ? 1 : 0.4; // hors ligne : estompé
    m.ring.visible = flag.has(p.pseudo); if (m.ring.visible) m.ring.material.color.set(flag.get(p.pseudo));
    if (p.bot) { const k = bots++; m.target = BOTS_AT.clone().add(new THREE.Vector3((k % 7 - 3) * 2, 0, (Math.floor(k / 7) - 1.5) * 2)); m.wander = false; continue }
    const top = Object.entries(p.positions.reduce((o, q) => (o[q.tk] = (o[q.tk] || 0) + q.stake * q.lev, o), {})).sort((a, b) => b[1] - a[1])[0];
    if (!top || !buildings.has(top[0])) { m.wander = true; continue }
    m.wander = false;
    (groups.get(top[0]) ?? groups.set(top[0], []).get(top[0])).push(m);
  }
  // Devant la société de leur plus grosse exposition, en rangs de 6 vers le centre.
  for (const [tk, list] of groups) {
    const b = buildings.get(tk).pos, out = b.clone().normalize(), side = new THREE.Vector3(-out.z, 0, out.x);
    list.sort((a, c) => exposure(c.data) - exposure(a.data)).forEach((m, k) => {
      m.target = b.clone().addScaledVector(out, -4.5 - Math.floor(k / 6) * 1.8).addScaledVector(side, (k % 6 - 2.5) * 1.4);
    });
  }
}

function frame() {
  raf = requestAnimationFrame(frame);
  clock.update(); const dt = Math.min(clock.getDelta(), 0.1), t = clock.getElapsed();
  for (const b of buildings.values()) {
    const h = b.body.scale.y + (b.h - b.body.scale.y) * Math.min(1, dt * 2);
    b.body.scale.y = h; b.roof.position.y = h; b.lb.position.y = h + 1.6;
  }
  for (const m of people.values()) {
    if (m.wander && m.g.position.distanceTo(m.target) < 0.3) m.target.set((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
    const d = m.target.clone().sub(m.g.position), dist = d.length(), step = Math.min(dist, dt * (m.wander ? 1.5 : 6));
    if (dist > 0.05) { m.g.position.addScaledVector(d.normalize(), step); m.g.rotation.y = Math.atan2(d.x, d.z) }
    m.g.position.y = dist > 0.05 ? Math.abs(Math.sin(t * 9 + m.phase)) * 0.15 : Math.sin(t * 2 + m.phase) * 0.03;
  }
  controls.update();
  renderer.render(scene, camera);
}

function pick(e) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects([...[...people.values()].map(m => m.g), ...[...buildings.values()].map(b => b.g)], true).find(h => h.object.userData.id || h.object.userData.tk);
  selected = hit ? hit.object.userData : null;
  card();
}

// ===== Panneaux =====
function card() {
  const el = $("card");
  if (!selected || !snap) { el.style.display = "none"; return }
  let html = "";
  if (selected.id) {
    const p = snap.players.find(x => x.id === selected.id);
    if (!p) { el.style.display = "none"; return }
    html = `<h3>${esc(p.pseudo)} ${p.bot ? '<span class="muted">bot</span>' : ""}</h3>`
      + row("Patrimoine", W(p.patrimoine)) + row("Caisse / banque", `${W(p.cash)} / ${W(p.bank)}`)
      + row("Niveau", `${p.level} · ${W(p.tal_cum)} net`) + row("Faillites", p.bankruptcies)
      + row("Inscrit", ago(p.created)) + row("Dernière connexion", ago(p.seen))
      + row("Parrain", esc(p.parrain ?? "—")) + row("Filleuls", p.filleuls.map(f => `${esc(f.pseudo)}${f.status === "validé" ? " ✓" : ""}`).join(", ") || "—")
      + `<h2 style="margin-top:10px">Positions (${p.positions.length})</h2>`
      + (p.positions.map(q => { const g = q.value - q.stake; return row(`${q.tk} ${q.dir === "up" ? "▲" : "▼"} ×${q.lev}`, `${W(q.stake)} → ${W(q.value)}`, g >= 0 ? "up" : "down") }).join("") || '<div class="muted">aucune</div>')
      + `<h2 style="margin-top:10px">Talents</h2><div class="num">${Object.entries(p.talents).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>`
      + `<h2 style="margin-top:10px">Succès (${p.achievements.length})</h2><div class="num muted">${p.achievements.join(" · ") || "—"}</div>`;
  } else {
    const s = snap.stocks.find(x => x.tk === selected.tk);
    if (!s) { el.style.display = "none"; return }
    const holders = snap.players.map(p => [p, p.positions.filter(q => q.tk === s.tk).reduce((a, q) => a + q.stake * q.lev * (q.dir === "up" ? 1 : -1), 0)]).filter(x => x[1]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    html = `<h3>${esc(s.name)} <span class="muted">${s.tk}</span></h3>` + row("Secteur", esc(s.sector)) + row("Cours", s.p?.toFixed(2) ?? "—")
      + row("Exposition ▲", W(s.long), "up") + row("Exposition ▼", W(s.short), "down") + row("Bots", W(s.bots), "muted")
      + `<h2 style="margin-top:10px">Joueurs</h2>` + (holders.slice(0, 20).map(([p, x]) => row(`${esc(p.pseudo)}${p.bot ? " (bot)" : ""}`, `${x > 0 ? "▲" : "▼"} ${W(Math.abs(x))}`, x > 0 ? "up" : "down")).join("") || '<div class="muted">aucun</div>');
  }
  el.innerHTML = `<button id="close" title="Fermer">✕</button>` + html;
  el.style.display = "block";
  $("close").onclick = () => { selected = null; card() };
}

function panels() {
  const k = snap.kpi, h = snap.health, r = k.retention;
  const expo = [...snap.stocks].sort((a, b) => (b.long + b.short) - (a.long + a.short));
  $("kpi").innerHTML = `<h2>Cité d'Aurelys</h2>`
    + row("Connectés (2 min)", k.online) + row("Inscrits du jour", k.signups_today) + row("Joueurs", k.players)
    + row("Démos lancées", k.demos ?? "non mesuré", "muted")
    + row("Retour J1", `${pct(r.j1, r.j1_n)} (${r.j1}/${r.j1_n})`) + row("Retour J7", `${pct(r.j7, r.j7_n)} (${r.j7}/${r.j7_n})`)
    + row("W en circulation", W(k.w_cash)) + row("Liquidations (1 h)", `${k.liq_hour} · bots ${k.liq_hour_bots}`, k.liq_hour ? "down" : "")
    + `<h2 style="margin-top:10px">Exposition par société</h2>`
    + expo.map(s => row(s.tk, `<span class="up">▲ ${W(s.long)}</span> <span class="down">▼ ${W(s.short)}</span>`)).join("");
  const late = h.engine_ahead_s == null || h.engine_ahead_s < 5;
  $("health").innerHTML = `<h2>Santé</h2>`
    + row("Moteur : cours calculés jusqu'à", h.engine_ahead_s == null ? "aucun cours" : `${h.engine_ahead_s >= 0 ? "+" : ""}${h.engine_ahead_s.toFixed(0)} s`, late ? "bad" : "up")
    + (h.settle ? row("settle() dernier / moy. / max", `${h.settle.last_ms?.toFixed(0)} / ${h.settle.avg_ms?.toFixed(0)} / ${h.settle.max_ms?.toFixed(0)} ms`, h.settle.failed ? "bad" : "")
                + row("settle() en échec (30 derniers)", h.settle.failed, h.settle.failed ? "bad" : "") : row("settle()", "pg_cron absent", "muted"))
    + row("aur_ticks", `${(h.ticks_bytes / 1048576).toFixed(1)} Mo · ${Number(h.ticks_rows).toLocaleString("fr-FR")} lignes`)
    + row("Instantané", `${lastMs} ms · ${new Date(snap.now).toLocaleTimeString("fr-FR")}`, "muted")
    + `<h2 style="margin-top:10px">Erreurs de la fonction (pg_net, 1 h)</h2>`
    + (h.errors ? (h.errors.map(e => `<div class="alert"><span class="num muted">${new Date(e.at).toLocaleTimeString("fr-FR")}</span> <span class="bad">${e.status ?? ""} ${esc(e.error ?? "")}</span><div class="num muted">${esc(e.body ?? "")}</div></div>`).join("") || '<div class="muted">aucune</div>') : '<div class="muted">pg_net absent</div>');
  const txt = a => a.kind === "concentration" ? `<b>Concentration</b> ${esc(a.pseudo)} porte ${Math.round(a.share * 100)} % de l'exposition sur ${a.tk}`
    : a.kind === "gain" ? `<b>Gain anormal</b> ${esc(a.pseudo)} : ${W(a.gain)} aujourd'hui (médiane ${W(a.median)})`
    : `<b>Miroir</b> filleuls de ${esc(a.parrain)} : ${a.pseudos.map(esc).join(", ")} (${a.pairs} ordres jumeaux en 24 h)`;
  $("alerts").innerHTML = `<h2>Alertes (${snap.alerts.length})</h2>` + (snap.alerts.map(a => `<div class="alert">${txt(a)}</div>`).join("") || '<div class="muted">aucune</div>');
}

// ===== Rafraîchissement : 1 appel agrégé toutes les 20 s, rien quand l'onglet est caché =====
async function poll() {
  clearTimeout(timer);
  const t0 = performance.now(), { data, error } = await sb.rpc("admin_snapshot");
  lastMs = Math.round(performance.now() - t0);
  if (error) { $("alerts").hidden = false; $("alerts").innerHTML = `<div class="bad">${esc(error.message)}</div>`; return } // Accès réservé : on n'insiste pas
  snap = data;
  syncBuildings(snap.stocks); syncPeople(snap.players, snap.alerts); panels(); card();
  if (!document.hidden) timer = setTimeout(poll, POLL);
}

function start() {
  if (renderer) return;
  $("login").remove();
  for (const id of ["kpi", "health", "alerts"]) $(id).hidden = false;
  initScene(); frame(); poll();
  // Onglet caché : rendu et appels en pause ; au retour, un appel si le dernier date de plus de 20 s.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); clearTimeout(timer); return }
    clock.update(); frame();
    const age = snap ? Date.now() - new Date(snap.now) : POLL;
    timer = setTimeout(poll, Math.max(0, POLL - age));
  });
}

(await sb.auth.getSession()).data.session && start(); // session gardée : on entre directement
