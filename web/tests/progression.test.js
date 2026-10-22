// H3 (niveaux, XP, levier), H4 (quêtes), H5 (pari du jour) : 20261028400000_niveaux_quetes.sql, 20261028500000_pari_du_jour.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrateFrom, login } from "./db.js";
import { XP_TOTAL, MAX_LEVEL, QUESTS, LEV_LEVEL, LEV_DIVISION, maxPosOf, levelOf } from "../supabase/functions/_shared/progression.js";
import { calendar, BY } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
const one = async (db, sql, args) => (await db.query(sql, args)).rows[0];
const xpOf = async (db, id) => (await one(db, "select xp from profiles where id = $1", [id])).xp;
const tick = (db, tk, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ($1, now() - make_interval(secs => $2), $3)", [tk, ago, p]);
const setXp = (db, id, level) => db.query("update profiles set xp = $2 where id = $1", [id, XP_TOTAL[level]]);
// Trade valide clôturé il y a `ago` minutes : mise, levier, sens, gain net et durée (s) au choix.
const trade = (db, u, { tk = "NXR", stake = 100, lev = 1, dir = "up", gain = 10, held = 200, ago = 1, sl = null } = {}) => db.query(
  `insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, fees, fee_open, status, payout, sl, created_at, closed_at)
   values ($1, 0, 0, 'aurelys', $2, $3, $4, $5, 10, 10, 0, 0, case when $6::float8 > 0 then 'won' else 'lost' end, $2 + $6::float8, $8,
           now() - make_interval(mins => $9) - make_interval(secs => $7), now() - make_interval(mins => $9))`, [u, stake, tk, dir, lev, gain, held, sl, ago]);

test("progression : la base et progression.js disent la même chose (courbe, quêtes, paliers, calendrier des résultats)", async () => {
  const db = await freshDb();
  const curve = (await db.query("select level, xp from xp_curve order by level")).rows;
  assert.equal(curve.length, MAX_LEVEL);
  assert.deepEqual(curve.map(r => r.xp), XP_TOTAL.slice(1));
  const defs = (await db.query("select code, period, tier, goal, needs, text from quest_defs order by code")).rows;
  assert.deepEqual(defs, [...QUESTS].sort((a, b) => a.code < b.code ? -1 : 1).map(q => ({ ...q })));
  assert.ok(QUESTS.length >= 30, "au moins 30 quêtes");
  for (const v of [1, 2, 5, 10, 15, 20]) {
    assert.equal((await one(db, "select lev_level($1) n", [v])).n, LEV_LEVEL[v]);
    assert.equal((await one(db, "select lev_division($1) n", [v])).n, LEV_DIVISION[v] ?? 0);
  }
  await login(db, A, "alice");
  for (const l of [1, 2, 5, 12, 20, 25, 40, 60]) {
    await setXp(db, A, l);
    assert.equal((await one(db, "select trader_level($1) n", [A])).n, l);
    assert.equal(levelOf(XP_TOTAL[l]), l);
    assert.equal((await one(db, "select aur_max_pos($1) n", [A])).n, maxPosOf(l));
  }
  // Résultats entre 14 h et 20 h : même calendrier que le moteur.
  const t0 = Date.UTC(2026, 9, 20, 12), t1 = Date.UTC(2026, 9, 20, 18);
  const js = [...new Set(calendar(t0 / 1000 - 1, 400).filter(e => e.kind === "resultats" && e.at >= t0 && e.at <= t1 && BY[e.tk]).map(e => e.tk))].sort();
  const sql = (await db.query("select x from results_between(to_timestamp($1), to_timestamp($2)) x order by x", [t0 / 1000, t1 / 1000])).rows.map(r => r.x);
  assert.ok(js.length >= 3);
  assert.deepEqual(sql, js);
});

test("XP : une clé ne paie qu'une fois, pas d'XP pour les bots, bandeau de niveau, tutoriel = niveau 2", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await login(db, C, "robot");
  await db.query("update profiles set bot = true where id = $1", [C]);
  assert.equal((await one(db, "select xp_grant($1, 'test', 'k', 30) ok", [A])).ok, true);
  assert.equal((await one(db, "select xp_grant($1, 'test', 'k', 30) ok", [A])).ok, false);
  assert.equal(await xpOf(db, A), 30);
  assert.equal((await one(db, "select xp_grant($1, 'test', 'k', 30) ok", [C])).ok, false);
  await login(db, A);
  await db.query("select tuto_done('howto')"); await db.query("select tuto_done('howto')");
  await tick(db, "NXR", 2, 100);
  await db.query("select aur_open($1, 'NXR', 'up', 1, 100, 0)", [A]); // premier ordre
  assert.equal(await xpOf(db, A), 30 + 10 + 20);
  assert.equal((await one(db, "select trader_level($1) n", [A])).n, 2);
  assert.deepEqual((await db.query("select body from notices where user_id = $1 and kind = 'level'", [A])).rows.map(r => r.body), [{ from: 1, to: 2 }]);
  await assert.rejects(db.query("select tuto_done('triche')"), /inconnue/);
});

test("niveau de départ (H1) converti en XP : le niveau ne bouge pas, et ne baisse jamais", async () => {
  const db = await freshDb({ until: "20261028400000" });
  await login(db, A, "alice"); await login(db, B, "bruno");
  await db.query("update profiles set lvl_floor = 5 where id = $1", [A]);
  await migrateFrom(db, "20261028400000");
  assert.equal(await xpOf(db, A), XP_TOTAL[5]);
  assert.equal(await xpOf(db, B), 0);
  assert.equal((await one(db, "select trader_level($1) n", [A])).n, 5);
  await db.query("update profiles set xp = 0 where id = $1", [A]); // même si l'XP disparaissait, le plancher tient
  assert.equal((await one(db, "select trader_level($1) n", [A])).n, 5);
});

test("levier = min(société, niveau, ligue) ; une position ouverte n'est jamais touchée ; positions, ordres à déclenchement, guilde", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e7 where id = $1", [A]);
  await tick(db, "NXR", 2, 100);
  const open = lev => db.query("select aur_open($1, 'NXR', 'up', $2, 100, 0)", [A, lev]);
  await open(1);
  await assert.rejects(open(2), /débloqué au niveau 2 \(tu es niveau 1\)/);
  await setXp(db, A, 12); await open(10);
  await assert.rejects(open(15), /débloqué au niveau 25/);
  await setXp(db, A, 40);
  await assert.rejects(open(15), /ligue Platine 1/, "×15 : la ligue manque (H6)");
  await assert.rejects(open(20), /ligue Diamant 1/);
  // Ligue retirée : une position ×15 déjà ouverte reste ouverte et se clôture normalement.
  const { rows: [old] } = await db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open)
    values ($1, 0, 0, 'aurelys', 100, 'NXR', 'up', 15, 100, 0, 0) returning id`, [A]);
  await tick(db, "NXR", 1, 101);
  const c = await one(db, "select status from aur_close($1, $2, 0)", [A, old.id]);
  assert.equal(c.status, "won");
  // Plafond de la société : jeune pousse ×5.
  await db.query("update aur_stocks set status = 'listed' where tk = 'SLM'"); await tick(db, "SLM", 1, 10);
  await assert.rejects(db.query("select aur_open($1, 'SLM', 'up', 10, 100, 0)", [A]), /Jeune pousse/);
  // Positions selon le niveau, ordres à déclenchement au niveau 10, guilde au niveau 8.
  await setXp(db, A, 1);
  assert.equal((await one(db, "select aur_max_pos($1) n", [A])).n, 5);
  await login(db, A);
  await assert.rejects(db.query("select aur_trigger_add('NXR', 'up', 1, 100, 90)"), /niveau 10/);
  await assert.rejects(db.query("select guild_create('Les Taureaux', 'TOR')"), /niveau 8/);
  await setXp(db, A, 10);
  await db.query("select aur_trigger_add('NXR', 'up', 1, 100, 90)");
  await db.query("select guild_create('Les Taureaux', 'TOR')");
  const t = (await one(db, "select my_terms() t")).t;
  assert.equal(t.level, 10); assert.equal(t.max_lev, 5); assert.equal(t.triggers, true); assert.equal(t.max_pos, 9);
});

test("semaine et jour à l'heure de Paris, changement d'heure du 25 octobre 2026 compris", async () => {
  const db = await freshDb();
  const w = async ts => (await one(db, "select paris_week($1::timestamptz) w, paris_week_end($1::timestamptz) e, paris_date($1::timestamptz) d", [ts]));
  const sun = await w("2026-10-25T22:30:00Z"); // dimanche 23:30, heure d'hiver
  assert.equal(sun.w.toISOString(), "2026-10-18T22:00:00.000Z"); // lundi 19, 0 h heure d'été
  assert.equal(sun.e.toISOString(), "2026-10-25T23:00:00.000Z"); // lundi 26, 0 h heure d'hiver : semaine de 169 h
  const mon = await w("2026-10-25T23:30:00Z"); // lundi 0:30
  assert.equal(mon.w.toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal((await w("2026-10-25T21:59:00Z")).d.toISOString().slice(0, 10), "2026-10-25");
  await login(db, A, "alice");
  const keys = async ts => (await db.query("select distinct pkey from quests_of($1, $2::timestamptz) where period = 'week'", [A, ts])).rows.map(r => r.pkey);
  assert.deepEqual(await keys("2026-10-25T22:30:00Z"), ["w2026-10-19"]);
  assert.deepEqual(await keys("2026-10-25T23:30:00Z"), ["w2026-10-26"]);
});

test("quêtes : même tirage pour tous, filtré (guilde, ×10), 4e quête au niveau 20, progression et XP une seule fois, coffre", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await login(db, B, "bruno");
  const of = async u => (await db.query("select code, period, tier from quests_of($1)", [u])).rows;
  assert.deepEqual(await of(A), await of(B), "même jour, mêmes conditions : mêmes quêtes");
  const qa = await of(A);
  assert.deepEqual(qa.map(q => q.period + q.tier), ["dayeasy", "daymedium", "dayhard", "weekeasy", "weekmedium", "weekhard"]);
  assert.ok(!qa.some(q => ["guild_win", "w_guild_10", "lev10_win"].includes(q.code)), "ni guilde ni ×10 sans y avoir accès");
  await setXp(db, A, 20);
  assert.equal((await of(A)).filter(q => q.period === "day").length, 4);
  // Beaucoup de trades valides : toutes les quêtes de trading sont faites ; vérifier deux fois ne paie qu'une fois.
  for (const [i, tk] of ["NXR", "GTR", "HLV", "LMR", "PXF", "SLM", "OMB", "FRC", "BCS", "KST", "MRV", "VLS"].entries())
    for (let k = 0; k < 4; k++) await trade(db, A, { tk, gain: 20, held: 2000, lev: k % 2 ? 1 : 2, dir: k % 2 ? "up" : "down", sl: 5, ago: 1 + i });
  await db.query("select quests_check($1)", [A]);
  const done = (await db.query("select code from quest_done where user_id = $1", [A])).rows.map(r => r.code);
  const mine = await of(A);
  for (const q of mine) {
    const p = (await one(db, "select quest_progress($1, $2, q.t0, q.t1) n from quests_of($1) q where q.code = $2", [A, q.code])).n;
    assert.equal(done.includes(q.code), p >= QUESTS.find(x => x.code === q.code).goal, `${q.code} : ${p}`);
  }
  // Pas de minimum : le tirage dépend de la date, et certains jours peu de quêtes se font par des trades
  // (lecture, achat, pari, résultats…). La boucle ci-dessus vérifie déjà chaque quête tirée.
  const xp1 = await xpOf(db, A);
  await db.query("select quests_check($1)", [A]); await db.query("select quests_check($1)", [A]);
  assert.equal(await xpOf(db, A), xp1, "rejouer ne double rien");
  const fromQuests = (await one(db, "select coalesce(sum(amount), 0)::int s from xp_log where user_id = $1 and source = 'quest'", [A])).s;
  const expect = mine.filter(q => done.includes(q.code)).reduce((a, q) => a + ({ day: { easy: 30, medium: 50, hard: 80 }, week: { easy: 150, medium: 250, hard: 400 } })[q.period][q.tier], 0);
  assert.equal(fromQuests, expect);
  // Coffre : les 3 quêtes de la semaine.
  const week = mine.filter(q => q.period === "week").map(q => q.code);
  const chest = (await one(db, "select count(*)::int n from quest_chests where user_id = $1", [A])).n;
  assert.equal(chest, week.every(c => done.includes(c)) ? 1 : 0);
  // Écran.
  await login(db, A);
  const s = (await one(db, "select my_quests() s")).s;
  assert.equal(s.level, levelOf(await xpOf(db, A)));
  assert.equal(s.quests.length, 7);
  assert.ok(s.quests.every(q => q.cur <= q.goal));
});

test("quêtes : chaque type compte ce qu'il dit (lectures, stop, achat, actualité puis trade, résultats, ×10)", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const p = async code => (await one(db, "select quest_progress($1, $2, now() - interval '1 day', now() + interval '1 minute') n", [A, code])).n;
  await trade(db, A, { stake: 99 }); await trade(db, A, { held: 100 }); // ni l'un ni l'autre n'est valide
  assert.equal(await p("trade_1"), 0);
  await trade(db, A, { tk: "GTR", dir: "down", held: 700, gain: 15 }); await trade(db, A, { tk: "HLV", gain: -5, lev: 10 }); await trade(db, A, { lev: 10, gain: 5, sl: 1 });
  assert.equal(await p("trade_5"), 3); assert.equal(await p("win_3"), 2); assert.equal(await p("trade_3co"), 3);
  assert.equal(await p("real_3"), 2); assert.equal(await p("short_1"), 1); assert.equal(await p("hold_10"), 1); assert.equal(await p("hold_30"), 0);
  assert.equal(await p("gain_10"), 1); assert.equal(await p("lev10_win"), 1); assert.equal(await p("w_stop_5"), 1); assert.equal(await p("w_days_3"), 1);
  // Lecture puis trade de la même société dans l'heure.
  await db.query("insert into aur_news (id, t, tk, sector, cat, title, body, sent, fiab) values (1, now() - interval '5 minutes', 'OMB', 'sante', 'pdg', 'x', 'x', 0, 1)");
  await login(db, A);
  await db.query("select article_read(1)");
  assert.equal(await p("read_2"), 1);
  await tick(db, "OMB", 1, 50); await db.query("select aur_open($1, 'OMB', 'up', 1, 100, 0)", [A]);
  assert.equal(await p("news_trade"), 1);
  // Stop posé, achat d'actions.
  const b = await one(db, "select id from bets where user_id = $1 and status = 'open'", [A]);
  await db.query("select aur_set_auto($1, null, 60)", [b.id]);
  assert.equal(await p("stop_1"), 1);
  await db.query("select aur_buy($1, 'OMB', 100, 0)", [A]);
  assert.equal(await p("invest_1"), 1);
});

test("série : jours de suite avec une quête, un jour pardonné par semaine, bonus une fois par série", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const days = ds => db.query("delete from quest_done").then(() => Promise.all(ds.map(d => db.query("insert into quest_done (user_id, pkey, code) values ($1, $2, 'trade_1')", [A, d]))));
  const st = async today => (await one(db, "select * from quest_streak($1, $2::date)", [A, today]));
  await days(["2026-10-19", "2026-10-20", "2026-10-22"]);               // mercredi 21 pardonné
  assert.equal((await st("2026-10-22")).len, 3);
  assert.equal((await st("2026-10-23")).len, 3, "le jour en cours ne casse rien");
  await days(["2026-10-16", "2026-10-17", "2026-10-19", "2026-10-20", "2026-10-22"]); // un pardon par semaine
  assert.equal((await st("2026-10-22")).len, 5);
  await days(["2026-10-19", "2026-10-22"]);                               // deux jours manqués la même semaine
  assert.equal((await st("2026-10-22")).len, 1);
  // Bonus de 3 jours, une seule fois.
  const today = (await one(db, "select paris_date(now()) d")).d.toISOString().slice(0, 10);
  const back = n => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
  await days([back(2), back(1), today]);
  await db.query("select quests_check($1)", [A]); await db.query("select quests_check($1)", [A]);
  assert.deepEqual((await db.query("select key, amount from xp_log where user_id = $1 and source = 'streak'", [A])).rows, [{ key: back(2) + ":3", amount: 50 }]);
});

test("pari du jour : créé à 8 h, vote au cours frais, une fois ; répartition après le vote ; résolution juste, fausse ou annulée", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await login(db, B, "bruno"); await login(db, C, "carla");
  const d = (await one(db, "select paris_date(now()) d")).d;
  const at = h => one(db, "select paris_day_start(paris_date(now())) + make_interval(secs => $1) t", [h * 3600]).then(r => r.t);
  await db.query("select pari_tick($1)", [await at(7.9)]);
  assert.equal((await one(db, "select count(*)::int n from aur_pari")).n, 0, "pas avant 8 h");
  await db.query("select pari_tick($1)", [await at(8)]); await db.query("select pari_tick($1)", [await at(9)]);
  assert.equal((await one(db, "select count(*)::int n from aur_pari")).n, 1, "un seul pari par jour");
  // Le test vote maintenant : on force un pari de type A ouvert, sur NXR.
  await db.query("update aur_pari set kind = 'A', tks = array['NXR'], open_until = now() + interval '1 hour', resolve_at = now() + interval '2 hours'");
  await login(db, A);
  await assert.rejects(db.query("select pari_vote('up')"), /indisponible/, "pas de cours frais : pas de vote");
  await db.query("insert into aur_ticks (tk, t, p) values ('NXR', now() - interval '2 hours', 100)"); // vieux cours : toujours pas frais
  await assert.rejects(db.query("select pari_vote('up')"), /indisponible/);
  await tick(db, "NXR", 2, 100);
  assert.equal((await one(db, "select my_pari() p")).p.dist, null, "répartition cachée avant de voter");
  const r = (await one(db, "select pari_vote('up') p")).p;
  assert.deepEqual(r.dist, { up: 1 }); assert.deepEqual(r.mine.ref, { NXR: 100 });
  await assert.rejects(db.query("select pari_vote('down')"), /déjà voté/);
  await login(db, B); await db.query("select pari_vote('down')");
  await login(db, C); await tick(db, "NXR", 1, 100.18); await db.query("select pari_vote('up')");
  // 20 h : pas encore de cours après l'heure → on attend ; on ne résout jamais sur un vieux cours.
  await db.query("update aur_pari set resolve_at = now() - interval '0.5 seconds'");
  await db.query("select pari_tick()");
  assert.equal((await one(db, "select status from aur_pari")).status, "open");
  await tick(db, "NXR", 0, 100.2); // premier vrai cours après 20 h
  await db.query("select pari_tick()"); await db.query("select pari_tick()");
  const v = Object.fromEntries((await db.query("select user_id, result from aur_pari_vote")).rows.map(x => [x.user_id, x.result]));
  assert.deepEqual([v[A], v[B], v[C]], ["right", "wrong", "void"], "Carla : +0,02 %, sous 0,05 % : annulé");
  const pari = (await db.query("select user_id, key, amount from xp_log where source = 'pari' order by user_id, key")).rows;
  assert.deepEqual(pari.filter(x => x.user_id === A).map(x => x.amount), [25, 10]);
  assert.deepEqual(pari.filter(x => x.user_id === B).map(x => x.amount), [10]);
  assert.equal((await one(db, "select status from aur_pari")).status, "resolved");
  assert.ok(d);
});

test("pari du jour : annulé sans cours frais 30 min après 20 h ; 3 bonnes réponses d'affilée = +40", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const mk = (day, res) => db.query(`insert into aur_pari (day, kind, tks, open_until, resolve_at) values ($1, 'A', array['NXR'], now(), now() - make_interval(mins => $2)) returning id`, [day, res]);
  const { rows: [p0] } = await mk("2026-10-01", 31);
  await db.query("insert into aur_pari_vote (user_id, pari_id, choice, ref) values ($1, $2, 'up', '{\"NXR\": 100}')", [A, p0.id]);
  await db.query("select pari_tick()");
  assert.equal((await one(db, "select status from aur_pari where id = $1", [p0.id])).status, "void");
  assert.equal((await one(db, "select result from aur_pari_vote where pari_id = $1", [p0.id])).result, "void");
  // Trois paris justes de suite (le vote annulé au milieu ne casse pas la série).
  for (const day of ["2026-10-02", "2026-10-03", "2026-10-04"]) {
    const { rows: [p] } = await mk(day, 1);
    await db.query("insert into aur_pari_vote (user_id, pari_id, choice, ref) values ($1, $2, 'up', '{\"NXR\": 100}')", [A, p.id]);
  }
  await db.query("insert into aur_ticks (tk, t, p) values ('NXR', now() - interval '30 seconds', 101)");
  await db.query("select pari_tick()");
  assert.deepEqual((await db.query("select key, amount from xp_log where user_id = $1 and key like '%three'", [A])).rows.map(r => r.amount), [40]);
  assert.equal((await one(db, "select count(*)::int n from aur_pari_vote where result = 'right'")).n, 3);
});
