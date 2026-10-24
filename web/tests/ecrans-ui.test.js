import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp, overflow, sticking } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Écrans principaux sur téléphone (360, 375, 414 px) : ni la page ni un élément ne dépasse à droite. Sur GitHub, pas de saut sans Chrome.
test("écrans principaux : aucun débordement horizontal à 360, 375 et 414 px", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 900000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch(), bad = [];
  const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`).then(ok => assert.ok(ok, `bouton introuvable : ${text}`));
  const check = async what => {
    await sleep(900); // fin des fondus
    const o = await overflow(b), s = await sticking(b);
    if (o.scroll > o.client || s.length) bad.push(`${what} (${o.client} px) : page ${o.scroll}/${o.client} px ${s.join(" ; ")}`);
  };
  const sql = q => b.evaluate(`window.__wbDemo.query(${JSON.stringify(q)}).then(() => true)`);
  try {
    await openApp(b, srv.url);
    // Une position réglée et un remboursement du QG dans l'historique (sans eux, l'écran s'arrête au message vide),
    // et le message de la refonte (H1), montré une fois.
    await sql(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, status, payout, fees, fee_open, created_at, closed_at, exit_at)
      select id, (select k from game_now()), 0, 'aurelys', 100, 'NXR', 'down', 10, 100, 99, 'won', 109, 2, 1, now() - interval '5 minutes', now(), now() from profiles where not bot`);
    await sql("insert into h1_refunds (user_id, kind, item, amount) select id, 'logement', 'villa', 360000 from profiles where not bot");
    await sql(`insert into notices (user_id, kind, body) select id, 'h1', '{"w": 787620, "bank": 325876, "level": 5}' from profiles where not bot`);
    // Un pari à trois sociétés (le plus long à afficher) et le niveau 20 (4 quêtes du jour).
    await sql("insert into aur_pari (day, kind, tks, open_until, resolve_at) values (paris_date(now()), 'B', array['NXR', 'OMB', 'VLS'], now() + interval '2 hours', now() + interval '5 hours') on conflict do nothing");
    await sql("update profiles set xp = (select xp from xp_curve where level = 20) where not bot");
    for (const w of [360, 375, 414]) {
      await b.size(w);
      await b.evaluate("location.reload(), true"); await sleep(1500); await b.waitFor("!!document.querySelector('.dock')", 60000);
      if (w === 360) { await b.waitFor("!!document.querySelector('.sheet')", 20000); await check("Message de la refonte"); await press("Compris", ".sheet") }
      for (const v of ["Aperçu", "Actions", "Journal", "Carte", "Rumeurs"]) { await press(v); await check(`Marché · ${v}`) }
      await press("Quêtes", ".dock"); await b.waitFor("!!document.querySelector('.quest-head')", 20000); await check("Quêtes");
      await press("Ligue"); await b.waitFor("!!document.querySelector('.lg-head')", 20000); await check("Ligue"); await press("Quêtes");
      await press("Positions", ".dock"); await check("Positions · en cours");
      await press("Historique");
      await b.waitFor("[...document.querySelectorAll('.history .hrow')].some(r => r.textContent.includes('Remboursement QG'))", 20000); // écran noir si History plante
      await check("Positions · historique");
      await press("Guilde", ".dock"); await check("Guilde");
      await press("Fonder une guilde"); await check("Guilde · fonder");
      await press("Plus", ".dock"); await check("Profil");
      for (const v of ["Ma page", "Modifier mon profil", "Classement", "Succès", "Mon compte", "Comment jouer", "Sources des données", "Confidentialité"]) {
        await press("Plus", ".dock"); await press(v); await check(v);
      }
    }
  } finally { await b.close(); await srv.close() }
  assert.deepEqual(bad, [], "écrans qui débordent");
});
