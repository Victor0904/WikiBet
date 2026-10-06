import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`);

// Un streamer « zerator » avec des relevés, `ago` en minutes avant maintenant.
async function setup(ticks) {
  const db = await freshDb();
  await db.query("insert into streamers values ('zerator', 'ZeratoR', null)");
  for (const [ago, viewers, live = true] of ticks)
    await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - make_interval(mins => $1), $2, $3)", [ago, viewers, live]);
  await login(db, A, "alice");
  return db;
}
// Fait comme si la position avait été ouverte `mins` minutes plus tôt, puis ajoute les relevés suivants.
async function age(db, id, mins, ticks) {
  await db.query("update bets set created_at = created_at - make_interval(mins => $2), end_at = end_at - make_interval(mins => $2) where id = $1", [id, mins]);
  await db.query("update stream_ticks set at = at - make_interval(mins => $1)", [mins]); // le relevé d'ouverture recule aussi
  for (const [ago, viewers, live = true] of ticks)
    await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - make_interval(mins => $1) + interval '1 second', $2, $3)", [ago, viewers, live]);
}
const bet = async (db, id) => (await db.query("select * from bets where id = $1", [id])).rows[0];

test("une position sur un streamer s'ouvre au dernier relevé et se clôture au relevé courant", async () => {
  const db = await setup([[1, 20000]]);
  const { rows: [b] } = await db.query("select * from open_stream('zerator', 'up', 5, 1000, '60')");
  assert.equal(b.entry, 20000); assert.equal(await cash(db, A), 9000);
  await age(db, b.id, 10, [[5, 22000]]);
  const { rows: [c] } = await db.query("select * from close_trade($1)", [b.id]);
  near(c.payout, 1000 * (1 + 5 * 0.1), "+10 % de spectateurs ×5 = +50 %");
  near(await cash(db, A), 10500, "solde");
});

test("on ne parie pas sur un streamer hors ligne ou sans relevé récent", async () => {
  let db = await setup([[1, 500, false]]);
  await assert.rejects(db.query("select open_stream('zerator', 'up', 1, 100, '15')"), /pas en live/);
  db = await setup([[10, 500]]);
  await assert.rejects(db.query("select open_stream('zerator', 'up', 1, 100, '15')"), /relevé récent/);
});

test("liquidation : ×10 à la hausse, les spectateurs chutent de 15 %", async () => {
  const db = await setup([[1, 10000]]);
  const { rows: [b] } = await db.query("select * from open_stream('zerator', 'up', 10, 500, 'live')");
  await age(db, b.id, 10, [[8, 9800], [6, 8500], [4, 11000]]);
  await db.query("select settle()");
  const c = await bet(db, b.id);
  assert.equal(c.status, "lost"); assert.equal(c.payout, 0); assert.equal(c.exit, 8500);
});

test("« fin du live » : réglée au dernier relevé en direct quand le stream s'arrête", async () => {
  const db = await setup([[1, 3000]]);
  const { rows: [b] } = await db.query("select * from open_stream('zerator', 'down', 1, 1000, 'live')");
  await age(db, b.id, 30, [[20, 2800], [10, 2400], [9, 0, false]]);
  await db.query("select settle()");
  const c = await bet(db, b.id);
  near(c.payout, 1000 * (1 + 0.2), "à la baisse, 3 000 → 2 400 = +20 %");
  assert.equal(c.status, "won");
});

test("échéance 15 min : réglée au dernier relevé avant l'échéance, pas après", async () => {
  const db = await setup([[1, 1000]]);
  const { rows: [b] } = await db.query("select * from open_stream('zerator', 'up', 1, 100, '15')");
  await age(db, b.id, 20, [[12, 1100], [6, 1200], [2, 5000]]); // échéance il y a 5 min
  await db.query("select settle()");
  near((await bet(db, b.id)).payout, 120, "dernier relevé avant l'échéance (1 200), pas celui d'après (5 000)");
});
