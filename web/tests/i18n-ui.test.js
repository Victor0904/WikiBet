import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch } from "./browser.js";
import { STOCKS, CHARACTERS } from "../supabase/functions/_shared/aurelys.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Noms propres d'Aurelys (sociétés, personnages, lieux) : ils restent en français.
const PROPER = [...STOCKS.map(s => s.name), ...CHARACTERS.map(c => c.name), "Aurelys", "Port-Aurel", "Valmeyre", "Brennes", "Castellane", "Lisère", "Haut-Ombre", "Grise-Vallée", "Sel-Rouge",
  "Épi d'or", "éCO2mix", "Open-Meteo", "calendrier.api.gouv.fr", "Météo", "Ondéo", "Vélisse", "Français", "Invité", "Testeur", "Les Baleines"]; // dernier : nom de guilde du test (contenu de joueur)
// Accents et petits mots français (« pour » et « plus » existent aussi en anglais : écartés).
const FRENCH = /[àâçéèêëîïôûùœ]|\b(le|la|les|des|du|une|est|avec|sans|dans|sur|ton|tes|ta|et|au|aux|cette|qui|que|pas|tu|ou|demain|hier|aujourd|jour|mise|perte|cours|frais|solde)\b/i;
// Lignes de la page encore en français (attributs lisibles compris).
const leftovers = b => b.evaluate(`(() => {
  const P = ${JSON.stringify(PROPER)}, FR = ${FRENCH};
  const clean = s => P.reduce((a, p) => a.split(p).join(" "), s);
  const lines = document.body.innerText.split("\\n").map(s => s.trim()).filter(Boolean);
  for (const e of document.querySelectorAll("[placeholder], [aria-label], [title]")) for (const a of ["placeholder", "aria-label", "title"]) { const v = e.getAttribute(a); if (v) lines.push("@" + a + " " + v) }
  return [...new Set(lines.filter(l => FR.test(clean(l)) && !document.querySelector("[translate=no]")?.innerText.includes(l)))];
})()`);

test("anglais : les écrans principaux n'affichent plus de français", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 400000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch(), bad = new Map();
  const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`).then(ok => assert.ok(ok, `bouton introuvable : ${text}`));
  const check = async what => { await sleep(900); for (const l of await leftovers(b)) if (!bad.has(l)) bad.set(l, what) };
  try {
    await b.size(375);
    await b.goto(srv.url); await b.evaluate(`localStorage.setItem("wb-lang", "en"); localStorage.setItem("wb-howto", "1"); location.reload(), true`);
    await b.waitFor("!!document.querySelector('.landing h1')"); await sleep(1500); await check("Accueil");
    await b.goto(srv.url + "jouer"); await b.waitFor("!!document.querySelector('#pseudo')"); await check("Inscription");
    await b.evaluate(`(() => { const i = document.querySelector("#pseudo"), set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "Testeur"); i.dispatchEvent(new Event("input", { bubbles: true })); return true })()`);
    await press("Enter", "form"); await b.waitFor("!!document.querySelector('.dock')", 120000); await sleep(4000);
    for (const v of ["Overview", "Stocks", "News", "Map", "Rumours", "Analysts"]) { await press(v); await check(`Market · ${v}`) }
    await press("Overview"); await sleep(600);
    await b.evaluate(`document.querySelector("main .p-row")?.click(), true`); await sleep(1500); await check("Fiche");
    await press("Invest", ".sheet.detail"); await sleep(800); await check("Achat d'actions");
    await b.evaluate(`document.querySelector(".sheet .x")?.click(), true`); await sleep(400);
    await b.evaluate(`document.querySelector("main .p-row")?.click(), true`); await sleep(1200);
    await press("▲ Up", ".sheet.detail"); await sleep(800); await check("Ticket");
    await press("▲ Up ×", ".sheet"); await sleep(2500); await check("Ordre passé");
    await b.evaluate(`window.__wbDemo.query("update profiles set xp = 9999 where not bot").then(() => window.__wbDemo.query("select guild_create('Les Baleines', 'BAL', null)")).then(() => true)`);
    await press("Market", ".dock"); await press("Stocks"); await check("Stocks");
    await press("Quests", ".dock"); await sleep(2500); await check("Quests");
    await press("Positions", ".dock"); await check("Positions");
    for (const v of ["Portfolio", "History"]) { await press(v); await check(`Positions · ${v}`) }
    await press("Guild", ".dock"); await sleep(1500); await check("Guild");
    await press("More", ".dock"); await check("Profile");
    for (const v of ["Leaderboard", "Achievements", "My account", "How to play", "Data sources", "Privacy"]) { await press("More", ".dock"); await press(v); await check(v) }
    await b.goto(srv.url + "jouer?demo=1"); await b.waitFor("!!document.querySelector('.intro-slide')", 30000); await check("Présentation de l'essai");
    await b.waitFor("!!document.querySelector('.trial-bar')", 120000); await check("Essai");
    await press("Guild", ".dock"); await check("Essai · guilde verrouillée");
  } finally { await b.close(); await srv.close() }
  const list = [...bad].map(([l, w]) => `${w} : ${l}`);
  assert.deepEqual(list, [], "textes restés en français");
});
