import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(20);

test("faillite : sous 2 000 W de patrimoine, on repart à 10 000 W ; positions perdues", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 2500 where id = $1", [A]);
  await assert.rejects(db.query("select restart()"), /pas en faillite/);
  await db.query("update profiles set cash = 100 where id = $1", [A]);
  const p = (await db.query("select * from restart()")).rows[0];
  assert.equal(p.cash, 10000);
  assert.equal(p.bankruptcies, 1);
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
