import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(10);
const tick = (db, tk, p) => db.query("insert into aur_ticks (tk, t, p) values ($1, clock_timestamp(), $2) on conflict (tk, t) do update set p = excluded.p", [tk, p]);
// Position Aurelys ouverte au cours 10, tenue `held` secondes, clôturée au cours `to` (vrais aur_open / aur_close).
async function trade(db, { tk = "SLM", dir = "up", lev = 1, stake = 100, held = 200, to = 10.5, u = A } = {}) {
  await tick(db, tk, 10);
  const b = (await db.query("select * from aur_open($1, $2, $3, $4, $5, 0)", [u, tk, dir, lev, stake])).rows[0];
  await db.query("update bets set created_at = now() - make_interval(secs => $2) where id = $1", [b.id, held]);
  await tick(db, tk, to);
  return (await db.query("select * from aur_close($1, $2, 0)", [u, b.id])).rows[0];
}
const has = async (db, code, u = A) => (await db.query("select count(*)::int n from aur_achievements where user_id = $1 and code = $2", [u, code])).rows[0].n;
const player = async (db, u = A, pseudo = "alice") => { await login(db, u, pseudo); await db.query("update profiles set cash = 1e6 where id = $1", [u]) };

test("succès : série cassée par une perte (même un trade non valide), trade de moins de 150 s ignoré", async () => {
  const db = await freshDb(); await player(db);
  await trade(db, { held: 60 });
  assert.equal(await has(db, "FIRST_TRADE"), 0, "moins de 150 s : pas un trade valide");
  for (let i = 0; i < 4; i++) await trade(db);
  assert.equal(await has(db, "FIRST_TRADE"), 1); assert.equal(await has(db, "FIRST_GREEN"), 1);
  await trade(db, { held: 60 }); // gain non valide : ne compte pas, ne casse pas
  assert.equal((await db.query("select ach_streak from profiles where id = $1", [A])).rows[0].ach_streak, 4);
  await trade(db, { stake: 50, to: 9 }); // perte sur un trade non valide : la série casse
  assert.equal((await db.query("select ach_streak from profiles where id = $1", [A])).rows[0].ach_streak, 0);
  for (let i = 0; i < 4; i++) await trade(db);
  assert.equal(await has(db, "SERIE_5"), 0);
  await trade(db);
  assert.equal(await has(db, "SERIE_5"), 1);
});

test("succès : règle des pourcentages (mise de 1 000 W ou plus, levier ×5 au plus)", async () => {
  const db = await freshDb(); await player(db);
  await trade(db, { stake: 999, lev: 5, to: 11.5 });
  assert.equal(await has(db, "COUP_50"), 0, "mise de 999 W refusée");
  await trade(db, { stake: 1000, lev: 10, to: 10.8 });
  assert.equal(await has(db, "COUP_50"), 0, "levier ×10 refusé");
  await trade(db, { stake: 1000, lev: 5, to: 11.2 }); // +60 % de la mise, frais déduits
  assert.equal(await has(db, "COUP_50"), 1); assert.equal(await has(db, "COUP_100"), 0);
});

test("succès : idempotence (deux settle() = un seul déblocage) et Diversifié", async () => {
  const db = await freshDb(); await player(db);
  await db.query("insert into talents values ($1, 'multitache', 2)", [A]); // 5 positions
  for (const tk of ["SLM", "NXR", "PXF", "GTR", "HLV"]) { await tick(db, tk, 10); await db.query("select aur_open($1, $2, 'up', 1, 100, 0)", [A, tk]) }
  await db.query("select settle()"); await db.query("select settle()");
  assert.equal(await has(db, "DIVERSIFIE"), 1);
  assert.equal((await db.query("select achievement_grant($1, 'DIVERSIFIE') ok", [A])).rows[0].ok, false);
});

test("succès : 21 points au plus, réinitialiser les talents garde les points des succès", async () => {
  const db = await freshDb(); await player(db);
  assert.equal((await db.query("select sum(points)::int s, count(*)::int n from achievements")).rows[0].s, 21);
  await db.query("insert into achievements (code, name, descr, points) values ('BONUS', 'Bonus', 'test', 3)");
  await db.query("insert into aur_achievements (user_id, code) select $1, code from achievements", [A]);
  const t = (await db.query("select my_talents() t")).rows[0].t;
  assert.equal(t.ach, 21, "plafond");
  await db.query("delete from aur_achievements where code <> 'FIRST_TRADE'");
  await db.query("select talent_buy('frais')"); await db.query("select talent_reset()");
  const t2 = (await db.query("select my_talents() t")).rows[0].t;
  assert.equal(t2.ach, 1); assert.equal(t2.spent, 0);
  assert.equal((await db.query("select talent_points($1) p", [A])).rows[0].p, 1, "le point du succès est de nouveau disponible");
});

test("succès : le parrainage ne compte pas dans le gain net (tal_hwm), mais débloque Parrain", async () => {
  const db = await freshDb(); await login(db, A, "Vayk");
  const code = (await db.query("select referral_code c from profiles where id = $1", [A])).rows[0].c, F = id(11);
  await db.query("insert into auth.users values ($1)", [F]);
  await db.query("select set_config('app.uid', $1, false)", [F]);
  await db.query("select create_profile('Tom', $1)", [code]);
  for (const d of [0, 0, 0, 1, 1]) await db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, aur, dir, lev, entry, created_at, closed_at)
    values ($1, 0, 0, 'aurelys', 100, 'won', 110, 'SLM', 'up', 1, 10, now() - make_interval(days => $2, secs => 200), now() - make_interval(days => $2))`, [F, d]);
  await db.query("insert into inventory (user_id, item_id, qty) values ($1, 'studio', 1)", [F]);
  const c0 = await cash(db, A);
  await db.query("select settle()");
  assert.equal(await cash(db, A) - c0, 10000, "parrainage payé");
  assert.equal((await db.query("select tal_hwm from profiles where id = $1", [A])).rows[0].tal_hwm, 0, "hors gain net");
  assert.equal(await has(db, "PARRAIN"), 1); assert.equal(await has(db, "GAIN_10K"), 0);
});

test("succès : rétroactif sur l'historique, secrets masqués, classement de la semaine", async () => {
  const db = await freshDb(); await player(db);
  await db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, fees, aur, dir, lev, entry, created_at, closed_at)
    select $1, 0, 0, 'aurelys', 100, 'won', 110, 2, s.tk, 'up', 1, 10, now() - interval '1 day' - make_interval(secs => 200 + i), now() - interval '1 day' + make_interval(secs => i)
    from generate_series(1, 65) i, lateral (select tk from aur_stocks where status = 'core' order by tk offset i % 13 limit 1) s`, [A]);
  await db.query("select ach_history($1)", [A]);
  for (const c of ["FIRST_TRADE", "SCALPEUR", "SERIE_10", "TOUS_SECTEURS", "AGRONOME"]) assert.equal(await has(db, c), 1, c);
  const list = (await db.query("select my_achievements() r")).rows[0].r;
  assert.equal(list.total, 51);
  const noct = list.list.find(a => a.code === "NOCTAMBULE");
  assert.equal(noct.name, "???"); assert.equal(noct.descr, null); assert.equal(noct.hint, "Les marchés ne dorment jamais");
  assert.equal(list.list.find(a => a.code === "VETERAN").cur, 65, "progression : 65 / 500 trades valides");
  await db.query("select ach_week_end(now() - interval '7 days', now())");
  assert.equal(await has(db, "TOP_100"), 1); assert.equal(await has(db, "CHAMPION"), 1);
});
