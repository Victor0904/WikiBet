// Repris de qg.test.js (supprimé avec le QG en H1) : le salaire sans le bonus « Salaire doublé », le patrimoine sans objets,
// les trophées (meilleur trade…, gardés pour la page Profil).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, setClock, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";

test("salaire : 10 % des mises Aurelys tenues 150 s (500 W au plus), une fois par séance", async () => {
  const db = await freshDb();
  await setClock(db, 4, 100);
  await login(db, A, "alice");
  await db.query("insert into aur_ticks (tk, t, p) values ('HLV', now() - interval '2 seconds', 20)");
  const open = (st) => db.query("select aur_open($1, 'HLV', 'up', 1, $2, 0)", [A, st]);
  await open(1000); await open(1500); // 2 500 W tenus une heure d'Aurelys (150 s) : 250 W
  await db.query("update bets set created_at = now() - interval '3 minutes'");
  await open(3000); // ouverte à l'instant : ne compte pas
  await setClock(db, 4, 600);
  const before = await cash(db, A);
  await db.query("select settle()"); await db.query("select settle()");
  assert.equal(await cash(db, A), before + 250, "250 W, une seule fois");
});

test("patrimoine : espèces, positions à leur valeur actuelle, actions ; classement dans cet ordre", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  await db.query("insert into aur_ticks (tk, t, p) values ('HLV', now() - interval '2 seconds', 20)");
  await db.query("select aur_open($1, 'HLV', 'up', 1, 1000, 0)", [A]);
  await db.query("select aur_buy($1, 'HLV', 2000, 0)", [A]);
  const p = Number((await db.query("select patrimoine($1) p", [A])).rows[0].p);
  const parts = (await db.query("select cash + open_value(id) + holdings_value(id) s from profiles where id = $1", [A])).rows[0].s;
  assert.ok(Math.abs(p - parts) < 1e-6);
  assert.ok(p < 10000 && p > 9990, "seuls les frais manquent");
  const board = (await db.query("select * from leaderboard()")).rows;
  assert.deepEqual(board.map(r => r.patrimoine), [...board.map(r => r.patrimoine)].sort((a, b) => b - a));
  const me = board.find(r => r.id === A);
  assert.equal(me.home, 0); assert.equal(me.title, null); assert.equal(me.level, 1);
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
