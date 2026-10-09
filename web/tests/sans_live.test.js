import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./db.js";

test("Live retiré : settle() ne crée plus de questions, même avec un relevé frais", async () => {
  const db = await freshDb();
  await db.query("insert into streamers values ('steam:730', 'Counter-Strike 2', null), ('zerator', 'ZeratoR', null)");
  for (const [login, v] of [["steam:730", 1300000], ["zerator", 9000]])
    await db.query("insert into stream_ticks (login, at, viewers, live) values ($1, now() - interval '1 minute', $2, true)", [login, v]);
  await db.query("select settle()");
  assert.equal((await db.query("select count(*)::int n from stream_markets")).rows[0].n, 0);
});
