// H1 : suppression du QG, de la banque, des talents et de la ville de guilde (20261028300000_suppressions.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrateFrom, login } from "./db.js";

const H1 = "20261028300000";
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c",
  D = "00000000-0000-0000-0000-00000000000d";
const one = async (db, sql, args) => (await db.query(sql, args)).rows[0];
const cashOf = async (db, id) => +(await one(db, "select cash from profiles where id = $1", [id])).cash;

// Avant H1 : A a un dépôt, un logement, de la déco, un bonus, un cosmétique et des talents ; B a le penthouse ;
// C est un bot avec un logement ; deux guildes de joueurs (avec et sans dons) et une guilde de bots ont un Trésor.
async function before() {
  const db = await freshDb({ until: H1 });
  await login(db, A, "Alice"); await login(db, B, "Bruno"); await login(db, C, "Robot"); await login(db, D, "Dora");
  await db.query("update profiles set cash = 400000, bank = 5000 where id = $1", [A]);
  await db.query("update profiles set cash = 400000 where id in ($1, $2, $3)", [B, C, D]);
  await db.query("update profiles set tal_hwm = 13000, tal_cum = 9000 where id = $1", [A]); // niveau de talent 5
  await login(db, A);
  for (const it of ["studio", "lampe", "assurance", "theme_cyan"]) await db.query("select buy_item($1)", [it]);
  await login(db, B);
  for (const it of ["studio", "openspace", "loft", "penthouse"]) await db.query("select buy_item($1)", [it]);
  await login(db, C); await db.query("select buy_item('studio')");
  await db.query("update profiles set bot = true where id = $1", [C]);
  // Trésors : guilde d'Alice (dons d'Alice et de Bruno), guilde de Dora (sans don), guilde du bot.
  await login(db, A); const g1 = (await one(db, "select (guild_create('Les Alices', 'ALI')).id")).id;
  await login(db, B); await db.query("select guild_join($1)", [g1]);
  await login(db, D); const g2 = (await one(db, "select (guild_create('Doraville', 'DOR')).id")).id;
  await login(db, C); const g3 = (await one(db, "select (guild_create('Les Robots', 'ROB')).id")).id;
  await db.query("insert into city_gifts (guild_id, user_id, kind, amount) values ($1, $2, 'tresor', 3000), ($1, $3, 'tresor', 1000)", [g1, A, B]);
  await db.query("update guilds set treasury = 2000 where id = $1", [g1]); // 4 000 donnés, 2 000 dépensés en bâtiments
  await db.query("update guilds set treasury = 900 where id = $1", [g2]);
  await db.query("update guilds set treasury = 700 where id = $1", [g3]);
  // Un trade clôturé, pour les classements de gains.
  await db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, exit, fees, fee_open, status, payout, created_at, closed_at)
                  values ($1, 0, 0, 'aurelys', 1000, 'PXF', 'up', 1, 10, 11, 2, 1, 'won', 1098, now() - interval '10 minutes', now() - interval '1 minute')`, [A]);
  return { db, g1, g2, g3 };
}

test("H1 : banque, objets et Trésors rendus ou détruits, W conservés à l'unité, gains de trading inchangés", async () => {
  const { db, g1, g2, g3 } = await before();
  const cash0 = Object.fromEntries((await db.query("select id, cash, bank from profiles")).rows.map(r => [r.id, +r.cash + +r.bank]));
  const total0 = +(await one(db, `select (select sum(cash + bank) from profiles) + (select sum(treasury) from guilds)
    + (select sum(case when s.kind = 'bonus' then s.price else floor(s.price * .6) end * i.qty) from inventory i join shop_items s on s.id = i.item_id where i.qty > 0) t`)).t;
  const hwm0 = (await db.query("select id, tal_hwm, tal_cum from profiles order by id")).rows;
  const gains0 = (await db.query("select id, gain from gains_board('total', 'all') order by id")).rows;
  await migrateFrom(db, H1);

  const r = (await db.query("select user_id, guild_id, kind, item, amount from h1_refunds order by id")).rows;
  const sum = (f) => r.filter(f).reduce((a, x) => a + x.amount, 0);
  // Alice : dépôt + studio et lampe à 60 % + assurance à 100 % + 3/4 du Trésor de sa guilde ; le thème n'est pas rendu.
  const alice = 5000 + 7200 + 240 + 2500 + 1500;
  assert.equal(sum(x => x.user_id === A && x.kind !== "cosmetique"), alice);
  assert.equal(await cashOf(db, A), cash0[A] - 5000 + alice);
  assert.deepEqual(r.filter(x => x.user_id === A && x.kind === "cosmetique").map(x => [x.item, x.amount]), [["theme_cyan", 1200]]);
  // Bruno : ses logements à 60 % et 1/4 du Trésor ; Dora : tout le Trésor de sa guilde, sans don enregistré.
  assert.equal(await cashOf(db, B), cash0[B] + (12000 + 35000 + 90000 + 250000) * .6 + 500);
  assert.equal(await cashOf(db, D), cash0[D] + 900);
  // Bot : aucune espèce touchée, son logement et le Trésor de sa guilde détruits (journalisés).
  assert.equal(await cashOf(db, C), cash0[C]);
  assert.deepEqual(r.filter(x => x.kind === "detruit").map(x => [x.user_id, x.guild_id == null ? null : +x.guild_id, x.item, x.amount]),
    [[C, null, "studio", 7200], [null, +g3, null, 700]]);
  assert.ok(g1 && g2);
  // Conservation : avant − détruit = après, à l'unité.
  const total1 = +(await one(db, "select sum(cash) t from profiles")).t;
  assert.ok(Math.abs(total0 - sum(x => ["detruit", "cosmetique"].includes(x.kind)) - total1) < 1, `${total0} → ${total1}`);
  // Ni le record de gain net, ni les classements de gains ne bougent.
  assert.deepEqual((await db.query("select id, tal_hwm, tal_cum from profiles order by id")).rows, hwm0);
  assert.deepEqual((await db.query("select id, gain from gains_board('total', 'all') order by id")).rows, gains0);
  // Historique et message du joueur.
  await login(db, A);
  assert.deepEqual((await db.query("select kind, amount from my_refunds()")).rows, [{ kind: "banque", amount: 5000 }, { kind: "qg", amount: alice - 5000 }]);
  const n = (await db.query("select kind, body from my_notices()")).rows;
  assert.deepEqual(n, [{ kind: "h1", body: { w: alice - 5000, bank: 5000, level: 6 } }]);
  await login(db, C);
  assert.equal((await db.query("select * from my_notices()")).rows.length, 0); // pas de message aux bots
  // Guildes gardées, membres compris.
  assert.equal(+(await one(db, "select count(*) n from guild_members where guild_id in ($1, $2, $3)", [g1, g2, g3])).n, 4);
});

test("H1 : règles d'un joueur sans talent, niveau de départ, ordres à déclenchement gardés, parrainage en attente", async () => {
  const { db } = await before();
  await db.query("insert into talents values ($1, 'frais', 5), ($1, 'discretion', 4), ($1, 'calibre', 3)", [A]);
  await migrateFrom(db, H1);
  for (const id of [A, B, D]) {
    assert.equal(+(await one(db, "select aur_fee_rate($1) f", [id])).f, 0.001);
    assert.equal((await one(db, "select aur_max_lev($1) n", [id])).n, 15);
    assert.equal((await one(db, "select aur_max_pos($1) n", [id])).n, 12);
  }
  assert.deepEqual((await db.query("select id, lvl_floor, trig_ok from profiles where id in ($1, $2, $3) order by id", [A, B, D])).rows,
    [{ id: A, lvl_floor: 6, trig_ok: false }, { id: B, lvl_floor: 1, trig_ok: true }, { id: D, lvl_floor: 1, trig_ok: false }]);
  await login(db, A);
  assert.deepEqual(await one(db, "select my_terms() t").then(x => x.t), { fee: 0.001, cut: 1, kraken: false, max_pos: 12, max_lev: 15, stop: true, triggers: false });
  await assert.rejects(db.query("select aur_trigger_add('PXF', 'up', 1, 100, 1)"), /niveaux de trader/);
  // Plus aucune fonction ne parle du QG, de la banque, des talents ou de la ville ; les bots non plus.
  const bad = "home_level|city_|tal_rank|talent_|inventory|shop_items|treasury|fund_units|\\.bank\\b|bank_since|kraken_|consume_bonus|buy_item|aur_index|aur_revisions|salary_boost";
  const { rows } = await db.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and prosrc ~ $1`, [`(${bad})`]);
  assert.deepEqual(rows, []);
  assert.ok(+(await one(db, "select count(*) n from pg_proc where proname like 'bots%' or proname = 'guild_bot_yield'")).n >= 3);
  // Succès retirés.
  assert.equal(+(await one(db, "select count(*) n from achievements where code in ('PROPRIO', 'BANQUIER', 'SPECIALISTE', 'POLYVALENT')")).n, 0);
  // Parrainage : en attente tant que le filleul n'a pas le niveau 3 de trader.
  await db.query("insert into referrals (filleul, parrain) values ($1, $2)", [D, A]);
  for (let i = 0; i < 5; i++) await db.query(`insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open, status, payout, created_at, closed_at)
    values ($1, 0, 0, 'aurelys', 100, 'PXF', 'up', 1, 10, 0, 0, 'won', 101, now() - interval '2 days' + $2 * interval '1 day', now() - interval '2 days' + $2 * interval '1 day' + interval '5 minutes')`, [D, i % 2]);
  await db.query("select referral_check()");
  assert.equal((await one(db, "select status from referrals where filleul = $1", [D])).status, "en_attente");
  await db.query("update profiles set lvl_floor = 3 where id = $1", [D]);
  await db.query("select referral_check()");
  assert.equal((await one(db, "select status from referrals where filleul = $1", [D])).status, "validé");
});
