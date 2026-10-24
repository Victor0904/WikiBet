import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";

test("pseudo : jamais une adresse e-mail, à l'inscription comme au changement", async () => {
  const db = await freshDb();
  for (const p of ["bob@exemple.fr", "bob.dupont@gmail", "bobdupont.com", "MonHotmail", "x"])
    await assert.rejects(login(db, A, p), /e-mail|3 à 16/, p);
  await login(db, A, "Bob.Le.Bricoleur");
  await assert.rejects(db.query("update profiles set pseudo = 'a@b.fr' where id = $1", [A]), /profiles_pseudo_email/);
  await db.query("select pseudo_change('Robert')"); // un changement par 30 jours (H2)
  await assert.rejects(db.query("select pseudo_change('Roberto')"), /30 jours/);
});

test("pseudo en forme d'e-mail : renommé Joueur-XXXX, prévenu, connexion gardée, code de parrainage refait", async () => {
  const db = await freshDb();
  await login(db, B, "Autre");
  await db.query("alter table profiles drop constraint profiles_pseudo_email");
  await login(db, A);
  await db.query("insert into profiles (id, pseudo) values ($1, 'Jean.D@Exemple.fr')", [A]); // inscrit avant la règle
  await db.query("update auth.users set email = id || '@joueurs.aurelys.invalid' where id = $1", [A]);
  const before = (await db.query("select referral_code from profiles where id = $1", [A])).rows[0].referral_code;
  assert.equal((await db.query("select pseudo_email_fix() n")).rows[0].n, 1);
  assert.equal((await db.query("select pseudo_email_fix() n")).rows[0].n, 0); // rejouée : rien de plus
  await db.query("alter table profiles add constraint profiles_pseudo_email check (not pseudo_email_like(pseudo))");
  const p = (await db.query("select * from profiles where id = $1", [A])).rows[0];
  assert.match(p.pseudo, /^Joueur-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(p.pseudo_free, true);
  assert.notEqual(p.referral_code, before);
  assert.match(p.referral_code, /^JOUE-/);
  // Plus aucune copie de l'adresse dans les données publiques.
  const pub = JSON.stringify((await db.query("select * from profiles")).rows) + JSON.stringify((await db.query("select * from leaderboard()")).rows);
  assert.doesNotMatch(pub, /exemple/i);
  // Connexion avec l'ancienne adresse : elle passe par l'e-mail privé.
  assert.equal((await db.query("select login_email('jean.d@exemple.fr') e")).rows[0].e, A + "@joueurs.aurelys.invalid");
  // Le joueur lit son message, puis choisit un pseudo une fois.
  await login(db, A);
  const [n] = (await db.query("select * from my_notices()")).rows;
  assert.equal(n.kind, "pseudo"); assert.equal(n.body.pseudo, p.pseudo);
  await db.query("select notice_read($1)", [n.id]);
  assert.equal((await db.query("select * from my_notices()")).rows.length, 0);
  await assert.rejects(db.query("select pseudo_change('autre')"), /déjà pris/);
  await assert.rejects(db.query("select pseudo_change('jean@exemple.fr')"), /e-mail/);
  await db.query("select pseudo_change(' Jeannot ')");
  assert.equal((await db.query("select pseudo from profiles where id = $1", [A])).rows[0].pseudo, "Jeannot");
  await assert.rejects(db.query("select pseudo_change('Jean2')"), /30 jours/); // puis un par 30 jours
  // Un autre joueur ne lit pas les messages des autres.
  await login(db, B);
  assert.equal((await db.query("select * from my_notices()")).rows.length, 0);
});
