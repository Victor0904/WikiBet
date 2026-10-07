import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const as = (db, id) => db.query("select set_config('app.uid', $1, false)", [id]);
const idx = (db, p = 1000) => db.query("insert into aur_ticks (tk, t, p) values ('AUR12', now() - interval '1 second', $1)", [p]);

async function city() {
  const db = await freshDb();
  await login(db, A, "alice"); await login(db, B, "bob");
  await as(db, A);
  const { rows: [g] } = await db.query("select * from guild_create('Les Taureaux', 'TOR')");
  await as(db, B); await db.query("select guild_join($1)", [g.id]);
  await db.query("update profiles set cash = 5000000");
  await idx(db);
  return { db, g };
}

test("ville : dons au Trésor, construction par le fondateur, mairie d'abord", async () => {
  const { db, g } = await city();
  await db.query("select city_give(300000, 'tresor')");                 // bob donne
  assert.equal(await cash(db, B), 4700000);
  await assert.rejects(db.query("select city_build('mairie')"), /fondateur/);
  await as(db, A);
  await assert.rejects(db.query("select city_build('salle')"), /mairie/);
  await db.query("select city_build('mairie')");
  await db.query("select city_build('salle')");
  await assert.rejects(db.query("select city_build('salle')"), /mairie/, "niveau 2 seulement avec une mairie de niveau 2");
  const { rows: [{ v }] } = await db.query("select city_view($1) as v", [g.id]);
  assert.equal(v.treasury, 300000 - 10000 - 15000); assert.equal(v.cap, 35); assert.equal(v.donors[0].pseudo, "bob");
});

test("ville : salle des marchés (frais), banque (liquidation) ; l'observatoire ne touche plus aux cotes", async () => {
  const { db } = await city();
  await db.query("update guilds set treasury = 1e7");
  await as(db, A);
  for (const b of ["mairie", "salle", "banque", "observatoire"]) await db.query("select city_build($1)", [b]);
  await db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - interval '2 seconds', 10)");
  const { rows: [o] } = await db.query("select * from aur_open($1, 'SLM', 'up', 5, 1000, 0)", [B]);
  assert.equal(o.fees, 4.5, "frais −10 % (5 W → 4,5 W)");
  await db.query("update bets set created_at = now() - interval '10 seconds' where id = $1", [o.id]);
  await db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - interval '1 second', 7)");
  await db.query("select aur_settle()");
  const { rows: [l] } = await db.query("select payout, insured from bets where id = $1", [o.id]);
  assert.equal(l.payout, 150); assert.equal(l.insured, true, "banque : 15 % de la mise rendus");
});

test("ville : entretien selon les membres actifs, la ville s'endort sans Trésor ; dividende pris sur les gains du fonds", async () => {
  const { db } = await city();
  await db.query("update guilds set treasury = 10000");
  await as(db, A); await db.query("select city_build('mairie')");               // Trésor vide après la mairie
  await db.query("select city_give(3000000, 'fonds')");                         // 3 000 unités d'AUR-12 à 1 000
  await db.query("update guild_members set joined_at = now() - interval '5 days'");
  await db.query("insert into bets (user_id, session, day, kind, stake, status, created_at) values ($1, 0, 0, 'trade', 10, 'lost', day_start() - interval '2 hours')", [B]);
  await db.query("update guilds set last_day = paris_day() - 1");
  const before = await cash(db, B);
  await db.query("select city_daily()");
  assert.equal((await db.query("select asleep from city_buildings")).rows[0].asleep, true, "Trésor vide : la mairie s'endort");
  assert.equal(await cash(db, B), before, "fonds sans gain : pas de dividende (pas d'argent créé)");
  await idx(db, 1100);                                                           // l'AUR-12 gagne 10 %
  await db.query("update guilds set last_day = paris_day() - 1");
  await db.query("select city_daily()");
  assert.equal(Math.round(await cash(db, B)), Math.round(before + 150000), "moitié du gain (300 000 W) au seul membre actif");
  const { rows: [g] } = await db.query("select fund_units, fund_hwm from guilds");
  assert.equal(Math.round(g.fund_units * 1100), 3150000, "le dividende sort du fonds");
  await db.query("select city_daily()");
  assert.equal(Math.round(await cash(db, B)), Math.round(before + 150000), "une seule fois par jour");
});

test("ville : parcelles achetées par le fondateur avec le Trésor, de plus en plus chères", async () => {
  const { db, g } = await city();
  await db.query("update guilds set treasury = 30000");
  await assert.rejects(db.query("select city_buy_land()"), /fondateur/);
  await as(db, A);
  await db.query("select city_buy_land()");                                  // 6 000
  await db.query("select city_buy_land()");                                  // 24 000
  await assert.rejects(db.query("select city_buy_land()"), /Trésor insuffisant/); // 54 000
  const { rows: [{ v }] } = await db.query("select city_view($1) as v", [g.id]);
  assert.equal(v.land, 2); assert.equal(v.treasury, 0); assert.equal(v.land_cost, 54000);
});
