import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login, cash, setClock } from "./db.js";
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

test("bots : un ordre au plus toutes les 2 minutes, exécuté par le serveur ; faillite = retour à 10 000 W", async () => {
  const db = await freshDb(); await login(db, A, "robot1");
  await db.query("update profiles set bot = true where id = $1", [A]);
  await tick(db, "SLM", 200, 10); await tick(db, "SLM", 1, 10.2);
  for (const tk of ["NXR", "HLV", "BCS", "FRC", "VLS", "OMB", "PXF", "MRV", "GTR", "LMR", "KST", "OND"]) await tick(db, tk, 1, 20);
  const plan = (await db.query("select * from bots_plan()")).rows;
  assert.equal(plan.length, 1); assert.equal(plan[0].what, "open");
  assert.ok(plan[0].stake >= 200 && plan[0].stake <= 800, "mise de 2 à 8 % du solde");
  assert.equal((await db.query("select * from bots_plan()")).rows.length, 0, "il vient d'agir");
  await db.query("update profiles set cash = 500, last_seen = now() where id = $1", [A]);
  await db.query("select * from bots_plan()");
  assert.equal(await cash(db, A), 10000, "faillite : il repart comme un joueur");
  await db.exec("grant usage on schema public to authenticated; set role authenticated");
  await assert.rejects(db.query("select * from bots_plan()"), /permission denied/, "réservé au serveur");
  await db.exec("reset role");
});

test("salaire : une couverture (hausse + baisse sur la même action) ne compte pas ; dégressif avec le patrimoine", async () => {
  const db = await freshDb(); await setClock(db, 4, 100); await login(db, A, "alice"); await login(db, B, "bob");
  await tick(db, "HLV", 2, 20); await tick(db, "SLM", 2, 10);
  await open(db, A, "HLV", "up", 5, 2000); await open(db, A, "HLV", "down", 5, 2000); // couverture : 0
  await open(db, A, "SLM", "up", 1, 1000);                                           // 1 000 W : 100 W
  await db.query("update profiles set cash = 59000 where id = $1", [B]);              // patrimoine ≈ 60 000 : moitié du salaire
  await open(db, B, "SLM", "up", 1, 2000);
  await db.query("update bets set created_at = now() - interval '3 minutes'");
  await setClock(db, 4, 600);
  const a0 = await cash(db, A), b0 = await cash(db, B);
  await db.query("select settle()");
  near(await cash(db, A) - a0, 100, "seule la position non couverte compte");
  const pat = (await db.query("select patrimoine($1) p", [B])).rows[0].p;
  near(await cash(db, B) - b0, Math.round(200 * (100000 - pat) / 80000), "salaire réduit au-dessus de 20 000 W (patrimoine relu après le salaire)", 2);
});

test("guilde de bots : un joueur qui la rejoint prend la place d'un bot et la direction", async () => {
  const db = await freshDb(); await login(db, A, "robot1"); await login(db, B, "robot2");
  await db.query("update profiles set bot = true");
  await db.query("select set_config('app.uid', $1, false)", [A]);
  const { rows: [g] } = await db.query("select * from guild_create('Les Taureaux', 'TAU')");
  await db.query("insert into guild_members (user_id, guild_id) values ($1, $2)", [B, g.id]);
  const H = "00000000-0000-0000-0000-00000000000c"; await login(db, H, "humain");
  await db.query("select guild_join($1)", [g.id]);
  const { rows: m } = await db.query("select user_id from guild_members where guild_id = $1 order by user_id", [g.id]);
  assert.deepEqual(m.map(r => r.user_id), [A, H], "robot2 a cédé sa place");
  assert.equal((await db.query("select owner from guilds where id = $1", [g.id])).rows[0].owner, H);
});

test("bots : paris réglés depuis 3 jours remplacés par un cumul, même total au classement", async () => {
  const db = await freshDb(); await login(db, A, "robot1");
  await db.query("update profiles set bot = true");
  await tick(db, "SLM", 2, 10);
  for (const st of [100, 200, 300]) { const b = await open(db, A, "SLM", "up", 1, st); await db.query("select aur_close($1, $2, 0)", [A, b.id]) }
  await db.query("update bets set closed_at = now() - interval '4 days'");
  const total = async () => (await db.query("select gain from gains_board('total')")).rows[0].gain;
  const before = await total();
  assert.equal((await db.query("select bots_compact() n")).rows[0].n, 3);
  assert.equal((await db.query("select count(*)::int n from bets")).rows[0].n, 1);
  near(await total(), before, "total des gains");
});

test("AUR-12 : aucune société au-dessus de 15 % de l'indice", () => {
  const w = capWeights([66, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1]);
  near(w.reduce((a, b) => a + b, 0), 1, "somme des poids");
  assert.ok(Math.max(...w) <= .15 + 1e-9, "plafond");
  near(w[1] / w[12], 5, "les autres gardent leurs proportions");
});
