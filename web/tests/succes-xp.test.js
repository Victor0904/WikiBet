// H8 : les succès rapportent de l'XP de trader (0 point → 25, 1 → 75, 2 → 150), une seule fois, rétroactivement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrateFrom, login } from "./db.js";
import { XP } from "../supabase/functions/_shared/progression.js";

const A = "00000000-0000-0000-0000-000000000010";
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const xp = async db => (await one(db, "select xp from profiles where id = $1", [A])).xp;
const has = async (db, code) => (await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = $2", [A, code])).n;

test("succès en XP : barème partagé, une seule fois, total des trophées borné", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  for (const p of [0, 1, 2]) assert.equal((await one(db, "select ach_xp($1) x", [p])).x, XP.ach[p]);
  const x0 = await xp(db);
  assert.equal((await one(db, "select achievement_grant($1, 'FIRST_TRADE') ok", [A])).ok, true);
  assert.equal(await xp(db) - x0, 75);
  await db.query("select achievement_grant($1, 'FIRST_TRADE')", [A]);
  assert.equal(await xp(db) - x0, 75, "rejouer ne double rien");
  // Remplace « 21 points au plus » : tous les trophées réunis valent moins de 4 000 XP (niveau 15 environ), pour que la
  // courbe d'XP reste calée sur les quêtes (scripts/sim-xp.mjs compte ~300 XP de succès la 1re semaine, puis ~60).
  const tot = (await one(db, "select sum(ach_xp(points))::int t, count(*)::int n from achievements"));
  assert.ok(tot.t <= 4000, `total ${tot.t} XP`); assert.equal(tot.n, 64);
  const easy = (await one(db, `select sum(ach_xp(points))::int t from achievements
    where code in ('FIRST_TRADE', 'FIRST_GREEN', 'GUILDE', 'SALAIRE', 'DIVERSIFIE', 'LECTEUR', 'SCALPEUR', 'TOP_100')`)).t;
  assert.ok(easy >= 200 && easy <= 400, `succès d'une 1re semaine : ${easy} XP`);
  assert.equal(await has(db, "GUILDE_TOP3"), 0);
  assert.equal((await one(db, "select count(*)::int n from achievements where code = 'GUILDE_TOP3'")).n, 0);
});

test("succès en XP : niveaux 10, 25, 50 à la montée de niveau, jamais pour un bot", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("select xp_grant($1, 'test', 'n10', (select xp from xp_curve where level = 10))", [A]);
  assert.equal(await has(db, "NIVEAU_10"), 1); assert.equal(await has(db, "NIVEAU_25"), 0);
  await db.query("select xp_grant($1, 'test', 'n50', (select xp from xp_curve where level = 50))", [A]);
  assert.equal(await has(db, "NIVEAU_25"), 1); assert.equal(await has(db, "NIVEAU_50"), 1);
  const bot = "00000000-0000-0000-0000-000000000011";
  await login(db, bot, "robot"); await db.query("update profiles set bot = true where id = $1", [bot]);
  assert.equal((await one(db, "select achievement_grant($1, 'NIVEAU_10') ok", [bot])).ok, false);
});

test("succès en XP : pari du jour (3 d'affilée, 10 au total), série de quêtes", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const vote = (d, result) => db.query(`with p as (insert into aur_pari (day, kind, tks, open_until, resolve_at, status)
      values (current_date - $1::int, 'A', array['SLM'], now(), now(), 'resolved') returning id)
    insert into aur_pari_vote (user_id, pari_id, choice, ref, result) select $2, id, 'up', '{}', $3 from p`, [d, A, result]);
  await vote(5, "right"); await vote(4, "wrong"); await vote(3, "right"); await vote(2, "void"); await vote(1, "right");
  await db.query("select ach_pari($1)", [A]);
  assert.equal(await has(db, "PARI_3"), 0, "2 d'affilée seulement (le vote annulé ne compte pas)");
  await vote(0, "right"); await db.query("select ach_pari($1)", [A]);
  assert.equal(await has(db, "PARI_3"), 1); assert.equal(await has(db, "PARI_10"), 0);
  for (let d = 6; d < 12; d++) await vote(d, "right");
  await db.query("select ach_pari($1)", [A]);
  assert.equal(await has(db, "PARI_10"), 1);
  // 7 jours de suite avec une quête du jour réussie.
  for (let d = 0; d < 7; d++) await db.query("insert into quest_done (user_id, pkey, code) values ($1, (current_date - $2::int)::text, 'trade_1')", [A, d]);
  await db.query("select quests_check($1)", [A]);
  assert.equal(await has(db, "QUETES_7"), 1); assert.equal(await has(db, "QUETES_30"), 0);
});

test("succès en XP : rétroactif au déploiement, GUILDE_TOP3 retiré", async () => {
  const db = await freshDb({ until: "20261029600000" }); await login(db, A, "alice");
  await db.query("insert into aur_achievements (user_id, code) values ($1, 'FIRST_TRADE'), ($1, 'CHAMPION'), ($1, 'GUILDE_TOP3')", [A]);
  const x0 = await xp(db);
  await migrateFrom(db, "20261029600000");
  assert.equal(await xp(db) - x0, 75 + 150);
  assert.equal(await has(db, "GUILDE_TOP3"), 0);
});
