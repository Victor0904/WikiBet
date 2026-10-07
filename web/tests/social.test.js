import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
const as = (db, id) => db.query("select set_config('app.uid', $1, false)", [id]);
// Pari réglé fictif : mise, paiement, type et date de clôture.
const bet = (db, user, stake, payout, kind = "trade", at = "now()", lev = 1) =>
  db.query(`insert into bets (user_id, session, day, kind, stake, status, payout, closed_at, lev) values ($1, 0, 0, $2, $3, $4, $5, ${at}, $6)`,
    [user, kind, stake, payout > stake ? "won" : "lost", payout, lev]);

test("classement des gains : du jour (minuit à Paris) et total, frais d'ouverture comptés", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await login(db, B, "bob");
  await bet(db, A, 100, 300);                                  // +200 aujourd'hui
  await bet(db, A, 100, 0, "trade", "now() - interval '3 days'"); // -100 il y a 3 jours
  await bet(db, B, 1000, 1100, "crypto", "now()", 10);          // +100 - 10 de frais d'ouverture
  await db.query("insert into bets (user_id, session, day, kind, stake) values ($1, 0, 0, 'trade', 500)", [B]); // ouvert : ignoré
  const day = (await db.query("select pseudo, gain from gains_board('today')")).rows;
  assert.deepEqual(day.map(r => [r.pseudo, r.gain]), [["alice", 200], ["bob", 90]]);
  const tot = (await db.query("select pseudo, gain from gains_board('total')")).rows;
  assert.deepEqual(tot.map(r => [r.pseudo, r.gain]), [["alice", 100], ["bob", 90]]);
});

test("amis : demande, acceptation croisée, retrait, classement entre amis", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await login(db, B, "bob"); await login(db, C, "chloe");
  await bet(db, C, 100, 900);
  await as(db, A);
  assert.equal((await db.query("select friend_add('BOB') as s")).rows[0].s, "envoye");
  await assert.rejects(db.query("select friend_add('alice')"), /C'est toi/);
  await assert.rejects(db.query("select friend_add('personne')"), /Aucun joueur/);
  await as(db, B);
  assert.deepEqual((await db.query("select pseudo, state from my_friends()")).rows, [{ pseudo: "alice", state: "recu" }]);
  assert.equal((await db.query("select friend_add('alice') as s")).rows[0].s, "ami");
  await assert.rejects(db.query("select friend_add('alice')"), /déjà amis/);
  await as(db, A);
  assert.deepEqual((await db.query("select pseudo from gains_board('today', 'friends')")).rows, [], "chloé n'est pas une amie");
  await as(db, C); await db.query("select friend_add('alice')");
  await as(db, A); await db.query("select friend_add('chloe')");
  assert.deepEqual((await db.query("select pseudo from gains_board('today', 'friends')")).rows.map(r => r.pseudo), ["chloe"]);
  await db.query("select friend_remove($1)", [B]);
  assert.deepEqual((await db.query("select pseudo, state from my_friends()")).rows, [{ pseudo: "chloe", state: "ami" }]);
});

test("guildes : une seule à la fois, sigle unique, exclusion par le fondateur, succession, classement", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await login(db, B, "bob"); await login(db, C, "chloe");
  await bet(db, B, 100, 600);
  await as(db, A);
  const { rows: [g] } = await db.query("select * from guild_create('Les Taureaux', 'tor', 'On monte.')");
  assert.equal(g.tag, "TOR");
  await assert.rejects(db.query("select guild_create('Autre', 'AUT')"), /Quitte d'abord/);
  await as(db, B);
  await assert.rejects(db.query("select guild_create('les taureaux', 'XX')"), /déjà pris/);
  await db.query("select guild_join($1)", [g.id]);
  await as(db, C); await db.query("select guild_join($1)", [g.id]);
  await assert.rejects(db.query("select guild_kick($1)", [B]), /Seul le fondateur/);
  const list = (await db.query("select name, members, gain, mine from guild_list('today')")).rows;
  assert.deepEqual(list, [{ name: "Les Taureaux", members: 3, gain: 500, mine: true }]);
  assert.deepEqual((await db.query("select pseudo from gains_board('today', 'guild')")).rows.map(r => r.pseudo), ["bob"]);
  assert.equal((await db.query("select guild from gains_board('today')")).rows[0].guild, "TOR");
  await as(db, A); await db.query("select guild_kick($1)", [C]);
  await db.query("select guild_leave()");
  const m = (await db.query("select pseudo, owner from guild_members_of($1)", [g.id])).rows;
  assert.deepEqual(m, [{ pseudo: "bob", owner: true }], "bob, plus ancien membre, prend la suite");
  await as(db, B); await db.query("select guild_leave()");
  assert.equal((await db.query("select count(*)::int as n from guilds")).rows[0].n, 0, "guilde vide supprimée");
});
