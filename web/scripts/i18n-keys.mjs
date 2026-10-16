// Textes français à traduire (clés de src/en.js) : `node scripts/i18n-keys.mjs` écrit scripts/i18n-missing.json,
// la liste des clés absentes du dictionnaire. Sources : textes du code (analyse JSX), actualités tirées par le moteur,
// messages d'erreur des migrations SQL, catalogues de la base (succès, talents, boutique).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseSync } from "rolldown/utils";
import { PGlite } from "@electric-sql/pglite";
import { keyOf, addNames, PATTERNS } from "../src/i18n.js";
import { STOCKS, CHARACTERS, ANALYSTS, SECTORS, REGIMES, IDEAS, initState, advance, calendar, SPM } from "../supabase/functions/_shared/aurelys.js";

const root = new URL("..", import.meta.url), read = p => readFileSync(new URL(p, root), "utf8");
addNames([...STOCKS.map(s => s.name), ...CHARACTERS.map(c => c.name), ...ANALYSTS.map(a => a.split(",")[0]), "Aurelys", "Port-Aurel"]);
const keys = new Map(); // clé → origine
const FR = /[a-zàâçéèêëîïôûùüÿœ]{2}/i;
const MARK = "";
const add = (s, from) => {
  if (typeof s !== "string") return;
  const core = s.replace(/[ \t\n\r]+/g, " ").trim();
  if (!core || !FR.test(core) || core.length > 1200) return;
  // Phrase traitée par une règle (src/i18n.js) : seuls ses morceaux se traduisent.
  const cap = x => x && x.charAt(0).toUpperCase() + x.slice(1);
  for (const [i, [re]] of PATTERNS.entries()) { const x = re.exec(core); if (!x) continue;
    if (i === 0) add(cap(x[5]), from); if (i === 1) { add(cap(x[2]), from); add(x[5], from) } if (i === 2) { add(x[1], from); add(x[3], from); add(x[4]?.trim(), from) }
    return }
  if (!/[ àâçéèêëîïôûùüÿœ]/i.test(core) && (/[a-z][A-Z]|[/._]/.test(core) || core.length > 30)) return; // du code, pas du texte
  // Gabarits : chaque ${…} est un repère, comme les nombres et les noms, dans l'ordre d'apparition ;
  // « +{0} W » devient « {0} », comme à l'exécution (signe et unité comptent dans le repère).
  const key = core.split(MARK).map(part => keyOf(part).key).join("{}")
    .replace(/[+−-]?\{\d*\}(?:[   ](?:W|%))?/g, "{}");
  let i = 0; const k = key.replace(/\{\}/g, () => `{${i++}}`);
  if (!keys.has(k)) keys.set(k, from);
};

// 1. Code de l'écran : textes JSX, chaînes et gabarits (hors attributs techniques, comparaisons et appels techniques).
const TECH_ATTR = new Set(["className", "key", "type", "id", "name", "htmlFor", "autoComplete", "inputMode", "role", "rel", "href", "src", "viewBox", "d", "fill", "stroke", "strokeLinecap", "strokeLinejoin", "loading", "decoding", "autoCapitalize", "lang", "translate", "target", "style", "transform", "preserveAspectRatio", "fontFamily", "textAnchor", "dominantBaseline", "points", "x", "y", "width", "height"]);
const TECH_CALL = /^(querySelector|querySelectorAll|getItem|setItem|removeItem|rpc|from|select|eq|neq|in|order|channel|on|import|require|matchMedia|addEventListener|removeEventListener|createElement|getElementById|closest|matches|test|replace|split|startsWith|endsWith|includes|indexOf|join|toLocaleString|toLocaleDateString|toLocaleTimeString|DateTimeFormat|NumberFormat|RegExp|fetch|send|act|all|query|exec|postMessage|getAttribute|setAttribute|evaluate|waitFor|define|log|warn|error)$/;
function walk(n, parent, ctx, from) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) walk(x, parent, ctx, from); return }
  switch (n.type) {
    case "ImportDeclaration": case "ExportAllDeclaration": return;
    case "JSXAttribute": if (TECH_ATTR.has(n.name?.name)) return; break;
    case "BinaryExpression": if (/[=!]==?/.test(n.operator)) return; break;
    case "SwitchCase": walk(n.consequent, n, ctx, from); return;
    case "Property": if (!n.computed && n.key) { walk(n.value, n, ctx, from); return } break;
    case "MemberExpression": if (n.computed && n.property?.type === "Literal") { walk(n.object, n, ctx, from); return } break;
    case "CallExpression": { const f = n.callee?.property?.name ?? n.callee?.name; if (TECH_CALL.test(f ?? "")) return } break;
    case "JSXText": add(n.value.split(/\n/).map(l => l.trim()).filter(Boolean).join(" "), from); return;
    case "Literal": if (typeof n.value === "string" && /[ .:!?»«’']|[A-ZÉ]/.test(n.value)) add(n.value, from); return;
    case "TemplateLiteral": add(n.quasis.map((q, i) => q.value.cooked + (i < n.expressions.length ? MARK : "")).join(""), from); break;
  }
  for (const k in n) if (k !== "type" && k !== "start" && k !== "end" && k !== "range" && k !== "loc") walk(n[k], n, ctx, from);
}
const files = [...["src", "src/qg"].flatMap(d => readdirSync(new URL(d + "/", root)).filter(f => /\.(jsx?|mjs)$/.test(f) && !/^(en|i18n|seed|engine|demo)\.js$/.test(f)).map(f => d + "/" + f)),
  "supabase/functions/_shared/aurelys-stories.js", "supabase/functions/aurelys/index.ts"];
for (const f of files) { const r = parseSync(f, read(f), { lang: f.endsWith(".ts") ? "ts" : "jsx" }); walk(r.program, null, null, f) }
// Données du moteur affichées telles quelles : secteurs, humeurs, personnages, sociétés.
for (const s of Object.values(SECTORS)) add(s.name, "secteurs");
for (const r of Object.values(REGIMES)) add(r.name, "humeurs");
for (const c of CHARACTERS) { add(c.role, "personnages"); add(c.bio, "personnages") }
for (const s of STOCKS) add(s.desc, "sociétés");
for (const l of Object.values(IDEAS)) for (const w of l) add(w, "idées");

// 2. Actualités : le moteur tourne 40 jours d'Aurelys (graines variées), titres et paragraphes des articles.
for (const seed of [1, 2, 3, 4]) {
  const t0 = 1800000000 + seed * 1e6, S = initState(t0, seed); let v = t0;
  for (let i = 0; i < 40 * 1440 / 240; i++) { v += 240 * SPM; const o = advance(S, v); addNames(Object.values(S.extra).map(d => d.name)); for (const n of o.news) { add(n.title, "actualités"); for (const p of (n.text ?? "").split("\n\n")) add(p, "actualités") } }
  for (const e of calendar(v, 40, Object.values(S.extra))) add(e.title, "calendrier");
  for (const d of Object.values(S.extra)) for (const k of ["what", "desc", "story", "since"]) add(d[k], "jeunes pousses");
}

// 3. Erreurs SQL (raise exception '… % …') : les % deviennent des repères.
for (const f of readdirSync(new URL("supabase/migrations/", root))) {
  for (const m of read("supabase/migrations/" + f).matchAll(/raise exception '((?:[^']|'')+)'/g)) add(m[1].replace(/''/g, "'").replace(/%/g, MARK), "sql " + f)
}
for (const m of read("supabase/functions/aurelys/index.ts").matchAll(/error: "([^"]+)"/g)) add(m[1], "fonction aurelys");

// 4. Catalogues de la base : tous les textes des tables de référence.
const db = new PGlite();
await db.exec(read("src/demo-stub.sql"));
for (const f of readdirSync(new URL("supabase/migrations/", root)).sort()) await db.exec(read("supabase/migrations/" + f));
for (const t of ["achievements", "talent_defs", "shop_items", "city_catalog"]) for (const r of (await db.query(`select * from ${t}`)).rows) for (const v of Object.values(r)) if (typeof v === "string" && (/ /.test(v) || /^[A-ZÀ-Ý]\p{Ll}/u.test(v))) add(v, "base " + t);

const EN = (await import("../src/en.js").catch(() => ({ default: {} }))).default;
const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, from]) => ({ k, from }));
writeFileSync(new URL("scripts/i18n-missing.json", root), JSON.stringify(missing, null, 1));
console.log(keys.size, "clés,", missing.length, "sans traduction");
