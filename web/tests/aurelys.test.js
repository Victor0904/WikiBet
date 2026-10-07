import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";
import { initState, advance, slip, calendar, STOCKS, EPOCH_S, SPM, DAY, realOf, LINKS } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a";
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg} : ${a} ≠ ${b}`);
// Cours de SLM, `ago` secondes avant maintenant (négatif = dans le futur).
const tick = (db, ago, p, halt = false) => db.query("insert into aur_ticks (tk, t, p, halt) values ('SLM', now() - make_interval(secs => $1), $2, $3)", [ago, p, halt]);
const open = async (db, dir, lev, stake, slip = 0) => (await db.query("select * from aur_open($1, 'SLM', $2, $3, $4, $5)", [A, dir, lev, stake, slip])).rows[0];
// 30 positions déjà clôturées : débloque le levier ×10.
const veteran = (db, id = A) => db.query("insert into bets (user_id, session, day, kind, stake, aur, status, payout, closed_at) select $1, 0, 0, 'aurelys', 10, 'SLM', 'lost', 0, now() from generate_series(1, 30)", [id]);
const row = async (db, id) => (await db.query("select * from bets where id = $1", [id])).rows[0];

test("aurelys : moteur déterministe, même découpé en appels avec l'état relu en JSON", () => {
  const run = step => {
    let S = initState(EPOCH_S, 3); const out = []; const end = S.t + 600; let first = true;
    while (S.t < end) { out.push(...advance(S, realOf(Math.min(end, S.t + step)), first ? [{ tk: "SLM", q: 50000 }] : []).ticks); first = false; S = JSON.parse(JSON.stringify(S)) }
    return out;
  };
  const a = run(60), b = run(13);
  assert.deepEqual(a, b);
  assert.ok(a.every(k => Number.isFinite(k.p) && k.p > 0), "cours finis et positifs");
  assert.equal(a.length, 600 * SPM * (STOCKS.length + 1), "un cours par seconde réelle, par action et pour l'indice");
  const slm = a.filter(k => k.tk === "SLM");
  assert.ok(slm.every((k, i) => !i || k.t - slm[i - 1].t === 1), "un cours chaque seconde");
  assert.ok(new Set(slm.slice(0, SPM).map(k => k.p)).size > 1, "les cours bougent à l'intérieur d'une minute d'Aurelys");
});

test("aurelys : un gros ordre pèse plus qu'un petit, et plus sur une petite valeur", () => {
  const S = initState(EPOCH_S + 11 * 3600, 1);
  assert.ok(slip(S, "SLM", 100000) > slip(S, "SLM", 10000), "racine carrée : plus gros, plus d'impact");
  near(slip(S, "SLM", 40000) / slip(S, "SLM", 10000), 2, "4 fois plus gros = 2 fois plus d'impact");
  assert.ok(slip(S, "SLM", 50000) > slip(S, "LMR", 50000), "Solarmine (peu liquide) bouge plus que Lumirue");
  const s25 = slip(S, "SLM", 25000) * 2; // mouvement provoqué (le prix moyen payé en subit la moitié)
  assert.ok(s25 > .005 && s25 < .02, `25 000 W sur Solarmine font bouger le cours de façon visible : ${(s25 * 100).toFixed(2)} %`);
  const cal = calendar(EPOCH_S + 100, 6);
  assert.equal(cal.length, 6); assert.ok(cal.every((e, i) => !i || e.at >= cal[i - 1].at), "calendrier trié");
});

test("aurelys : les cours et les nouvelles à venir restent cachés", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, 3, 12); await tick(db, -5, 99);
  await db.query("insert into aur_news (id, t, cat, title) values (1, now() - interval '1 second', 'x', 'passée'), (2, now() + interval '5 seconds', 'x', 'future')");
  const { rows: [{ f }] } = await db.query("select aur_feed(null) as f");
  assert.deepEqual(f.rows.map(r => r[2]), [12], "aur_feed s'arrête à maintenant");
  await db.exec("grant usage on schema public to authenticated; grant select on aur_ticks, aur_news, aur_state to authenticated; set role authenticated");
  assert.equal((await db.query("select * from aur_ticks")).rows.length, 0, "table des cours illisible directement");
  assert.equal((await db.query("select * from aur_state")).rows.length, 0, "état (valeurs fondamentales) illisible");
  assert.deepEqual((await db.query("select title from aur_news")).rows.map(r => r.title), ["passée"]);
  await assert.rejects(db.query("select aur_open($1, 'SLM', 'up', 1, 100, 0)", [A]), /permission denied/, "un joueur n'ouvre pas sans le serveur");
  await db.exec("reset role");
});

test("aurelys : ordre au dernier cours plus l'impact, frais, flux enregistré, clôture", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, 2, 10);
  const b = await open(db, "up", 5, 1000, .01);
  near(b.entry, 10.1, "achat : le prix monte de l'impact"); near(b.fees, 5, "0,1 % de 5 000");
  near(await cash(db, A), 10000 - 1005, "mise + frais");
  const { rows: [o] } = await db.query("select * from aur_take_orders()");
  near(o.q, 5000, "ordre d'achat de 5 000 Ꜷ transmis à la simulation");
  assert.equal((await db.query("select * from aur_take_orders()")).rows.length, 0, "pris une seule fois");
  await tick(db, 1, 11);
  const { rows: [c] } = await db.query("select * from aur_close($1, $2, .01)", [A, b.id]);
  near(c.exit, 10.89, "vente : le prix baisse de l'impact");
  near(c.payout, 1000 * (1 + 5 * (10.89 / 10.1 - 1)) - 5, "valeur moins frais de clôture");
  const { rows: [o2] } = await db.query("select * from aur_take_orders()");
  near(o2.q, -5000, "la clôture est une vente");
});

test("aurelys : plafond par action, cotation suspendue, marché à l'arrêt", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await veteran(db);
  await tick(db, 2, 10);
  await open(db, "up", 10, 9000);                                 // 90 000 Ꜷ sur 120 000 permis
  await open(db, "down", 10, 400);                                // 94 000 : encore sous le plafond
  await assert.rejects(db.query("select aur_open($1, 'SLM', 'up', 10, 3500, 0)", [A]), /Plafond/, "125 000 > 20 × 6 000");
  await tick(db, 1, 10, true);
  await assert.rejects(open(db, "up", 1, 10), /suspendue/);
  await db.query("delete from aur_ticks");
  await tick(db, 60, 10);
  await assert.rejects(open(db, "up", 1, 10), /indisponible/, "dernier cours trop ancien");
});

test("aurelys : liquidation sur le premier cours qui touche le seuil, assurance comprise", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await veteran(db);
  await db.query("select buy_item('assurance')");
  await tick(db, 15, 10);
  const b = await open(db, "up", 10, 1000);                       // liquidée sous 9
  await db.query("update bets set created_at = now() - interval '12 seconds'");
  await tick(db, 10, 9.5); await tick(db, 5, 8.9); await tick(db, -3, 5);
  await db.query("select aur_settle()");
  const c = await row(db, b.id);
  assert.equal(c.status, "lost"); near(c.exit, 9, "fermée au seuil"); assert.equal(c.insured, true); near(c.payout, 500, "assurance : 50 %");
  const { rows: [k] } = await db.query("select * from aur_candles where tk = 'SLM' order by t desc limit 1");
  assert.ok(k.l >= 8.9, "les bougies ignorent les cours à venir");
});

test("aurelys : un pas de simulation s'enregistre une fois ; un état périmé est refusé", async () => {
  const db = await freshDb();
  const S = initState(Date.now() / 1000 - 20, 5), out = advance(S, realOf(S.t + 30));
  await db.query("select aur_store(null, $1, $2, $3)", [S, JSON.stringify(out.ticks), JSON.stringify(out.news)]);
  assert.equal((await db.query("select count(*)::int as n from aur_ticks")).rows[0].n, out.ticks.length);
  await assert.rejects(db.query("select aur_store(123, $1, '[]', '[]')", [S]), /conflit/, "un autre appel a déjà avancé");
  await db.query("select aur_settle()");
  const { rows: [{ f }] } = await db.query("select aur_feed(null) as f");
  assert.ok(f.rows.length > 0 && f.rows.every(r => r[0] <= f.now), "le flux ne montre que le passé");
  assert.ok(f.x?.reg, "régime publié avec l'indice");
});

test("aurelys : résultats annoncés face au consensus, le cours réagit à la surprise", () => {
  const S = initState(EPOCH_S, 9), news = [];
  for (let m = S.t, end = S.t + 8 * DAY; m < end; m += 60) news.push(...advance(S, realOf(m + 60)).news);
  const res = news.filter(n => n.cat === "resultats");
  assert.ok(res.length >= STOCKS.length, "chaque entreprise publie ses résultats dans la semaine");
  assert.ok(res.every(n => /attendus|conforme aux attentes/.test(n.title)), "le titre compare au consensus");
  const x = advance(S, realOf(S.t + 1)).ticks.find(k => k.x).x;
  assert.ok(STOCKS.every(s => typeof x.cons[s.tk] === "number"), "consensus publié pour chaque entreprise");
  assert.ok(!JSON.stringify(x).includes("act"), "le vrai chiffre reste caché");
});

test("aurelys : une entreprise branchée sur un chiffre réel suit son écart à la normale", () => {
  const run = z => { const S = initState(EPOCH_S, 4); const sig = z == null ? {} : { PXF: { z, txt: "test" } }; let n = [];
    for (let m = S.t, end = S.t + DAY; m < end; m += 60) n.push(...advance(S, realOf(m + 60), [], sig).news); return { v: S.st.PXF.v, n } };
  const base = run(null), hot = run(.2);
  near(hot.v - base.v, Math.log(1 + LINKS.PXF.beta * .2), "valeur fondamentale relevée de β × écart", 1e-9);
  assert.ok(hot.n.some(n => n.cat === "reel" && n.tk === "PXF"), "le changement est annoncé dans les actualités");
});

test("aurelys : ×15 pour tous, ×20 avec un logement, ×25 dans une guilde qui a une salle des marchés", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, 2, 10);
  assert.equal((await open(db, "up", 15, 100)).lev, 15);
  await assert.rejects(open(db, "up", 20, 100), /logement/);
  await db.query("update profiles set cash = 1e6 where id = $1", [A]); await db.query("select buy_item('studio')");
  assert.equal((await open(db, "up", 20, 100)).lev, 20);
  await assert.rejects(open(db, "up", 25, 100), /salle des marchés/);
  const { rows: [g] } = await db.query("select * from guild_create('Les Taureaux', 'TOR')");
  await db.query("update guilds set treasury = 1e6 where id = $1", [g.id]);
  await db.query("select city_build('mairie')"); await db.query("select city_build('salle')");
  assert.equal((await open(db, "up", 25, 100)).lev, 25);
  await assert.rejects(open(db, "up", 30, 100), /invalide/);
});

test("aurelys : bougies d'une heure d'Aurelys (2 min 30 réelles)", async () => {
  const db = await freshDb();
  const { rows: [{ a, b }] } = await db.query("select aur_hour(to_timestamp($1)) as a, aur_hour(to_timestamp($2)) as b", [EPOCH_S + 60 * SPM - 1, EPOCH_S + 60 * SPM]);
  assert.equal(new Date(a).getTime() / 1000, EPOCH_S); assert.equal(new Date(b).getTime() / 1000, EPOCH_S + 60 * SPM);
});

test("aurelys : un état calculé à l'ancienne échelle (5 s par minute) garde ses dates réelles", () => {
  const S = initState(EPOCH_S + 1e6, 2); S.spm = 5; S.t = Math.floor(1e6 / 5); S.nextIpo = S.t + 100; S.whales.kraken.until = S.t + 50;
  const realIpo = EPOCH_S + S.nextIpo * 5;
  advance(S, EPOCH_S + 1e6 + 1);
  assert.equal(S.spm, SPM);
  assert.ok(Math.abs(EPOCH_S + S.nextIpo * SPM - realIpo) <= SPM, "la prochaine levée garde son heure réelle");
});
