import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, setClock, login, cash, engine } from "./db.js";
import { tradeValue, T } from "../src/engine.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`);
const tk = engine.STOCKS[0].tk;

test("l'horloge SQL et le moteur JS donnent la même séance et la même minute", async () => {
  const db = await freshDb();
  for (const [k, t] of [[0, 0], [7, 123], [31, 509], [45, T]]) {
    await setClock(db, k, t);
    const { rows: [g] } = await db.query("select * from game_now()");
    assert.equal(g.k, k); assert.equal(g.t, t); assert.equal(g.playing, t < T);
    assert.equal(g.d, engine.START + k % engine.NSESS);
  }
});

test("une position s'ouvre au cours du moteur et se clôture à sa valeur", async () => {
  const db = await freshDb();
  await setClock(db, 2, 40);
  await login(db, A, "alice");
  const d = engine.START + 2;
  const { rows: [b] } = await db.query("select * from open_trade($1, 'up', 5, 500, '60')", [tk]);
  near(b.entry, engine.price(tk, d, 40), "entrée");
  assert.equal(b.end_tick, 100);
  assert.equal(await cash(db, A), 9500);

  await setClock(db, 2, 70);
  const { rows: [c] } = await db.query("select * from close_trade($1)", [b.id]);
  const px = engine.price(tk, d, 70), path = engine.pathOf(tk, d).slice(41, 71);
  if (path.every(p => tradeValue(b, p) > 0)) {
    near(c.payout, tradeValue(b, px), "valeur encaissée");
    near(await cash(db, A), 9500 + c.payout, "solde après clôture");
    assert.equal(c.closed_tick, 70);
  } else assert.equal(c.payout, 0);
});

test("une position atteinte par la liquidation est fermée à 0 à la bonne minute", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  // Cherche une séance où une position ×10 se fait liquider : on balaie articles, sens et départs.
  let found = null;
  for (let k = 0; k < engine.NSESS && !found; k++) for (const s of engine.STOCKS) for (const dir of ["up", "down"]) {
    const p = engine.pathOf(s.tk, engine.START + k), b = { entry: p[10], stake: 500, lev: 10, dir };
    const i = p.findIndex((x, j) => j > 10 && j <= T && tradeValue(b, x) <= 0);
    if (i > 0 && !found) found = { k, tk: s.tk, dir, i };
  }
  assert.ok(found, "aucun cas de liquidation trouvé dans les données");
  await setClock(db, found.k, 10);
  const { rows: [b] } = await db.query("select * from open_trade($1, $2, 10, 500, 'close')", [found.tk, found.dir]);
  await setClock(db, found.k, Math.min(T - 1, found.i + 5));
  await db.query("select settle()");
  const { rows: [c] } = await db.query("select * from bets where id = $1", [b.id]);
  assert.equal(c.status, "lost"); assert.equal(c.payout, 0); assert.equal(c.closed_tick, found.i);
});

test("fin de séance : positions à échéance, duels réglés sur les vraies vues, salaire versé une seule fois", async () => {
  const db = await freshDb();
  await setClock(db, 4, 100);
  await login(db, A, "alice");
  const d = engine.START + 4, duel = engine.makeDuels(d)[0];
  const { rows: [t] } = await db.query("select * from open_trade($1, 'down', 1, 1000, '15')", [tk]);
  const { rows: [u] } = await db.query("select * from bet_duel($1, 'a', 500)", [duel.id]);
  near(u.odds, duel.oa, "cote du duel");

  await setClock(db, 4, T);            // pause après la séance 4
  await db.query("select settle()");
  await db.query("select settle()");   // deux appels : rien ne doit être payé deux fois
  const { rows } = await db.query("select * from bets order by id");
  near(rows[0].payout, tradeValue(t, engine.price(tk, d, 115)), "position fermée à son échéance");
  const va = engine.BY[duel.a].views[d + 1], vb = engine.BY[duel.b].views[d + 1];
  near(rows[1].payout, va > vb ? 500 * duel.oa : 0, "duel");
  near(await cash(db, A), 10000 - 1500 + rows[0].payout + rows[1].payout + 500, "solde final avec un seul salaire");
});

test("un joueur ne peut ni toucher à son solde ni clôturer la position d'un autre", async () => {
  const db = await freshDb();
  await setClock(db, 1, 50);
  await login(db, A, "alice");
  const { rows: [b] } = await db.query("select * from open_trade($1, 'up', 1, 100, 'close')", [tk]);
  await login(db, B, "bob");
  await assert.rejects(db.query("select close_trade($1)", [b.id]), /introuvable/);
  // Comme sur Supabase : les tables sont accessibles au rôle, c'est la RLS qui bloque.
  await db.exec("grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated");
  await db.exec("set role authenticated");
  await db.query("update profiles set cash = 1e9 where id = $1", [B]);
  const { rows } = await db.query("select user_id from bets");
  await db.exec("reset role");
  assert.equal(await cash(db, B), 10000, "la RLS bloque la modification directe du solde");
  assert.equal(rows.length, 0, "bob ne voit pas les paris d'alice");
  await assert.rejects(db.query("select open_trade($1, 'up', 1, 20000, 'close')", [tk]), /Solde insuffisant/);
});

test("on ne parie pas pendant la pause", async () => {
  const db = await freshDb();
  await setClock(db, 3, T);
  await login(db, A, "alice");
  await assert.rejects(db.query("select open_trade($1, 'up', 1, 100, 'close')", [tk]), /séance est fermée/);
});
