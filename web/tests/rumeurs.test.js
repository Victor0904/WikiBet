import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";
import { initState, advance, realOf, EPOCH_S } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a";
const now = async db => Number((await db.query("select extract(epoch from now()) as t")).rows[0].t);
let st = 0;
const store = async (db, ticks, news) => {
  await db.query("select aur_store($1, $2, $3, $4)", [st || null, { t: st + 1 }, JSON.stringify(ticks), JSON.stringify(news)]); st++;
};
const list = async db => (await db.query("select aur_rumor_list() as r")).rows[0].r;

test("rumeurs : le moteur relie chaque résolution à sa rumeur, l'issue part seulement vers aur_store", () => {
  const S = initState(EPOCH_S + 9 * 3600, 7), news = [], end = S.t + 3 * 1440;
  while (S.t < end) news.push(...advance(S, realOf(S.t + 240)).news);
  const rumors = news.filter(n => n.rok != null), res = news.filter(n => n.rid != null);
  assert.ok(rumors.length > 0 && res.length > 0, `rumeurs : ${rumors.length}, résolutions : ${res.length}`);
  for (const r of res) {
    const o = rumors.find(x => x.id === r.rid);
    assert.ok(o && o.t < r.t && o.tk === r.tk, "résolution après sa rumeur, même société");
    assert.equal(/confirme/.test(r.title), o.rok, "l'issue publiée est celle tirée à la sortie");
  }
});

test("rumeurs : issue cachée tant que la résolution n'est pas publiée, table illisible, statistiques", async () => {
  const db = await freshDb(); await login(db, A, "alice"); st = 0;
  const t = Math.floor(await now(db));
  await store(db, [{ t: t - 60, tk: "SLM", p: 10, v: 0 }, { t: t - 2, tk: "SLM", p: 11, v: 0 }, { t: t - 60, tk: "NXR", p: 50, v: 0 }, { t: t - 2, tk: "NXR", p: 45, v: 0 }],
    [{ id: 5, t: t - 50, tk: "SLM", cat: "rumeur", title: "Rumeur SLM", text: "", sent: .5, fiab: .3, rok: true },
     { id: 6, t: t - 60, tk: "NXR", cat: "rumeur", title: "Rumeur NXR", text: "", sent: .5, fiab: .3, rok: false },
     { id: 7, t: t + 30, tk: "SLM", cat: "rumeur", title: "Rumeur future", text: "", sent: .5, fiab: .3, rok: true }]);
  let r = await list(db);
  assert.deepEqual(r.list.map(x => [x.title, x.status]), [["Rumeur SLM", "open"], ["Rumeur NXR", "open"]], "pas de rumeur future");
  assert.ok(Math.abs(r.list[0].chg - .1) < 1e-9, "réaction depuis la rumeur : 10 → 11");
  assert.ok(!/"ok"\s*:\s*(true|false)|rok/.test(JSON.stringify(r.list)), "aucune issue dans la réponse");
  // Résolution calculée d'avance (dans 20 s) : toujours « En cours ».
  await store(db, [{ t: t + 20, tk: "SLM", p: 99, v: 0 }], [{ id: 8, t: t + 20, tk: "SLM", cat: "rumeur", title: "SLM confirme", text: "", sent: .6, fiab: 1, rid: 5 }]);
  r = await list(db);
  assert.equal(r.list[0].status, "open"); assert.equal(r.list[0].res_t, null);
  assert.ok(Math.abs(r.list[0].chg - .1) < 1e-9, "jamais de cours futur");
  assert.equal(r.stats.n, 0);
  // Le temps passe : la résolution est publiée.
  await db.query("update aur_rumors set res_t = now() - interval '1 second', p1 = 12 where eid = 5");
  await db.query("update aur_rumors set res_t = now() - interval '1 second', p1 = 40 where eid = 6");
  r = await list(db);
  assert.deepEqual(r.list.map(x => x.status), ["ok", "no"]);
  assert.equal(r.stats.n, 2); assert.equal(r.stats.ok, 1);
  assert.ok(Math.abs(r.stats.chg - (.2 + -.2) / 2) < 1e-9, "réaction moyenne dans le sens de la rumeur");
  await db.exec("grant usage on schema public to authenticated; grant select on aur_rumors to authenticated; set role authenticated");
  assert.equal((await db.query("select * from aur_rumors")).rows.length, 0, "table des rumeurs illisible");
  await db.exec("reset role");
});

test("rumeurs : société radiée avant la résolution, « Sans suite », sans l'issue", async () => {
  const db = await freshDb(); await login(db, A, "alice"); st = 0;
  const t = Math.floor(await now(db));
  await store(db, [{ t: t - 60, tk: "SLM", p: 10, v: 0 }], [{ id: 5, t: t - 50, tk: "SLM", cat: "rumeur", title: "Rumeur SLM", text: "", sent: .5, fiab: .3, rok: true }]);
  await db.query("update aur_stocks set status = 'delisted' where tk = 'SLM'");
  const r = (await list(db)).list[0];
  assert.equal(r.status, "void"); assert.equal(r.res_t, null);
  assert.ok(!/"ok"\s*:\s*(true|false)|rok/.test(JSON.stringify(r)), "aucune issue");
});
