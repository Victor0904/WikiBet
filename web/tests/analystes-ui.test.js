import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp, overflow } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Onglet Analystes sur téléphone : acheter un tuyau à la Gazette (devis, confirmation), le lire en grand, prendre position
// (ticket prérempli), le retrouver dans « Mes tuyaux » ; la fiche société mène à l'onglet filtré.
test("écran Analystes : achat d'un tuyau, prise de position, aucun débordement à 360 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 480000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch();
  const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`).then(ok => assert.ok(ok, `bouton introuvable : ${text}`));
  const fits = async what => {
    await sleep(700);
    const o = await overflow(b); assert.ok(o.scroll <= o.client, `${what} : la page fait ${o.scroll} px pour ${o.client} px`);
    const out = await b.evaluate("[...document.querySelectorAll('.ana *, .ana-sheet *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + .5).map(e => e.tagName + '.' + e.className).slice(0, 5)");
    assert.deepEqual(out, [], `${what} : éléments qui dépassent`);
  };
  try {
    await openApp(b, srv.url);
    await b.size(360);
    await b.waitFor("!!document.querySelector('.dock')", 60000);
    await b.waitFor("window.__wbDemo.query(\"select (state->'st'->'NXR'->'res'->>'act') is not null as ok from aur_state\").then(r => r.rows[0]?.ok)", 240000);
    await press("Analystes"); await b.waitFor("document.querySelectorAll('.ana-card').length === 6", 20000); await fits("liste");
    await b.evaluate("[...document.querySelectorAll('.ana-card')].find(c => c.textContent.includes('Gazette')).click(), true");
    await b.waitFor("/Acheter pour/.test(document.querySelector('.ana-sheet .btn.primary')?.textContent)", 20000); await fits("achat");
    await press("Acheter pour", ".ana-sheet"); await b.waitFor("/Confirmer/.test(document.querySelector('.ana-sheet .btn.primary').textContent)", 5000);
    await press("Confirmer", ".ana-sheet"); await b.waitFor("!!document.querySelector('.tuyau-big')", 20000); await fits("tuyau");
    assert.match(await b.evaluate("document.querySelector('.tuyau-big').textContent"), /Gazette/);
    const dir = await b.evaluate("document.querySelector('.ana-sheet .btn.primary').textContent");
    await press(dir.startsWith("Prendre") ? "Prendre position" : "Voir la société", ".ana-sheet"); await sleep(800);
    assert.ok(await b.evaluate("!!document.querySelector('.sheet')"), "ticket ou fiche ouverts");
    await b.evaluate("document.querySelector('.sheet .x')?.click(), true"); await sleep(500);
    await b.waitFor("document.querySelectorAll('.ana .tuyau').length === 1", 20000); await fits("mes tuyaux");
    // Fiche société → « Demander à un analyste » → onglet filtré sur la société.
    await press("Actions"); await sleep(500);
    await b.evaluate("document.querySelector('.srow-open[aria-label=\"Fiche de Granterre Agro\"]').click(), true");
    await b.waitFor("!!document.querySelector('.sheet.detail')", 10000);
    await press("Demander à un analyste", ".sheet.detail"); await sleep(800);
    assert.ok(await b.evaluate("!!document.querySelector('.ana')"), "onglet Analystes ouvert");
    assert.equal(await b.evaluate("document.querySelectorAll('.ana-card').length"), 2, "Granterre : Madame Météo et la Gazette");
  } finally { await b.close(); await srv.close() }
});
