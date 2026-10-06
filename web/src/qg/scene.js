// Le QG en 3D : une pièce isométrique qui grandit avec le logement, meublée par les objets achetés.
// Tout est construit en formes simples (pas de modèle externe), en low-poly, pour rester léger sur mobile.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Par logement : taille de la pièce, sol, murs, largeur de la fenêtre (part du mur du fond).
const HOMES = [
  { size: 6, floor: 0x6b4f3a, wall: 0x343a52, win: 0.32 },   // chambre
  { size: 7, floor: 0x8a6a4b, wall: 0x2c3247, win: 0.38 },   // studio
  { size: 8.5, floor: 0x585d68, wall: 0x22283a, win: 0.6 },  // open space
  { size: 10, floor: 0x4a3528, wall: 0x7a3b2e, win: 0.5 },   // loft (briques)
  { size: 12, floor: 0xd4d0c8, wall: 0x141824, win: 0.9 },   // penthouse
];
const H = 3.2; // hauteur des murs

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
function skyline(level) {
  return canvasTex(512, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#0b1030"); sky.addColorStop(1, level >= 3 ? "#5b3a6e" : "#24305e");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    let seed = 7 + level; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = level >= 2 ? 2 : 1;
    for (let k = 0; k < rows; k++) for (let x = 0; x < w;) {
      const bw = 18 + r() * 40, bh = (k ? 60 : 90) + r() * (level >= 3 ? 150 : 90);
      g.fillStyle = k ? "#151a33" : "#0d1124"; g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = "rgba(255,210,120,.75)";
      for (let wy = h - bh + 6; wy < h - 4; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) if (r() < .35) g.fillRect(wx, wy, 3, 4);
      x += bw + 2;
    }
  });
}

// Écran qui affiche le gain ou la perte des positions ouvertes.
function pnlTex() {
  return canvasTex(256, 160, (g, w, h, pnl = null, accent = "#F5B83D") => {
    g.fillStyle = "#07090f"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.06)"; for (let y = 20; y < h; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    g.font = "600 18px 'IBM Plex Mono', monospace"; g.fillStyle = "#9097a8"; g.fillText("positions", 14, 30);
    if (pnl == null) { g.fillStyle = accent; g.font = "600 30px 'IBM Plex Mono', monospace"; g.fillText("wiki·bourse", 14, 96); return }
    const up = pnl >= 0; g.fillStyle = up ? "#1fcb8b" : "#f04b5c";
    g.font = "700 40px 'IBM Plex Mono', monospace";
    g.fillText(`${up ? "+" : "−"}${Math.abs(Math.round(pnl)).toLocaleString("fr-FR")} W`, 14, 100);
    g.font = "600 22px 'IBM Plex Mono', monospace"; g.fillText(up ? "▲ en gain" : "▼ en perte", 14, 136);
  });
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
  // Bureau et écran principal : toujours là.
  out.push(at(group(box(2.1, .06, .8, wood, 0, top - .06), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => box(.06, top - .06, .06, dark, i * .98, 0, j * .35))), deskX, deskZ));
  const main = monitor(screens.pnl); main.position.set(deskX, top, deskZ - .15); out.push(main);
  const has = id => ids.has(id);
  if (has("ecran2")) { const m = monitor(screens.c1, .75); m.position.set(deskX + .82, top, deskZ - .1); m.rotation.y = -.35; out.push(m) }
  if (has("ecran3")) { const m = monitor(screens.c2, .75); m.position.set(deskX - .82, top, deskZ - .1); m.rotation.y = .35; out.push(m) }
  if (has("lampe")) { const l = new THREE.PointLight(0xffd59a, 1.2, 3); l.position.y = .4; out.push(at(group(cyl(.1, .12, .03, dark), cyl(.015, .015, .45, metal), cyl(.06, .14, .14, mat(accent), 0, .42), l), deskX + .85, deskZ + .25).translateY(top)) }
  if (has("micro")) out.push(at(group(cyl(.015, .015, .5, metal), cyl(.045, .045, .16, dark, 0, .5)), deskX - .55, deskZ + .2).translateY(top));
  if (has("chaise")) {
    const seat = mat(0x16181f), trim = mat(accent);
    out.push(at(group(cyl(.3, .3, .05, dark), cyl(.04, .04, .4, metal), box(.62, .1, .6, seat, 0, .42), box(.62, .85, .1, seat, 0, .52, .3), box(.64, .06, .12, trim, 0, 1.32, .3), box(.06, .25, .5, trim, -.33, .52), box(.06, .25, .5, trim, .33, .52)), deskX, deskZ + 1.05));
  }
  if (has("plante")) out.push(at(group(cyl(.22, .17, .4, mat(0xc9b8a0)), ...[0, 1, 2, 3, 4].map(i => ball(.28, mat(0x2f7d4a), Math.cos(i * 1.3) * .18, .7 + (i % 2) * .25, Math.sin(i * 1.3) * .18))), c + .55, c + .55));
  if (has("tapis")) { const t = box(2.8, .02, 1.9, mat(A.clone().multiplyScalar(.45))); t.position.set(c + S / 2 + .3, .005, c + S / 2 + .3); out.push(t) }
  if (has("neon")) {
    const tex = canvasTex(512, 128, g => { g.clearRect(0, 0, 512, 128); g.font = "italic 700 76px 'IBM Plex Sans Condensed', sans-serif"; g.shadowColor = accent; g.shadowBlur = 24; g.fillStyle = "#fff"; g.fillText("wiki·bourse", 30, 92); g.fillStyle = accent; g.fillText("wiki·bourse", 30, 92) });
    const n = new THREE.Mesh(new THREE.PlaneGeometry(2, .5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const l = new THREE.PointLight(accent, 1.5, 4); l.position.set(deskX, 2.2, c + .5);
    n.position.set(deskX, 2.35, c + .03); out.push(n, l);
  }
  if (has("camera")) out.push(at(group(cyl(.015, .015, 1.4, metal), box(.18, .12, .14, dark, 0, 1.4), box(.5, .5, .04, glow(0xfff4dc), .35, 1.1)), deskX + 2.1, deskZ + 1.5, -2.3));
  if (has("bibliotheque")) {
    const g = group(box(.45, 2.1, 1.7, wood));
    for (let s = 0; s < 4; s++) for (let b = 0; b < 7; b++) g.add(box(.12, .32 + (b % 3) * .04, .16, mat([0x9b2c2c, 0x2c5f9b, 0xd4a017, 0x2f7d4a, 0x6b3fa0][(s + b) % 5]), .25, .1 + s * .5, -.66 + b * .21)); // dos des livres côté pièce
    out.push(at(g, c + .25, c + 3.2));
  }
  if (has("canape")) { const f = mat(0x3d4f6e); out.push(at(group(box(.95, .45, 2.3, f), box(.25, .55, 2.3, f, -.35, .45), box(.95, .3, .22, f, 0, .45, -1.04), box(.95, .3, .22, f, 0, .45, 1.04), box(.4, .25, .5, mat(accent), .1, .45, .5)), c + .55, c + 5.3)) }
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
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(.78, .48), new THREE.MeshBasicMaterial({ map: screens.wall[(i * 3 + j) % screens.wall.length] }));
      sc.position.set(c + .04, 1 + i * .55, c + S - 2.9 + j * .85); sc.rotation.y = Math.PI / 2; g.add(sc);
    }
    out.push(g);
  }
  if (has("lingots")) {
    const gold = mat(0xe8c547, { metalness: .9, roughness: .2 });
    const g = group(box(1.2, .9, .7, mat(0x1f2330)), box(1.1, .6, .6, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: .25 }), 0, .9));
    for (let k = 0; k < 6; k++) g.add(box(.28, .1, .14, gold, -.3 + (k % 3) * .3, .92 + Math.floor(k / 3) * .11, (k % 2) * .16 - .08));
    out.push(at(g, c + S - .9, c + 6.4, Math.PI / 2));
  }
  return out;
}

export function createScene(parent, { interactive = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  parent.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a1e14, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6); sun.position.set(6, 10, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 }); scene.add(sun);

  const screens = { pnl: pnlTex(), c1: chartTex(11), c2: chartTex(24), wall: [3, 8, 13, 21, 34, 55].map(chartTex) };
  Object.values(screens).flat().forEach(t => { t.userData.keep = true }); // réutilisées d'un logement à l'autre
  let room = null, state = {}, S = 6;
  const fine = matchMedia("(pointer: fine)").matches;
  const controls = interactive && fine ? Object.assign(new OrbitControls(camera, renderer.domElement), { enablePan: false, enableZoom: false, minPolarAngle: .7, maxPolarAngle: 1.1, minAzimuthAngle: Math.PI / 4 - .5, maxAzimuthAngle: Math.PI / 4 + .5, enableDamping: true }) : null;

  function frame() {
    const w = parent.clientWidth, h = parent.clientHeight, view = S * (w < 600 ? 1.02 : .9), asp = w / h; // la pièce entière, murs compris
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: -view * asp / 2, right: view * asp / 2, top: view / 2, bottom: -view / 2 }); camera.updateProjectionMatrix();
  }
  function build({ level, items, accent }) {
    if (room) { scene.remove(room); dispose(room) }
    const home = HOMES[level] ?? HOMES[0]; S = home.size;
    const c = -S / 2; room = new THREE.Group();
    const floor = box(S, .2, S, mat(home.floor, { roughness: .85 }), 0, -.2, 0); room.add(floor);
    room.add(box(S, H, .2, mat(home.wall), 0, 0, c - .1), box(.2, H, S, mat(home.wall), c - .1, 0, 0));
    if (level === 3) for (let y = .3; y < H; y += .3) room.add(box(S, .02, .01, mat(0x5c2a20), 0, y, c + .005)); // joints de briques
    const ww = S * home.win, win = new THREE.Mesh(new THREE.PlaneGeometry(ww, level >= 4 ? H - .4 : 1.6), new THREE.MeshBasicMaterial({ map: skyline(level) }));
    win.position.set(level >= 4 ? 0 : c + S - ww / 2 - .5, level >= 4 ? H / 2 : 1.75, c + .02); room.add(win);
    buildItems(new Set(items), S, accent, screens).forEach(o => room.add(o));
    scene.add(room);
    camera.position.set(S * 1.1, S * 1.05, S * 1.1); camera.lookAt(0, 1.2, 0);
    if (controls) { controls.target.set(0, 1.2, 0); controls.update() }
    frame();
  }
  function update(next) {
    const key = JSON.stringify([next.level, [...next.items].sort(), next.accent]);
    if (key !== state.key) build(next);
    if (next.pnl !== state.pnl || next.accent !== state.accent) screens.pnl.redraw(next.pnl, next.accent);
    state = { ...next, key };
  }
  let raf = 0, t0 = performance.now();
  const loop = t => {
    raf = requestAnimationFrame(loop);
    const s = (t - t0) / 1000;
    room?.traverse(o => o.userData.fish?.forEach((f, i) => { f.position.x = Math.sin(s * (.6 + i * .2) + i) * .55; f.position.z = Math.cos(s * (.5 + i * .3)) * .15 }));
    if (controls) controls.update();
    else if (room) { const a = Math.PI / 4 + Math.sin(s * .25) * .12, r = S * 1.1 * Math.SQRT2; camera.position.set(Math.sin(a) * r, S * 1.05, Math.cos(a) * r); camera.lookAt(0, 1.2, 0) }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(frame); ro.observe(parent);
  return {
    update,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls?.dispose(); dispose(room ?? scene); Object.values(screens).flat().forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove() },
  };
}

function dispose(root) {
  root.traverse(o => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { if (!x.map?.userData.keep) x.map?.dispose(); x.dispose() }) });
}
