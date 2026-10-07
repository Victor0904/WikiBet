// La ville d'une guilde en 3D : un diorama isométrique. Bâtiments publics sur la place centrale, un immeuble par membre
// autour (son allure suit son logement du QG). Jour et nuit suivent l'horloge d'Aurelys : la nuit, les fenêtres s'allument.
// Formes simples, sans modèle externe ; un appui sur l'immeuble d'un membre ouvre son QG.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { place, SUB, COM } from "./models.js";

// Immeubles Kenney (CC0) par logement : maisons de banlieue, puis immeubles de ville, puis gratte-ciel.
const HOMES_3D = [
  [SUB, ["building-type-a", "building-type-b", "building-type-c", "building-type-d"], 1.5],
  [SUB, ["building-type-g", "building-type-h", "building-type-i", "building-type-k"], 1.7],
  [COM, ["building-a", "building-b", "building-c", "building-d"], 1.6],
  [COM, ["building-f", "building-g", "building-h", "building-i"], 1.7],
  [COM, ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d"], 1.6],
];
const hashId = id => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...o });
function box(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = true; return o }
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; return o }
const group = (...k) => { const g = new THREE.Group(); k.forEach(x => g.add(x)); return g };

// Façade à fenêtres : texture dessinée, dont les fenêtres s'éclairent la nuit (emissive).
function facade(color, floors, cols) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 64 * floors / Math.max(1, cols) * 1.2 | 0 || 64;
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  const fh = c.height / floors, fw = c.width / cols;
  g.fillStyle = "#ffcf7a";
  for (let i = 0; i < floors; i++) for (let j = 0; j < cols; j++) if ((i * 7 + j * 3) % 5 !== 0) g.fillRect(j * fw + fw * .25, i * fh + fh * .25, fw * .5, fh * .45);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ color, roughness: .7, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 });
}

// Immeuble d'un membre selon son logement : cabane, maison, petit immeuble, loft de briques, tour de verre.
function home(level, accent, lit) {
  const roof = mat(0x7a3b2e), A = new THREE.Color(accent);
  const shapes = [
    () => { const f = facade(0x8a6a4b, 1, 2); lit.push(f); return group(box(.9, .7, .9, f), cyl(0, .75, .45, roof, 0, .7, 0, 4)) },
    () => { const f = facade(0xd9cbb2, 2, 3); lit.push(f); return group(box(1.2, 1.3, 1.1, f), cyl(0, .95, .55, roof, 0, 1.3, 0, 4)) },
    () => { const f = facade(0xbac1cf, 4, 3); lit.push(f); return group(box(1.3, 2.4, 1.3, f), box(1.35, .1, 1.35, mat(A), 0, 2.4)) },
    () => { const f = facade(0x8a4a3a, 4, 4); lit.push(f); return group(box(1.6, 2.6, 1.4, f), box(.3, .8, .3, mat(0x3a2a24), .5, 2.6, .3)) },
    () => { const f = facade(0x5a7a9a, 10, 3, true); f.metalness = .4; f.roughness = .25; lit.push(f); return group(box(1.3, 5.2, 1.3, f), box(.9, .4, .9, mat(A), 0, 5.2), cyl(.03, .03, 1, mat(0xdddddd), 0, 5.6)) },
  ];
  return (shapes[level] ?? shapes[0])();
}

// Bâtiments publics : chacun sa silhouette, plus haut avec le niveau ; endormi = gris et éteint.
function publicBuilding(id, level, asleep, lit, accent) {
  const k = .7 + .3 * level, stone = mat(asleep ? 0x555555 : 0xe8dcc4), A = mat(asleep ? 0x444444 : accent);
  let g;
  if (id === "mairie") {
    const f = facade(asleep ? 0x666666 : 0xe8dcc4, 2, 5); if (!asleep) lit.push(f);
    g = group(box(2.6, 1.4 * k, 1.6, f), ...[-1.1, -.55, 0, .55, 1.1].map(x => cyl(.08, .08, 1.4 * k, stone, x, 0, .9)), cyl(.7, .7, .5, A, 0, 1.4 * k), new THREE.Mesh(new THREE.SphereGeometry(.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), A));
    g.children.at(-1).position.y = 1.4 * k + .5;
  } else if (id === "salle") {
    const f = facade(asleep ? 0x555555 : 0x2a4a6a, 4, 4); if (!asleep) lit.push(f);
    g = group(box(1.8, 2.2 * k, 1.4, f), box(1.85, .25, 1.45, mat(asleep ? 0x333333 : 0x1fcb8b, { emissive: asleep ? 0 : 0x0a5a3a }), 0, 1.4 * k));
  } else if (id === "banque") {
    const f = facade(asleep ? 0x666666 : 0xd8d0bc, 2, 3); if (!asleep) lit.push(f);
    g = group(box(1.8, 1.3 * k, 1.4, f), ...[-.6, -.2, .2, .6].map(x => cyl(.09, .09, 1.3 * k, stone, x, 0, .8)), cyl(0, 1.3, .5, stone, 0, 1.3 * k, 0, 4));
  } else if (id === "presse") {
    const f = facade(asleep ? 0x555555 : 0x9a4a4a, 5, 3); if (!asleep) lit.push(f);
    g = group(box(1.3, 2.6 * k, 1.3, f), cyl(.04, .04, 1.4, mat(0xcccccc), 0, 2.6 * k), new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), mat(0xf04b5c, { emissive: asleep ? 0 : 0x801010 })));
    g.children.at(-1).position.y = 2.6 * k + 1.4;
  } else {
    const f = facade(asleep ? 0x555555 : 0xcfd6e2, 1, 4); if (!asleep) lit.push(f);
    g = group(cyl(.9, 1, 1.2 * k, f, 0, 0, 0, 20), new THREE.Mesh(new THREE.SphereGeometry(.9, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(asleep ? 0x555555 : 0xb8c4d8, { metalness: .6, roughness: .3 })));
    g.children.at(-1).position.y = 1.2 * k;
  }
  return g;
}

// Bannière et enseigne aux couleurs de la guilde.
function canvasMat(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .35 });
}
const bannerMat = (color, tag) => canvasMat(64, 96, (g, w, h) => {
  g.fillStyle = color; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(w / 2, h - 18); g.lineTo(0, h); g.fill();
  g.fillStyle = "#08090d"; g.font = "700 22px 'IBM Plex Mono', monospace"; g.textAlign = "center"; g.fillText(tag, w / 2, 46);
});
const signMat = (name, color) => canvasMat(512, 108, (g, w, h) => {
  g.fillStyle = "#14161f"; g.fillRect(0, 0, w, h); g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = color; g.font = "700 54px 'IBM Plex Sans Condensed', sans-serif"; g.textAlign = "center"; g.fillText(name.slice(0, 22), w / 2, 72);
});
// Feu d'artifice au-dessus de la ville (objectifs de la semaine atteints).
function makeFireworks(city) {
  const sparks = [], cols = [0xf5b83d, 0x1fcb8b, 0xf04b5c, 0x3987e5, 0xa78bfa];
  for (let k = 0; k < 5; k++) for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.07, 6, 4), new THREE.MeshBasicMaterial({ color: cols[k], transparent: true }));
    m.userData = { k, a: i / 18 * Math.PI * 2, b: (i % 3 - 1) * .5 }; sparks.push(m); city.add(m);
  }
  return t => sparks.forEach(m => {
    const { k, a, b } = m.userData, u = (t * .45 + k * .21) % 1, r = u * 2.2, cx = Math.cos(k * 2.1) * 4, cz = Math.sin(k * 2.1) * 4, cy = 7 + k % 2;
    m.position.set(cx + Math.cos(a) * Math.cos(b) * r, cy + Math.sin(b) * r - u * u * 1.5, cz + Math.sin(a) * Math.cos(b) * r);
    m.material.opacity = 1 - u;
  });
}

// Fanal vert : membre en gain aujourd'hui.
function addBeacon(b, top) {
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1fcb8b, emissive: 0x1fcb8b, emissiveIntensity: 1.6 }));
  beacon.position.set(0, top + .15, 0); b.add(beacon);
}

function tree(x, z) { const top = new THREE.Mesh(new THREE.ConeGeometry(.35, .9, 7), mat(0x2f7d4a)); top.position.set(x, .8, z); top.castShadow = true; return group(cyl(.06, .08, .4, mat(0x5a3d28), x, 0, z, 6), top) }

export function createCity(parent, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true;
  parent.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 200);
  const hemi = new THREE.HemisphereLight(0xffe8cc, 0x2a2018, 1), sun = new THREE.DirectionalLight(0xffe0b8, 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
  scene.add(hemi, sun);
  const fine = matchMedia("(pointer: fine)").matches;
  const controls = fine ? Object.assign(new OrbitControls(camera, renderer.domElement), { enablePan: false, minZoom: .7, maxZoom: 2.5, minPolarAngle: .6, maxPolarAngle: 1.15, enableDamping: true }) : null;
  let city = null, R = 10, lit = [], picks = [], key = "", movers = [], bulbs = [], online = [], fireworks = null;

  function frame() {
    const w = parent.clientWidth, h = parent.clientHeight, view = R * 1.75, asp = w / h;
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: -view * asp / 2, right: view * asp / 2, top: view / 2, bottom: -view / 2 }); camera.updateProjectionMatrix();
  }
  function build({ members, buildings, accent, color = accent, name = "", tag = "", party = false, land = 0 }) {
    if (city) { scene.remove(city); city.traverse(o => { o.geometry?.dispose(); o.material?.emissiveMap?.dispose(); o.material?.dispose?.() }) }
    city = new THREE.Group(); lit = []; picks = []; movers = []; bulbs = []; online = [];
    // Chaque parcelle achetée ajoute un anneau de terrain : la ville respire.
    const n = members.length, ring = Math.max(3 + land, Math.ceil(Math.sqrt(n + 9))), size = ring * 2.4 + 2; R = size / 2 + 1;
    city.add(box(size + 2, .3, size + 2, mat(0x3d4a35), 0, -.3), box(size + 2.4, .2, size + 2.4, mat(0x2a2a2a), 0, -.45));
    // Rues en croix et place centrale.
    city.add(box(size + 2, .02, 1, mat(0x3a3d44)), box(1, .02, size + 2, mat(0x3a3d44)), box(8.4, .03, 8.4, mat(0xb8ad98)));
    // Lampadaires le long des rues (allumés la nuit), quelques-uns éclairent vraiment.
    const half = size / 2 + .6;
    for (let k = -half; k <= half; k += 2.4) for (const [x, z] of [[k, .7], [.7, k]]) {
      if (Math.abs(k) < 4.6) continue;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xffc860, emissiveIntensity: 0 }));
      bulb.position.set(x, 1.25, z); bulbs.push(bulb);
      city.add(cyl(.03, .04, 1.2, mat(0x2a2d34), x, 0, z, 6), bulb);
      if (tag) { const fl = new THREE.Mesh(new THREE.PlaneGeometry(.28, .4), bannerMat(color, tag)); fl.position.set(x + (z === .7 ? .16 : 0), .85, z + (x === .7 ? .16 : 0)); fl.rotation.y = x === .7 ? 0 : Math.PI / 2; city.add(fl) }
    }
    // Habitants et voitures : ils parcourent les rues en boucle.
    const peopleColors = [0xf04b5c, 0x3987e5, 0xf5b83d, 0x1fcb8b, 0xa78bfa, 0xe9e2d4];
    for (let i = 0; i < Math.min(24, 6 + members.length * 2); i++) {
      const p = group(cyl(.07, .09, .32, mat(peopleColors[i % 6]), 0, 0, 0, 6), new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), mat(0xe8c4a0)));
      p.children[1].position.y = .4;
      movers.push({ o: p, axis: i % 2, lane: (i % 4 < 2 ? 1 : -1) * .42, speed: .25 + (i % 5) * .06, off: i * 1.7, span: size + 1 }); city.add(p);
    }
    for (let i = 0; i < Math.min(8, 2 + members.length); i++) {
      const car = group(box(.55, .2, .28, mat(peopleColors[(i + 2) % 6], { metalness: .3 })), box(.3, .15, .26, mat(0x223344), -.03, .2, 0));
      movers.push({ o: car, axis: i % 2, lane: (i % 2 ? .18 : -.18), speed: 1.1 + (i % 3) * .3, off: i * 3.1, span: size + 1, car: true }); city.add(car);
    }
    const slots = []; // places en spirale autour de la place, en évitant les rues
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      const x = i * 2.4, z = j * 2.4; if (Math.abs(x) < 4.4 && Math.abs(z) < 4.4) continue; if (Math.abs(x) < 1.2 || Math.abs(z) < 1.2) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) > ring * 2.4 - .2) continue; // rien au bord du plateau
      slots.push([x, z]);
    }
    slots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    members.forEach((m, i) => {
      const mine = [], [x, z] = slots[i] ?? [0, 0], [dir, names, size] = HOMES_3D[m.home ?? 0] ?? HOMES_3D[0];
      // Modèle Kenney ; la forme simple reste affichée en attendant (ou si le modèle ne charge pas).
      const b = place(city, dir(names[hashId(m.id) % names.length]), { x, z, ry: (hashId(m.id) % 4) * Math.PI / 2, size, own: true, fallback: home(m.home ?? 0, color, mine),
        onLoad: model => {
          const mats = []; model.traverse(o => { if (o.isMesh && o.material.map) { o.material.emissive = new THREE.Color(0xffc070); o.material.emissiveMap = o.material.map; o.material.userData.k = .3; mats.push(o.material) } });
          (m.online ? online : lit).push(...mats); if (!m.online) mats.forEach(f => { f.userData.dark = true });
          if (m.gain) addBeacon(b, new THREE.Box3().setFromObject(model).max.y);
          if (lastHour != null) daylight(lastHour);
        } });
      // Fenêtres : allumées la nuit seulement si le membre est connecté (une ville vide se voit).
      (m.online ? online : lit).push(...mine); if (!m.online) mine.forEach(f => { f.userData.dark = true });
      b.userData.member = m; picks.push(b);
    });
    // Terrains libres : parcs, arbres et bancs, pour que la ville ne paraisse pas vide.
    const kTree = (x, z, k) => place(city, SUB(k % 2 ? "tree-small" : "tree-large"), { x, z, size: k % 2 ? .55 : .7, fallback: tree(0, 0) });
    slots.slice(members.length).forEach(([x, z], i) => {
      if (i % 3 === 2) { city.add(box(1.6, .02, 1.6, mat(0x4f7a3a), x, 0, z), box(.6, .12, .15, mat(0x7a5537), x, .15, z + .4)); kTree(x - .5, z - .4, i); kTree(x + .5, z - .3, i + 1) }
      else { kTree(x - .45, z, i); kTree(x + .45, z + .35, i + 1); kTree(x, z - .5, i + 2) }
    });
    // Place : les bâtiments construits autour de la fontaine.
    const spots = { mairie: [0, -2.4], salle: [-2.5, .3], banque: [2.5, .3], presse: [-2.3, 2.8], observatoire: [2.3, 2.8] };
    city.add(cyl(.6, .7, .25, mat(0x9aa8b8)), cyl(.08, .08, .6, mat(0x9aa8b8)));
    for (const b of buildings) { const g = publicBuilding(b.id, b.level, b.asleep, lit, color); g.scale.setScalar(.95); g.position.set(...[spots[b.id][0], 0, spots[b.id][1]]); city.add(g) }
    if (name) { // le nom de la guilde en haut de la mairie (ou sur un fronton au centre de la place)
      const mairie = buildings.find(b => b.id === "mairie"), y = mairie ? 1.4 * (.7 + .3 * mairie.level) * .95 + 1.4 : 1.2;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .55), signMat(name, color)); sign.position.set(0, y, mairie ? -1.6 : -.9); city.add(sign);
      if (!mairie) city.add(box(.1, 1.2, .1, mat(0x2a2d34), -1.2, 0, -.95), box(.1, 1.2, .1, mat(0x2a2d34), 1.2, 0, -.95));
    }
    fireworks = party ? makeFireworks(city) : null;
    scene.add(city);
    camera.position.set(R * 2, R * 1.9, R * 2); camera.lookAt(0, 0, 0);
    if (controls) { controls.target.set(0, 0, 0); controls.update() }
    frame();
  }
  // Heure d'Aurelys (0-24) : soleil, ciel et fenêtres.
  let lastHour = null;
  function daylight(h) {
    lastHour = h;
    const d = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)); // 0 la nuit, 1 à midi
    sun.intensity = .45 + 1.3 * d; hemi.intensity = .6 + .5 * d; // la nuit reste lisible
    sun.position.set(Math.cos((h - 6) / 12 * Math.PI) * 20, 4 + 16 * d, 10);
    const night = d < .25 ? 1 - d * 4 : 0;
    lit.forEach(m => { m.emissiveIntensity = m.userData.dark ? 0 : 1.1 * night * (m.userData.k ?? 1) });
    online.forEach(m => { m.emissiveIntensity = (.35 + .9 * night) * (m.userData.k ?? 1) }); // un membre connecté a toujours de la lumière
    bulbs.forEach(b => { b.material.emissiveIntensity = 2 * night });
    renderer.setClearColor(new THREE.Color(0x0d1426).lerp(new THREE.Color(0x8fb8de), d), 1); // ciel : nuit bleu nuit, jour bleu clair
  }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const tap = e => {
    const r = renderer.domElement.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(picks, true)[0]; let o = hit?.object;
    while (o && !o.userData.member) o = o.parent;
    if (o) onPick(o.userData.member);
  };
  renderer.domElement.addEventListener("click", tap);
  let raf = 0;
  const t0 = performance.now();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    for (const m of movers) { // aller-retour le long d'une rue
      const u = ((t * m.speed + m.off) % (2 * m.span)), pos = (u < m.span ? u : 2 * m.span - u) - m.span / 2, dir = u < m.span ? 1 : -1;
      if (m.axis) { m.o.position.set(m.lane, 0, pos); m.o.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2 } else { m.o.position.set(pos, 0, m.lane); m.o.rotation.y = dir > 0 ? 0 : Math.PI }
    }
    if (fireworks) fireworks(t);
    controls?.update(); renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(frame); ro.observe(parent);
  return {
    update(next) { const k = JSON.stringify([next.members, next.buildings, next.accent, next.color, next.name, next.party, next.land]); if (k !== key) { key = k; build(next) } daylight(next.hour) },
    snapshot(caption) {
      renderer.render(scene, camera);
      const src = renderer.domElement, c = document.createElement("canvas"); c.width = src.width; c.height = src.height + 90;
      const g = c.getContext("2d"); g.fillStyle = "#08090d"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
      g.fillStyle = "#f5b83d"; g.font = "700 40px 'IBM Plex Sans Condensed', sans-serif"; g.fillText(caption, 28, src.height + 58);
      return c.toDataURL("image/png");
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls?.dispose(); renderer.domElement.removeEventListener("click", tap); renderer.dispose(); renderer.domElement.remove() },
  };
}
