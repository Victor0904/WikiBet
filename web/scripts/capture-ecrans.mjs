// Captures des écrans du jeu en démo, pour juger une refonte : `node scripts/capture-ecrans.mjs <dossier> [largeur] [écran…]`.
// Sans liste : tous les écrans. Les captures ne vont pas dans le dépôt.
import { demoServer, launch, openApp } from "../tests/browser.js";

const [out = ".", width = "375", ...only] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await demoServer(), b = await launch();
const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`);
const sql = q => b.evaluate(`window.__wbDemo.query(${JSON.stringify(q)}).then(() => true)`);
const home = async () => { await b.evaluate("location.reload(), true"); await sleep(1500); await b.waitFor("!!document.querySelector('.dock')", 60000); await sleep(1500) };
const SCREENS = {
  marche: async () => {},
  actions: () => press("Actions"),
  journal: () => press("Journal"),
  carte: () => press("Carte"),
  rumeurs: () => press("Rumeurs"),
  fiche: async () => { await press("Actions"); await sleep(600); await b.evaluate(`document.querySelector("main .srow-open")?.click(), true`); await sleep(1500) },
  ticket: async () => { await press("Actions"); await sleep(600); await b.evaluate(`document.querySelector("main .srow-open")?.click(), true`); await sleep(1200); await press("▲", ".sheet"); await sleep(1200) },
  positions: () => press("Positions", ".dock"),
  portefeuille: async () => { await press("Positions", ".dock"); await sleep(500); await press("Portefeuille") },
  historique: async () => { await press("Positions", ".dock"); await sleep(500); await press("Historique") },
  quetes: () => press("Quêtes", ".dock"),
  guilde: () => press("Guilde", ".dock"),
  classement: async () => { await press("Plus", ".dock"); await sleep(500); await press("Classements") },
  succes: async () => { await press("Plus", ".dock"); await sleep(500); await press("Succès") },
  compte: async () => { await press("Plus", ".dock"); await sleep(500); await press("Mon compte") },
  howto: async () => { await press("Plus", ".dock"); await sleep(500); await press("Comment jouer") },
};
try {
  await openApp(b, srv.url);
  // Un joueur qui a un peu joué : niveau, une position ouverte, un trade réglé, un pari du jour.
  await sql("update profiles set xp = 900 where not bot");
  await sql("insert into aur_pari (day, kind, tks, open_until, resolve_at) values (paris_date(now()), 'B', array['NXR', 'OMB', 'VLS'], now() + interval '2 hours', now() + interval '5 hours') on conflict do nothing");
  await sql(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, status, payout, fees, fee_open, created_at, closed_at, exit_at)
    select id, (select k from game_now()), 0, 'aurelys', 500, 'NXR', 'down', 5, 100, 99, 'won', 524, 2, 1, now() - interval '9 minutes', now(), now() from profiles where not bot`);
  await sleep(4000); // premiers cours de la démo
  await sql(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open, created_at)
    select id, (select k from game_now()), 0, 'aurelys', 800, 'OMB', 'up', 5, (select p * .998 from aur_ticks where tk = 'OMB' and t <= now() order by t desc limit 1), 4, 4, now() - interval '4 minutes' from profiles where not bot`);
  await sql("insert into h1_refunds (user_id, kind, item, amount) select id, 'logement', 'studio', 7200 from profiles where not bot");
  await b.size(+width, +width < 600 ? 812 : 900);
  for (const [name, go] of Object.entries(SCREENS)) {
    if (only.length && !only.includes(name)) continue;
    await home(); await go(); await sleep(1500);
    await b.shot(`${out}/${name}-${width}.png`, true);
  }
} finally { await b.close(); await srv.close() }
