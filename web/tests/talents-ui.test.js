import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openTalents, forceTalents, overflow } from "./browser.js";

// Écran Talents sur téléphone : rien ne dépasse à droite, ni la page ni un élément de l'écran.
// Sur GitHub (CI), pas de saut : sans Chrome, le test échoue.
test("écrans Talents et Succès : aucun débordement horizontal à 375 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch();
  const check = async what => {
    const o = await overflow(b);
    assert.ok(o.scroll <= o.client, `${what} : la page fait ${o.scroll} px pour ${o.client} px`);
    const out = await b.evaluate("[...document.querySelectorAll('.talents *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + .5).map(e => e.className).slice(0, 5)");
    assert.deepEqual(out, [], `${what} : éléments qui dépassent`);
  };
  try {
    await b.size(375);
    await openTalents(b, srv.url);
    await check("niveau 0");
    await forceTalents(b);
    await check("points investis");
    for (const tab of ["Rente", "Information", "Audace"]) {
      await b.evaluate(`[...document.querySelectorAll(".tal-tabs button")].find(x => x.textContent.includes(${JSON.stringify(tab)})).click()`);
      await check(tab);
    }
    await b.click("Points gagnés via succès");
    await b.waitFor("!!document.querySelector('.ach-head')");
    await check("succès");
    assert.match(await b.evaluate("document.querySelector('.ach-head p').textContent"), /\/ 51 succès · \d+ \/ 36 points/);
  } finally { await b.close(); await srv.close() }
});
