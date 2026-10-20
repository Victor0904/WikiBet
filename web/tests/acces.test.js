import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a";

// Audit d'octobre 2026 : rafales d'ordres limitées à 8 par fenêtre de 10 s et par joueur.
test("order_gate : 8 ordres par 10 s, le 9e refusé sans être compté, puis nouvelle fenêtre", async () => {
  const db = await freshDb();
  await login(db, A, "victor");
  for (let i = 0; i < 8; i++) await db.query("select order_gate($1)", [A]);
  await assert.rejects(db.query("select order_gate($1)", [A]), /Trop d'ordres d'un coup/);
  assert.equal((await db.query("select ord_n from profiles where id = $1", [A])).rows[0].ord_n, 8, "le refus n'est pas compté");
  await db.query("update profiles set ord_win = clock_timestamp() - interval '11 seconds' where id = $1", [A]);
  await db.query("select order_gate($1)", [A]);
  assert.equal((await db.query("select ord_n from profiles where id = $1", [A])).rows[0].ord_n, 1);
  for (const r of ["anon", "authenticated"])
    assert.equal((await db.query(`select has_function_privilege('${r}', 'order_gate(uuid)', 'execute') ok`)).rows[0].ok, false, r);
});

// Fonctions DEFINER : rien pour anon (sauf login_email, connexion du tableau de bord admin), tout pour authenticated.
test("fonctions DEFINER : anon n'exécute que login_email", async () => {
  const db = await freshDb();
  const { rows } = await db.query(`select p.proname n, has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosecdef`);
  assert.deepEqual(rows.filter(r => r.anon).map(r => r.n), ["login_email"]);
  for (const f of ["create_profile", "leaderboard", "aur_feed", "push_subscribe"]) assert.ok(rows.find(r => r.n === f).auth, f);
});

// tick : refusé sans le secret de pg_cron, vérifié avant toute autre action.
test("fonction aurelys : tick exige x-tick-secret, les ordres passent par order_gate", () => {
  const src = readFileSync(new URL("../supabase/functions/aurelys/index.ts", import.meta.url), "utf8");
  const tick = src.indexOf('body.action === "tick"'), check = src.indexOf('req.headers.get("x-tick-secret") !== secret');
  assert.ok(tick > 0 && check > tick && check - tick < 300, "contrôle du secret juste après la branche tick");
  assert.ok(src.indexOf("order_gate") < src.indexOf('body.action === "open"'), "order_gate avant le premier ordre");
});
