// H7 : guildes à objectif hebdomadaire. Les valeurs de progression.js et de la base doivent être les mêmes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";
import { guildCap, guildMin, guildG, guildXp, guildLevelOf, GUILD_XP_TOTAL } from "../supabase/functions/_shared/progression.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const as = (db, u) => db.query("select set_config('app.uid', $1, false)", [u]);
// Semaine passée (lundi 0 h, Paris) : w0, et la suivante w1.
const weeks = async (db, back = 14) => one(db, `select paris_week(now() - make_interval(days => $1)) w0, paris_week(now() - make_interval(days => $1) + interval '7 days') w1`, [back]);
// Trade clôturé dans la semaine : mise 1 000 W, gain g, tenu 200 s (valide).
const closed = (db, u, at, g, stake = 1000) => db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, fee_open, aur, dir, lev, entry, created_at, closed_at)
  values ($1, 0, 0, 'aurelys', $4::float8, 'won', $4::float8 + $3::float8, 0, 'SLM', 'up', 1, 10, $2::timestamptz - interval '200 seconds', $2::timestamptz)`, [u, at, g, stake]);
// Guilde de n joueurs (chef = premier), arrivés avant w0.
async function guild(db, n, w0, base = 10) {
  const users = Array.from({ length: n }, (_, i) => id(base + i));
  await login(db, users[0], "chef" + base, 8);
  const g = (await one(db, "select (guild_create('Les Taureaux' || $1, 'T' || $1)).id", [base])).id;
  for (const u of users.slice(1)) { await login(db, u, "m" + u.slice(-3)); await db.query("select guild_join($1)", [g]) }
  await db.query("update guild_members set joined_at = $2::timestamptz - interval '1 day' where guild_id = $1", [g, w0]);
  return { g, users };
}

test("guildes : la base et progression.js disent la même chose (niveaux, plafond, minimum, g, XP)", async () => {
  const db = await freshDb();
  for (const xp of [0, 499, 500, 1500, 5000, 94999, 95000, 1e7]) assert.equal((await one(db, "select guild_level($1) l", [xp])).l, guildLevelOf(xp), `xp ${xp}`);
  for (let l = 1; l <= 20; l++) {
    assert.equal((await one(db, "select guild_level_xp($1) x", [l])).x, GUILD_XP_TOTAL[l]);
    assert.equal((await one(db, "select guild_cap($1) c", [l])).c, guildCap(l));
    assert.equal((await one(db, "select guild_min(7, $1) m", [l])).m, guildMin(7, l));
  }
  for (const r of [0.5, 1, 1.2, 1.5, 1.8, 2, 2.6, 3, 4.1, 5, 6]) assert.ok(Math.abs((await one(db, "select guild_g($1) g", [r])).g - guildG(r)) < 1e-9, `g(${r})`);
  for (const [n, t, m, tot] of [[10, 2000, 2000, 2500], [10, 4000, 2000, 3100], [12, 6600, 2200, 1000], [7, 3500, 1400, 3500]])
    assert.equal((await one(db, "select guild_xp_for($1, $2, $3, $4) x", [n, t, m, tot])).x, guildXp(n, t, m, tot));
  assert.equal(guildCap(1), 10); assert.equal(guildCap(17), 50); assert.equal(GUILD_XP_TOTAL[20], 95000);
});

test("guildes : objectif verrouillé le lundi, arrivant exclu, contributions bornées, XP une seule fois", async () => {
  const db = await freshDb();
  const { w0, w1 } = await weeks(db);
  const { g, users: [a, b, c] } = await guild(db, 3, w0);
  await db.query("select guild_lock($1)", [w0]);
  const late = id(30); await login(db, late, "tardif"); await db.query("select guild_join($1)", [g]); // arrivé après le verrouillage
  await db.query("update guild_members set joined_at = $2::timestamptz + interval '1 day' where user_id = $1", [late, w0]);
  const q = await one(db, "select * from guild_goals where guild_id = $1 and week = paris_date($2)", [g, w0]);
  assert.equal(q.members, 3); assert.equal(q.min, guildMin(3, 1)); assert.equal(q.target, q.min);
  // a : +5 000 W (borné à +40 % de la cible), 3 trades valides ; b : −5 000 W (borné à −10 %), 1 trade ; c : rien.
  for (const s of [3600, 7200, 10800]) await closed(db, a, new Date(+w0 + s * 1000).toISOString(), 5000 / 3);
  await closed(db, b, new Date(+w0 + 3600e3).toISOString(), -900, 1000);
  await db.query("update bets set payout = 0, status = 'lost' where user_id = $1", [b]);
  await closed(db, late, new Date(+w0 + 3600e3).toISOString(), 99999);
  const xa = (await one(db, "select xp from profiles where id = $1", [a])).xp, xb = (await one(db, "select xp from profiles where id = $1", [b])).xp;
  assert.equal((await one(db, "select week_close($1) ok", [w0])).ok, true);
  assert.equal((await one(db, "select week_close($1) ok", [w0])).ok, false, "rejouer la clôture ne fait rien");
  await db.query("select guild_settle($1)", [w0]);
  const r = await one(db, "select * from guild_goals where guild_id = $1 and week = paris_date($2)", [g, w0]);
  const cap = 0.4 * q.target, floor = -0.1 * q.target;
  assert.equal(Math.round(r.total), Math.round(cap + floor)); // a plafonné à +40 %, b à −10 %, c à 0
  assert.equal(r.status, "missed");
  assert.ok(!(await one(db, "select count(*)::int n from guild_goal_members where user_id = $1 and week = paris_date($2)", [late, w0])).n, "l'arrivant ne compte pas");
  assert.equal(r.xp, guildXp(3, q.target, q.min, r.total));
  assert.equal((await one(db, "select xp from guilds where id = $1", [g])).xp, r.xp);
  // Semaine suivante verrouillée à la clôture, avec l'arrivant.
  assert.equal((await one(db, "select members from guild_goals where guild_id = $1 and week = paris_date($2)", [g, w1])).members, 4);
  // XP de trader des membres : seulement si l'objectif est atteint, et 3 trades valides ou plus.
  const dA = (await one(db, "select xp from profiles where id = $1", [a])).xp - xa, dB = (await one(db, "select xp from profiles where id = $1", [b])).xp - xb;
  assert.equal(dB, 0);
  assert.equal(dA, 0, "objectif manqué : pas d'XP de membre");
});

test("guildes : objectif atteint (cible ×2), partiel, manqué ; succès et série", async () => {
  const db = await freshDb();
  // 3 membres : chacun plafonné à 40 % de la cible (il en faut 3 pour l'atteindre).
  for (const [k, frac, expect] of [[0, .35, "reached"], [1, .27, "partial"], [2, .1, "missed"]]) {
    const { w0 } = await weeks(db, 30 + 7 * k);
    const { g, users } = await guild(db, 3, w0, 40 + 10 * k);
    await as(db, users[0]); await db.query("select guild_set(p_ratio => 2)");
    await db.query("select guild_lock($1)", [w0]);
    const q = await one(db, "select * from guild_goals where guild_id = $1", [g]);
    assert.equal(q.target, 2 * q.min);
    for (const u of users) for (const s of [3600, 7200, 10800]) await closed(db, u, new Date(+w0 + s * 1000).toISOString(), frac * q.target / 3);
    await db.query("select guild_settle($1)", [w0]);
    const r = await one(db, "select * from guild_goals where guild_id = $1", [g]);
    assert.equal(r.status, expect, `${expect} : total ${r.total} / ${r.target}`);
    assert.equal(r.xp, expect === "reached" ? Math.round(100 * 3 * guildG(2)) : expect === "partial" ? Math.round(Math.round(100 * 3 * guildG(2)) / 4) : 0);
    const ach = (await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = 'OBJECTIF_GUILDE'", [users[1]])).n;
    assert.equal(ach, expect === "reached" ? 1 : 0);
  }
});

test("guildes : 24 h entre deux guildes, guilde sur invitation, plafond selon le niveau, chef et transfert", async () => {
  const db = await freshDb();
  const { w0 } = await weeks(db);
  const { g, users: [a, b] } = await guild(db, 2, w0);
  await as(db, b); await db.query("select guild_leave()");
  await assert.rejects(db.query("select guild_join($1)", [g]), /moins de 24 h/);
  await db.query("update profiles set guild_left_at = now() - interval '25 hours' where id = $1", [b]);
  await as(db, a); await db.query("select guild_set(p_open => false)");
  await as(db, b); await assert.rejects(db.query("select guild_join($1)", [g]), /sur invitation/);
  await as(db, a); await assert.rejects(db.query("select guild_invite('personne')"), /Aucun joueur/);
  const pseudoB = (await one(db, "select pseudo from profiles where id = $1", [b])).pseudo;
  await db.query("select guild_invite($1)", [pseudoB]);
  await as(db, b); await db.query("select guild_join($1)", [g]);
  assert.equal((await one(db, "select count(*)::int n from guild_invites")).n, 0, "invitation consommée");
  // Plafond : 10 joueurs au niveau 1.
  await as(db, a); await db.query("select guild_set(p_open => true)");
  for (let i = 0; i < 8; i++) { const u = id(60 + i); await login(db, u, "pl" + i); await db.query("select guild_join($1)", [g]) }
  const extra = id(70); await login(db, extra, "onzieme");
  await assert.rejects(db.query("select guild_join($1)", [g]), /complète \(10 membres au niveau 1\)/);
  await db.query("update guilds set xp = 1500 where id = $1", [g]); // niveau 3 : 15 membres
  await db.query("select guild_join($1)", [g]);
  // Transfert, puis exclusion par le nouveau chef seulement.
  await as(db, a); await db.query("select guild_transfer($1)", [b]);
  await assert.rejects(db.query("select guild_kick($1)", [extra]), /Seul le chef/);
  await as(db, b); await db.query("select guild_kick($1)", [extra]);
  assert.ok((await one(db, "select guild_left_at is not null ok from profiles where id = $1", [extra])).ok, "exclu : 24 h aussi");
  // Personnalisation selon le niveau (niveau 3).
  await assert.rejects(db.query("select guild_set(p_emblem => 11)"), /niveau 18/);
  await db.query("select guild_set(p_emblem => 3, p_descr => 'On trade la météo.')");
  // Chef absent depuis 14 jours : le membre actif le plus ancien prend la tête.
  await db.query("update profiles set last_seen = now() - interval '15 days' where id = $1", [b]);
  await db.query("update profiles set last_seen = now() where id in ($1, $2)", [a, id(61)]);
  await db.query("select week_tick()");
  assert.equal((await one(db, "select owner from guilds where id = $1", [g])).owner, a);
});

test("guildes : saison du mois (top 3, 5 membres actifs au moins, +200 XP), migration sans exclusion", async () => {
  const db = await freshDb();
  const { w0 } = await weeks(db, 40);
  const big = await guild(db, 6, w0, 80), small = await guild(db, 4, w0, 90);
  for (const x of [big, small]) {
    await db.query("select guild_lock($1)", [w0]);
    for (const u of x.users) for (const s of [3600, 7200, 10800]) await closed(db, u, new Date(+w0 + s * 1000).toISOString(), 1000);
  }
  await db.query("select guild_settle($1)", [w0]);
  const m = (await one(db, "select date_trunc('month', paris_date($1))::date m", [w0])).m;
  const x0 = (await one(db, "select xp from profiles where id = $1", [big.users[1]])).xp;
  await db.query("select guild_month_close($1)", [m]); await db.query("select guild_month_close($1)", [m]);
  const t = (await db.query("select guild_id, rank from guild_trophies")).rows;
  assert.deepEqual(t, [{ guild_id: big.g, rank: 1 }], "4 membres actifs : pas classée");
  assert.equal((await one(db, "select xp from profiles where id = $1", [big.users[1]])).xp - x0, 200);
});

test("guildes : gain de la semaine d'une position à cheval (cours de la frontière), noms filtrés", async () => {
  const db = await freshDb();
  const { w0, w1 } = await weeks(db);
  const u = id(10); await login(db, u, "alice", 8);
  const tick = (t, p) => db.query("insert into aur_ticks (tk, t, p) values ('SLM', $1, $2) on conflict (tk, t) do update set p = excluded.p", [t, p]);
  await tick(new Date(+w0 - 1000).toISOString(), 11); await tick(new Date(+w1 - 1000).toISOString(), 12);
  // Ouverte avant la semaine au cours 10, toujours ouverte : 1 000 W × (12/11 − 1).
  await db.query(`insert into bets (user_id, session, day, kind, stake, status, aur, dir, lev, entry, fee_open, created_at)
    values ($1, 0, 0, 'aurelys', 1000, 'open', 'SLM', 'up', 1, 10, 1, $2::timestamptz - interval '1 day')`, [u, w0]);
  const pnl = (await one(db, "select week_pnl($1, $2, $3) g", [u, w0, w1])).g;
  assert.ok(Math.abs(pnl - (1200 - 1100)) < 1e-6, `gain ${pnl}`);
  await as(db, u);
  for (const bad of ["Admin Team", "Les Encul3s", "FDP", "Aurelys Pro"]) await assert.rejects(db.query("select guild_create($1, 'ZZ')", [bad]), /interdit|réservé/, bad);
  await db.query("select guild_create('Conseil des sages', 'CDS')"); // « con » dans un mot : accepté
});
