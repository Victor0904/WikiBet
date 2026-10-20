// Langue de l'écran : français (le jeu est écrit en français) ou anglais, choisie par le drapeau et gardée dans le navigateur.
// En anglais, chaque texte affiché passe par le dictionnaire (en.js, chargé seulement en anglais) au moment où il entre
// dans la page, y compris ce qui vient du serveur (erreurs SQL, catalogues, actualités du moteur). Les nombres et les noms
// propres sont remplacés par des repères : « Mise minimale : 10 W » se cherche sous « Mise minimale : {0} W ».
// ponytail: un texte absent du dictionnaire reste en français (ex. avec un pseudo dedans) ; tests/i18n-ui.test.js les repère.
export const LANG = (() => { try { const l = localStorage.getItem("wb-lang"); if (l === "fr" || l === "en") return l } catch { } return "fr" })();
export const LOCALE = LANG === "en" ? "en-GB" : "fr-FR";
export const setLang = l => { try { localStorage.setItem("wb-lang", l) } catch { } location.reload() };

let DICT = null, NAMES = [], RE = null, WILD = [];
// Clés à joker : {w0}, {w1} prennent n'importe quel texte (pseudo, nom de succès…), lui-même passé au dictionnaire.
const wild = d => [...d].filter(([k]) => /\{w\d\}/.test(k)).sort(([a], [b]) => b.length - a.length) // la plus précise d'abord
  .map(([k, v]) => [new RegExp("^" + k.split(/\{w\d\}/).map(esc).join("(.+?)") + "$"), v]);
// Un montant compte pour un seul repère, signe et unité compris (« +10 000 W », « −1,5 % »).
const NUM = "\\d{1,2}:\\d\\d|[+−-]?\\d(?:[\\d\\u00a0\\u202f.,]*\\d)?(?:[\\u00a0\\u202f ](?:W|%))?";
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Noms propres (sociétés, personnages) : ils restent tels quels, comme les nombres.
export function addNames(list) {
  NAMES = [...new Set([...NAMES, ...list.filter(n => n && n.length > 2)])].sort((a, b) => b.length - a.length);
  RE = new RegExp([...NAMES.map(esc), NUM].join("|"), "g");
}
// Nombre écrit à la française par le serveur (« 1,5 », « 10 000 ») : à l'anglaise.
const num = x => {
  const m = /^([+−-]?)([\d  .,]+?)([   ](?:W|%))?$/.exec(x); if (!m) return x;
  let n = m[2];
  if (/^\d+,\d{1,2}$/.test(n)) n = n.replace(",", ".");
  else if (/^\d{1,3}([  ]\d{3})+(,\d+)?$/.test(n)) n = n.replace(",", ".").replace(/[  ]/g, ",");
  return m[1] + n + (m[3] ?? "");
};
// Clé du dictionnaire pour un texte : repères à la place des noms et des nombres.
export function keyOf(s) { const v = []; return { key: s.replace(RE ?? new RegExp(NUM, "g"), x => "{" + (v.push(x) - 1) + "}"), v } }

// Phrases assemblées par le moteur à partir de morceaux tirés au hasard (fondateurs, produit, analyste) : une règle par forme,
// les morceaux passent eux-mêmes par le dictionnaire.
const cap = s => s.charAt(0).toUpperCase() + s.slice(1), low = s => s.charAt(0).toLowerCase() + s.slice(1);
const DAYS = { lundi: "Monday", mardi: "Tuesday", mercredi: "Wednesday", jeudi: "Thursday", vendredi: "Friday", samedi: "Saturday", dimanche: "Sunday" };
const MONTHS = { janvier: "January", février: "February", mars: "March", avril: "April", mai: "May", juin: "June", juillet: "July", août: "August", septembre: "September", octobre: "October", novembre: "November", décembre: "December" };
const date = s => s.replace(/(\p{L}+) (\d+) (\p{L}+) à (\d\d:\d\d)/u, (x, d, n, m, h) => DAYS[d] && MONTHS[m] ? `${DAYS[d]} ${n} ${MONTHS[m]} at ${h}` : x);
const VERBS = { commente: "says", prévient: "warns", juge: "judges", note: "notes", estime: "reckons" };
export const PATTERNS = [
  [/^(.+?) et (.+?) ont fondé (.+?) à (.+?)\. Leur pari : (.+?)\. La société n'a encore jamais gagné d'argent ; elle lève des fonds pour grandir\.$/,
    (a, b, c, d, e) => `${a} and ${b} founded ${c} in ${d}. Their bet: ${low(t(cap(e)))}. The company has never made money yet; it is raising funds to grow.`],
  [/^([^,.()«]{2,40}) \((?:jeune pousse|(.+?), fondée en (\d+) à ([^,()]+?))\)\. (.+)$/s,
    (n, w, y, c, rest) => `${n} (${w ? `${low(t(cap(w)))}, founded in ${y} in ${t(c)}` : "start-up"}). ${t(rest)}`],
  [/^(« .+? ») ?, (commente|prévient|juge|note|estime) (.+?)\.( .+)?$/s, (q, v, a, rest) => `${t(q)}, ${VERBS[v]} ${t(a)}.${rest ? " " + t(rest.trim()) : ""}`],
  [/^Sont concernées : (.+)\.$/, l => `Affected: ${l}.`],
  [/^([^.]+?) et ([^.]+?) ont fondé ([^.]+?) à ([^.]+?)\.$/, (a, b, c, d) => `${a} and ${b} founded ${c} in ${d}.`],
  [/^La levée de fonds est ouverte jusqu'au (.+?) \(heure de Paris\)\. Chaque action est proposée à (.+?) ; (\d+) millions d'actions composeront le capital\.$/,
    (d, p, n) => `The fundraising is open until ${date(d)} (Paris time). Each share is offered at ${num(p)}; the capital will be made of ${n} million shares.`],
];

export function t(s, vars) {
  if (s == null) return s;
  let out = s;
  if (DICT) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2];
    if (core && /\p{L}/u.test(core)) {
      let hit = DICT.get(core), v = [];
      if (hit == null) { const k = keyOf(core); hit = DICT.get(k.key); v = k.v }
      if (hit == null) { const k = keyOf(core); for (const [re, val] of WILD) { const x = re.exec(k.key); if (x) { const back = s => s.replace(/\{(\d+)\}/g, (_, j) => k.v[j]); hit = back(val.replace(/\{w(\d)\}/g, (_, i) => t(back(x[+i + 1])))); break } } }
      if (hit != null) out = m[1] + hit.replace(/\{(\d+)\}/g, (_, i) => num(v[i] ?? "")) + m[3];
      else if (/^[^\p{L}\p{N}{«"]+[\p{L}\p{N}]/u.test(core)) { const p = /^[^\p{L}\p{N}{«"]+/u.exec(core)[0], x = t(core.slice(p.length)); if (x !== core.slice(p.length)) out = m[1] + p + x + m[3] } // « ☆ », « ⛅ » devant le texte
      else for (const [re, f] of PATTERNS) { const x = re.exec(core); if (x) { out = m[1] + f(...x.slice(1)) + m[3]; break } }
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  // Milliers à l'anglaise, même écrits avec des espaces ordinaires dans le texte français (« 10 000 W » → « 10,000 W »).
  return DICT && out !== s ? out.replace(/\b\d{1,3}(?:[   ]\d{3})+\b/g, x => x.replace(/[   ]/g, ",")) : out;
}
// Texte pris en charge par une règle de phrase (pas besoin d'entrée dans le dictionnaire).
export const byPattern = s => PATTERNS.some(([re]) => re.test(s));

// Traduction de la page au fil de l'eau : textes et attributs lisibles, sauf saisies et zones marquées translate="no".
const ATTRS = ["placeholder", "aria-label", "title", "alt"];
const skip = el => !el || el.closest?.("input, textarea, [contenteditable], [translate=no], script, style");
function fixText(n) { if (skip(n.parentElement)) return; const v = n.nodeValue, x = t(v); if (x !== v) n.nodeValue = x }
function fixAttrs(el) { if (el.closest?.("[translate=no]")) return; for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v) { const x = t(v); if (x !== v) el.setAttribute(a, x) } } }
function fix(n) {
  if (n.nodeType === 3) return fixText(n);
  if (n.nodeType !== 1) return;
  fixAttrs(n);
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let x = w.nextNode(); x; x = w.nextNode()) x.nodeType === 3 ? fixText(x) : fixAttrs(x);
}

// Dictionnaire en place (startI18n, ou les tests sans navigateur).
export function useDict(d) { DICT = new Map(Object.entries(d)); WILD = wild(DICT) }

// À appeler avant le premier rendu.
export async function startI18n() {
  document.documentElement.lang = LANG;
  if (LANG !== "en") return;
  useDict((await import("./en.js")).default);
  const { STOCKS, CHARACTERS, ANALYSTS } = await import("../supabase/functions/_shared/aurelys.js");
  addNames([...STOCKS.map(s => s.name), ...CHARACTERS.map(c => c.name), ...ANALYSTS.map(a => a.split(",")[0]), "Aurelys", "Port-Aurel"]);
  document.title = t(document.title);
  // Textes dessinés dans la 3D (QG, ville, photos) : pas dans la page, traduits au moment du dessin.
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...a) { return fill.call(this, typeof s === "string" ? t(s) : s, ...a) };
  new MutationObserver(ms => { for (const m of ms) m.type === "characterData" ? fixText(m.target) : m.type === "attributes" ? fixAttrs(m.target) : m.addedNodes.forEach(fix) })
    .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
