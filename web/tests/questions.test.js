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

test("settle crée trois questions par live : quarts d'heure à venir, seuil rond au-dessus de l'audience", async () => {
  const db = await setup(9732);
  const ms = await markets(db);
  assert.equal(ms.length, 3);
  for (const m of ms) {
    assert.ok(m.threshold > 9732 && m.threshold % 50 === 0, `seuil au-dessus de 9 732, au pas de 50 : ${m.threshold}`);
    assert.equal(new Date(m.closes_at).getUTCMinutes() % 15, 0, "échéance à heure ronde");
    assert.equal(new Date(m.closes_at).getUTCSeconds(), 0);
    assert.ok(new Date(m.closes_at) - Date.now() >= 9.5 * 60000, "au moins 10 min devant");
  }
  await db.query("select settle()");
  assert.ok(ms[2].threshold >= ms[0].threshold, "échéance plus lointaine, seuil au moins aussi haut");
  assert.equal((await markets(db)).length, 3, "pas de doublon au settle suivant");
});

test("les cotes suivent la probabilité : sous le seuil, Oui paie plus que Non, marge de 7 %", async () => {
  const db = await setup(9732);
  const { rows } = await db.query("select * from open_markets()");
  assert.equal(rows.length, 3);
  for (const m of rows) {
    assert.ok(m.p_yes > 0.15 && m.p_yes < 0.5, `question ouverte, ni gagnée ni perdue d'avance : p = ${m.p_yes}`);
    assert.ok(Number(m.odds_yes) > Number(m.odds_no), "Oui est l'outsider");
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
