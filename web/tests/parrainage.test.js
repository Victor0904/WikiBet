import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = id(1); // parrain
const codeOf = async (db, u) => (await db.query("select referral_code c from profiles where id = $1", [u])).rows[0].c;
// Nouveau joueur inscrit avec un code de parrainage.
const signup = async (db, u, pseudo, code) => {
  await db.query("insert into auth.users values ($1) on conflict do nothing", [u]);
  await db.query("select set_config('app.uid', $1, false)", [u]);
  return db.query("select create_profile($1, $2)", [pseudo, code]);
};
// Position Aurelys clôturée il y a `days` jours : mise et durée de détention au choix.
const closed = (db, u, days, stake = 100, held = 200) => db.query(
  `insert into bets (user_id, session, day, kind, stake, status, payout, aur, dir, lev, entry, created_at, closed_at)
   values ($1, 0, 0, 'aurelys', $2::float8, 'won', $2::float8 * 1.1, 'SLM', 'up', 1, 10, now() - make_interval(days => $3, secs => $4), now() - make_interval(days => $3))`,
  [u, stake, days, held]);
const studio = (db, u) => db.query("insert into inventory (user_id, item_id, qty) values ($1, 'studio', 1)", [u]);
const ready = async (db, u) => { for (const d of [0, 0, 0, 1, 1]) await closed(db, u, d); await studio(db, u) };
const check = async db => (await db.query("select referral_check() n")).rows[0].n;
const ref = async (db, u) => (await db.query("select * from referrals where filleul = $1", [u])).rows[0];

test("parrainage : code unique, auto-parrainage refusé, code inconnu refusé sans créer le compte", async () => {
  const db = await freshDb(); await login(db, P, "Vayk");
  const code = await codeOf(db, P);
  assert.match(code, /^VAYK-[2-9A-HJ-NP-Z]{3}$/);
  await assert.rejects(db.query("select referral_link($1, $2)", [P, code]), /propre code/);
  await assert.rejects(signup(db, id(2), "Tom", "NOPE-123"), /inconnu/);
  assert.equal((await db.query("select count(*)::int n from profiles where id = $1", [id(2)])).rows[0].n, 0, "rien n'est créé");
  await signup(db, id(2), "Tom", ` https://aurelys-trade.vercel.app/?ref=${code.toLowerCase()} `); // lien collé, minuscules
  assert.equal((await ref(db, id(2))).parrain, P);
  await db.query("select referral_link($1, $2)", [id(2), code]); // un second code ne change rien
  assert.equal((await db.query("select count(*)::int n from referrals")).rows[0].n, 1);
});

test("parrainage : validé seulement avec 5 positions ≥ 100 W tenues 150 s sur 2 jours, et un logement acheté", async () => {
  const db = await freshDb(); await login(db, P, "Vayk");
  const F = id(2); await signup(db, F, "Tom", await codeOf(db, P));
  await closed(db, F, 0, 50); await closed(db, F, 1, 100, 100); // trop petite, trop courte : ne comptent pas
  for (const d of [0, 0, 0, 0]) await closed(db, F, d);
  await studio(db, F);
  assert.equal(await check(db), 0, "4 positions valables, un seul jour");
  await db.query("delete from inventory where user_id = $1", [F]);
  await closed(db, F, 1);
  assert.equal(await check(db), 0, "5 positions sur 2 jours, mais pas de logement");
  const p0 = await cash(db, P), f0 = await cash(db, F);
  await studio(db, F);
  assert.equal(await check(db), 1);
  const r = await ref(db, F);
  assert.equal(r.status, "validé"); assert.equal(r.paid_parrain, 10000); assert.equal(r.paid_filleul, 2000);
  assert.equal(await cash(db, P) - p0, 10000); assert.equal(await cash(db, F) - f0, 2000);
  assert.equal(await check(db), 0, "double validation impossible");
  assert.equal(await cash(db, P) - p0, 10000, "un seul versement");
});

test("parrainage : 5e filleul validé sans récompense pour le parrain, 2 000 W pour le filleul quand même", async () => {
  const db = await freshDb(); await login(db, P, "Vayk"); const code = await codeOf(db, P);
  for (let n = 2; n <= 6; n++) { await signup(db, id(n), "Joueur" + n, code); await ready(db, id(n)) }
  const p0 = await cash(db, P);
  assert.equal(await check(db), 5);
  assert.equal(await cash(db, P) - p0, 40000, "4 récompenses au plus");
  const paid = (await db.query("select paid_parrain p, paid_filleul f from referrals order by created_at, filleul")).rows;
  assert.equal(paid.filter(r => r.p === 10000).length, 4);
  assert.ok(paid.every(r => r.f === 2000));
});

test("parrainage : les bots ne parrainent pas et ne sont pas parrainés", async () => {
  const db = await freshDb(); await login(db, P, "Vayk"); const code = await codeOf(db, P);
  await login(db, id(9), "Robot"); await db.query("update profiles set bot = true where id = $1", [id(9)]);
  assert.equal(await codeOf(db, id(9)), null, "un bot n'a pas de code");
  await assert.rejects(db.query("select referral_link($1, $2)", [id(9), code]), /non valable/, "filleul bot refusé");
  // Devenu bot après l'inscription : jamais validé.
  await signup(db, id(2), "Tom", code); await ready(db, id(2));
  await db.query("update profiles set bot = true where id = $1", [id(2)]);
  assert.equal(await check(db), 0);
  assert.equal((await ref(db, id(2))).status, "en_attente");
});

test("parrainage : chacun ne lit que ses propres parrainages", async () => {
  const db = await freshDb(); await login(db, P, "Vayk"); const code = await codeOf(db, P);
  await signup(db, id(2), "Tom", code); await login(db, id(3), "Zoé");
  await db.exec("grant usage on schema public to authenticated; grant select on referrals to authenticated; set role authenticated");
  const seen = async u => { await db.query("select set_config('app.uid', $1, false)", [u]); return (await db.query("select count(*)::int n from referrals")).rows[0].n };
  assert.equal(await seen(P), 1); assert.equal(await seen(id(2)), 1); assert.equal(await seen(id(3)), 0);
  await db.query("select set_config('app.uid', $1, false)", [P]);
  const m = (await db.query("select my_referrals() r")).rows[0].r;
  assert.equal(m.code, code); assert.equal(m.mine.length, 1); assert.equal(m.mine[0].pseudo, "Tom");
  await assert.rejects(db.query("select referral_check()"), /permission denied/, "validation réservée au serveur");
  await db.exec("reset role");
});
