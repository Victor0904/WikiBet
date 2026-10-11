import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const bank = async (db, id) => (await db.query("select bank from profiles where id = $1", [id])).rows[0].bank;

test("banque : dépôt, retrait, intérêts à chaque nouveau jour d'Aurelys, compté dans le patrimoine", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 300000 where id = $1", [A]);
  await assert.rejects(db.query("select bank_move(400000)"), /Solde insuffisant/);
  await db.query("select bank_move(250000)");
  assert.equal(await cash(db, A), 50000);
  assert.equal(await bank(db, A), 250000);
  assert.equal(Number((await db.query("select patrimoine($1) p", [A])).rows[0].p), 300000);
  await assert.rejects(db.query("select bank_move(-300000)"), /Dépôt insuffisant/);

  await db.query("select aur_dividends()"); // premier passage : le jour est noté, rien n'est versé
  await db.query("select aur_dividends()");
  assert.equal(await bank(db, A), 250000, "même jour : pas d'intérêt");
  await db.query("update aur_div_day set day = day - 1");
  await db.query("select aur_dividends()");
  assert.equal(await bank(db, A), 250100, "0,1 % sur 100 000 W au plus");

  await db.query("select bank_move(-250100)");
  assert.equal(await cash(db, A), 300100);
  assert.equal(await bank(db, A), 0);
});

test("objectif ouvert à tous, stop réservé au loft", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - interval '2 seconds', 10)");
  const { rows: [b] } = await db.query("select * from aur_open($1, 'SLM', 'up', 5, 100, 0)", [A]);
  await db.query("select aur_set_auto($1, null, 12)", [b.id]);
  await assert.rejects(db.query("select aur_set_auto($1, 9, 12)", [b.id]), /loft/);
});
