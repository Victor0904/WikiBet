// H2 : profil (pseudo, avatars, titres, trophées épinglés, page publique, profil masqué, coffres).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshDb, login } from "./db.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [A, B] = [id(1), id(2)];
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const as = (db, u) => db.query("select set_config('app.uid', $1, false)", [u]);

test("profil : le catalogue des avatars de la base et de src/avatars.jsx est le même", async () => {
  const db = await freshDb();
  // src/avatars.jsx est du JSX : on y lit les lignes [code, déblocage, valeur, …].
  const src = readFileSync(new URL("../src/avatars.jsx", import.meta.url), "utf8");
  const front = [...src.matchAll(/^\s+\["(\w+)", "(\w+)", (null|\d+|"\w+")/gm)].map(m => [m[1], m[2], m[3] === "null" ? null : m[3].replace(/"/g, "")]);
  const base = (await db.query("select code, unlock, value from avatar_defs order by ord")).rows.map(r => [r.code, r.unlock, r.value]);
  assert.deepEqual(front, base);
  assert.ok(base.length >= 30); assert.ok((await one(db, "select count(*)::int n from title_defs")).n >= 30);
});

test("profil : pseudo de 3 à 16 caractères, unique sans majuscules, filtré, un changement par 30 jours", async () => {
  const db = await freshDb();
  await login(db, A, "Alice");
  for (const [p, re] of [["alice", /déjà pris/], ["ALICE", /déjà pris/], ["ab", /3 à 16/], ["Un pseudo bien trop long", /3 à 16/],
    ["Admin", /interdit ou réservé/], ["Aurelys_fan", /interdit ou réservé/], ["Gros C0nnard", /interdit ou réservé/], ["<script>", /lettres, chiffres/]])
    await assert.rejects(login(db, B, p), re, p);
  await login(db, B, "Élodie-B");
  await db.query("select pseudo_change('Élo')");
  await assert.rejects(db.query("select pseudo_change('Elodie')"), /30 jours/);
  await db.query("update profiles set pseudo_changed_at = now() - interval '31 days' where id = $1", [B]);
  await db.query("select pseudo_change('Elodie')");
});

test("profil : avatars et titres selon le niveau, la ligue, les succès, le coffre ; profil complet", async () => {
  const db = await freshDb();
  await login(db, A, "Alice");
  await db.query("select profile_set('taureau:3')");
  await assert.rejects(db.query("select profile_set('requin:0')"), /pas encore débloqué/);
  await assert.rejects(db.query("select profile_set('taureau:12')"), /Avatar inconnu/);
  await assert.rejects(db.query("select profile_set(p_title => 'dore')"), /pas encore débloqué/);
  await db.query("update profiles set xp = (select xp from xp_curve where level = 5), division = 6 where id = $1", [A]);
  await db.query("select profile_set('requin:0', 'dore')");
  // Coffre : rien à ouvrir, puis un coffre gagné → un avatar de coffre.
  await assert.rejects(db.query("select chest_open()"), /Aucun coffre/);
  await db.query("insert into quest_chests (user_id, week) values ($1, current_date)", [A]);
  const got = (await one(db, "select chest_open() r")).r;
  assert.ok(got.avatar); await db.query("select profile_set($1)", [got.avatar + ":5"]);
  await assert.rejects(db.query("select chest_open()"), /Aucun coffre/, "un coffre ne s'ouvre qu'une fois");
  // Épingles : 3 de ses succès au plus.
  await assert.rejects(db.query("select profile_set(p_pins => array['FIRST_TRADE'])"), /3 de tes succès/);
  await db.query("insert into aur_achievements (user_id, code) values ($1, 'FIRST_TRADE'), ($1, 'GUILDE'), ($1, 'SALAIRE'), ($1, 'LECTEUR')", [A]);
  await assert.rejects(db.query("select profile_set(p_pins => array['FIRST_TRADE', 'GUILDE', 'SALAIRE', 'LECTEUR'])"), /3 de tes succès/);
  await db.query("select profile_set(p_pins => array['FIRST_TRADE', 'GUILDE', 'SALAIRE'])");
  assert.equal((await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = 'PROFIL_COMPLET'", [A])).n, 1);
  // Le titre s'affiche dans les classements.
  await db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, fee_open, aur, dir, lev, entry, created_at, closed_at)
    values ($1, 0, 0, 'aurelys', 100, 'won', 150, 0, 'SLM', 'up', 1, 10, now() - interval '5 minutes', now())`, [A]);
  assert.equal((await one(db, "select title from gains_board('today') where id = $1", [A])).title, "Doré");
  assert.equal((await one(db, "select title from leaderboard() where id = $1", [A])).title, "Doré");
});

test("profil : page publique sans donnée personnelle, profil masqué, pas de page pour un bot", async () => {
  const db = await freshDb();
  await login(db, A, "Alice"); await login(db, B, "Bob");
  await db.query("update auth.users set email = 'alice@exemple.fr' where id = $1", [A]);
  await db.query("insert into account_emails (user_id, email) values ($1, 'alice@exemple.fr')", [A]).catch(() => {});
  const page = (await one(db, "select player_page('alice') r")).r;
  assert.equal(page.pseudo, "Alice"); assert.equal(page.me, false); assert.equal(page.level, 1);
  assert.doesNotMatch(JSON.stringify(page), /exemple|@/);
  await as(db, A); await db.query("select profile_set(p_hidden => true)");
  assert.equal((await one(db, "select player_page('Alice') r")).r.hidden, true, "visible pour soi");
  await as(db, B);
  assert.equal((await one(db, "select player_page('Alice') r")).r, null, "masqué pour les autres");
  assert.equal((await one(db, "select count(*)::int n from leaderboard() where id = $1", [A])).n, 1, "toujours dans les classements");
  await db.query("update profiles set bot = true where id = $1", [A]); await db.query("update profiles set hidden = false where id = $1", [A]);
  assert.equal((await one(db, "select player_page('Alice') r")).r, null);
});
