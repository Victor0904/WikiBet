// La ville d'une guilde en 3D : un diorama isométrique. Bâtiments publics sur la place centrale, un immeuble par membre
// autour (son allure suit son logement du QG). Jour et nuit suivent l'horloge d'Aurelys : la nuit, les fenêtres s'allument.
// Formes simples, sans modèle externe ; un appui sur l'immeuble d'un membre ouvre son QG.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
  let city = null, R = 10, lit = [], picks = [], key = "";

  function frame() {
    const w = parent.clientWidth, h = parent.clientHeight, view = R * 1.55, asp = w / h;
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: -view * asp / 2, right: view * asp / 2, top: view / 2, bottom: -view / 2 }); camera.updateProjectionMatrix();
  }
  function build({ members, buildings, accent }) {
    if (city) { scene.remove(city); city.traverse(o => { o.geometry?.dispose(); o.material?.emissiveMap?.dispose(); o.material?.dispose?.() }) }
    city = new THREE.Group(); lit = []; picks = [];
    const n = members.length, ring = Math.max(1, Math.ceil(Math.sqrt(n + 9))), size = ring * 2.4 + 2; R = size / 2 + 1;
    city.add(box(size + 2, .3, size + 2, mat(0x3d4a35), 0, -.3), box(size + 2.4, .2, size + 2.4, mat(0x2a2a2a), 0, -.45));
    // Rues en croix et place centrale.
    city.add(box(size + 2, .02, 1, mat(0x3a3d44)), box(1, .02, size + 2, mat(0x3a3d44)), box(5.2, .03, 5.2, mat(0xb8ad98)));
    const slots = []; // places en spirale autour de la place, en évitant les rues
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      const x = i * 2.4, z = j * 2.4; if (Math.abs(x) < 3.2 && Math.abs(z) < 3.2) continue; if (Math.abs(x) < 1.2 || Math.abs(z) < 1.2) continue;
      slots.push([x, z]);
    }
    slots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    members.forEach((m, i) => {
      const [x, z] = slots[i] ?? [0, 0], b = home(m.home ?? 0, accent, lit);
      b.position.set(x, 0, z); b.userData.member = m; picks.push(b); city.add(b);
    });
    slots.slice(members.length, members.length + 12).forEach(([x, z], i) => { if (i % 2 === 0) city.add(group(tree(x - .4, z), tree(x + .4, z + .3))) });
    // Place : les bâtiments construits autour de la fontaine.
    const spots = { mairie: [0, -1.5], salle: [-1.6, .2], banque: [1.6, .2], presse: [-1.4, 1.8], observatoire: [1.4, 1.8] };
    city.add(cyl(.6, .7, .25, mat(0x9aa8b8)), cyl(.08, .08, .6, mat(0x9aa8b8)));
    for (const b of buildings) { const g = publicBuilding(b.id, b.level, b.asleep, lit, accent); g.scale.setScalar(.6); g.position.set(...[spots[b.id][0], 0, spots[b.id][1]]); city.add(g) }
    scene.add(city);
    camera.position.set(R * 2, R * 1.9, R * 2); camera.lookAt(0, 0, 0);
    if (controls) { controls.target.set(0, 0, 0); controls.update() }
    frame();
  }
  // Heure d'Aurelys (0-24) : soleil, ciel et fenêtres.
  function daylight(h) {
    const d = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)); // 0 la nuit, 1 à midi
    sun.intensity = .45 + 1.3 * d; hemi.intensity = .6 + .5 * d; // la nuit reste lisible
    sun.position.set(Math.cos((h - 6) / 12 * Math.PI) * 20, 4 + 16 * d, 10);
    lit.forEach(m => { m.emissiveIntensity = d < .25 ? 1.1 * (1 - d * 4) : 0 });
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
  const loop = () => { raf = requestAnimationFrame(loop); controls?.update(); renderer.render(scene, camera) };
  raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(frame); ro.observe(parent);
  return {
    update(next) { const k = JSON.stringify([next.members.map(m => [m.id, m.home]), next.buildings, next.accent]); if (k !== key) { key = k; build(next) } daylight(next.hour) },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls?.dispose(); renderer.domElement.removeEventListener("click", tap); renderer.dispose(); renderer.domElement.remove() },
  };
}
