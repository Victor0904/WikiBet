// Captures des écrans du jeu en démo, pour juger une refonte : `node scripts/capture-ecrans.mjs <dossier> [largeur] [écran…]`.
// Sans liste : tous les écrans. Les captures ne vont pas dans le dépôt.
import { demoServer, launch, openApp } from "../tests/browser.js";

const [out = ".", width = "375", ...only] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await demoServer(), b = await launch();
const press = (text, scope = "main") => b.evaluate(`(() => { const x = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); x?.click(); return !!x })()`);
const sql = q => b.evaluate(`window.__wbDemo.query(${JSON.stringify(q)}).then(() => true)`);
const home = async () => { await b.evaluate("location.reload(), true"); await sleep(1500); await b.waitFor("!!document.querySelector('.dock')", 60000); await sleep(1500) };
const profil = async () => {
  await sql("insert into aur_achievements (user_id, code) select p.id, a.code from profiles p, achievements a where not p.bot and a.code in ('FIRST_TRADE', 'SERIE_10', 'GAIN_10K', 'LECTEUR') on conflict do nothing");
  await sql("update profiles set division = 6, avatar = 'eclair:3', title = 'imbattable', pins = array['SERIE_10', 'FIRST_TRADE', 'GAIN_10K'] where not bot");
  await sql("insert into quest_chests (user_id, week) select id, current_date from profiles where not bot on conflict do nothing");
  await home();
};
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
  // Groupe de ligue de 12 joueurs (Or 2), dont le joueur, et une saison passée.
  ligue: async () => {
    await sql(`with u as (insert into auth.users select gen_random_uuid() from generate_series(1, 11) returning id),
      p as (insert into profiles (id, pseudo, division) select id, 'Trader' || row_number() over (), 7 from u returning id)
      insert into bets (user_id, session, day, kind, stake, status, payout, fee_open, aur, dir, lev, entry, created_at, closed_at)
      select p.id, 0, 0, 'aurelys', 1000, 'won', 1000 + (random() * 3000 - 1000)::int, 0, 'SLM', 'up', 1, 10, now() - interval '1 hour', now() - interval '50 minutes' from p, generate_series(1, 5)`);
    await sql("update profiles set division = 7 where not bot");
    await sql("select league_enter(user_id) from (select distinct user_id from bets) b");
    await sql(`insert into league_members (week, user_id, group_id, division, rank, n, move, eligible, reward, div_after, ret)
      select paris_date(paris_week(now()) - interval '7 days'), p.id, (select min(id) from league_groups), 6, 3, 41, 1, true, 550, 7, .084 from profiles p where not bot`);
    await press("Quêtes", ".dock"); await sleep(600); await press("Ligue");
  },
  guilde: () => press("Guilde", ".dock"),
  // Membre (et chef) d'une guilde de niveau 4 avec un objectif en cours et un objectif passé.
  "guilde-ma": async () => {
    await sql(`insert into guilds (name, tag, motto, owner, xp, banner, emblem) select 'Les Taureaux', 'TAU', 'On trade la météo', id, 4200, 2, 6 from profiles where not bot on conflict do nothing`);
    await sql("insert into guild_members (user_id, guild_id, joined_at) select p.id, g.id, now() - interval '20 days' from profiles p, guilds g where not p.bot and g.tag = 'TAU' on conflict do nothing");
    await sql("select guild_lock(paris_week(now()), now())");
    await sql(`insert into guild_goals (guild_id, week, members, level, min, target, total, status, xp)
      select id, paris_date(paris_week(now()) - interval '7 days'), 1, 3, 240, 480, 512, 'reached', 70 from guilds where tag = 'TAU' on conflict do nothing`);
    await press("Guilde", ".dock"); await sleep(1500);
  },
  // Profil (H2) : avatar, titre, 3 trophées épinglés, ligue Or 1, un coffre à ouvrir.
  "ma-page": async () => { await profil(); await press("Plus", ".dock"); await sleep(500); await press("Ma page") },
  "edit-profil": async () => { await profil(); await press("Plus", ".dock"); await sleep(500); await press("Modifier mon profil") },
  classement: async () => { await press("Plus", ".dock"); await sleep(500); await press("Classements") },
  succes: async () => { await press("Plus", ".dock"); await sleep(500); await press("Succès") },
  compte: async () => { await press("Plus", ".dock"); await sleep(500); await press("Mon compte") },
  howto: async () => { await press("Plus", ".dock"); await sleep(500); await press("Comment jouer") },
  investir: async () => { await press("Actions"); await sleep(600); await b.evaluate(`document.querySelector("main .srow-open")?.click(), true`); await sleep(1200); await press("Investir", ".sheet"); await sleep(1200) },
  cloture: async () => { await press("Positions", ".dock"); await sleep(800); await press("Clôturer pour"); await sleep(1200) },
  amis: async () => { await press("Plus", ".dock"); await sleep(500); await press("Amis") },
  sources: async () => { await press("Plus", ".dock"); await sleep(500); await press("Sources des données") },
  confidentialite: async () => { await press("Plus", ".dock"); await sleep(500); await press("Confidentialité") },
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
  await sql("insert into aur_holdings (user_id, tk, qty, cost) select id, tk, q, q * c from profiles, (values ('NXR', 12, 130), ('GTR', 80, 23), ('LMR', 50, 17.5)) v(tk, q, c) where not bot");
  await sql("insert into h1_refunds (user_id, kind, item, amount) select id, 'logement', 'studio', 7200 from profiles where not bot");
  await b.size(+width, +width < 600 ? 812 : 900);
  for (const [name, go] of Object.entries(SCREENS)) {
    if (only.length && !only.includes(name)) continue;
    await home(); await go(); await sleep(1500);
    await b.shot(`${out}/${name}-${width}.png`, true);
  }
} finally { await b.close(); await srv.close() }
