// Modèles 3D Kenney (CC0, public/models) : chargés une fois, puis copiés. Un modèle est posé « à la taille » voulue
// (largeur de son emprise au sol), tourné, et ses ombres activées. En attendant le chargement, rien ne s'affiche à sa place ;
// si le chargement échoue, `fallback` (une forme simple) reste en place.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader(), cache = new Map();
const load = url => { if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then(g => g.scene)); return cache.get(url) };

// Pose le modèle `url` dans `parent` en (x, y, z), mis à l'échelle pour que son emprise la plus large fasse `size`.
// `own` : copie ses matériaux (pour les modifier sans toucher les autres exemplaires, par exemple les fenêtres allumées).
export function place(parent, url, { x = 0, y = 0, z = 0, ry = 0, size = 1, own = false, fallback = null, onLoad } = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  if (fallback) g.add(fallback);
  load(url).then(src => {
    const m = src.clone(true), box = new THREE.Box3().setFromObject(m), dim = box.getSize(new THREE.Vector3());
    const k = size / Math.max(dim.x, dim.z, 1e-6); m.scale.setScalar(k);
    m.position.set(-(box.min.x + dim.x / 2) * k, -box.min.y * k, -(box.min.z + dim.z / 2) * k); // centré, posé au sol
    m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (own) o.material = o.material.clone() } });
    if (fallback) { g.remove(fallback); fallback.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.() }) }
    g.add(m); onLoad?.(m);
  }).catch(() => { /* le dessin simple reste */ });
  return g;
}
export const F = n => `/models/furniture/${n}.glb`;
export const SUB = n => `/models/suburban/${n}.glb`;
export const COM = n => `/models/commercial/${n}.glb`;
