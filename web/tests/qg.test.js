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

test("faillite : les objets revendables et les bonus comptent, pas de W infinis", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  for (const id of ["lampe", "plante", "tapis", "ecran2", "chaise", "neon"]) await buy(db, id); // 9 200 W de déco
  await db.query("update profiles set cash = 300 where id = $1", [A]);
  await assert.rejects(db.query("select restart()"), /pas en faillite/, "5 520 W de revente : pas de faillite");
  for (const id of ["lampe", "plante", "tapis", "ecran2", "chaise", "neon"]) await db.query("select sell_item($1)", [id]);
  await db.query("update profiles set cash = 1000 where id = $1", [A]);
  await db.query("select restart()");
  assert.equal(await cash(db, A), 10000);
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
  await setClock(db, 3, 100); // en pleine séance : pas de salaire de fin de séance pendant le test
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

test("salaire : 10 % des mises Aurelys tenues 1 min (500 W au plus), doublé par le bonus ; la faillite garde les objets", async () => {
  const db = await freshDb();
  await setClock(db, 4, 100);
  await login(db, A, "alice");
  await buy(db, "salaire_x2"); await buy(db, "plante");
  await db.query("select use_bonus('salaire_x2')");
  await db.query("insert into aur_ticks (tk, t, p) values ('HLV', now() - interval '2 seconds', 20)");
  const open = (st) => db.query("select aur_open($1, 'HLV', 'up', 1, $2, 0)", [A, st]);
  await open(1000); await open(1500); // 2 500 W tenus 1 min : 250 W
  await db.query("update bets set created_at = now() - interval '2 minutes'");
  await open(3000); // ouverte à l'instant : ne compte pas
  await setClock(db, 4, 600);
  const before = await cash(db, A);
  await db.query("select settle()"); await db.query("select settle()");
  assert.equal(await cash(db, A), before + 2 * 250, "250 W, doublés, une seule fois");
  await db.query("update bets set status = 'lost', payout = 0");
  await db.query("update profiles set cash = 100 where id = $1", [A]);
  await db.query("select restart()");
  assert.equal((await inv(db, A)).plante.qty, 1, "les objets survivent à la faillite");
});

test("trophées : meilleur trade, krach, mains de diamant, million", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  const got = async () => Object.fromEntries((await db.query("select id, got, detail from trophies($1)", [A])).rows.map(r => [r.id, r]));
  assert.equal(Object.values(await got()).filter(t => t.got).length, 0, "rien au départ");
  await db.query(`insert into bets (user_id, session, day, kind, stake, aur, lev, status, payout, reg, created_at, closed_at) values
    ($1, 0, 0, 'aurelys', 1000, 'NXR', 1, 'won', 2500, 'krach', now() - interval '3 hours', now())`, [A]);
  await db.query("update profiles set cash = 2000000 where id = $1", [A]);
  const t = await got();
  assert.ok(t.best.got && t.krach.got && t.diamant.got && t.million.got);
  assert.match(t.best.detail, /^\+1.?499 W · NXR$/, "cadre du meilleur trade : gain net (frais d'ouverture compris)");
});

test("grands logements : villa, manoir, château, île privée, chacun après le précédent", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  await db.query("update profiles set cash = 20000000 where id = $1", [A]);
  await assert.rejects(buy(db, "villa"), /logement précédent/);
  for (const id of ["studio", "openspace", "loft", "penthouse", "villa", "manoir", "chateau", "ile"]) await buy(db, id);
  assert.equal(await cash(db, A), 20000000 - 16487000);
  assert.equal((await db.query("select home_level($1) l", [A])).rows[0].l, 8);
});
