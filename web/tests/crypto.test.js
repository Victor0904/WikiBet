import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`);
const open = async (db, dir, lev, stake, price) => (await db.query("select * from crypto_open($1, 'BTC', $2, $3, $4, $5)", [A, dir, lev, stake, price])).rows[0];
const candle = (db, minsAgo, l, h) => db.query("insert into crypto_candles values ('BTC', date_trunc('minute', now()) - make_interval(mins => $1), $2, $3, $2, $3)", [minsAgo, l, h]);

test("crypto : ouverture au prix serveur, frais de 0,1 % à l'ouverture et à la clôture", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const b = await open(db, "up", 5, 1000, 70000);
  near(b.fees, 5, "frais d'ouverture = 0,1 % de 5 000"); near(await cash(db, A), 10000 - 1005, "mise + frais débités");
  const { rows: [c] } = await db.query("select * from crypto_close($1, $2, 71400)", [A, b.id]);
  // +2 % ×5 = +10 % : 1 100, moins 5 W de frais de clôture
  near(c.payout, 1095, "valeur moins frais de clôture"); near(c.fees, 10, "frais cumulés"); assert.equal(c.status, "won");
  near(await cash(db, A), 10000 - 1005 + 1095, "solde final");
});

test("crypto : un gain plus petit que les frais compte comme perdu", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const b = await open(db, "up", 10, 1000, 70000);
  const { rows: [c] } = await db.query("select * from crypto_close($1, $2, 70070)", [A, b.id]); // +0,1 % ×10 = +10 W, frais 20 W
  assert.equal(c.status, "lost"); near(c.payout, 1000, "1 010 − 10 de frais");
});

test("crypto : liquidation sur le vrai plus bas de la minute, assurance comprise", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("select buy_item('assurance')");
  const b = await open(db, "up", 10, 1000, 70000);               // liquidée sous 63 000
  await db.query("update bets set created_at = now() - interval '5 minutes'");
  await candle(db, 4, 69000, 70500); await candle(db, 3, 62900, 69900); await candle(db, 2, 64000, 66000);
  await db.query("select crypto_settle()");
  const { rows: [c] } = await db.query("select * from bets where id = $1", [b.id]);
  assert.equal(c.status, "lost"); near(c.exit, 63000, "fermée au seuil"); assert.equal(c.insured, true); near(c.payout, 500, "assurance : 50 %");
  const before = await cash(db, A);
  const { rows: [again] } = await db.query("select * from crypto_close($1, $2, 80000)", [A, b.id]);
  assert.equal(again.status, "lost"); near(await cash(db, A), before, "une position liquidée ne se clôture pas une seconde fois");
});

test("crypto : une position à la baisse est liquidée sur le plus haut, pas sur le plus bas", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const b = await open(db, "down", 5, 1000, 70000);              // liquidée au-dessus de 84 000
  await db.query("update bets set created_at = now() - interval '3 minutes'");
  await candle(db, 2, 50000, 83000);
  await db.query("select crypto_settle()");
  assert.equal((await db.query("select status from bets where id = $1", [b.id])).rows[0].status, "open");
  await candle(db, 1, 82000, 84100);
  await db.query("select crypto_settle()");
  assert.equal((await db.query("select status from bets where id = $1", [b.id])).rows[0].status, "lost");
});

test("crypto : un joueur ne peut pas fixer son prix", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.exec("grant usage on schema public to authenticated; set role authenticated");
  await assert.rejects(db.query("select crypto_open($1, 'BTC', 'up', 1, 100, 1)", [A]), /permission denied/);
  await db.exec("reset role");
});
