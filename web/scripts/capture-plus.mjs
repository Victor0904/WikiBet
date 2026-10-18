// Capture de l'écran Plus (page Profil) en démo, sur téléphone et sur grand écran : `node scripts/capture-plus.mjs [dossier]`.
// Sert à juger le rendu pendant une refonte (les captures ne vont pas dans le dépôt).
import { demoServer, launch, openApp } from "../tests/browser.js";

const out = process.argv[2] ?? ".";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await demoServer(), b = await launch();
try {
  await openApp(b, srv.url);
  // Un peu de vie : une guilde, un ami, un parrainage, des succès.
  await b.evaluate(`window.__wbDemo.query("update profiles set xp = 900 where not bot").then(() => window.__wbDemo.query("insert into aur_achievements (user_id, code) select p.id, a.code from profiles p, achievements a where not p.bot and a.code in ('FIRST_TRADE', 'FIRST_GREEN', 'GUILDE') on conflict do nothing")).then(() => true)`);
  for (const [w, h, name] of [[375, 812, "plus-375"], [1280, 900, "plus-1280"]]) {
    await b.size(w, h);
    await b.evaluate("location.reload(), true"); await sleep(1500); await b.waitFor("!!document.querySelector('.dock')", 60000);
    await b.click("Plus", ".dock"); await sleep(1500);
    await b.shot(`${out}/${name}.png`, true);
  }
} finally { await b.close(); await srv.close() }
