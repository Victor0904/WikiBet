import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp, overflow } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Page de ma guilde (H7) sur téléphone : objectif en cours, membres, réglages du chef ouverts, objectifs passés, trophée.
test("écran Guilde (ma guilde, chef) : aucun débordement horizontal à 360, 375 et 414 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch();
  const sql = q => b.evaluate(`window.__wbDemo.query(${JSON.stringify(q)}).then(() => true)`);
  try {
    await openApp(b, srv.url);
    await sql("insert into guilds (name, tag, motto, owner, xp, banner, emblem, descr) select 'Les Taureaux du Nord', 'TAUR', 'On trade la météo, la pluie et le beau temps', id, 9000, 3, 10, 'Une guilde pour ceux qui lisent le Courrier avant de trader.' from profiles where not bot");
    await sql("insert into guild_members (user_id, guild_id, joined_at) select p.id, g.id, now() - interval '20 days' from profiles p, guilds g where not p.bot and g.tag = 'TAUR'");
    await sql("select guild_lock(paris_week(now()), now())");
    await sql(`insert into guild_goals (guild_id, week, members, level, min, target, total, status, xp)
      select id, paris_date(paris_week(now()) - interval '7 days'), 1, 6, 300, 1500, -1234567, 'missed', 0 from guilds where tag = 'TAUR'`);
    await sql("insert into guild_trophies (guild_id, month, rank) select id, date_trunc('month', now() - interval '1 month')::date, 2 from guilds where tag = 'TAUR'");
    for (const w of [360, 375, 414]) {
      await b.size(w);
      await b.click("Guilde", ".dock");
      await b.waitFor("!!document.querySelector('.g-goal')", 20000);
      await b.evaluate("document.querySelector('.g-chef').open = true, true"); await sleep(900);
      const o = await overflow(b);
      assert.ok(o.scroll <= o.client, `${w} px : la page fait ${o.scroll} px pour ${o.client} px`);
      const out = await b.evaluate("[...document.querySelectorAll('.guilds *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + .5).map(e => e.tagName + '.' + e.className).slice(0, 5)");
      assert.deepEqual(out, [], `${w} px : éléments qui dépassent`);
      await b.click("Marché", ".dock"); await sleep(300);
    }
  } finally { await b.close(); await srv.close() }
});
