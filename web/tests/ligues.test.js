// H6 : saisons hebdomadaires et ligues. La base et progression.js doivent dire la même chose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";
import { seasonMove, nextDivision, seasonReward, SEASON_XP, maxLevOf } from "../supabase/functions/_shared/progression.js";

const id = n => `00000000-0000-0000-${String(Math.floor(n / 1e6)).padStart(4, "0")}-${String(n % 1e6).padStart(12, "0")}`;
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const weeks = async (db, back = 14) => one(db, `select paris_week(now() - make_interval(days => $1)) w0, paris_week(now() - make_interval(days => $1) + interval '7 days') w1`, [back]);
// n joueurs dans un groupe de la division d, rendements donnés (gain en W sur 10 000 W), trades valides donnés.
async function group(db, w0, rows, d = 5, base = 100) {
  const users = [];
  for (const [i, [gain, trades]] of rows.entries()) {
    const u = id(base + i); users.push(u);
    await db.query("insert into auth.users values ($1)", [u]);
    await db.query("insert into profiles (id, pseudo, division, created_at) values ($1, $2, $3, now() - interval '30 days')", [u, "j" + (base + i), d]);
    for (let k = 0; k < trades; k++) await db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, fee_open, aur, dir, lev, entry, created_at, closed_at)
      values ($1, 0, 0, 'aurelys', 1000, 'won', 1000 + $2::float8, 0, 'SLM', 'up', 1, 10, $3::timestamptz + make_interval(hours => 1 + $4) - interval '200 seconds', $3::timestamptz + make_interval(hours => 1 + $4))`,
      [u, k === 0 ? gain : 0, w0, k]);
    await db.query("select league_enter($1, $2::timestamptz + interval '2 hours')", [u, w0]);
  }
  return users;
}
const row = (db, w0, u) => one(db, "select * from league_members where week = paris_date($1) and user_id = $2", [w0, u]);

test("ligues : la base et progression.js disent la même chose (mouvements, récompenses, levier)", async () => {
  const db = await freshDb();
  for (const n of [1, 2, 3, 9, 10, 11, 19, 20, 37, 100]) for (let r = 1; r <= n; r++)
    assert.equal((await one(db, "select season_move($1, $2) m", [r, n])).m, seasonMove(r, n), `rang ${r} sur ${n}`);
  for (let d = 0; d < 16; d++) assert.equal((await one(db, "select season_reward($1) r", [d])).r, seasonReward(d));
  // n = 100 : 5 / 15 / 60 / 20.
  const m = Array.from({ length: 100 }, (_, i) => seasonMove(i + 1, 100));
  assert.deepEqual([2, 1, 0, -1].map(x => m.filter(y => y === x).length), [5, 15, 60, 20]);
  assert.equal(nextDivision(15, 2, true), 15); assert.equal(nextDivision(0, -1, true), 0); assert.equal(nextDivision(4, 2, false), 4); assert.equal(nextDivision(4, -1, false), 3);
  // ×15 en Platine 1 (division 9) et niveau 25, ×20 en Diamant 1 (12) et niveau 40 : la base suit profiles.division.
  const u = id(1); await login(db, u, "alice", 40);
  for (const [d, lev] of [[0, 10], [8, 10], [9, 15], [12, 20]]) {
    await db.query("update profiles set division = $2 where id = $1", [u, d]);
    assert.equal((await one(db, "select aur_max_lev($1) l", [u])).l, lev); assert.equal(maxLevOf(40, d), lev);
  }
});

test("ligues : entrée au premier trade valide, groupes de 100 au plus par division, bots exclus", async () => {
  const db = await freshDb();
  const u = id(2); await login(db, u, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [u]);
  const tick = p => db.query("insert into aur_ticks (tk, t, p) values ('SLM', clock_timestamp(), $1) on conflict (tk, t) do update set p = excluded.p", [p]);
  const trade = async held => { await tick(10); const b = (await one(db, "select * from aur_open($1, 'SLM', 'up', 1, 100, 0)", [u]));
    await db.query("update bets set created_at = now() - make_interval(secs => $2) where id = $1", [b.id, held]); await tick(10.2);
    await db.query("select aur_close($1, $2, 0)", [u, b.id]) };
  await trade(60);
  assert.equal((await one(db, "select count(*)::int n from league_members")).n, 0, "trade de moins de 150 s : pas encore dans la saison");
  await trade(200);
  const me = await one(db, "select * from league_members where user_id = $1", [u]);
  assert.equal(me.division, 0);
  // 101 joueurs en Argent 1 : deux groupes.
  const { w0 } = await weeks(db, 0);
  await group(db, w0, Array.from({ length: 101 }, () => [0, 0]), 3, 1000);
  assert.deepEqual((await db.query("select count(*)::int n from league_members where division = 3 group by group_id order by 1")).rows.map(r => r.n), [1, 100]);
  const bot = id(3); await login(db, bot, "robot"); await db.query("update profiles set bot = true where id = $1", [bot]);
  await db.query("select league_enter($1)", [bot]);
  assert.equal((await one(db, "select count(*)::int n from league_members where user_id = $1", [bot])).n, 0);
});

test("ligues : clôture 5/15/60/20 sur 20 joueurs, égalités, inéligibles, bornes, une seule fois", async () => {
  const db = await freshDb();
  const { w0, w1 } = await weeks(db);
  // 20 joueurs en Or 3 (division 8) : rendements décroissants ; les 2e et 3e à égalité ; le 1er n'a que 4 trades.
  const gains = [3000, 2000, 2000, 1500, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 0, -100, -200, -300, -400, -500];
  const users = await group(db, w0, gains.map((g, i) => [g, i === 0 ? 4 : 5]), 8);
  const cash0 = (await one(db, "select cash from profiles where id = $1", [users[5]])).cash;
  assert.equal((await one(db, "select week_close($1) ok", [w0])).ok, true);
  assert.equal((await one(db, "select week_close($1) ok", [w0])).ok, false);
  await db.query("select league_settle($1)", [w0]); // rejouée : rien de plus
  const r = await Promise.all(users.map(u => row(db, w0, u)));
  // n = 20 : 1 → +2 ; rangs 2 à 4 → +1 ; 17 à 20 → −1.
  assert.equal(r[0].rank, 1); assert.equal(r[0].move, 0, "1er sans 5 trades : ne monte pas");
  assert.equal(r[0].reward, 0); assert.equal(r[0].eligible, false);
  assert.equal(r[1].rank, 2); assert.equal(r[2].rank, 2, "égalité : même rang, le meilleur"); assert.equal(r[1].move, 1); assert.equal(r[2].move, 1);
  assert.equal(r[3].move, 1); assert.equal(r[4].move, 0);
  assert.deepEqual(r.slice(16).map(x => x.move), [-1, -1, -1, -1]);
  // Récompense identique pour tous les éligibles d'une division ; versée en espèces, une seule fois, hors des paris.
  assert.deepEqual([...new Set(r.slice(1).map(x => x.reward))], [seasonReward(8)]);
  assert.equal((await one(db, "select cash from profiles where id = $1", [users[5]])).cash - cash0, seasonReward(8));
  assert.equal((await one(db, "select count(*)::int n from bets where user_id = $1", [users[5]])).n, 5, "aucune ligne de pari : hors classement des gains");
  assert.equal((await one(db, "select division from profiles where id = $1", [users[1]])).division, 9);
  // XP : participation + divisions gagnées, une fois.
  assert.equal((await one(db, "select amount from xp_log where user_id = $1 and source = 'saison'", [users[1]])).amount, SEASON_XP.play + SEASON_XP.perDiv);
  assert.equal((await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = 'LIGUE_PLATINE'", [users[1]])).n, 1);
  assert.equal((await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = 'PODIUM'", [users[1]])).n, 1);
  void w1;
});

test("ligues : petits groupes (n < 10), Maître et Bronze 1 aux bornes, compte de moins de 48 h", async () => {
  const db = await freshDb();
  const { w0 } = await weeks(db);
  const small = await group(db, w0, [[500, 5], [300, 5], [-900, 5]], 1, 200);
  const top = await group(db, w0, [[500, 5], [100, 5], [0, 5]], 15, 300);
  const pair = await group(db, w0, [[500, 5], [100, 5]], 4, 400);
  const bronze = await group(db, w0, Array.from({ length: 10 }, (_, i) => [1000 - 100 * i, 5]), 0, 500);
  await db.query("update profiles set created_at = now() - interval '1 hour' where id = $1", [small[1]]);
  await db.query("select week_close($1)", [w0]);
  const s = await Promise.all(small.map(u => row(db, w0, u)));
  assert.deepEqual(s.map(x => x.move), [1, 0, 0], "seul le 1er monte, personne ne descend");
  assert.equal(s[1].reward, 0, "compte récent : pas de récompense");
  assert.equal(s[2].reward, seasonReward(1));
  assert.deepEqual((await Promise.all(top.map(u => row(db, w0, u)))).map(x => x.div_after), [15, 15, 15], "pas au-dessus de Maître");
  assert.deepEqual((await Promise.all(pair.map(u => row(db, w0, u)))).map(x => x.move), [0, 0], "moins de 3 joueurs : personne ne monte");
  const last = await row(db, w0, bronze[9]);
  assert.equal(last.div_after, 0, "pas sous Bronze 1"); assert.equal(last.move, 0);
});

test("ligues : la semaine traverse le changement d'heure (25 octobre 2026)", async () => {
  const db = await freshDb();
  const r = await one(db, "select paris_week('2026-10-25 12:00+01') w0, paris_week_end('2026-10-25 12:00+01') w1, paris_week(paris_week('2026-10-19 00:00+02') + interval '8 days') nxt");
  assert.equal(new Date(r.w0).toISOString(), "2026-10-18T22:00:00.000Z"); // lundi 19, 0 h (heure d'été)
  assert.equal(new Date(r.w1).toISOString(), "2026-10-25T23:00:00.000Z"); // lundi 26, 0 h (heure d'hiver)
  assert.equal(new Date(r.nxt).toISOString(), "2026-10-25T23:00:00.000Z");
});
