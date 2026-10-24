// H9 : journal des comptes suspects (miroir entre comptes liés par le parrainage, même appareil), sans rien bloquer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [P, A, B, C] = [id(1), id(2), id(3), id(4)];
const log = async (db, kind) => (await db.query("select user_a, user_b from abuse_log where kind = $1 order by 1, 2", [kind])).rows;

test("anti-abus : positions en miroir entre filleuls d'un même parrain, journalisées une fois", async () => {
  const db = await freshDb();
  for (const [u, n] of [[P, "parrain"], [A, "alice"], [B, "bob"], [C, "carla"]]) await login(db, u, n);
  await db.query("insert into referrals (parrain, filleul) values ($1, $2), ($1, $3)", [P, A, B]);
  const bet = (u, dir, s) => db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, created_at)
    values ($1, 0, 0, 'aurelys', 1000, 'SLM', $2, 10, 10, now() - make_interval(secs => $3))`, [u, dir, s]);
  for (const s of [100, 2000, 4000]) { await bet(A, "up", s); await bet(B, "down", s + 20) }
  await bet(C, "down", 100); await bet(C, "down", 2000); await bet(C, "down", 4000); // C n'est lié à personne
  await db.query("select abuse_scan()"); await db.query("select abuse_scan()");
  assert.deepEqual(await log(db, "miroir"), [{ user_a: A, user_b: B }]);
  // Rien n'est bloqué, rien n'est lisible par les joueurs.
  await db.query("select set_config('app.uid', $1, false)", [A]);
  assert.equal((await db.query("select count(*)::int n from abuse_log")).rows[0].n, 1, "lu en tant que propriétaire de la base");
});

test("anti-abus : même appareil sur plusieurs comptes, identifiant mal formé refusé", async () => {
  const db = await freshDb();
  const dev = "0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
  for (const [u, n] of [[A, "alice"], [B, "bob"], [C, "carla"]]) { await login(db, u, n); await db.query("select touch($1)", [u === C ? "pas un identifiant ; drop" : dev]) }
  assert.equal((await db.query("select count(*)::int n from device_seen")).rows[0].n, 2);
  await db.query("select abuse_scan()"); await db.query("select abuse_scan()");
  assert.deepEqual(await log(db, "appareil"), [{ user_a: A, user_b: B }]);
  await db.query("select touch()"); // onglet d'avant la mise à jour : sans appareil
});

