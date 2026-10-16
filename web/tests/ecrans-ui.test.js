import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp, overflow, sticking } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Écrans principaux sur téléphone (375 px) : ni la page ni un élément ne dépasse à droite. Sur GitHub, pas de saut sans Chrome.
test("écrans principaux : aucun débordement horizontal à 375 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 400000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch(), bad = [];
  const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`).then(ok => assert.ok(ok, `bouton introuvable : ${text}`));
  const check = async what => {
    await sleep(900); // fin des fondus
    const o = await overflow(b), s = await sticking(b);
    if (o.scroll > o.client || s.length) bad.push(`${what} : page ${o.scroll}/${o.client} px ${s.join(" ; ")}`);
  };
  try {
    await b.size(375);
    await openApp(b, srv.url);
    for (const v of ["Tableau de bord", "Journal", "Carte", "Rumeurs"]) { await press(v); await check(`Marché · ${v}`) }
    await press("Actions", ".dock"); await check("Actions");
    await press("Positions", ".dock"); await check("Positions · en cours");
    // Une position réglée dans l'historique (sans elle, l'écran s'arrête au message vide et ne teste rien).
    await b.evaluate(`window.__wbDemo.query("insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, status, payout, fees, fee_open, created_at, closed_at, exit_at) select id, (select k from game_now()), 0, 'aurelys', 100, 'NXR', 'down', 10, 100, 99, 'won', 109, 2, 1, now() - interval '5 minutes', now(), now() from profiles where not bot").then(() => true)`);
    await b.evaluate("location.reload(), true"); await sleep(1500); await b.waitFor("!!document.querySelector('.dock')", 60000); // relit les paris
    await press("Positions", ".dock"); await press("Historique");
    await b.waitFor("!!document.querySelector('.history .hrow')", 20000); // écran noir si History plante
    await check("Positions · historique");
    await press("QG", ".dock"); await check("QG");
    for (const v of ["Banque", "Talents"]) { await press(v); await check(`QG · ${v}`) }
    await press("Plus", ".dock"); await check("Profil");
    for (const v of ["Classement", "Mon compte", "Comment jouer", "Sources des données"]) {
      await press("Plus", ".dock"); await press(v); await check(v);
    }
  } finally { await b.close(); await srv.close() }
  assert.deepEqual(bad, [], "écrans qui débordent");
});
