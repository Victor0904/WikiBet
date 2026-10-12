import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(20);

test("faillite : on repart à 10 000 W de patrimoine, logements compris (plus d'aller-retour gagnant)", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 13000 where id = $1", [A]);
  await db.query("select buy_item('studio')"); // 12 000 W : il reste 1 000 W, sous le seuil
  const price = (await db.query("select price from shop_items where id = 'studio'")).rows[0].price;
  const p = (await db.query("select * from restart()")).rows[0];
  assert.equal(p.cash, Math.max(2000, 10000 - Math.floor(price * .6)), "10 000 W moins 60 % du studio");
  assert.equal(p.bankruptcies, 1);
  // Sans logement : 10 000 W comme avant ; jamais moins de 2 000 W en caisse.
  const B = id(21); await login(db, B, "bob");
  await db.query("update profiles set cash = 100 where id = $1", [B]);
  assert.equal((await db.query("select cash from restart()")).rows[0].cash, 10000);
  await db.query("insert into inventory (user_id, item_id, qty) values ($1, 'penthouse', 1)", [B]);
  await db.query("update profiles set cash = 100 where id = $1", [B]);
  assert.equal((await db.query("select cash from restart()")).rows[0].cash, 2000, "grand logement : 2 000 W en caisse au moins");
});

test("classement de la semaine : entre joueurs seulement, un bot devant ne prive pas le premier joueur", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const BOT = id(22); await login(db, BOT, "robot"); await db.query("update profiles set bot = true where id = $1", [BOT]);
  const win = (u, gain) => db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, fees, fee_open, aur, dir, lev, entry, created_at, closed_at)
    values ($1, 0, 0, 'aurelys', 100, 'won', 100 + $2::float8, 0, 0, 'SLM', 'up', 1, 10, now() - interval '1 day', now() - interval '1 day')`, [u, gain]);
  await win(BOT, 5000); await win(A, 1000);
  await db.query("select ach_week_end(now() - interval '7 days', now())");
  const has = async c => (await db.query("select count(*)::int n from aur_achievements where user_id = $1 and code = $2", [A, c])).rows[0].n;
  assert.equal(await has("CHAMPION"), 1); assert.equal(await has("TOP_10"), 1);
});
