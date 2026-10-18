import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp, overflow } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Écran Succès sur téléphone (360, 375, 414 px) : rien ne dépasse à droite, ni la page ni un élément de l'écran.
// Sur GitHub (CI), pas de saut : sans Chrome, le test échoue.
test("écran Succès : aucun débordement horizontal à 360, 375 et 414 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch();
  try {
    await openApp(b, srv.url);
    // Quelques succès débloqués, dont un secret, pour que l'écran montre aussi les dates et les jauges.
    await b.evaluate(`window.__wbDemo.query("insert into aur_achievements (user_id, code) select p.id, a.code from profiles p, achievements a where not p.bot and a.code in ('FIRST_TRADE', 'NOCTAMBULE', 'GAIN_10K') on conflict do nothing").then(() => true)`);
    for (const w of [360, 375, 414]) {
      await b.size(w);
      await b.click("Plus", ".dock"); await sleep(500);
      await b.click("Succès", "main");
      await b.waitFor("!!document.querySelector('.ach-head')", 20000); await sleep(900);
      const o = await overflow(b);
      assert.ok(o.scroll <= o.client, `${w} px : la page fait ${o.scroll} px pour ${o.client} px`);
      const out = await b.evaluate("[...document.querySelectorAll('.talents *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + .5).map(e => e.className).slice(0, 5)");
      assert.deepEqual(out, [], `${w} px : éléments qui dépassent`);
      assert.match(await b.evaluate("document.querySelector('.ach-head p').textContent"), /^3 \/ 47 succès$/);
    }
  } finally { await b.close(); await srv.close() }
});
