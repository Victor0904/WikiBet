import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg} : ${a} ≠ ${b}`);
const tick = (db, p, ago = 1) => db.query("insert into aur_ticks (tk, t, p) values ('SLM', clock_timestamp() - make_interval(secs => $1), $2) on conflict (tk, t) do update set p = excluded.p", [ago, p]); // deux cours dans la même milliseconde : le dernier compte
const open = async (db, dir, lev, stake, slip = 0, u = A) => (await db.query("select * from aur_open($1, 'SLM', $2, $3, $4, $5)", [u, dir, lev, stake, slip])).rows[0];
const close = async (db, id, slip = 0, u = A) => (await db.query("select * from aur_close($1, $2, $3)", [u, id, slip])).rows[0];
const give = (db, code, rank, u = A) => db.query("insert into talents values ($1, $2, $3) on conflict (user_id, code) do update set rank = $3", [u, code, rank]);
const me = async db => (await db.query("select my_talents() as t")).rows[0].t;
const prof = async (db, u = A) => (await db.query("select * from profiles where id = $1", [u])).rows[0];
const aged = (db, id) => db.query("update bets set created_at = now() - interval '200 seconds' where id = $1", [id]); // tenue plus de 150 s

test("talents : niveau au plus haut du gain net (paliers 2 500 / 5 000 / 10 000 W), positions courtes et remboursements exclus", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const lv = async h => (await db.query("select talent_level($1) as l", [h])).rows[0].l;
  assert.deepEqual([await lv(2499), await lv(2500), await lv(12500), await lv(17499), await lv(17500), await lv(62500), await lv(72500)], [0, 1, 5, 5, 6, 15, 16]);
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await tick(db, 10, 3);
  let b = await open(db, "up", 10, 10000); await aged(db, b.id);
  await tick(db, 10.3); b = await close(db, b.id); // +3 % ×10 = +3 000 W, moins les frais
  let p = await prof(db);
  near(p.tal_cum, b.payout - b.stake - b.fees, "gain net, tous frais déduits");
  assert.equal((await me(db)).level, 1);
  b = await open(db, "up", 10, 10000); await tick(db, 10.0); await close(db, b.id); // moins de 150 s : ne compte pas
  assert.equal((await prof(db)).tal_cum, p.tal_cum);
  b = await open(db, "down", 10, 10000); await aged(db, b.id); await tick(db, 10.1); await close(db, b.id); // perte
  p = await prof(db);
  assert.ok(p.tal_cum < p.tal_hwm, "la perte baisse le cumul…"); assert.equal((await me(db)).level, 1, "…mais pas le niveau");
  // Un bot n'a ni niveau ni talents.
  await login(db, B, "bot1"); await db.query("update profiles set bot = true, cash = 1e6 where id = $1", [B]);
  b = await open(db, "up", 10, 10000, 0, B); await aged(db, b.id); await tick(db, 10.4); await close(db, b.id, 0, B);
  assert.equal((await prof(db, B)).tal_hwm, 0);
  await assert.rejects(db.query("select talent_buy('frais')"), /Connexion requise/);
});

test("talents : achat avec les points (niveau + succès), rang maximum, ultime à 10 points, réinitialisation", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await assert.rejects(db.query("select talent_buy('frais')"), /Aucun point/);
  await db.query("insert into achievements values ('test', 'Test', 'Pour le test', 3)");
  await db.query("select achievement_grant($1, 'test')", [A]);
  assert.equal((await me(db)).ach, 3, "un succès donne ses points");
  await db.query("update profiles set tal_hwm = 62500 where id = $1", [A]); // niveau 15 + 3 = 18 points
  for (let i = 0; i < 5; i++) await db.query("select talent_buy('frais')");
  await assert.rejects(db.query("select talent_buy('frais')"), /rang maximum/);
  for (let i = 0; i < 4; i++) await db.query("select talent_buy('amort')");
  await assert.rejects(db.query("select talent_buy('phenix')"), /il faut 10 points/);
  await db.query("select talent_buy('amort')"); await db.query("select talent_buy('phenix')");
  const t = await me(db);
  assert.equal(t.spent, 11); assert.deepEqual(t.ranks, { frais: 5, amort: 5, phenix: 1 });
  await db.query("update profiles set cash = 6000 where id = $1", [A]);
  await db.query("select talent_reset()");
  assert.equal((await me(db)).spent, 0); assert.equal(await cash(db, A), 6000, "première réinitialisation gratuite");
  await db.query("select talent_reset()");
  assert.equal(await cash(db, A), 1000, "puis 5 000 W");
  await assert.rejects(db.query("select talent_reset()"), /5 000 W/);
});

test("talents Audace : Discrétion, Kraken (une fois par jour d'Aurelys), Gros calibre, Multitâche, Timing", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await tick(db, 10, 3);
  const entry = async () => { const b = await open(db, "up", 1, 100, .01); await db.query("delete from bets where id = $1", [b.id]); return b.entry };
  await give(db, "discretion", 4);
  near(await entry(), 10 * (1 + .01 * .9), "Discrétion 4 : −10 % d'impact");
  await assert.rejects(db.query("select kraken_arm(true)"), /Kraken requis/);
  await give(db, "kraken", 1);
  await db.query("select kraken_arm(true)");
  assert.equal((await db.query("select my_terms() as t")).rows[0].t.kraken, true);
  near(await entry(), 10, "Kraken : ordre sans impact");
  near(await entry(), 10.09, "une seule fois");
  await db.query("select kraken_arm(true)");
  near(await entry(), 10.09, "déjà utilisé ce jour d'Aurelys");
  await db.query("update profiles set kraken_day = kraken_day - 1 where id = $1", [A]);
  near(await entry(), 10, "jour d'Aurelys suivant : de nouveau");
  // Gros calibre : plafond 20 × liquidité (+10 % par rang).
  const liq = (await db.query("select liq from aur_stocks where tk = 'SLM'")).rows[0].liq;
  await db.query("delete from bets where user_id = $1", [A]);
  await assert.rejects(open(db, "up", 10, 20 * liq * 1.2 / 10), /Plafond/);
  await give(db, "calibre", 3);
  await open(db, "up", 10, 20 * liq * 1.2 / 10);
  // Multitâche : +1 position par rang.
  await db.query("delete from bets where user_id = $1", [A]);
  for (let i = 0; i < 3; i++) await open(db, "up", 1, 10);
  await assert.rejects(open(db, "up", 1, 10), /Au plus 3/);
  await give(db, "multitache", 2);
  await open(db, "up", 1, 10); await open(db, "up", 1, 10);
  await assert.rejects(open(db, "up", 1, 10), /Au plus 5/);
  // Timing : l'objectif part du cours qui l'a touché. Le Kraken armé n'est pas consommé par un ordre automatique.
  for (const timing of [false, true]) {
    await db.query("delete from bets where user_id = $1", [A]); await db.query("delete from aur_ticks");
    if (timing) await give(db, "timing", 1);
    await tick(db, 10, 3);
    const b = await open(db, "up", 1, 1000);
    await db.query("select aur_set_auto($1, null, 10.5)", [b.id]);
    await db.query("insert into aur_ticks (tk, t, p) values ('SLM', clock_timestamp(), 10.6), ('SLM', clock_timestamp() + interval '1 millisecond', 10.2)");
    await new Promise(r => setTimeout(r, 10)); // les deux cours sont passés
    await db.query("update profiles set kraken_day = null where id = $1", [A]); await db.query("select kraken_arm(true)");
    await db.query("select aur_auto_exec('close', $1, 0)", [b.id]);
    assert.equal((await db.query("select kraken_armed from profiles where id = $1", [A])).rows[0].kraken_armed, true, "Kraken gardé pour un ordre à la main");
    near((await db.query("select exit from bets where id = $1", [b.id])).rows[0].exit, timing ? 10.6 : 10.2, `Timing ${timing}`);
  }
});

test("talents Prudence : Frais réduits, Amortisseur (clôture au seuil, sans cadeau), Filet, Phénix (une fois par semaine)", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await give(db, "frais", 5);
  near((await db.query("select my_fee_rate() as r")).rows[0].r, .00075, "−25 %");
  await tick(db, 10, 3);
  await give(db, "amort", 5); // 5 rangs : la position est clôturée quand elle ne vaut plus que 15 % de sa mise
  const liquidate = async stake => { await tick(db, 10, 0); const b = await open(db, "up", 10, stake); await tick(db, 8.9, 0); return close(db, b.id) };
  let b = await liquidate(1000);
  assert.equal(b.closed_by, "liq"); near(b.exit, 9.15, "liquidée à 9,15 (il reste 15 %), pas à 9");
  near(b.payout, 150, "la valeur restante"); assert.ok(!b.insured, "pas un remboursement");
  const c0 = await cash(db, A);
  b = await liquidate(12000);
  near(b.payout, 1800, "chaque liquidation, sans plafond : c'est ce qui reste de la position");
  near(await cash(db, A) - c0, -12000 - 120000 * .00075 + 1800, "mise et frais perdus, reste rendu une seule fois");
  // Filet : stop sans le loft.
  await tick(db, 10, 0); b = await open(db, "up", 1, 100);
  await assert.rejects(db.query("select aur_set_auto($1, 9.5, null)", [b.id]), /loft/);
  await give(db, "filet", 1);
  await db.query("select aur_set_auto($1, 9.5, null)", [b.id]);
  // Phénix : 15 000 W, une fois par semaine réelle.
  await give(db, "phenix", 1);
  await db.query("update profiles set cash = 100 where id = $1", [A]);
  assert.equal((await db.query("select cash from restart()")).rows[0].cash, 15000);
  await db.query("update profiles set cash = 100 where id = $1", [A]);
  assert.equal((await db.query("select cash from restart()")).rows[0].cash, 10000, "pas deux fois dans la semaine");
});

test("talents Rente : Fidélité, Négociateur, Argent passif et Rentier par jour réel", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await give(db, "fidelite", 5);
  let c = await cash(db, A);
  await db.query("insert into salaries (user_id, session, amount) values ($1, 1, 400)", [A]);
  assert.equal(await cash(db, A), c + 100, "+25 % du salaire");
  const price = (await db.query("select price from shop_items where id = 'studio'")).rows[0].price;
  await give(db, "negociateur", 5);
  await db.query("update profiles set cash = 1e6 where id = $1", [A]); c = await cash(db, A);
  await db.query("select buy_item('studio')");
  assert.equal(c - await cash(db, A), Math.round(price * .85), "−15 % sur la boutique");
  await give(db, "passif", 6);
  await db.query("update profiles set last_seen = now(), cash = 0 where id = $1", [A]);
  await db.query("delete from talent_day");
  await db.query("select talent_daily()"); assert.equal(await cash(db, A), 100);
  await db.query("select talent_daily()"); assert.equal(await cash(db, A), 100, "une fois par jour");
  await give(db, "rentier", 1);
  await db.query("insert into bets (user_id, session, day, kind, stake, aur, status, payout, created_at, closed_at) values ($1, 0, 0, 'aurelys', 10, 'SLM', 'won', 20, day_start() - interval '2 hours', day_start() - interval '1 hour')", [A]);
  await db.query("update talent_day set day = day - 1");
  await db.query("select talent_daily()"); assert.equal(await cash(db, A), 300, "doublé après une position gagnante la veille");
  await db.query("update talent_day set day = day - 1"); await db.query("update profiles set last_seen = now() - interval '2 days' where id = $1", [A]);
  await db.query("select talent_daily()"); assert.equal(await cash(db, A), 300, "pas connecté depuis 24 h : rien");
});

test("talents Information : Avant-première, Flair (rumeurs en cours seulement), Initié (révisions décidées, cachées aux autres)", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  const lead = async () => (await db.query("select extract(epoch from news_lead()) as s")).rows[0].s;
  assert.equal(Number(await lead()), 0);
  await give(db, "avant", 3); assert.equal(Number(await lead()), 10);
  const t = Math.floor(Number((await db.query("select extract(epoch from now()) as t")).rows[0].t));
  await db.query("select aur_store(null, $1, '[]', $2)", [{ t: 1 }, JSON.stringify([
    { id: 1, t: t - 30, tk: "SLM", cat: "rumeur", title: "R", text: "", sent: .5, fiab: .3, rok: true },
    { pre: true, t: t + 100, t0: t - 5, tk: "SLM", title: "Les analystes relèvent" },
    { pre: true, t: t + 140, t0: t + 20, tk: "NXR", title: "Pas encore décidée" }])]);
  assert.equal((await db.query("select count(*)::int as n from aur_news where title like 'Les analystes%'")).rows[0].n, 0, "pas dans le Courrier");
  const list = async () => (await db.query("select aur_rumor_list() as r")).rows[0].r.list;
  assert.ok(!(await list())[0].flair, "sans Flair : pas d'indice");
  await give(db, "flair", 3);
  assert.ok(["credible", "douteuse"].includes((await list())[0].flair));
  const ins = async () => (await db.query("select aur_insider() as r")).rows[0].r;
  assert.deepEqual(await ins(), [], "réservé aux initiés");
  await give(db, "initie", 1);
  assert.deepEqual((await ins()).map(r => r.title), ["Les analystes relèvent"], "seulement les révisions déjà décidées");
});
