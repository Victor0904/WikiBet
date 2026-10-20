import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [V1, V2, P1, P2, P3, BOT, MDP, DIS, FON] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);

// Ménage des parties anonymes : sans profil après 7 jours, inactives après 90 jours ; jamais les bots, les comptes
// sauvegardés (mot de passe, Discord) ni les fondateurs de guilde (signalés).
test("anon_purge : à blanc d'abord, puis seulement les parties anonymes abandonnées", async () => {
  const db = await freshDb();
  const old = (u, days) => db.query(`update auth.users set created_at = now() - interval '${days} days' where id = $1`, [u]);
  await db.query("insert into auth.users (id) values ($1), ($2)", [V1, V2]); await old(V1, 8); await old(V2, 3);
  for (const [u, p] of [[P1, "oublie"], [P2, "actif"], [P3, "ordre"], [BOT, "robot"], [MDP, "sauve"], [DIS, "discord"]]) { await login(db, u, p); await old(u, 200) }
  await login(db, FON, "fondateur", 8); await db.query("select guild_create('Les Anciens', 'ANC', null)"); await old(FON, 200);
  await db.query("update profiles set last_seen = now() - interval '100 days' where id <> $1", [P2]);
  await db.query("update profiles set last_seen = now() - interval '10 days' where id = $1", [P2]); // visite récente
  await db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open, created_at)
    values ($1, 0, 0, 'aurelys', 100, 'NXR', 'up', 1, 100, 1, 1, now() - interval '20 days')`, [P3]); // ordre récent
  await db.query("update profiles set bot = true where id = $1", [BOT]);
  await db.query("update auth.users set is_anonymous = false, email = $2, encrypted_password = 'x' where id = $1", [MDP, `${MDP}@joueurs.aurelys.invalid`]);
  await db.query("insert into auth.identities (user_id, provider) values ($1, 'discord')", [DIS]);
  await db.query("select set_config('app.uid', '', false)");

  const dry = (await db.query("select anon_purge(true) r")).rows[0].r;
  assert.deepEqual(dry, { a_blanc: true, sans_profil: 1, inactifs: 1, fondateurs_gardes: ["fondateur"] });
  assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n, 9, "à blanc : rien supprimé");
  assert.equal((await db.query("select count(*)::int n from anon_purge_log")).rows[0].n, 0, "à blanc : rien journalisé");

  const r = (await db.query("select anon_purge() r")).rows[0].r;
  assert.equal(r.sans_profil + r.inactifs, 2);
  const left = (await db.query("select id from auth.users order by id")).rows.map(x => x.id);
  assert.deepEqual(left, [V2, P2, P3, BOT, MDP, DIS, FON], "V1 (visiteur de 8 jours) et P1 (inactif 100 jours) partis");
  assert.equal((await db.query("select count(*)::int n from profiles where id = $1", [P1])).rows[0].n, 0, "profil parti en cascade");
  const log = (await db.query("select sans_profil, inactifs, fondateurs_gardes from anon_purge_log")).rows;
  assert.deepEqual(log, [{ sans_profil: 1, inactifs: 1, fondateurs_gardes: ["fondateur"] }]);
  for (const role of ["anon", "authenticated"])
    assert.equal((await db.query(`select has_function_privilege('${role}', 'anon_purge(boolean)', 'execute') ok`)).rows[0].ok, false, role);
});
