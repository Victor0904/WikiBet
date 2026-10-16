// Ajoute des traductions à src/en.js : `node scripts/i18n-add.mjs lot.tsv`. Chaque ligne :
//   « numéro<TAB>anglais »  (numéro de scripts/i18n-missing.json, sortie de i18n-keys.mjs ; anglais vide : texte gardé tel quel)
//   « ~texte français tel qu'affiché<TAB>anglais »  (la clé est calculée : nombres et noms deviennent {0}, {1}…)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { keyOf, addNames } from "../src/i18n.js";
import { STOCKS, CHARACTERS, ANALYSTS } from "../supabase/functions/_shared/aurelys.js";

addNames([...STOCKS.map(s => s.name), ...CHARACTERS.map(c => c.name), ...ANALYSTS.map(a => a.split(",")[0]), "Aurelys", "Port-Aurel"]);
const root = new URL("..", import.meta.url), file = new URL("src/en.js", root);
const missing = JSON.parse(readFileSync(new URL("scripts/i18n-missing.json", root), "utf8"));
const EN = existsSync(file) ? (await import(file.href + "?" + Date.now())).default : {};
let n = 0;
for (const line of readFileSync(process.argv[2], "utf8").split(/\r?\n/)) {
  const m = /^(~[^\t]+|\d+)\t(.*)$/.exec(line); if (!m) continue;
  const W = ["", "", ""], wOut = s => s.replace(/[-]/g, c => `{w${W.indexOf(c)}}`), wIn = s => s.replace(/\{w(\d)\}/g, (_, i) => W[i]); // jokers {w0}…
  const k = m[1][0] === "~" ? wOut(keyOf(wIn(m[1].slice(1).trim().replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))).key) : missing[+m[1]]?.k; // \u202f, \u00a0 : espaces insécables
  if (k == null) throw new Error("numéro inconnu : " + m[1]);
  const v = m[2].trim() || k;
  const ph = s => new Set(s.match(/\{\d+\}/g) ?? []), pk = ph(k); // une traduction peut omettre un repère, pas en inventer
  if ([...ph(v)].some(x => !pk.has(x))) throw new Error(`repère inconnu (${m[1]}) : ${k} → ${v}`);
  EN[k] = v; n++;
}
writeFileSync(file, "// Dictionnaire anglais (clé : texte français tel qu'affiché, nombres et noms remplacés par {0}, {1}…).\n" +
  "// Rempli avec scripts/i18n-keys.mjs puis scripts/i18n-add.mjs.\nexport default {\n" +
  Object.entries(EN).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n") + "\n};\n");
console.log(n, "traductions ajoutées,", Object.keys(EN).length, "au total");
