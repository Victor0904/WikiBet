import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, setClock, login, cash, engine } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const buy = (db, id) => db.query("select * from buy_item($1)", [id]);
const inv = async (db, user) => Object.fromEntries((await db.query("select item_id, qty, equipped from inventory where user_id = $1", [user])).rows.map(r => [r.item_id, r]));

test("acheter : débité, une seule fois par objet, déco réservée aux logements assez grands", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  await buy(db, "plante");
  assert.equal(await cash(db, A), 9400);
  await assert.rejects(buy(db, "plante"), /déjà/);
  await assert.rejects(buy(db, "micro"), /logement plus grand/);
  await assert.rejects(buy(db, "openspace"), /logement précédent/);
  await assert.rejects(buy(db, "studio"), /Solde insuffisant/);
  assert.equal(await cash(db, A), 9400, "un achat refusé ne débite rien");
});

test("logements par paliers, revente à 60 %, patrimoine et classement", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  await db.query("update profiles set cash = 60000 where id = $1", [A]);
  await buy(db, "studio"); await buy(db, "openspace"); await buy(db, "micro");
  assert.equal((await db.query("select home_level($1) as l", [A])).rows[0].l, 2);
  assert.equal(await cash(db, A), 60000 - 12000 - 35000 - 3500);
  const { rows: [{ v }] } = await db.query("select sell_item('micro') as v");
  assert.equal(v, 2100);
  await assert.rejects(db.query("select sell_item('studio')"), /ne se revend pas/);
  // Patrimoine = solde + 60 % des logements (déco revendue)
  const solde = 60000 - 12000 - 35000 - 3500 + 2100;
  assert.equal((await db.query("select patrimoine($1) as p", [A])).rows[0].p, solde + 0.6 * 12000 + 0.6 * 35000);
  await login(db, B, "bob");
  const { rows } = await db.query("select pseudo, patrimoine, home from leaderboard()");
  assert.deepEqual(rows.map(r => r.pseudo), ["alice", "bob"], "acheter ne fait pas perdre de place");
  assert.equal(rows[0].home, 2);
});

test("cosmétiques : équipé à l'achat, un seul par catégorie, titre affiché au classement", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  await buy(db, "theme_cyan"); await buy(db, "theme_rose"); await buy(db, "title_porteur");
  const i = await inv(db, A);
  assert.equal(i.theme_cyan.equipped, false); assert.equal(i.theme_rose.equipped, true);
  await db.query("select equip_item('theme_cyan')");
  assert.equal((await inv(db, A)).theme_rose.equipped, false);
  assert.equal((await db.query("select title from leaderboard()")).rows[0].title, "Petit porteur");
  await db.query("select unequip('title')");
  assert.equal((await db.query("select title from leaderboard()")).rows[0].title, null);
});

test("bonus cote boostée : +20 % sur le prochain duel seulement", async () => {
  const db = await freshDb();
  await setClock(db, 3, 100);
  await login(db, A, "alice");
  await buy(db, "boost_duel");
  const d = engine.makeDuels(engine.START + 3)[1];
  const { rows: [b1] } = await db.query("select * from bet_duel($1, 'a', 100)", [d.id]);
  const { rows: [b2] } = await db.query("select * from bet_duel($1, 'b', 100)", [d.id]);
  assert.equal(Number(b1.odds), Math.round(d.oa * 1.2 * 100) / 100);
  assert.equal(Number(b2.odds), d.ob);
  assert.equal((await inv(db, A)).boost_duel.qty, 0);
});

test("bonus assurance : une position liquidée rend 50 % de la mise, une seule fois", async () => {
  const db = await freshDb();
  await db.query("insert into streamers values ('zerator', 'ZeratoR', null)");
  await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - interval '1 minute', 10000, true)");
  await login(db, A, "alice");
  await buy(db, "assurance");
  const open = async () => (await db.query("select * from open_stream('zerator', 'up', 10, 1000, 'live')")).rows[0];
  const b1 = await open(), b2 = await open();
  await db.query("update bets set created_at = created_at - interval '10 minutes'");
  await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - interval '5 minutes', 8000, true)");
  const before = await cash(db, A);
  await db.query("select settle()");
  const { rows } = await db.query("select id, payout, insured from bets order by id");
  assert.deepEqual(rows.map(r => [r.payout, r.insured]), [[500, true], [0, false]]);
  assert.equal(await cash(db, A), before + 500);
});

test("bonus salaire doublé : 1 000 W par séance pendant l'heure active ; la faillite garde les objets", async () => {
  const db = await freshDb();
  await setClock(db, 4, 100);
  await login(db, A, "alice");
  await buy(db, "salaire_x2"); await buy(db, "plante");
  await db.query("select use_bonus('salaire_x2')");
  await db.query("select open_trade($1, 'up', 1, 100, 'close')", [engine.STOCKS[0].tk]);
  await setClock(db, 4, 600);
  const before = await cash(db, A);
  await db.query("select settle()");
  const { rows: [b] } = await db.query("select payout from bets");
  assert.equal(await cash(db, A), before + b.payout + 1000);
  await db.query("update profiles set cash = 100 where id = $1", [A]);
  await db.query("select restart()");
  assert.equal((await inv(db, A)).plante.qty, 1, "les objets survivent à la faillite");
});
