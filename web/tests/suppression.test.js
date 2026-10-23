import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [ALI, BOB, CAM, BOT] = [1, 2, 3, 4].map(id);
const n = async (db, sql, args) => (await db.query(sql, args)).rows[0].n;

// Suppression de son compte : le joueur et tout ce qui le rattache disparaissent, les autres joueurs et l'historique
// du marché restent ; la guilde passe au membre le plus ancien ; un joueur ne peut ni appeler la fonction ni viser un autre.
test("account_delete : tout le joueur part, rien d'autre", async () => {
  const db = await freshDb();
  await login(db, BOT, "robot"); await db.query("update profiles set bot = true where id = $1", [BOT]);
  await login(db, ALI, "alice", 8);
  const code = (await db.query("select referral_code c from profiles where id = $1", [ALI])).rows[0].c;
  await db.query("select guild_create('Les Baleines', 'BAL', null)");
  const gid = (await db.query("select id from guilds")).rows[0].id;
  await login(db, BOB, "bob"); await db.query("select create_profile('bob')").catch(() => {}); // déjà créé
  await db.query("insert into referrals (filleul, parrain) values ($1, $2) on conflict do nothing", [BOB, ALI]);
  await db.query("select guild_join($1)", [gid]);
  await db.query("select friend_add('alice')");
  await login(db, CAM, "cam");
  await db.query("select set_config('app.uid', $1, false)", [ALI]);
  await db.query("select friend_add('bob')");
  await db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open)
    values ($1, 0, 0, 'aurelys', 100, 'NXR', 'up', 1, 100, 1, 1), ($2, 0, 0, 'aurelys', 50, 'NXR', 'down', 1, 100, 1, 1)`, [ALI, CAM]);
  await db.query("insert into aur_holdings (user_id, tk, qty, cost) values ($1, 'NXR', 3, 300)", [ALI]);
  await db.query("insert into push_subs (endpoint, user_id) values ('https://push.example/a', $1)", [ALI]);
  await db.query("insert into auth.identities (user_id, provider) values ($1, 'discord')", [ALI]);
  await db.query("insert into aur_ticks (tk, t, p) values ('NXR', now() - interval '5 s', 101)");
  await db.query("insert into aur_candles (tk, t, o, h, l, c, v) values ('NXR', date_trunc('hour', now()), 100, 102, 99, 101, 7)");
  await db.query("select set_config('app.uid', '', false)");
  assert.ok(code);

  const market = "select (select count(*) from aur_ticks) + (select count(*) from aur_candles) + (select count(*) from aur_news) as n";
  const before = await n(db, market);
  // Toute colonne uuid de public : aucune ligne ne doit encore porter l'identifiant d'Alice.
  const cols = (await db.query(`select table_name t, column_name c from information_schema.columns
    where table_schema = 'public' and data_type = 'uuid' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')`)).rows;
  const traces = async u => { let s = 0; for (const { t, c } of cols) s += Number(await n(db, `select count(*) n from "${t}" where "${c}" = $1`, [u])); return s };
  assert.ok(await traces(ALI) > 5, "Alice a bien des données avant");

  await assert.rejects(db.query("select account_delete($1, 'bob')", [ALI]), /ne correspond pas/, "le pseudo d'un autre ne suffit pas");
  await assert.rejects(db.query("select account_delete($1, 'robot')", [BOT]), /introuvable/, "jamais un bot");
  await db.query("select account_delete($1, '  Alice ')", [ALI]);

  assert.equal(await traces(ALI), 0, "plus aucune trace d'Alice dans public");
  assert.equal(await n(db, "select count(*)::int n from auth.users where id = $1", [ALI]), 0);
  assert.equal(await n(db, "select count(*)::int n from auth.identities where user_id = $1", [ALI]), 0, "identité Discord partie");
  assert.deepEqual((await db.query("select id, owner from guilds")).rows, [{ id: gid, owner: BOB }], "la guilde passe à Bob");
  assert.equal(await n(db, "select count(*)::int n from profiles where id = any($1)", [[BOB, CAM, BOT]]), 3, "autres joueurs intacts");
  assert.equal(await n(db, "select count(*)::int n from bets where user_id = $1", [CAM]), 1, "positions des autres intactes");
  assert.equal(await n(db, market), before, "historique du marché intact");
  assert.equal(await n(db, "select count(*)::int n from account_delete_log"), 1);
  assert.equal(await n(db, "select count(*)::int n from information_schema.columns where table_name = 'account_delete_log'"), 1, "journal sans identifiant");

  // Chef seul dans sa guilde : elle disparaît.
  await db.query("select set_config('app.uid', $1, false)", [CAM]); await db.query("update profiles set xp = (select xp from xp_curve where level = 8) where id = $1", [CAM]);
  await db.query("select guild_create('Solo', 'SOL', null)"); await db.query("select set_config('app.uid', '', false)");
  await db.query("select account_delete($1, 'cam')", [CAM]);
  assert.equal(await n(db, "select count(*)::int n from guilds where name = 'Solo'"), 0);

  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query(`select has_function_privilege('${role}', 'account_delete(uuid, text)', 'execute') ok`)).rows[0].ok, false, role);
    assert.equal((await db.query(`select has_table_privilege('${role}', 'account_delete_log', 'select') ok`)).rows[0].ok, false, role);
  }
});
