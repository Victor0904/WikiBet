import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const tick = (db, tk, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ($1, now() - make_interval(secs => $2), $3)", [tk, ago, p]);
const open = async (db, user, tk, dir, lev, stake) => (await db.query("select * from aur_open($1, $2, $3, $4, $5, 0)", [user, tk, dir, lev, stake])).rows[0];
const bet = async (db, id) => (await db.query("select status, payout, exit, exit_at, closed_by from bets where id = $1", [id])).rows[0];

test("liquidation : au prix de liquidation même après un trou de cours, jamais de solde négatif", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, "SLM", 5, 10);
  const all = Math.floor(10000 / 1.005); // presque tout le solde engagé à ×5 (frais 0,1 % de mise × levier)
  const b = await open(db, A, "SLM", "up", 5, all);
  await db.query("update bets set created_at = now() - interval '3 seconds'");
  const left = await cash(db, A);
  assert.ok(left >= 0 && left < 10, `reste ${left}`);
  await tick(db, "SLM", 1, 5); // le cours tombe de 10 à 5 d'un coup : bien sous le seuil (8)
  await db.query("select aur_settle()");
  const r = await bet(db, b.id);
  assert.equal(r.status, "lost"); assert.equal(r.closed_by, "liq");
  assert.equal(r.exit, 8, "clôturée au prix de liquidation, pas au cours du trou");
  assert.equal(r.payout, 0);
  assert.equal(await cash(db, A), left, "rien de plus n'est débité");
  assert.ok(await cash(db, A) >= 0);
});

test("liquidation : un passage ne relit que les nouveaux cours, mais n'en manque aucun", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, "SLM", 26, 10);
  const b = await open(db, A, "SLM", "down", 5, 1000); // seuil : 12
  await db.query("update bets set created_at = now() - interval '25 seconds'");
  await tick(db, "SLM", 20, 11);
  await db.query("select aur_settle()");
  assert.equal((await bet(db, b.id)).status, "open", "11 ne touche pas 12");
  assert.ok((await db.query("select liq_at from aur_watch")).rows[0].liq_at, "repère enregistré");
  await tick(db, "SLM", 1, 12.5); // cours arrivé après le passage précédent
  await db.query("select aur_settle()");
  const r = await bet(db, b.id);
  assert.equal(r.status, "lost"); assert.equal(r.exit, 12);
  const t = (await db.query("select max(t) t from aur_ticks where tk = 'SLM'")).rows[0].t;
  assert.equal(+r.exit_at, +t, "heure du premier cours qui touche le seuil");
});

test("cours à la seconde perdus (redémarrage) : les actions gardent la valeur de la dernière bougie, les ordres attendent", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, "HLV", 3, 20);
  await db.query("select aur_settle()"); // bougie de l'heure en cours : clôture 20
  await db.query("insert into aur_holdings (user_id, tk, qty, cost) values ($1, 'HLV', 100, 2000)", [A]);
  const before = (await db.query("select patrimoine($1) p", [A])).rows[0].p;
  await db.query("truncate aur_ticks");
  assert.equal((await db.query("select holding_price('HLV') p")).rows[0].p, 20, "dernière bougie");
  assert.equal((await db.query("select patrimoine($1) p", [A])).rows[0].p, before, "patrimoine inchangé : pas de fausse faillite");
  await assert.rejects(open(db, A, "HLV", "up", 1, 100), /indisponible/);
  await db.query("select aur_settle()");
  const c = (await db.query("select o, h, l, c from aur_candles where tk = 'HLV'")).rows;
  assert.equal(c.length, 1); assert.equal(c[0].o, 20, "la bougie n'est pas effacée");
});
