import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freshDb, migrateFrom, login } from "./db.js";

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

// Audit d'octobre 2026 : Supabase donne ALL à authenticated sur toute nouvelle vue (droits par défaut, absents de PGlite).
// public_profiles passe la RLS (vue du propriétaire) : un UPDATE ou un DELETE par elle touchait le profil de n'importe qui.
test("public_profiles : lecture seule, même avec les droits par défaut de Supabase", async () => {
  const FIX = "20261029100000";
  const db = await freshDb({ until: FIX });
  await login(db, B, "bea"); await login(db, A, "victor");
  await db.exec("grant usage on schema public to authenticated; grant all on public_profiles to authenticated"); // comme en prod
  await migrateFrom(db, FIX);
  for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
    assert.equal((await db.query(`select has_table_privilege('authenticated', 'public_profiles', '${p}') ok`)).rows[0].ok, false, p);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("update public_profiles set cash = 1e9 where pseudo = 'bea'"), /permission denied/);
  await assert.rejects(db.query("delete from public_profiles where pseudo = 'bea'"), /permission denied/);
  assert.equal((await db.query("select count(*)::int n from public_profiles")).rows[0].n, 2, "la lecture reste possible");
  await db.exec("reset role");
});

// La clé service_role ne doit jamais se trouver dans le code servi du jeu.
test("aucune clé service_role dans le code du jeu", () => {
  const hits = [];
  const walk = p => {
    if (/node_modules|dist|models|fonts/.test(basename(p)) || !existsSync(p)) return;
    if (statSync(p).isDirectory()) readdirSync(p).forEach(f => walk(join(p, f)));
    else if (/service_role/i.test(readFileSync(p, "utf8"))) hits.push(p);
  };
  for (const p of ["../src", "../public", "../index.html", "../vite.config.js"]) walk(fileURLToPath(new URL(p, import.meta.url)));
  assert.deepEqual(hits, []);
});
