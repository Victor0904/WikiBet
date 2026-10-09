import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash } from "./db.js";
import { capWeights } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg} : ${a} ≠ ${b}`);
const tick = (db, tk, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ($1, now() - make_interval(secs => $2), $3)", [tk, ago, p]);
const open = async (db, user, tk, dir, lev, stake) => (await db.query("select * from aur_open($1, $2, $3, $4, $5, 0)", [user, tk, dir, lev, stake])).rows[0];

test("jeune pousse : levier ×5 au plus", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("select aur_listing($1)", [JSON.stringify([{ tk: "NEO", name: "Néogen", sector: "sante", L: 3000, status: "listed", ipoPrice: 10, ipoAt: Date.now() / 1000 }])]);
  await tick(db, "NEO", 2, 10);
  await assert.rejects(open(db, A, "NEO", "up", 10, 100), /×5 au plus/);
  assert.equal(await cash(db, A), 10000, "rien n'est débité");
  assert.equal((await open(db, A, "NEO", "up", 5, 100)).lev, 5);
});

test("patrimoine et faillite : une position compte pour sa valeur actuelle, pas pour sa mise", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await tick(db, "SLM", 3, 10);
  const b = await open(db, A, "SLM", "up", 5, 1000); // frais 5 W
  await tick(db, "SLM", 1, 9); // −10 % × 5 : il reste 500 W, moins 5 W de frais de clôture
  near((await db.query("select patrimoine($1) p", [A])).rows[0].p, 10000 - 1005 + 500 - 5, "patrimoine", 1e-6);
  await db.query("update profiles set cash = 1000 where id = $1", [A]);
  await db.query("select restart()"); // 1 000 + 495 < 2 000 : faillite possible
  assert.equal((await db.query("select status from bets where id = $1", [b.id])).rows[0].status, "lost");
});

test("alerte avant liquidation : à 25 %, puis à 10 % de la mise, une fois chacune, pour les abonnés", async () => {
  const db = await freshDb(); await login(db, A, "alice"); await login(db, B, "bob");
  await tick(db, "SLM", 4, 10);
  const a = await open(db, A, "SLM", "up", 10, 100), b = await open(db, B, "SLM", "up", 10, 100);
  await db.query("insert into push_subs values ('https://push.exemple/a', $1)", [A]);
  const due = async () => (await db.query("select * from push_due()")).rows.map(r => r.endpoint);
  await tick(db, "SLM", 3, 9.5); // il reste 50 %
  assert.deepEqual(await due(), []);
  await tick(db, "SLM", 2, 9.2); // 20 %
  assert.deepEqual(await due(), ["https://push.exemple/a"]);
  assert.deepEqual(await due(), [], "une seule fois");
  const info = (await db.query("select * from push_info('https://push.exemple/a')")).rows;
  assert.equal(info[0].kind, "25"); near(info[0].lq, 9, "seuil de liquidation");
  await tick(db, "SLM", 1, 9.05); // 5 %
  assert.deepEqual(await due(), ["https://push.exemple/a"]);
  assert.equal((await db.query("select warn from bets where id = $1", [a.id])).rows[0].warn, 2);
  assert.equal((await db.query("select warn from bets where id = $1", [b.id])).rows[0].warn, 0, "bob n'est pas abonné");
});

test("bots : ils tradent par les règles des joueurs, au plus une fois toutes les 2 minutes", async () => {
  const db = await freshDb(); await login(db, A, "robot1");
  await db.query("update profiles set bot = true where id = $1", [A]);
  await tick(db, "SLM", 200, 10); await tick(db, "SLM", 1, 10.2);
  for (const tk of ["NXR", "HLV", "BCS", "FRC", "VLS", "OMB", "PXF", "MRV", "GTR", "LMR", "KST", "OND"]) await tick(db, tk, 1, 20);
  assert.equal((await db.query("select bots_play() n")).rows[0].n, 1);
  assert.equal((await db.query("select bots_play() n")).rows[0].n, 0, "il vient d'agir");
  const { rows } = await db.query("select kind, status, stake, fees from bets where user_id = $1", [A]);
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, "aurelys");
  assert.ok(rows[0].stake >= 200 && rows[0].stake <= 800 && rows[0].fees > 0, "mise de 2 à 8 % du solde, frais payés");
  await db.exec("grant usage on schema public to authenticated; set role authenticated");
  await assert.rejects(db.query("select bots_play()"), /permission denied/, "réservé au serveur");
  await db.exec("reset role");
});

test("AUR-12 : aucune société au-dessus de 15 % de l'indice", () => {
  const w = capWeights([66, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1]);
  near(w.reduce((a, b) => a + b, 0), 1, "somme des poids");
  assert.ok(Math.max(...w) <= .15 + 1e-9, "plafond");
  near(w[1] / w[12], 5, "les autres gardent leurs proportions");
});
