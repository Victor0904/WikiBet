import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";
import { initState, advance, realOf, DAY, IPO } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a";
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg} : ${a} ≠ ${b}`);
const tick = (db, tk, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ($1, now() - make_interval(secs => $2), $3)", [tk, ago, p]);

test("portefeuille : achat au cours + impact, frais, vente inscrite dans l'historique et le patrimoine", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, "HLV", 2, 20);
  const { rows: [h] } = await db.query("select * from aur_buy($1, 'HLV', 2000, .01)", [A]);
  near(h.qty, 2000 / 20.2, "quantité au prix d'exécution"); near(await cash(db, A), 10000 - 2002, "montant + 0,1 % de frais");
  near((await db.query("select patrimoine($1) as p", [A])).rows[0].p, 10000 - 2002 + h.qty * 20, "le portefeuille compte au dernier cours");
  await tick(db, "HLV", 1, 25);
  const { rows: [b] } = await db.query("select * from aur_sell($1, 'HLV', $2, 0)", [A, h.qty]);
  assert.equal(b.kind, "invest"); assert.equal(b.status, "won");
  near(b.payout, h.qty * 25 * .999, "vente moins frais");
  near((await db.query("select gain from gains_board('today')")).rows[0].gain, h.qty * 25 * .999 - 2002, "plus-value au classement des gains");
});

test("levée de fonds : réservée aux joueurs à 50 000 W de patrimoine, 20 % au plus", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("select aur_listing($1)", [JSON.stringify([{ tk: "NEO", name: "Néogen", sector: "sante", L: 3000, status: "round", roundPrice: 10, roundEnd: Date.now() / 1000 + 3600 }])]);
  await assert.rejects(db.query("select aur_subscribe('NEO', 1000)"), /50 000 W/);
  await db.query("update profiles set cash = 100000 where id = $1", [A]);
  await assert.rejects(db.query("select aur_subscribe('NEO', 30000)"), /20 %/);
  const { rows: [h] } = await db.query("select * from aur_subscribe('NEO', 20000)");
  near(h.qty, 2000, "au prix de la levée");
  // Faillite : actions perdues et inscrites dans l'historique.
  await db.query("select aur_listing($1)", [JSON.stringify([{ tk: "NEO", name: "Néogen", sector: "sante", L: 3000, status: "delisted", roundPrice: 10, roundEnd: 0, ipoPrice: 8, lastPrice: 1 }])]);
  assert.equal((await db.query("select qty from aur_holdings")).rows[0].qty, 0);
  const { rows: [l] } = await db.query("select kind, status, stake, payout from bets");
  assert.deepEqual([l.kind, l.status, l.stake, l.payout], ["invest", "lost", 20000, 0]);
});

test("moteur : des jeunes pousses sont annoncées, introduites en bourse, et radiées si elles s'effondrent", () => {
  const S = initState(1800000000, 4), all = [];
  let bad = 0;
  for (let m = S.t, end = S.t + 25 * DAY; m < end; m += 60) { const o = advance(S, realOf(m + 60)); all.push(...o.listing); bad += o.ticks.filter(x => !Number.isFinite(x.p)).length }
  assert.equal(bad, 0, "aucun cours invalide (un seul NaN fige tout le marché)");
  const by = st => all.filter(d => d.status === st);
  assert.ok(by("round").length >= 3 && by("listed").length >= 3, "plusieurs levées et introductions");
  assert.ok(all.every(d => !("q" in d)), "la qualité cachée ne sort jamais");
  assert.ok(Object.values(S.extra).filter(d => d.status === "listed").length <= IPO.maxYoung);
  for (const d of by("delisted")) assert.ok(d.lastPrice < d.ipoPrice * IPO.delist, "radiée sous 15 % du prix d'introduction");
});

test("souvenirs : certificat d'actionnaire fondateur numéroté, meilleur trade avec son graphique et la une du jour", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 100000 where id = $1", [A]);
  await db.query("select aur_listing($1)", [JSON.stringify([{ tk: "NEO", name: "Néogen", sector: "sante", L: 3000, status: "round", roundPrice: 10, roundEnd: Date.now() / 1000 + 3600 }])]);
  await db.query("select aur_subscribe('NEO', 1000)"); await db.query("select aur_subscribe('NEO', 1000)");
  await db.query("insert into aur_candles (tk, t, o, h, l, c, v) select 'NXR', now() - make_interval(mins => g), 1, 1, 1, 100 + g, 1 from generate_series(1, 5) g");
  await db.query("insert into aur_news (id, t, cat, title) values (1, now() - interval '30 seconds', 'resultats', 'Nexora pulvérise les attentes')");
  await db.query("insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, status, payout, created_at, closed_at, exit_at) values ($1, 0, 0, 'aurelys', 100, 'NXR', 'up', 5, 101, 104, 'won', 300, now() - interval '4 minutes', now(), now())", [A]);
  const { rows: [{ s }] } = await db.query("select souvenirs($1) as s", [A]);
  assert.deepEqual(s.founders.map(f => [f.tk, f.n]), [["NEO", 1]], "un seul certificat, n° 1");
  assert.equal(s.best.tk, "NXR"); assert.ok(s.best.series.length >= 4, "le vrai graphique du trade");
  assert.equal(s.best.une, "Nexora pulvérise les attentes");
});
