// Le QG en 3D : une pièce isométrique qui grandit avec le logement, meublée par les objets achetés.
// Tout est construit en formes simples (pas de modèle externe), en low-poly, pour rester léger sur mobile.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { place, F } from "./models.js";

// Meuble Kenney (CC0) posé au sol ; la forme simple `fallback` s'affiche en attendant (ou si le modèle ne charge pas).
// Groupe « plat » : il n'est pas agrandi avec les objets achetés (sa position est déjà en coordonnées de la pièce).
const km = (name, opts) => { const h = new THREE.Group(); h.userData.flat = true; place(h, F(name), opts); return h };

// Par logement : taille de la pièce, sol, murs, largeur de la fenêtre (part du mur du fond).
// Petites pièces au départ (moins de vide), murs plus chauds : on doit avoir envie d'y être.
const HOMES = [
  { size: 6, floor: 0x7a5a40, wall: 0x4a4258, win: 0.4 },     // chambre
  { size: 8.5, floor: 0x8a6a4b, wall: 0x3f3a52, win: 0.42 },  // studio
  { size: 10.5, floor: 0x6e6258, wall: 0x2f3346, win: 0.55 }, // open space
  { size: 12.5, floor: 0x4a3528, wall: 0x7a3b2e, win: 0.5 },  // loft (briques)
  { size: 15, floor: 0xd4d0c8, wall: 0x1c2030, win: 0.9 },    // penthouse
];
const WALL = [3.2, 3.2, 3.4, 3.8, 4.8]; // hauteur des murs par logement : le penthouse est en double hauteur

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...o });
const glow = color => new THREE.MeshBasicMaterial({ color });
function box(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = true; return o }
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; return o }
function ball(r, m, x, y, z) { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); o.position.set(x, y, z); o.castShadow = true; return o }
const group = (...kids) => { const g = new THREE.Group(); kids.forEach(k => g.add(k)); return g };
const at = (g, x, z, ry = 0) => { g.position.set(x, 0, z); g.rotation.y = ry; return g };

// Texture dessinée sur un canvas (écrans, néon, vue par la fenêtre).
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.redraw = (...a) => { draw(c.getContext("2d"), w, h, ...a); t.needsUpdate = true };
  t.redraw(); return t;
}
// La fenêtre donne sur Aurelys : ciel à l'heure d'Aurelys, pluie pendant un krach, feux d'artifice en euphorie.
// redraw(level, heure 0-24, régime, temps en s).
function skyline() {
  return canvasTex(512, 256, (g, w, h, level = 0, hour = 22, reg = "calme", t = 0) => {
    const d = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI)), mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * d));
    const top = mix([11, 16, 48], [120, 170, 225]), bot = mix(level >= 3 ? [91, 58, 110] : [36, 48, 94], [255, 214, 170]);
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${bot})`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    if (d > .2) { g.fillStyle = `rgba(255,236,170,${d})`; g.beginPath(); g.arc(80 + (hour - 6) / 12 * 360, 60 + (1 - d) * 80, 18, 0, 7); g.fill() }
    if (reg === "euphorie" && d < .5) for (let k = 0; k < 4; k++) { // feux d'artifice
      const ph = (t * .6 + k * .27) % 1, x = 60 + ((k * 137) % 400), y = 40 + ((k * 53) % 70), rad = 8 + ph * 34;
      g.strokeStyle = `hsla(${(k * 90 + 30) % 360},90%,65%,${1 - ph})`; g.lineWidth = 2;
      for (let a = 0; a < 12; a++) { const an = a / 12 * 6.28; g.beginPath(); g.moveTo(x + Math.cos(an) * rad * .6, y + Math.sin(an) * rad * .6); g.lineTo(x + Math.cos(an) * rad, y + Math.sin(an) * rad); g.stroke() }
    }
    let seed = 7 + level; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = level >= 2 ? 2 : 1, night = d < .35;
    for (let k = 0; k < rows; k++) for (let x = 0; x < w;) {
      const bw = 18 + r() * 40, bh = (k ? 60 : 90) + r() * (level >= 3 ? 150 : 90);
      g.fillStyle = night ? (k ? "#151a33" : "#0d1124") : (k ? "#6d7a92" : "#4f5b70"); g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = night ? "rgba(255,210,120,.8)" : "rgba(220,235,255,.35)";
      for (let wy = h - bh + 6; wy < h - 4; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) if (r() < .35) g.fillRect(wx, wy, 3, 4);
      x += bw + 2;
    }
    if (reg === "krach" || reg === "nervosite") { // pluie
      g.fillStyle = "rgba(20,26,40,.35)"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(190,210,240,.5)"; g.lineWidth = 1.2;
      for (let k = 0; k < (reg === "krach" ? 90 : 40); k++) { const x = (k * 97 + t * 260) % (w + 40) - 20, y = (k * 61 + t * 520) % h; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y + 14); g.stroke() }
    }
  });
}

// Écran qui affiche le gain ou la perte des positions ouvertes.
function pnlTex() {
  return canvasTex(256, 160, (g, w, h, pnl = null, accent = "#F5B83D") => {
    g.fillStyle = "#07090f"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.06)"; for (let y = 20; y < h; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    g.font = "600 18px 'IBM Plex Mono', monospace"; g.fillStyle = "#9097a8"; g.fillText("positions", 14, 30);
    if (pnl == null) { g.fillStyle = accent; g.font = "600 30px 'IBM Plex Mono', monospace"; g.fillText("Aurelys", 14, 96); return }
    const up = pnl >= 0; g.fillStyle = up ? "#1fcb8b" : "#f04b5c";
    g.font = "700 40px 'IBM Plex Mono', monospace";
    g.fillText(`${up ? "+" : "−"}${Math.abs(Math.round(pnl)).toLocaleString("fr-FR")} W`, 14, 100);
    g.font = "600 22px 'IBM Plex Mono', monospace"; g.fillText(up ? "▲ en gain" : "▼ en perte", 14, 136);
  });
}
// Affiche « Bourse d'Aurelys » : le décor par défaut du mur de gauche.
function posterTex() {
  return canvasTex(192, 256, g => {
    const bg = g.createLinearGradient(0, 0, 0, 256); bg.addColorStop(0, "#3b2a5a"); bg.addColorStop(1, "#d86b3c"); g.fillStyle = bg; g.fillRect(0, 0, 192, 256);
    g.fillStyle = "rgba(255,240,220,.9)"; g.beginPath(); g.arc(96, 150, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1a1424"; for (let x = 0; x < 192; x += 22) g.fillRect(x, 170 - (x * 7) % 60, 18, 90);
    g.fillStyle = "#fff4e6"; g.font = "700 22px 'IBM Plex Sans Condensed', sans-serif"; g.textAlign = "center"; g.fillText("BOURSE", 96, 40); g.fillText("D'AURELYS", 96, 64);
  });
}
// Écran d'une position : son nom, son gain ou sa perte. Sans position, une courbe de marché.
function posTex(seed) {
  const t = canvasTex(256, 160, (g, w, h, pos = null) => {
    g.fillStyle = "#07090f"; g.fillRect(0, 0, w, h);
    if (!pos) {
      let v = h / 2, s = seed; g.strokeStyle = s % 2 ? "#1fcb8b" : "#f04b5c"; g.lineWidth = 4; g.beginPath();
      for (let x = 0; x <= w; x += 12) { s = (s * 16807) % 2147483647; v = Math.max(16, Math.min(h - 16, v + (s / 2147483647 - .5) * 36)); x ? g.lineTo(x, v) : g.moveTo(x, v) }
      return g.stroke();
    }
    const up = pos.pnl >= 0, col = up ? "#1fcb8b" : "#f04b5c";
    g.fillStyle = col; g.fillRect(0, 0, 6, h);
    g.font = "700 26px 'IBM Plex Sans Condensed', sans-serif"; g.fillStyle = "#e9ecf2"; g.fillText(pos.label.slice(0, 14), 18, 40);
    g.font = "700 40px 'IBM Plex Mono', monospace"; g.fillStyle = col; g.fillText(`${up ? "+" : "−"}${Math.abs(Math.round(pos.pnl)).toLocaleString("fr-FR")} W`, 18, 98);
    g.font = "600 22px 'IBM Plex Mono', monospace"; g.fillText(up ? "▲ en gain" : "▼ en perte", 18, 136);
  });
  return t;
}
function chartTex(seed) {
  return canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = "#07090f"; g.fillRect(0, 0, w, h);
    let v = h / 2, s = seed; g.strokeStyle = s % 2 ? "#1fcb8b" : "#f04b5c"; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= w; x += 8) { s = (s * 16807) % 2147483647; v = Math.max(10, Math.min(h - 10, v + (s / 2147483647 - .5) * 24)); x ? g.lineTo(x, v) : g.moveTo(x, v) }
    g.stroke();
  });
}

function monitor(tex, w = .9) {
  const frame = mat(0x111318, { roughness: .4 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - .06, w * .58), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, .2 + w * .32, .031);
  return group(box(w, w * .64, .05, frame, 0, .2), screen, cyl(.03, .03, .2, frame), box(.3, .02, .2, frame));
}

// Objets achetables : chacun sait se construire et se placer, en coordonnées depuis le coin du fond (c, c).
function buildItems(ids, S, accent, screens) {
  const c = -S / 2, A = new THREE.Color(accent), out = [];
  const wood = mat(0x7a5537), dark = mat(0x1a1d26), metal = mat(0x9aa3b5, { metalness: .6, roughness: .3 });
  const deskX = c + 2.3, deskZ = c + .9, top = .78;
  // Mobilier de base, offert : un lit (chambre et studio) et une affiche, pour que la pièce ne paraisse pas vide.
  if (S < 9) { // chambre et studio
    const sheet = mat(0xe9e2d4), wood2 = mat(0x5a3d28);
    out.push(km("bedDouble", { x: c + S - .9, z: c + S - 1.25, size: 2.05, ry: Math.PI / 2,
      fallback: group(box(1.25, .35, 2.1, wood2), box(1.15, .18, 2, sheet, 0, .35), box(1.15, .12, .45, mat(accent), 0, .53, -.7), box(1.25, .8, .1, wood2, 0, 0, -1.05)) }));
    // Une petite chambre bien remplie : table de nuit et radio, lampe sur pied, portemanteau, plante.
    out.push(km("sideTable", { x: c + S - .35, z: c + S - 2.6, size: .45 }), km("radio", { x: c + S - .35, z: c + S - 2.6, y: .5, size: .3, ry: -Math.PI / 2 }),
      km("lampRoundFloor", { x: c + 1.2, z: c + S - .4, size: .45 }), km("coatRackStanding", { x: c + .45, z: c + S - .45, size: .5 }),
      km("plantSmall2", { x: c + S - 1.7, z: c + .35, size: .4 }));
  }
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(.9, 1.2), new THREE.MeshBasicMaterial({ map: screens.poster }));
  poster.position.set(c + .03, 1.75, c + S - .55); poster.rotation.y = Math.PI / 2; out.push(poster);
  // Bureau et écran principal : toujours là.
  out.push(at(group(box(2.1, .06, .8, wood, 0, top - .06), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => box(.06, top - .06, .06, dark, i * .98, 0, j * .35))), deskX, deskZ));
  const main = monitor(screens.pnl); main.position.set(deskX, top, deskZ - .15); out.push(main);
  const has = id => ids.has(id);
  if (has("ecran2")) { const m = monitor(screens.c1, .75); m.position.set(deskX + .82, top, deskZ - .1); m.rotation.y = -.35; out.push(m) }
  if (has("ecran3")) { const m = monitor(screens.c2, .75); m.position.set(deskX - .82, top, deskZ - .1); m.rotation.y = .35; out.push(m) }
  if (has("lampe")) { const l = new THREE.PointLight(0xffd59a, 1.2, 3); l.position.y = .4; out.push(at(group(cyl(.1, .12, .03, dark), cyl(.015, .015, .45, metal), cyl(.06, .14, .14, mat(accent), 0, .42), l), deskX + .85, deskZ + .25).translateY(top)) }
  if (has("micro")) out.push(at(group(cyl(.015, .015, .5, metal), cyl(.045, .045, .16, dark, 0, .5)), deskX - .55, deskZ + .2).translateY(top));
  // Une tasse de café qui fume et le Courrier d'Aurelys du jour, toujours sur le bureau.
  const steam = [0, 1, 2].map(() => new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .4 })));
  const mug = group(cyl(.06, .05, .12, mat(0xf2efe6)), ...steam); mug.userData.steam = steam; steam.forEach(p => p.position.y = .12);
  out.push(at(mug, deskX - .62, deskZ + .18).translateY(top));
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(.42, .3), new THREE.MeshBasicMaterial({ map: screens.paper }));
  paper.rotation.x = -Math.PI / 2; paper.rotation.z = .25; paper.position.set(deskX + .45, top + .005, deskZ + .22); out.push(paper);
  if (has("chaise")) {
    const seat = mat(0x16181f), trim = mat(accent);
    // Un chat endormi sur le fauteuil.
    const fur = mat(0xd08a3c), cat = group(ball(.17, fur, 0, .1, 0), ball(.1, fur, .17, .12, .05), cyl(0, .04, .07, fur, .2, .2, .02, 4), cyl(0, .04, .07, fur, .14, .2, .08, 4));
    cat.children[0].scale.set(1.3, .7, 1); cat.userData.cat = cat.children[0];
    out.push(at(cat, deskX, deskZ + 1.05).translateY(.47));
    out.push(at(group(cyl(.3, .3, .05, dark), cyl(.04, .04, .4, metal), box(.62, .1, .6, seat, 0, .42), box(.62, .85, .1, seat, 0, .52, .3), box(.64, .06, .12, trim, 0, 1.32, .3), box(.06, .25, .5, trim, -.33, .52), box(.06, .25, .5, trim, .33, .52)), deskX, deskZ + 1.05));
  }
  if (has("plante")) out.push(km("pottedPlant", { x: c + .55, z: c + .55, size: .7,
    fallback: group(cyl(.22, .17, .4, mat(0xc9b8a0)), ...[0, 1, 2, 3, 4].map(i => ball(.28, mat(0x2f7d4a), Math.cos(i * 1.3) * .18, .7 + (i % 2) * .25, Math.sin(i * 1.3) * .18))) }));
  if (has("tapis")) out.push(km("rugRectangle", { x: c + S / 2 + .3, z: c + S / 2 + .3, size: 2.8, fallback: box(2.8, .02, 1.9, mat(A.clone().multiplyScalar(.45))) }));
  if (has("neon")) {
    const tex = canvasTex(512, 128, g => { g.clearRect(0, 0, 512, 128); g.font = "italic 700 76px 'IBM Plex Sans Condensed', sans-serif"; g.shadowColor = accent; g.shadowBlur = 24; g.fillStyle = "#fff"; g.fillText("Aurelys", 90, 92); g.fillStyle = accent; g.fillText("Aurelys", 90, 92) });
    const n = new THREE.Mesh(new THREE.PlaneGeometry(2, .5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const l = new THREE.PointLight(accent, 1.5, 4); l.position.set(deskX, 2.2, c + .5);
    n.position.set(deskX, 2.35, c + .03); out.push(n, l);
  }
  if (has("camera")) out.push(at(group(cyl(.015, .015, 1.4, metal), box(.18, .12, .14, dark, 0, 1.4), box(.5, .5, .04, glow(0xfff4dc), .35, 1.1)), deskX + 2.1, deskZ + 1.5, -2.3));
  if (has("bibliotheque")) {
    const g = group(box(.45, 2.1, 1.7, wood));
    for (let s = 0; s < 4; s++) for (let b = 0; b < 7; b++) g.add(box(.12, .32 + (b % 3) * .04, .16, mat([0x9b2c2c, 0x2c5f9b, 0xd4a017, 0x2f7d4a, 0x6b3fa0][(s + b) % 5]), .25, .1 + s * .5, -.66 + b * .21)); // dos des livres côté pièce
    out.push(km("bookcaseOpen", { x: c + .3, z: c + 3.2, size: .95, ry: Math.PI / 2, fallback: g }));
  }
  if (has("canape")) { const f = mat(0x3d4f6e); out.push(km("loungeSofaLong", { x: c + .6, z: c + 5.3, size: 2.3, ry: Math.PI / 2,
    fallback: group(box(.95, .45, 2.3, f), box(.25, .55, 2.3, f, -.35, .45), box(.95, .3, .22, f, 0, .45, -1.04), box(.95, .3, .22, f, 0, .45, 1.04), box(.4, .25, .5, mat(accent), .1, .45, .5)) })) }
  if (has("aquarium")) {
    const g = group(box(1.6, .7, .6, dark), box(1.5, .8, .5, new THREE.MeshStandardMaterial({ color: 0x3fa7d6, transparent: true, opacity: .55, emissive: 0x0b4a6e }), 0, .7));
    g.userData.fish = [0, 1, 2].map(i => { const f = ball(.06, glow([0xff8c42, 0xffd23f, 0xf04b5c][i]), 0, 1 + i * .18, 0); g.add(f); return f });
    out.push(at(g, c + S - 1.4, c + .45));
  }
  if (has("trophee")) { const gold = mat(0xe8c547, { metalness: .9, roughness: .25 }); out.push(at(group(box(.5, .9, .5, mat(0x1f2330)), cyl(.08, .14, .12, gold, 0, .9), cyl(.04, .04, .2, gold, 0, 1.02), cyl(.25, .1, .35, gold, 0, 1.2)), c + S - .7, c + 2.3)) }
  if (has("arcade")) { const b = mat(0x6b3fa0); out.push(at(group(box(.7, 1.8, .7, b), box(.6, .45, .05, glow(0x4be0ff), 0, 1.15, -.36), box(.62, .08, .3, mat(accent), 0, .95, -.3)), c + S - .6, c + 3.9, Math.PI / 2)) }
  if (has("piano")) { const lac = mat(0x0b0c10, { roughness: .2, metalness: .3 }); out.push(at(group(box(1.5, .2, 1.9, lac, 0, .7), box(1.5, .06, .3, glow(0xf2f2f2), 0, .9, .85), ...[[-.6, -.8], [.6, -.8], [0, .7]].map(([x, z]) => box(.08, .7, .08, lac, x, 0, z)), box(1.4, .02, 1.2, lac, 0, 1.4, -.3)), c + S - 2.3, c + S - 2.5, -.3)) }
  if (has("taureau")) {
    const br = mat(0x8a5a2b, { metalness: .7, roughness: .35 });
    const bull = at(group(box(1.4, .55, .6, br, 0, .55), box(.45, .4, .4, br, .85, .8), ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([i, j]) => box(.12, .55, .12, br, i * .55, 0, j * .2)), cyl(.03, .06, .35, br, 1.05, 1.1, .2), cyl(.03, .06, .35, br, 1.05, 1.1, -.2)), c + S * .42, c + S * .66, Math.PI / 4); // de profil face à la caméra
    bull.scale.setScalar(1.3); out.push(bull);
  }
  if (has("murecrans")) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(.78, .48), new THREE.MeshBasicMaterial({ map: screens.wall[i * 3 + j] }));
      sc.position.set(c + .04, 1 + i * .55, c + S - 2.9 + j * .85); sc.rotation.y = Math.PI / 2; g.add(sc);
    }
    g.userData.flat = true; // écrans placés en coordonnées absolues : pas d'agrandissement
    out.push(g);
  }
  if (has("lingots")) {
    const gold = mat(0xe8c547, { metalness: .9, roughness: .2 });
    const g = group(box(1.2, .9, .7, mat(0x1f2330)), box(1.1, .6, .6, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: .25 }), 0, .9));
    for (let k = 0; k < 6; k++) g.add(box(.28, .1, .14, gold, -.3 + (k % 3) * .3, .92 + Math.floor(k / 3) * .11, (k % 2) * .16 - .08));
    out.push(at(g, c + S - .9, c + 6.4, Math.PI / 2));
  }
  // Les objets sont agrandis d'un cran : à l'échelle de la pièce, ils se voient.
  out.forEach(o => { if (!o.isLight && !o.userData.flat) o.scale.multiplyScalar(o.scale.x === 1 ? 1.15 : 1) });
  return out;
}

// Ce qui fait la différence entre les logements : cuisine, salle vitrée, mezzanine, piscine… (en plus des objets achetés).
function structure(level, S, H, accent) {
  const c = -S / 2, out = [], A = new THREE.Color(accent), metal = mat(0x3a3f4a, { metalness: .6, roughness: .35 }), wood = mat(0x8a6a4b), white = mat(0xeeeae2);
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: .22, roughness: .1 });
  const pendant = (x, z, y) => { const l = new THREE.PointLight(0xffc98a, .9, 4); l.position.set(x, y - .4, z); out.push(cyl(.01, .01, .6, metal, x, y - .6, z), cyl(.05, .2, .2, mat(0x1a1a1a), x, y - .8, z), l) };
  // Une maison bien habitée : coins verts, salon (télévision, canapé), salle à manger, éclairages. Les pièces sont grandes ;
  // ces meubles remplissent l'espace sans gêner les objets achetés (placés le long des murs du fond et de gauche).
  out.push(km("plantSmall3", { x: c + S - .4, z: c + S - .4, size: .45 }), km("pottedPlant", { x: c + .45, z: c + S - 1.3, size: .55 }));
  if (level >= 1 && level < 4) { // salon au premier plan
    const sx = c + S * (level === 1 ? .4 : .5), sz = c + S - .95;
    out.push(km("loungeSofa", { x: sx, z: sz, size: 2.1, ry: Math.PI }), km("tableCoffee", { x: sx, z: sz - 1.15, size: 1 }),
      km("cabinetTelevision", { x: sx, z: sz - 2.4, size: 1.3 }), km("televisionModern", { x: sx, z: sz - 2.45, y: .5, size: 1.1 }),
      km("rugRectangle", { x: sx, z: sz - 1.2, size: 3 }), km("lampRoundFloor", { x: sx - 1.5, z: sz, size: .45 }), km("loungeChair", { x: sx + 1.6, z: sz - 1.2, size: .9, ry: -Math.PI / 2 }));
  }
  if (level >= 2) { // salle à manger
    const tx = c + S * .74, tz = c + S * .52;
    out.push(km("table", { x: tx, z: tz, size: 1.5 }), ...[[0, -.75, 0], [0, .75, Math.PI], [-1.05, 0, Math.PI / 2], [1.05, 0, -Math.PI / 2]].map(([dx, dz, ry]) => km("chairCushion", { x: tx + dx, z: tz + dz, size: .5, ry })),
      km("bookcaseClosedWide", { x: c + S - .35, z: tz, size: 1.6, ry: -Math.PI / 2 }), km("speakerSmall", { x: c + S - .4, z: tz + 1.4, size: .35, ry: -Math.PI / 2 }));
  }
  if (level === 1) { // studio : cuisine le long du mur du fond
    out.push(km("kitchenFridge", { x: c + S - .4, z: c + .4, size: .7 }), km("kitchenCabinet", { x: c + S - 1.1, z: c + .4, size: .7 }),
      km("kitchenStove", { x: c + S - 1.8, z: c + .4, size: .7 }), km("kitchenCoffeeMachine", { x: c + S - 1.1, z: c + .35, y: .78, size: .3 }));
  }
  if (level === 2) { // open space : salle de réunion vitrée et coin café
    out.push(box(2.4, 2.3, .05, glass, c + S - 1.6, 0, c + 2.6), box(.05, 2.3, 2.2, glass, c + S - 2.8, 0, c + 1.5),
      box(1.6, .05, .8, wood, c + S - 1.5, .75, c + 1.5), ...[0, 1, 2].map(i => box(.35, .5, .35, mat(accent), c + S - 2 + i * .5, 0, c + 2)),
      box(.6, 1, .5, metal, c + 2.9, 0, c + S - .4), plantPot(c + .5, c + S - .5));
  }
  if (level >= 3) { // loft et penthouse : mezzanine avec escalier, garde-corps et suspensions
    const y = level >= 4 ? 2.5 : 2.1, w = S * .45, d = S * .32, x0 = c + S - w / 2, z0 = c + d / 2;
    out.push(box(w, .15, d, wood, x0, y - .15, z0), box(w, .6, .04, glass, x0, y, z0 + d / 2), box(.04, .6, d, glass, x0 - w / 2, y, z0));
    for (let i = 0; i < 4; i++) out.push(cyl(.06, .06, y - .15, metal, x0 - w / 2 + .1 + i * (w - .2) / 3, 0, z0 + d / 2 - .1));
    const steps = 8; for (let i = 0; i < steps; i++) out.push(box(.8, .08, .32, wood, x0 - w / 2 - .5, (i + 1) * y / steps - .08, z0 + d / 2 + .9 - i * .3));
    [0, 1, 2].forEach(i => pendant(c + 1.5 + i * 1.6, c + S * .55, H));
    if (level >= 4) { // la chambre sur la mezzanine, une piscine intérieure, un salon et un lustre
      out.push(box(1.4, .3, 2, mat(0x2a2030), x0 + .2, y, z0 - .1), box(1.3, .15, 1.9, white, x0 + .2, y + .3, z0 - .1), box(1.3, .1, .4, mat(accent), x0 + .2, y + .45, z0 - .8));
      const pool = new THREE.Mesh(new THREE.BoxGeometry(2.6, .05, 1.6), new THREE.MeshStandardMaterial({ color: 0x2fa4d9, emissive: 0x0b5a7a, roughness: .1, metalness: .2 }));
      pool.position.set(c + 6.6, .06, c + S - 1.4); out.push(pool, box(2.9, .06, 1.9, white, c + 6.6, -.02, c + S - 1.4));
      out.push(km("loungeDesignSofa", { x: c + 3.2, z: c + S - 1, size: 2.4, ry: Math.PI }), km("tableCoffeeGlass", { x: c + 3.2, z: c + S - 2.3, size: 1.2 }),
        km("rugRound", { x: c + 3.2, z: c + S - 2, size: 3 }), km("lampRoundFloor", { x: c + 1.6, z: c + S - .6, size: .5 }));
      const chand = new THREE.PointLight(0xfff0d0, 1.6, 8); chand.position.set(c + S * .45, H - 1, c + S * .5);
      out.push(cyl(.5, .3, .25, mat(0xe8c547, { metalness: .9, roughness: .2, emissive: 0x3a2a00 }), c + S * .45, H - 1, c + S * .5), chand, plantPot(c + .6, c + .6), plantPot(c + S - .6, c + S - .6));
    }
  }
  return out;
}
function plantPot(x, z) { return group(cyl(.22, .17, .4, mat(0xc9b8a0)), ...[0, 1, 2, 3].map(i => ball(.25, mat(0x2f7d4a), Math.cos(i * 1.6) * .15, .65 + (i % 2) * .2, Math.sin(i * 1.6) * .15))).translateX(x).translateZ(z) }

// Le Courrier d'Aurelys posé sur le bureau, avec la une du moment.
function paperTex() {
  return canvasTex(256, 180, (g, w, h, une = "") => {
    g.fillStyle = "#efe9dc"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1a1a1a"; g.font = "italic 700 24px Georgia, serif"; g.textAlign = "center"; g.fillText("Le Courrier d'Aurelys", w / 2, 30);
    g.fillRect(14, 38, w - 28, 2); g.textAlign = "left"; g.font = "700 17px Georgia, serif";
    wrap(g, une || "Les marchés attendent la prochaine séance", 14, 64, w - 28, 20, 4);
    g.fillStyle = "#9a9285"; for (let y = 140; y < h - 8; y += 9) g.fillRect(14, y, w - 28, 3);
  });
}
function wrap(g, text, x, y, mw, lh, max) {
  let line = "", n = 0;
  for (const word of text.split(" ")) { const t = line ? line + " " + word : word; if (g.measureText(t).width > mw && line) { g.fillText(line, x, y + n * lh); line = word; if (++n >= max) return } else line = t }
  g.fillText(line, x, y + n * lh);
}
// Souvenirs : le cadre du meilleur trade (vrai graphique, entrée et sortie), la une de ce jour-là, les certificats de fondateur.
function souvenirFrames(sv) {
  if (!sv) return [];
  const out = [];
  if (sv.best) out.push({ name: sv.best.name, big: true, draw: (g, w, h) => {
    const b = sv.best, v = (b.series ?? []).map(Number), lo = Math.min(...v, b.entry, b.exit), hi = Math.max(...v, b.entry, b.exit), r = (hi - lo) || 1;
    g.fillStyle = "#14161f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8c547"; g.font = "700 22px 'IBM Plex Sans Condensed', sans-serif"; g.fillText(`Mon meilleur trade · ${b.name}`, 14, 30);
    g.fillStyle = "#1fcb8b"; g.font = "700 30px 'IBM Plex Mono', monospace"; g.fillText(`+${Math.round(b.gain).toLocaleString("fr-FR")} W`, 14, 66);
    const X = i => 14 + i / Math.max(1, v.length - 1) * (w - 28), Y = p => h - 16 - (p - lo) / r * (h - 96);
    if (v.length > 1) { g.strokeStyle = "#1fcb8b"; g.lineWidth = 3; g.beginPath(); v.forEach((p, i) => i ? g.lineTo(X(i), Y(p)) : g.moveTo(X(i), Y(p))); g.stroke() }
    for (const [p, col, x] of [[b.entry, "#f5b83d", 14 + (w - 28) * .1], [b.exit, "#ffffff", w - 14 - (w - 28) * .1]]) { g.fillStyle = col; g.beginPath(); g.arc(x, Y(p), 6, 0, 7); g.fill() }
  } });
  if (sv.best?.une) out.push({ name: "La une", draw: (g, w, h) => {
    g.fillStyle = "#efe9dc"; g.fillRect(0, 0, w, h); g.fillStyle = "#1a1a1a"; g.font = "italic 700 18px Georgia, serif"; g.textAlign = "center"; g.fillText("Le Courrier d'Aurelys", w / 2, 24);
    g.fillRect(10, 30, w - 20, 2); g.textAlign = "left"; g.font = "700 16px Georgia, serif"; wrap(g, sv.best.une, 12, 54, w - 24, 19, 6);
  } });
  for (const f of sv.founders ?? []) out.push({ name: f.name, draw: (g, w, h) => {
    g.fillStyle = "#f3ead2"; g.fillRect(0, 0, w, h); g.strokeStyle = "#b8963e"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#5a4520"; g.textAlign = "center"; g.font = "italic 600 16px Georgia, serif"; g.fillText("Certificat", w / 2, 42);
    g.font = "700 20px Georgia, serif"; g.fillText("Actionnaire fondateur", w / 2, 74); g.fillText(f.name, w / 2, 104);
    g.font = "700 26px Georgia, serif"; g.fillStyle = "#8a6a20"; g.fillText(`n° ${f.n}`, w / 2, 148);
  } });
  return out;
}

// Cadres des trophées sur le mur de gauche : nom et détail (le meilleur trade affiche son gain).
function trophyFrames(list, S) {
  const c = -S / 2, out = [], gold = mat(0xe8c547, { metalness: .8, roughness: .3 });
  let col = 0, row = 0;
  for (const t of list) {
    if (t.big && row) { col++; row = 0 }
    const z = c + .9 + col * .75 + (t.big ? .1 : 0); if (z > c + S - 1.25) break; // l'affiche reste au bout du mur
    const big = !!t.big, W2 = big ? .9 : .66, H2 = big ? 1.1 : .5;
    const tex = canvasTex(256, big ? 312 : 192, t.draw ?? ((g, w, h) => {
      g.fillStyle = "#14161f"; g.fillRect(0, 0, w, h); g.fillStyle = "#e8c547"; g.font = "700 64px serif"; g.fillText("★", 96, 76);
      g.font = "600 22px 'IBM Plex Sans Condensed', sans-serif"; g.fillStyle = "#f2efe6"; g.textAlign = "center"; g.fillText(t.name, 128, 124);
      if (t.detail) { g.font = "600 18px 'IBM Plex Mono', monospace"; g.fillStyle = "#1fcb8b"; g.fillText(t.detail.slice(0, 22), 128, 156) }
    }));
    const f = group(box(W2, H2, .04, gold), new THREE.Mesh(new THREE.PlaneGeometry(W2 - .08, H2 - .07), new THREE.MeshBasicMaterial({ map: tex })));
    f.children[1].position.set(0, H2 / 2, .025);
    f.position.set(c + .05, big ? 1.4 : 2.25 - row * .62, z); f.rotation.y = Math.PI / 2; f.userData.flat = true;
    out.push(f);
    if (big) { col += 1.3; row = 0 } else if (++row === 2) { row = 0; col++ }
  }
  return out;
}

export function createScene(parent, { interactive = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  parent.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  const hemi = new THREE.HemisphereLight(0xffe4c4, 0x3a2614, 1.05); scene.add(hemi); // lumière chaude
  const sun = new THREE.DirectionalLight(0xffe0b8, 1.5); sun.position.set(6, 10, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 }); scene.add(sun);

  const screens = { pnl: pnlTex(), c1: posTex(11), c2: posTex(24), wall: [3, 8, 13, 21, 34, 55, 89, 144, 233].map(posTex), poster: posterTex(), sky: skyline(), paper: paperTex() };
  Object.values(screens).flat().forEach(t => { t.userData.keep = true }); // réutilisées d'un logement à l'autre
  let room = null, state = {}, S = 6;
  const fine = matchMedia("(pointer: fine)").matches;
  const controls = interactive && fine ? Object.assign(new OrbitControls(camera, renderer.domElement), { enablePan: false, enableZoom: false, minPolarAngle: .7, maxPolarAngle: 1.1, minAzimuthAngle: Math.PI / 4 - .5, maxAzimuthAngle: Math.PI / 4 + .5, enableDamping: true }) : null;

  function frame() {
    const w = parent.clientWidth, h = parent.clientHeight, view = S * (w < 600 ? 1.02 : .9) + ((room?.userData.h ?? 3.2) - 3.2) * .8, asp = w / h; // la pièce entière, murs compris
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: -view * asp / 2, right: view * asp / 2, top: view / 2, bottom: -view / 2 }); camera.updateProjectionMatrix();
  }
  let lamp = null;
  function build({ level, items, accent, trophies = [], souvenirs = null }) {
    if (room) { scene.remove(room); dispose(room) }
    const home = HOMES[level] ?? HOMES[0]; S = home.size; const H = WALL[level] ?? 3.2;
    const c = -S / 2; room = new THREE.Group();
    const floor = box(S, .2, S, mat(home.floor, { roughness: .85 }), 0, -.2, 0); room.add(floor);
    room.add(box(S, H, .2, mat(home.wall), 0, 0, c - .1), box(.2, H, S, mat(home.wall), c - .1, 0, 0));
    if (level === 3) for (let y = .3; y < H; y += .3) room.add(box(S, .02, .01, mat(0x5c2a20), 0, y, c + .005)); // joints de briques
    const ww = S * home.win, win = new THREE.Mesh(new THREE.PlaneGeometry(ww, level >= 4 ? H - .4 : 1.6), new THREE.MeshBasicMaterial({ map: screens.sky }));
    win.position.set(level >= 4 ? 0 : c + S - ww / 2 - .5, level >= 4 ? H / 2 : 1.75, c + .02); room.add(win);
    if (level >= 4) { // baie panoramique aussi sur le mur de gauche
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(S * .8, H - .4), new THREE.MeshBasicMaterial({ map: screens.sky }));
      w2.position.set(c + .02, H / 2, 0); w2.rotation.y = Math.PI / 2; room.add(w2);
    }
    structure(level, S, H, accent).forEach(o => room.add(o));
    buildItems(new Set(items), S, accent, screens).forEach(o => room.add(o));
    trophyFrames([...souvenirFrames(souvenirs), ...trophies], S).forEach(o => room.add(o));
    lamp = new THREE.PointLight(0xffc98a, 1.4, S * 1.6); lamp.position.set(0, H - .3, 0); room.add(lamp); // plafonnier chaud
    room.userData.h = H;
    scene.add(room);
    camera.position.set(S * 1.1, S * 1.05, S * 1.1); camera.lookAt(0, 1.2, 0);
    if (controls) { controls.target.set(0, 1.2, 0); controls.update() }
    frame();
  }
  function update(next) {
    const key = JSON.stringify([next.level, [...next.items].sort(), next.accent, next.trophies ?? [], next.souvenirs ?? null]);
    if (key !== state.key) build(next);
    if (next.pnl !== state.pnl || next.accent !== state.accent) screens.pnl.redraw(next.pnl, next.accent);
    // Un écran par position ouverte (deux écrans de bureau, puis le mur d'écrans).
    const pk = JSON.stringify(next.positions ?? []);
    if (pk !== state.pk) [screens.c1, screens.c2, ...screens.wall].forEach((t, i) => t.redraw(next.positions?.[i] ?? null));
    if (next.une !== state.une) screens.paper.redraw(next.une);
    // Ambiance : chaude quand la journée est en gain, pénombre bleutée quand elle est en perte.
    const m = next.mood ?? 0;
    hemi.intensity = m < 0 ? .45 : 1.05; hemi.color.set(m < 0 ? 0x8a9cc0 : 0xffe4c4);
    sun.intensity = m < 0 ? .55 : 1.5;
    if (lamp) { lamp.intensity = m < 0 ? .5 : 1.4 + (m > 0 ? .3 : 0); lamp.color.set(m < 0 ? 0x7f9cff : 0xffc98a) }
    state = { ...next, key, pk };
  }
  let raf = 0, t0 = performance.now();
  const loop = t => {
    raf = requestAnimationFrame(loop);
    const s = (t - t0) / 1000;
    room?.traverse(o => {
      o.userData.fish?.forEach((f, i) => { f.position.x = Math.sin(s * (.6 + i * .2) + i) * .55; f.position.z = Math.cos(s * (.5 + i * .3)) * .15 });
      o.userData.steam?.forEach((p, i) => { const u = (s * .5 + i / 3) % 1; p.position.set(Math.sin(u * 6 + i) * .03, .08 + u * .35, 0); p.material.opacity = .45 * (1 - u); p.scale.setScalar(.6 + u) });
      if (o.userData.cat) o.userData.cat.scale.y = 1 + Math.sin(s * 1.6) * .05; // le chat respire
    });
    if (s - (state.skyAt ?? -9) > (state.reg === "krach" || state.reg === "nervosite" || state.reg === "euphorie" ? .12 : 5)) { // fenêtre animée
      screens.sky.redraw(state.level ?? 0, state.hour ?? 22, state.reg ?? "calme", s); state.skyAt = s;
    }
    if (controls) controls.update();
    else if (room) { const a = Math.PI / 4 + Math.sin(s * .25) * .12, r = S * 1.1 * Math.SQRT2; camera.position.set(Math.sin(a) * r, S * 1.05, Math.cos(a) * r); camera.lookAt(0, 1.2, 0) }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(frame); ro.observe(parent);
  return {
    update,
    // Mode photo : l'image de la pièce, avec une légende en bas.
    snapshot(caption) {
      renderer.render(scene, camera);
      const src = renderer.domElement, c = document.createElement("canvas"); c.width = src.width; c.height = src.height + 90;
      const g = c.getContext("2d"); g.fillStyle = "#08090d"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
      g.fillStyle = "#f5b83d"; g.font = "700 40px 'IBM Plex Sans Condensed', sans-serif"; g.fillText(caption, 28, src.height + 58);
      return c.toDataURL("image/png");
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls?.dispose(); dispose(room ?? scene); Object.values(screens).flat().forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove() },
  };
}

function dispose(root) {
  root.traverse(o => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { if (!x.map?.userData.keep) x.map?.dispose(); x.dispose() }) });
}
