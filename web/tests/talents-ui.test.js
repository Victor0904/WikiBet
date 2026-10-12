import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openTalents, forceTalents, overflow } from "./browser.js";

// Écran Talents sur téléphone : rien ne dépasse à droite, ni la page ni un élément de l'écran.
test("écran Talents : aucun débordement horizontal à 375 px", { skip: !chromePath() && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
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
  } finally { await b.close(); await srv.close() }
});
