import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const tick = (db, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - make_interval(secs => $1), $2)", [ago, p]);
const open = async (db, dir, lev, stake) => (await db.query("select * from aur_open($1, 'SLM', $2, $3, $4, 0)", [A, dir, lev, stake])).rows[0];
const move = async (db, ...homes) => { for (const h of homes) await db.query("select buy_item($1)", [h]) };
const due = async db => (await db.query("select * from aur_due()")).rows;
const exec = async db => { for (const d of await due(db)) await db.query("select aur_auto_exec($1, $2, 0)", [d.what, d.id]) };
const bet = async (db, id) => (await db.query("select * from bets where id = $1", [id])).rows[0];

test("ordres auto : nombre de positions ouvertes selon le logement", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await tick(db, 2, 10);
  for (let i = 0; i < 3; i++) await open(db, "up", 1, 10);
  await assert.rejects(open(db, "up", 1, 10), /Au plus 3 positions/);
  await move(db, "studio");
  for (let i = 0; i < 2; i++) await open(db, "up", 1, 10);
  await assert.rejects(open(db, "up", 1, 10), /Au plus 5 positions/);
});

test("ordres auto : stop et objectif dès le loft, exécutés au cours du marché quand le seuil est touché", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await tick(db, 10, 10);
  const b = await open(db, "up", 5, 100); // liquidation à 8
  await assert.rejects(db.query("select aur_set_auto($1, 9, 12)", [b.id]), /loft/);
  await move(db, "studio", "openspace", "loft");
  await assert.rejects(db.query("select aur_set_auto($1, 7.5, null)", [b.id]), /Stop invalide/, "sous la liquidation");
  await assert.rejects(db.query("select aur_set_auto($1, 10.5, null)", [b.id]), /Stop invalide/, "au-dessus du cours");
  await assert.rejects(db.query("select aur_set_auto($1, null, 9.5)", [b.id]), /Objectif invalide/);
  await db.query("select aur_set_auto($1, 9, 12)", [b.id]);
  await db.query("update bets set auto_at = now() - interval '60 seconds'"); // les cours du test sont datés dans le passé
  await tick(db, 5, 9.5);
  assert.equal((await due(db)).length, 0, "seuils pas touchés");
  await tick(db, 4, 12.2); await tick(db, 3, 11.8); // l'objectif est touché, puis le cours redescend
  await tick(db, -30, 5); // un cours à venir ne compte pas
  await exec(db);
  const c = await bet(db, b.id);
  assert.equal(c.status, "won");
  assert.equal(c.exit, 11.8, "au cours du marché, pas au seuil");
  assert.equal((await due(db)).length, 0);
});

test("ordres auto : ordre à déclenchement au penthouse, annulé avec son motif s'il échoue", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await tick(db, 10, 10);
  await assert.rejects(db.query("select aur_trigger_add('SLM', 'up', 1, 100, 9)"), /penthouse/);
  await move(db, "studio", "openspace", "loft", "penthouse");
  const { rows: [g] } = await db.query("select * from aur_trigger_add('SLM', 'up', 1, 100, 9)");
  assert.equal(g.above, false, "achat sur repli");
  const { rows: [g2] } = await db.query("select * from aur_trigger_add('SLM', 'down', 1, 1e9, 11)");
  await db.query("update aur_triggers set created_at = now() - interval '60 seconds'");
  await tick(db, 5, 8.9); await tick(db, 4, 9.9); // touché à 8,9, exécuté au cours suivant
  await exec(db);
  const r = (await db.query("select * from aur_triggers where id = $1", [g.id])).rows[0];
  assert.equal(r.status, "done");
  assert.equal((await bet(db, r.bet_id)).entry, 9.9);
  await tick(db, 3, 11);
  await exec(db);
  const f = (await db.query("select * from aur_triggers where id = $1", [g2.id])).rows[0];
  assert.equal(f.status, "failed");
  assert.match(f.msg, /Solde insuffisant|Plafond/);
});
