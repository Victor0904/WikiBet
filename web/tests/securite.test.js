import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";

// Test d'intrusion d'octobre 2026 : la clé publique suffisait pour lister codes de parrainage, dates et compteurs de tous.
test("profiles : chacun ne lit que sa ligne, les autres par public_profiles sans colonnes privées", async () => {
  const db = await freshDb();
  await login(db, B, "bea"); await login(db, A, "victor");
  // Droits par défaut de Supabase sur les tables, que PGlite n'a pas.
  await db.exec("grant usage on schema public to authenticated, anon; grant select on profiles to authenticated, anon; set role authenticated");
  const own = (await db.query("select id, referral_code from profiles")).rows;
  assert.deepEqual(own.map(r => r.id), [A], "seulement mon profil");
  assert.ok(own[0].referral_code, "mon code reste lisible");
  const pub = (await db.query("select * from public_profiles order by pseudo")).rows;
  assert.deepEqual(pub.map(r => r.pseudo), ["bea", "victor"]);
  assert.deepEqual(Object.keys(pub[0]).sort(), ["bankruptcies", "bot", "cash", "id", "pseudo"]);
  await assert.rejects(db.query("select settle()"), /permission denied/, "settle réservé à pg_cron");
  await db.exec("reset role; select set_config('app.uid', '', false); set role anon");
  assert.equal((await db.query("select count(*)::int n from profiles")).rows[0].n, 0, "sans compte : rien");
  await assert.rejects(db.query("select * from public_profiles"), /permission denied/);
  await db.exec("reset role");
});
