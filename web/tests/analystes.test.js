// Analystes et tuyaux (20261030100000_analystes.sql) : prix, limites, tirage vrai ou leurre, jugement sur le chiffre
// publié, dérive du lundi, quêtes et succès, et rien de caché dans les réponses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";
import { TUYAU, ANALYSTS, tuyauPrice, tuyauProb, drawTuyau, tuyauOk, parseResults, sideOf } from "../supabase/functions/_shared/analystes.js";
import { initState, advance, calendar, STOCKS } from "../supabase/functions/_shared/aurelys.js";
import { QUESTS } from "../supabase/functions/_shared/progression.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const one = async (db, sql, args) => (await db.query(sql, args)).rows[0];
const aid = async (db, slug) => (await one(db, "select id from analysts where slug = $1", [slug])).id;
// Société dont les résultats ne tombent pas dans les 2 prochaines minutes (sinon l'achat est refusé : trop tard).
const freeTk = async (db, among) => {
  for (const tk of among) if ((await one(db, "select tuyau_event($1) > now() + interval '2 minutes' as ok", [tk])).ok) return tk;
};
// État du moteur : vrai chiffre caché (act) et consensus (cons) de chaque société.
const state = (db, res, revq = []) => db.query("insert into aur_state values (1, 0, $1) on conflict (id) do update set state = excluded.state",
  [JSON.stringify({ t: 0, st: Object.fromEntries(STOCKS.map(s => [s.tk, { res: res[s.tk] ?? { act: 10, cons: 5 } }])), revq })]);
const cfg = async (db, patch) => { await db.query("update analyst_config set c = c || $1::jsonb", [JSON.stringify(patch)]); await db.query("update profiles set cash = 1e7") };
const publish = (db, tk, title, t = "now()") => db.query(`insert into aur_news (id, t, tk, cat, title) values ((select coalesce(max(id), 0) + 1 from aur_news), ${t}, $1, 'resultats', $2)`, [tk, title]);
const due = (db, id) => db.query("update tuyaux set deadline_at = now() - interval '1 second', created_at = now() - interval '1 hour' where id = $1", [id]);

test("analystes : constantes et analystes de la base = valeurs partagées, prochains résultats = calendrier du moteur", async () => {
  const db = await freshDb();
  const c = (await one(db, "select c from analyst_config")).c;
  for (const k of Object.keys(TUYAU)) assert.deepEqual(c[k], TUYAU[k], k);
  const rows = (await db.query("select slug, name_fr, hidden_reliability, base_price, specialties from analysts order by id")).rows;
  assert.deepEqual(rows.map(r => [r.slug, r.name_fr, r.hidden_reliability, r.base_price, r.specialties]), ANALYSTS);
  for (const [, , , , sp] of ANALYSTS) for (const tk of sp) assert.ok(STOCKS.some(s => s.tk === tk), tk);
  for (const at of [Date.UTC(2026, 9, 25, 8, 0, 0), Date.UTC(2026, 10, 3, 17, 42, 13), Date.UTC(2027, 0, 1, 0, 0, 1)]) {
    const cal = calendar(at / 1000, 40);
    for (const s of STOCKS) {
      const sql = (await one(db, "select extract(epoch from tuyau_event($1, to_timestamp($2))) * 1000 as t", [s.tk, at / 1000])).t;
      assert.equal(Number(sql), cal.find(e => e.tk === s.tk && e.kind === "resultats").at, `${s.tk} ${new Date(at).toISOString()}`);
    }
  }
});

test("analystes : prix (patrimoine plafonné ×10, précision, disgrâce) et probabilité bornée", () => {
  assert.equal(tuyauPrice(800, 10000, 1), 960);
  assert.equal(tuyauPrice(800, 450000, 3), 800 * 10 * 2);
  assert.equal(tuyauPrice(800, 5e6, 3), 800 * 10 * 2, "plafond ×10");
  assert.equal(tuyauPrice(100, -500, 5), 450, "patrimoine négatif compté 0");
  assert.equal(tuyauPrice(100, 0, 2, true), 98);
  assert.ok(Math.abs(tuyauProb(.86, 5) - .93) < 1e-12); assert.ok(Math.abs(tuyauProb(.55, 1) - .45) < 1e-12); assert.equal(tuyauProb(.74, 3), .74);
  // Leurre toujours faux, tuyau vrai toujours juste (le moteur ne retouche pas le chiffre).
  for (let l = 1; l <= 5; l++) for (const [act, cons] of [[12, 5], [1, 7], [5.2, 5]]) {
    const truth = sideOf(act, cons), pub = { pub: act, side: truth };
    assert.equal(tuyauOk(drawTuyau(act, cons, .9, l, () => 0), l, pub), true, `vrai ${l} ${act}`);
    // Tirages : vrai ou leurre, écart du leurre, puis sens inversé (.9) ou chiffre exagéré (.1).
    for (const third of [.9, .1]) { const seq = [.99, .5, third]; assert.equal(tuyauOk(drawTuyau(act, cons, .9, l, () => seq.shift() ?? .5), l, pub), false, `leurre ${l} ${act} ${third}`) }
  }
});

test("analystes : titre des résultats du moteur lu comme par la base", async () => {
  const t0 = 1_800_000_000, S = initState(t0, 7), titles = [];
  for (let t = t0; t < t0 + 40000 && titles.length < 12; t += 60) for (const n of advance(S, t + 60).news) if (n.cat === "resultats") titles.push(n.title);
  assert.ok(titles.length >= 5);
  const db = await freshDb();
  for (const title of titles) {
    const js = parseResults(title);
    assert.ok(js, title);
    const m = (await one(db, "select regexp_match($1, 'chiffre d''affaires ([+−][0-9]+,[0-9]) %, (conforme|au-dessus|en dessous)') as m", [title])).m;
    assert.equal((m[0][0] === "−" ? -1 : 1) * +m[0].slice(1).replace(",", "."), js.pub, title);
  }
  assert.deepEqual(parseResults("Nexora Systems : chiffre d'affaires −3,9 %, conforme aux attentes"), { pub: -3.9, side: "flat", cons: null });
});

test("analystes : achat, débit, limites (3 par jour, une par société, spécialité, solde) et devis", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await state(db, {});
  const hibou = await aid(db, "hibou"), gazette = await aid(db, "gazette"), tk = await freeTk(db, ["NXR", "PXF", "VLS"]);
  const q = await one(db, "select analyst_quote($1, $2, 3) as r", [hibou, tk]);
  assert.deepEqual(q.r, { price: 1920, remaining_today: 3, allowed: true, reason: null, missing: null });
  const r = (await one(db, "select rumor_buy($1, $2, 3) as r", [hibou, tk])).r.rumor;
  assert.equal(r.price_paid, 1920); assert.equal(await cash(db, A), 10000 - 1920);
  assert.match(r.text_fr, /Le Hibou/); assert.match(r.text_en, /The Owl/);
  const row = await one(db, "select networth_at_purchase, price_paid, event_at = tuyau_event(company_id) as ev from tuyaux");
  assert.equal(row.networth_at_purchase, 10000); assert.ok(row.ev);
  assert.equal((await one(db, "select weekly_clients from analysts where id = $1", [hibou])).weekly_clients, 1);
  await assert.rejects(db.query("select rumor_buy($1, $2, 1)", [gazette, tk]), /déjà un tuyau en cours/);
  await assert.rejects(db.query("select rumor_buy($1, 'BCS', 1)", [hibou]), /ne suit pas cette société/);
  await assert.rejects(db.query("select rumor_buy($1, $2, 6)", [gazette, "BCS"]), /Précision/);
  const others = STOCKS.map(s => s.tk).filter(x => x !== tk);
  const t2 = await freeTk(db, others), t3 = await freeTk(db, others.filter(x => x !== t2)), t4 = await freeTk(db, others.filter(x => x !== t2 && x !== t3));
  await db.query("select rumor_buy($1, $2, 1)", [gazette, t2]); await db.query("select rumor_buy($1, $2, 1)", [gazette, t3]);
  const lim = (await one(db, "select analyst_quote($1, $2, 1) as r", [gazette, t4])).r;
  assert.equal(lim.allowed, false); assert.equal(lim.remaining_today, 0); assert.match(lim.reason, /Limite du jour/);
  await assert.rejects(db.query("select rumor_buy($1, $2, 1)", [gazette, t4]), /Limite du jour/);
  // Solde insuffisant : rien n'est débité, le montant manquant est donné.
  await login(db, B, "bob"); await db.query("update profiles set cash = 50 where id = $1", [B]);
  const poor = (await one(db, "select analyst_quote($1, $2, 1) as r", [gazette, tk])).r;
  assert.equal(poor.allowed, false); assert.equal(poor.missing, poor.price - 50);
  await assert.rejects(db.query("select rumor_buy($1, $2, 1)", [gazette, tk]), /Solde insuffisant/);
  assert.equal(await cash(db, B), 50);
  assert.equal((await one(db, "select count(*)::int n from tuyaux where player_id = $1", [B])).n, 0);
});

test("analystes : tirage vrai ou leurre, révision en attente comprise", async () => {
  const db = await freshDb();
  await login(db, A, "alice");
  const g = await aid(db, "gazette"), tk = await freeTk(db, STOCKS.map(s => s.tk));
  await cfg(db, { maxPerDay: 1000 });
  // Révision en attente (5 → 9) : la vérité se juge contre le nouveau consensus, 12 > 9.
  await state(db, { [tk]: { act: 12, cons: 5 } }, [{ tk, from: 5, act: 12, nc: 9, t: 0 }]);
  for (const [p, isTrue] of [[1, true], [0, false]]) {
    await cfg(db, { pMin: p, pMax: p });
    for (let l = 1; l <= 5; l++) for (let i = 0; i < 4; i++) {
      await db.query("select rumor_buy($1, $2, $3)", [g, tk, l]);
      const r = await one(db, "select * from tuyaux order by id desc limit 1");
      assert.equal(r.is_true, isTrue); assert.equal(r.cons, 9);
      const ok = tuyauOk({ dir: r.direction, fig: r.target }, l, { pub: 12, side: "up" });
      assert.equal(ok, isTrue, `niveau ${l} ${r.direction} ${r.target}`);
      if (l > 1) assert.ok(Math.abs(r.range_high - r.range_low - 2 * TUYAU.range[l - 1]) < 1e-9);
      await db.query("update tuyaux set resolved = true where id = $1", [r.id]);
    }
  }
});

test("analystes : jugement à la publication, compteurs, notification, succès, remboursement sans publication", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await state(db, {});
  const g = await aid(db, "gazette");
  await cfg(db, { maxPerDay: 1000 });
  const buy = async (tk, l, dir, target) => {
    await db.query("select rumor_buy($1, $2, $3)", [g, tk, l]);
    const { id } = await one(db, "select id from tuyaux order by id desc limit 1");
    await db.query("update tuyaux set direction = $2, target = $3, range_low = $3::float8 - $4, range_high = $3::float8 + $4 where id = $1", [id, dir, target, TUYAU.range[l - 1]]);
    await due(db, id); return id;
  };
  const tk = await freeTk(db, STOCKS.map(s => s.tk)), name = (await one(db, "select name from aur_stocks where tk = $1", [tk])).name;
  // Publié : +11,8 % au-dessus de +4,5 %.
  const cases = [[1, "up", null, "correct"], [1, "down", null, "wrong"], [2, "up", 8, "correct"], [2, "up", 7.7, "wrong"],
    [3, "up", 10, "correct"], [4, "up", 12.8, "correct"], [4, "up", 12.9, "wrong"], [5, "up", 11.4, "correct"], [5, "up", 11.2, "wrong"], [5, "down", 11.8, "wrong"]];
  let wrongs = 0;
  for (const [l, dir, target, want] of cases) {
    const id = await buy(tk, l, dir, target);
    await publish(db, tk, `${name} : chiffre d'affaires +11,8 %, au-dessus des +4,5 % attendus`, "now() - interval '30 minutes'");
    assert.equal((await one(db, "select analyst_resolve() as n")).n, 1);
    const r = await one(db, "select result, published, resolved from tuyaux where id = $1", [id]);
    assert.deepEqual([r.result, r.published, r.resolved], [want, 11.8, true], `niveau ${l} ${dir} ${target}`);
    wrongs += want === "wrong";
    await db.query("delete from aur_news");
  }
  const a = await one(db, "select correct_count, total_count from analysts where id = $1", [g]);
  assert.deepEqual([a.total_count, a.correct_count], [cases.length, cases.length - wrongs]);
  const n = (await db.query("select body from notices where user_id = $1 and kind = 'tuyau' order by id", [A])).rows;
  assert.equal(n.length, cases.length); assert.equal(n[0].body.ok, true); assert.equal(n[0].body.analyst_fr, "La Gazette du Port");
  assert.equal((await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = 'INITIE'", [A])).n, 1);
  // Une publication future (le moteur calcule 35 s d'avance) n'est pas lue ; sans publication 2 h après : sans suite, remboursé.
  const id = await buy(tk, 1, "up", null);
  await publish(db, tk, `${name} : chiffre d'affaires +1,0 %, conforme aux attentes`, "now() + interval '20 seconds'");
  await db.query("update tuyaux set created_at = now() - interval '3 hours', deadline_at = now() + interval '30 seconds' where id = $1", [id]);
  assert.equal((await one(db, "select analyst_resolve() as n")).n, 0);
  await db.query("delete from aur_news"); await db.query("update tuyaux set deadline_at = now() - interval '2 hours 1 minute' where id = $1", [id]);
  const before = await cash(db, A);
  await db.query("select analyst_resolve()");
  const v = await one(db, "select result, price_paid from tuyaux where id = $1", [id]);
  assert.equal(v.result, "void"); assert.equal(await cash(db, A), before + v.price_paid);
});

test("analystes : 5 faux d'affilée, 10 justes, 10 chez le même analyste", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await state(db, {});
  const g = await aid(db, "gazette"), tk = await freeTk(db, STOCKS.map(s => s.tk)), name = (await one(db, "select name from aur_stocks where tk = $1", [tk])).name;
  await cfg(db, { maxPerDay: 1000 });
  const has = async code => (await one(db, "select count(*)::int n from aur_achievements where user_id = $1 and code = $2", [A, code])).n === 1;
  for (let i = 0; i < 15; i++) {
    await db.query("select rumor_buy($1, $2, 1)", [g, tk]);
    const { id } = await one(db, "select id from tuyaux order by id desc limit 1");
    await db.query("update tuyaux set direction = $2 where id = $1", [id, i < 5 ? "down" : "up"]); await due(db, id);
    await publish(db, tk, `${name} : chiffre d'affaires +9,0 %, au-dessus des +4,5 % attendus`, "now() - interval '30 minutes'");
    await db.query("select analyst_resolve()"); await db.query("delete from aur_news");
    if (i === 3) assert.equal(await has("MAL_CONSEILLE"), false);
    if (i === 4) assert.equal(await has("MAL_CONSEILLE"), true);
    if (i === 8) assert.equal(await has("CLIENT_FIDELE"), false);
    if (i === 9) assert.equal(await has("CLIENT_FIDELE"), true);
    if (i === 13) assert.equal(await has("BIEN_RENSEIGNE"), false);
  }
  assert.equal(await has("BIEN_RENSEIGNE"), true);
});

test("analystes : dérive du lundi bornée, clients remis à zéro, disgrâce et prix −30 %", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await state(db, {});
  const g = await aid(db, "gazette");
  await db.query("update analysts set weekly_clients = 7, hidden_reliability = case slug when 'hibou' then .9 when 'solar' then .55 else hidden_reliability end");
  await db.query("update analysts set total_count = 25, correct_count = 5 where id = $1", [g]);
  // 20 dernières résolutions de la Gazette : 4 justes.
  for (let i = 0; i < 20; i++) await db.query(`insert into tuyaux (player_id, analyst_id, company_id, precision_level, direction, cons, event_at, deadline_at,
    price_paid, networth_at_purchase, is_true, text_fr, text_en, resolved, result, resolved_at) values ($1, $2, 'NXR', 1, 'up', 0, now(), now(), 1, 1, true, '', '', true, $3, now())`,
    [A, g, i < 4 ? "correct" : "wrong"]);
  for (let w = 0; w < 30; w++) {
    await db.query("update analyst_config set week = '2020-01-06'");
    await db.query("select analyst_resolve()");
    for (const r of (await db.query("select hidden_reliability h, weekly_clients c from analysts")).rows) {
      assert.ok(r.h >= TUYAU.relMin && r.h <= TUYAU.relMax, String(r.h)); assert.equal(r.c, 0);
    }
  }
  assert.ok((await one(db, "select disgrace_until > paris_date(now()) as ok from analysts where id = $1", [g])).ok);
  assert.ok((await one(db, "select analyst_list() as r")).r.list.find(a => a.slug === "gazette").badges.includes("disgrace"));
  const tk = await freeTk(db, STOCKS.map(s => s.tk));
  assert.equal((await one(db, "select analyst_quote($1, $2, 1) as r", [g, tk])).r.price, Math.round(100 * 1.2 * .7));
  // Même semaine : rien ne bouge.
  const before = (await db.query("select hidden_reliability from analysts order by id")).rows;
  await db.query("select analyst_resolve()");
  assert.deepEqual((await db.query("select hidden_reliability from analysts order by id")).rows, before);
});

test("analystes : quêtes Acheter un tuyau, Prendre position dans son sens, 5 justes dans la semaine", async () => {
  const db = await freshDb();
  await login(db, A, "alice"); await state(db, {});
  const g = await aid(db, "gazette"), tk = await freeTk(db, STOCKS.map(s => s.tk));
  for (const c of ["tuyau_1", "tuyau_suivi", "w_tuyau_5"]) assert.ok(QUESTS.find(q => q.code === c), c);
  const prog = async code => (await one(db, "select quest_progress($1, $2, now() - interval '1 day', now() + interval '1 day') as n", [A, code])).n;
  await db.query("select rumor_buy($1, $2, 1)", [g, tk]);
  assert.equal(await prog("tuyau_1"), 1);
  const { direction } = await one(db, "select direction from tuyaux");
  const bet = dir => db.query("insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry) values ($1, 0, 0, 'aurelys', 100, $2, $3, 1, 10)", [A, tk, dir]);
  await bet(direction === "up" ? "down" : "up");
  assert.equal(await prog("tuyau_suivi"), direction === "flat" ? 0 : 0);
  if (direction !== "flat") { await bet(direction); assert.equal(await prog("tuyau_suivi"), 1) }
  await db.query("update tuyaux set resolved = true, result = 'correct', resolved_at = now()");
  assert.equal(await prog("w_tuyau_5"), 1);
});

test("analystes : ni fiabilité cachée ni vérité d'un tuyau dans les réponses, tables et suivi fermés aux joueurs", async () => {
  const db = await freshDb();
  await login(db, B, "bob"); await login(db, A, "alice"); await state(db, {});
  const g = await aid(db, "gazette"), tk = await freeTk(db, STOCKS.map(s => s.tk));
  await db.exec("grant usage on schema public to authenticated; grant select on analysts, tuyaux, analyst_config to authenticated; set role authenticated");
  const out = [];
  out.push((await one(db, "select analyst_list() as r")).r);
  out.push((await one(db, "select analyst_quote($1, $2, 3) as r", [g, tk])).r);
  out.push((await one(db, "select rumor_buy($1, $2, 3) as r", [g, tk])).r);
  out.push((await one(db, "select my_tuyaux() as r")).r, (await one(db, "select my_tuyaux('active') as r")).r);
  out.push((await one(db, "select player_tuyaux('alice') as r")).r);
  const text = JSON.stringify(out);
  for (const k of ["hidden_reliability", "is_true", "hidden", "act"]) assert.ok(!new RegExp(`"${k}"`).test(text), k);
  for (const t of ["analysts", "tuyaux", "analyst_config"]) assert.equal((await one(db, `select count(*)::int n from ${t}`)).n, 0, t);
  for (const f of ["analyst_stats(30)", "analyst_resolve()", "tcfg()"]) await assert.rejects(db.query(`select ${f}`), /permission denied/, f);
  await db.exec("reset role");
  const s = (await one(db, "select analyst_stats(30) as r")).r;
  assert.equal(s.days[0].buys, 1); assert.equal(s.analysts.length, ANALYSTS.length); assert.ok("hidden" in s.analysts[0]);
});
