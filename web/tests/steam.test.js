import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./db.js";

test("Steam : un jeu reçoit des questions comme un streamer, mais n'est jamais demandé à Twitch", async () => {
  const db = await freshDb();
  await db.query("insert into streamers values ('steam:730', 'Counter-Strike 2', null), ('zerator', 'ZeratoR', null)");
  for (const [login, v] of [["steam:730", 1300000], ["zerator", 9000]])
    await db.query("insert into stream_ticks (login, at, viewers, live) values ($1, now() - interval '1 minute', $2, true)", [login, v]);
  await db.query("select settle()");
  const { rows } = await db.query("select login, threshold from stream_markets where login = 'steam:730'");
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => Math.abs(r.threshold / 1300000 - 1) < .05 && r.threshold % 10000 === 0), `seuil près de la prévision, arrondi : ${rows.map(r => r.threshold)}`);
  const { rows: odds } = await db.query("select p_yes from open_markets() where login = 'steam:730'");
  assert.ok(odds.every(o => o.p_yes > .3 && o.p_yes < .7), `question équilibrée : ${odds.map(o => o.p_yes.toFixed(2))}`);
  const watch = (await db.query("select login from streamers_to_watch()")).rows.map(r => r.login);
  assert.deepEqual(watch, ["zerator"]);
});
