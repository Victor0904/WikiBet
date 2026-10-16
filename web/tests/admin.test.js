import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
const snap = async db => (await db.query("select admin_snapshot() as s")).rows[0].s;

test("admin : instantané réservé à l'id de admin_config, alertes concentration et miroir", async () => {
  const db = await freshDb();
  await login(db, A, "victor"); await login(db, B, "bea"); await login(db, C, "cyril");
  await assert.rejects(snap(db), /Accès réservé/, "sans configuration, personne");
  await db.query("insert into admin_config values (1, $1)", [A]);
  await assert.rejects(snap(db), /Accès réservé/, "un autre joueur");
  await db.query("select set_config('app.uid', '', false)");
  await assert.rejects(snap(db), /Accès réservé/, "anonyme");

  // B et C, filleuls de A, ouvrent trois fois la même position à quelques secondes d'écart.
  await db.query("insert into referrals (filleul, parrain) values ($1, $3), ($2, $3)", [B, C, A]);
  await db.query("insert into aur_ticks (tk, t, p) values ('SLM', clock_timestamp() - interval '1 second', 10)");
  for (const u of [B, C]) {
    await db.query("update profiles set cash = 1e6 where id = $1", [u]);
    for (let i = 0; i < 3; i++) await db.query("select aur_open($1, 'SLM', 'up', 5, 1000, 0)", [u]);
  }
  await db.query("select set_config('app.uid', $1, false)", [A]);
  const s = await snap(db);
  assert.equal(s.players.length, 3);
  const bea = s.players.find(p => p.pseudo === "bea");
  assert.equal(bea.positions.length, 3); assert.equal(bea.parrain, "victor");
  assert.equal(s.players.find(p => p.pseudo === "victor").filleuls.length, 2);
  assert.equal(s.stocks.find(x => x.tk === "SLM").long, 30000, "exposition = mise × levier");
  assert.equal(s.kpi.signups_today, 3); assert.equal(s.kpi.demos, null);
  assert.ok(s.alerts.some(a => a.kind === "concentration" && a.pseudo === "bea" && Math.abs(a.share - 0.5) < 1e-9));
  const m = s.alerts.find(a => a.kind === "mirror");
  assert.ok(m && m.parrain === "victor" && m.pairs >= 3, "comptes en miroir");
  assert.ok(s.health.ticks_bytes > 0);
});

// La clé service_role ne doit jamais se trouver dans le code servi (jeu) ni dans admin/.
test("aucune clé service_role dans admin/ ni dans le code du jeu", () => {
  const hits = [];
  const walk = p => {
    if (/node_modules|dist|models|fonts/.test(basename(p)) || !existsSync(p)) return;
    if (statSync(p).isDirectory()) readdirSync(p).forEach(f => walk(join(p, f)));
    else if (/service_role/i.test(readFileSync(p, "utf8"))) hits.push(p);
  };
  for (const p of ["../src", "../public", "../index.html", "../vite.config.js", "../../admin"]) walk(fileURLToPath(new URL(p, import.meta.url)));
  assert.ok(existsSync(fileURLToPath(new URL("../../admin/src", import.meta.url))), "dossier admin/ présent");
  assert.deepEqual(hits, []);
});
