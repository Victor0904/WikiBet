import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`);

async function setup(viewers = 9732) {
  const db = await freshDb();
  await db.query("insert into streamers values ('zerator', 'ZeratoR', null)");
  for (const [ago, v] of [[30, viewers * .97], [20, viewers * 1.02], [10, viewers * .99], [1, viewers]])
    await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - make_interval(mins => $1), $2, true)", [ago, Math.round(v)]);
  await login(db, A, "alice");
  await db.query("select settle()");
  return db;
}
const markets = async db => (await db.query("select * from stream_markets order by closes_at")).rows;
const tick = (db, ago, viewers, live = true) => db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - make_interval(secs => $1), $2, $3)", [ago, viewers, live]);
// Fait échoir la question il y a 2 min (relevé du live déjà arrivé après l'échéance, celui de setup à -1 min).
const expire = (db, id) => db.query("update stream_markets set closes_at = now() - interval '2 minutes' where id = $1", [id]);

test("settle crée trois questions par live : quarts d'heure à venir, seuil rond près de la prévision", async () => {
  const db = await setup(9732);
  const ms = await markets(db);
  assert.equal(ms.length, 3);
  for (const m of ms) {
    assert.ok(Math.abs(m.threshold / 9732 - 1) < .1 && m.threshold % 100 === 0, `seuil près de 9 732, au pas de 100 : ${m.threshold}`);
    assert.equal(new Date(m.closes_at).getUTCMinutes() % 15, 0, "échéance à heure ronde");
    assert.equal(new Date(m.closes_at).getUTCSeconds(), 0);
    assert.ok(new Date(m.closes_at) - Date.now() >= 9.5 * 60000, "au moins 10 min devant");
  }
  await db.query("select settle()");
  assert.equal((await markets(db)).length, 3, "pas de doublon au settle suivant");
});

test("les cotes sont équilibrées (seuil près de la prévision), marge de 7 %", async () => {
  const db = await setup(9732);
  const { rows } = await db.query("select * from open_markets()");
  assert.equal(rows.length, 3);
  for (const m of rows) {
    assert.ok(m.p_yes > 0.3 && m.p_yes < 0.7, `question ouverte, ni gagnée ni perdue d'avance : p = ${m.p_yes}`);
    assert.ok(Number(m.odds_yes) > 1.3 && Number(m.odds_no) > 1.3, `cotes proches de 1,8 / 2 : ${m.odds_yes} / ${m.odds_no}`);
    assert.ok(Math.abs(1 / m.odds_yes + 1 / m.odds_no - 1 / 0.93) < 0.02, "marge de 7 % (aux arrondis près)");
  }
});

test("pari Oui : cote figée au moment du pari, payé si le chiffre avant l'échéance dépasse le seuil", async () => {
  const db = await setup(9732);
  const [m] = await markets(db);
  const { rows: [o] } = await db.query("select * from market_odds($1)", [m.id]);
  const { rows: [b] } = await db.query("select * from bet_question($1, 'yes', 100)", [m.id]);
  near(b.odds, o.odds_yes, "cote retenue"); assert.equal(await cash(db, A), 9900);
  await expire(db, m.id);
  await tick(db, 150, 11000);          // 2 min 30 avant maintenant : juste avant l'échéance
  await db.query("select settle()");
  const { rows: [c] } = await db.query("select * from bets where id = $1", [b.id]);
  assert.equal(c.status, "won"); assert.equal(c.exit, 11000); near(c.payout, 100 * Number(o.odds_yes), "gain");
});

test("live terminé avant l'échéance : la question est tranchée Non", async () => {
  const db = await setup(12000);
  const [m] = await markets(db);
  const { rows: [b] } = await db.query("select * from bet_question($1, 'no', 200)", [m.id]);
  await expire(db, m.id);
  await tick(db, 150, 0, false);
  await db.query("select settle()");
  const { rows: [c] } = await db.query("select * from bets where id = $1", [b.id]);
  assert.equal(c.status, "won"); assert.equal(c.exit, 0);
  assert.equal((await db.query("select result from stream_markets where id = $1", [m.id])).rows[0].result, false);
});

test("les paris ferment 5 min avant l'échéance", async () => {
  const db = await setup();
  const [m] = await markets(db);
  await db.query("update stream_markets set closes_at = now() + interval '4 minutes' where id = $1", [m.id]);
  await assert.rejects(db.query("select bet_question($1, 'yes', 100)", [m.id]), /fermés/);
});

test("un live qui monte : le seuil suit la tendance, Oui n'est pas donné", async () => {
  const db = await freshDb();
  await db.query("insert into streamers values ('zerator', 'ZeratoR', null)");
  for (let ago = 30; ago >= 1; ago--) await db.query("insert into stream_ticks (login, at, viewers, live) values ('zerator', now() - make_interval(mins => $1), $2, true)", [ago, Math.round(10000 * Math.exp(-.005 * ago))]);
  await login(db, A, "alice");
  await db.query("select settle()");
  const { rows } = await db.query("select * from open_markets() where kind = 'at' order by closes_at");
  assert.ok(rows[2].threshold > rows[0].threshold, "échéance plus lointaine, seuil plus haut quand le live monte");
  for (const m of rows) assert.ok(Number(m.odds_yes) > 1.4, `Oui pas donné d'avance : ${m.odds_yes}`);
});

test("question du jour : le pic d'aujourd'hui battra-t-il celui d'hier ?", async () => {
  const db = await freshDb();
  await db.query("insert into streamers values ('steam:730', 'Counter-Strike 2', null)");
  const { rows: [{ d }] } = await db.query("select extract(epoch from day_start()) as d");
  const at = (h, v) => db.query("insert into stream_ticks (login, at, viewers, live) values ('steam:730', to_timestamp($1), $2, true)", [Number(d) + h * 3600, v]);
  await at(-20, 900000); await at(-4, 1200000);            // hier : pic à 1 200 000
  await login(db, A, "alice");
  await db.query("select settle()");
  const { rows: [m] } = await db.query("select * from stream_markets where kind = 'peak'");
  assert.equal(m.threshold, 1200000);
  assert.ok(new Date(m.bet_until) - new Date(Number(d) * 1000) === 18 * 3600e3, "paris ouverts jusqu'à 18 h");
  await db.query("update stream_markets set bet_until = now() + interval '1 hour' where id = $1", [m.id]); // le test peut tourner après 18 h
  const { rows: [b] } = await db.query("select * from bet_question($1, 'yes', 100)", [m.id]);
  await db.query("update stream_markets set closes_at = now() - interval '1 second' where id = $1", [m.id]);
  await db.query("insert into stream_ticks (login, at, viewers, live) values ('steam:730', now() - interval '10 minutes', 1250000, true)");
  await db.query("select settle()");
  const { rows: [c] } = await db.query("select status, exit from bets where id = $1", [b.id]);
  assert.equal(c.status, "won"); assert.equal(c.exit, 1250000);
});
