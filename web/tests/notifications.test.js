import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";
const tick = (db, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - make_interval(secs => $1), $2)", [ago, p]);
const open = async (db, dir, lev, stake) => (await db.query("select * from aur_open($1, 'SLM', $2, $3, $4, 0)", [A, dir, lev, stake])).rows[0];
const bet = async (db, id) => (await db.query("select * from bets where id = $1", [id])).rows[0];
const exec = async db => { for (const d of (await db.query("select * from aur_due()")).rows) await db.query("select aur_auto_exec($1, $2, 0)", [d.what, d.id]) };

test("notifications : motif de clôture (liquidation, stop, objectif, main) et liquidations à annoncer", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  for (const h of ["studio", "openspace", "loft"]) await db.query("select buy_item($1)", [h]);
  await tick(db, 20, 10);
  const liq = await open(db, "up", 10, 100), stop = await open(db, "up", 5, 100), obj = await open(db, "down", 5, 100), hand = await open(db, "up", 1, 100);
  await db.query("update bets set created_at = now() - interval '60 seconds'");
  await db.query("select aur_set_auto($1, 9.5, null)", [stop.id]);
  await db.query("select aur_set_auto($1, null, 9.6)", [obj.id]);
  await db.query("update bets set auto_at = now() - interval '60 seconds'");
  await db.query("insert into push_subs values ('https://push.exemple/abc', $1)", [A]);
  await tick(db, 10, 9.4); await tick(db, 5, 8.9); // liquidation du ×10 à 9
  await db.query("select aur_settle()"); await exec(db);
  await db.query("select aur_close($1, $2, 0)", [A, hand.id]);
  assert.equal((await bet(db, liq.id)).closed_by, "liq");
  assert.equal((await bet(db, stop.id)).closed_by, "stop");
  assert.equal((await bet(db, obj.id)).closed_by, "objectif");
  assert.equal((await bet(db, hand.id)).closed_by, null);
  assert.deepEqual((await db.query("select * from push_due()")).rows, [{ endpoint: "https://push.exemple/abc" }]);
  assert.equal((await db.query("select * from push_due()")).rows.length, 0, "annoncée une seule fois");
  const info = (await db.query("select * from push_info('https://push.exemple/abc')")).rows;
  assert.equal(info.length, 1); assert.equal(info[0].lev, 10);
  assert.equal((await db.query("select * from push_info('https://push.exemple/autre')")).rows.length, 0);
});
