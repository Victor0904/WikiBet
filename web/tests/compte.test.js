import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

test("Connexion par pseudo : adresse interne seulement, pseudo exact d'abord, sans majuscules sinon", async () => {
  const db = await freshDb();
  const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
  await login(db, A, "Bob"); await login(db, B, "bob"); await login(db, C, "Anon");
  for (const id of [A, B]) await db.query("update auth.users set email = $1 || '@joueurs.aurelys.invalid' where id = $1", [id]);
  const mail = async p => (await db.query("select login_email($1) e", [p])).rows[0].e;
  assert.equal(await mail("bob"), B + "@joueurs.aurelys.invalid");
  assert.equal(await mail(" Bob "), A + "@joueurs.aurelys.invalid");
  assert.equal(await mail("BOB") != null, true);
  assert.equal(await mail("Anon"), null); // pas de mot de passe : pas de connexion
  await db.query("update auth.users set email = 'vrai@exemple.fr' where id = $1", [C]);
  assert.equal(await mail("anon"), null); // une vraie adresse ne sort jamais
});

test("Connexion par e-mail : facultative, unique, mot de passe requis", async () => {
  const db = await freshDb();
  const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
  await login(db, B, "Bea");
  await assert.rejects(db.query("select set_login_email('bea@exemple.fr')"), /mot de passe/);
  await db.query("update auth.users set email = id || '@joueurs.aurelys.invalid'");
  await db.query("select set_login_email(' Bea@Exemple.fr ')");
  await login(db, A, "Alix");
  await db.query("update auth.users set email = id || '@joueurs.aurelys.invalid'");
  await assert.rejects(db.query("select set_login_email('bea@exemple.fr')"), /déjà utilisé/);
  await assert.rejects(db.query("select set_login_email('pas-une-adresse')"), /invalide/);
  const mail = async p => (await db.query("select login_email($1) e", [p])).rows[0].e;
  assert.equal(await mail("BEA@exemple.fr"), B + "@joueurs.aurelys.invalid");
  await login(db, B);
  await db.query("select set_login_email('')");
  assert.equal(await mail("bea@exemple.fr"), null);
});
