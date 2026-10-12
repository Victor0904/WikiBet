import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, login } from "./db.js";
import { slip, closeQuote, initState, EPOCH_S } from "../supabase/functions/_shared/aurelys.js";

const A = "00000000-0000-0000-0000-00000000000a";
const tick = (db, ago, p) => db.query("insert into aur_ticks (tk, t, p) values ('SLM', now() - make_interval(secs => $1), $2)", [ago, p]);

test("impact : 100 000 W ≈ 0,35 % par sens sur une petite valeur, ≈ 0,1 % sur une grosse, racine carrée gardée", () => {
  const S = initState(EPOCH_S + 11 * 3600, 1);
  const pxf = slip(S, "PXF", 100000), lmr = slip(S, "LMR", 100000);
  assert.ok(pxf > .003 && pxf < .005, `Pixelfold : ${(pxf * 100).toFixed(2)} %`);
  assert.ok(lmr > .0008 && lmr < .0015, `Lumirue : ${(lmr * 100).toFixed(2)} %`);
  assert.ok(Math.abs(slip(S, "PXF", 400000) / pxf - 2) < 1e-9, "4 fois plus gros = 2 fois plus d'impact");
  assert.equal(slip(S, "PXF", 100000), slip(null, "PXF", 100000), "l'écran calcule le même impact que le serveur");
  // Aller-retour à ×10 (impact des deux sens + frais) : 5 à 10 % de la mise.
  const rt = 10 * (2 * pxf + .002);
  assert.ok(rt > .05 && rt < .1, `aller-retour ×10 sur Pixelfold : ${(rt * 100).toFixed(1)} % de la mise`);
});

test("impact : la valeur affichée (closeQuote) est le paiement réel de aur_close, ▲ et ▼, ×1 à ×20, petite et grosse mise", async () => {
  const db = await freshDb(); await login(db, A, "alice");
  await db.query("update profiles set cash = 1e6 where id = $1", [A]);
  await db.query("select buy_item('studio')"); // ×20
  const rate = (await db.query("select my_fee_rate() as r")).rows[0].r;
  assert.equal(rate, .001);
  for (const dir of ["up", "down"]) for (const lev of [1, 10, 20]) for (const stake of [100, Math.floor(110000 / lev)]) {
    await tick(db, 3, 10);
    const n = stake * lev, b = (await db.query("select * from aur_open($1, 'SLM', $2, $3, $4, $5)", [A, dir, lev, stake, slip(null, "SLM", n)])).rows[0];
    await tick(db, 2, 10.04); // le cours bouge un peu après l'ouverture
    const shown = closeQuote(b, 10.04, rate).value;
    const c = (await db.query("select * from aur_close($1, $2, $3)", [A, b.id, slip(null, "SLM", n)])).rows[0];
    const gap = Math.abs(c.payout - shown);
    assert.ok(gap < .005 * n, `${dir} ×${lev} ${stake} W : affiché ${shown.toFixed(2)}, payé ${c.payout.toFixed(2)}`);
    assert.ok(gap < 1e-6, `même formule : écart ${gap}`);
    await db.query("delete from aur_ticks");
  }
});
