import { test } from "node:test";
import assert from "node:assert/strict";
import { t, useDict, addNames, keyOf } from "../src/i18n.js";
import EN from "../src/en.js";
import { STOCKS, CHARACTERS, ANALYSTS } from "../supabase/functions/_shared/aurelys.js";

addNames([...STOCKS.map(s => s.name), ...CHARACTERS.map(c => c.name), ...ANALYSTS.map(a => a.split(",")[0]), "Aurelys", "Port-Aurel"]);
useDict(EN);

test("traduction : nombres, montants et noms propres gardés, formats à l'anglaise", () => {
  assert.equal(t("Mes positions"), "My positions");
  assert.equal(t("  Fermer "), "  Close ", "espaces autour gardés");
  assert.equal(t("Le titre cotait 12,40 W au moment de l'annonce."), "The stock was trading at 12.40 W at the time of the announcement.");
  assert.equal(t("Nexora Systems confirme : la rumeur était fondée"), "Nexora Systems confirms: the rumour was true");
  assert.equal(t("☆ Mains de diamant"), "☆ Diamond hands", "symbole devant le texte");
  assert.equal(t("Texte absent du dictionnaire"), "Texte absent du dictionnaire", "sinon, le français reste");
});

test("traduction : jokers (pseudos, noms de succès), pluriels, phrases assemblées par le moteur", () => {
  assert.equal(t("Voir le QG de Bob"), "See Bob's HQ");
  assert.equal(t("Succès débloqué : Esprit de corps (2 points de talent)"), "Achievement unlocked: Team spirit (2 talent points)");
  assert.equal(t("1 pari clôturé"), "1 bet closed");
  assert.equal(t("« Le marché en a vu d'autres », commente Sofia Delmar, de Castellane Research."), "“The market has seen worse”, says Sofia Delmar, of Castellane Research.");
  assert.equal(t("Clara Lemaire et Yanis Gallois ont fondé Pyrogen à Sel-Rouge. Leur pari : viande végétale. La société n'a encore jamais gagné d'argent ; elle lève des fonds pour grandir."),
    "Clara Lemaire and Yanis Gallois founded Pyrogen in Sel-Rouge. Their bet: plant-based meat. The company has never made money yet; it is raising funds to grow.");
});

test("dictionnaire : aucune traduction n'est elle-même une autre clé (la page ne bouclerait pas), repères connus", () => {
  for (const [k, v] of Object.entries(EN)) {
    if (v !== k && v in EN && EN[v] !== v) assert.fail(`« ${v} » est à la fois une traduction et une clé`);
    const ph = s => new Set(s.match(/\{w?\d+\}/g) ?? []), pk = ph(k);
    for (const p of ph(v)) assert.ok(pk.has(p), `repère ${p} inconnu dans « ${k} »`);
  }
  assert.equal(keyOf("Mise de 1 000 W").key, "Mise de {0} {1}", "les espaces ordinaires coupent un nombre, comme à l'écran");
});

test("actualités du moteur : toutes traduites (10 jours d'Aurelys, graine jamais vue par l'extraction)", async () => {
  const { initState, advance, SPM } = await import("../supabase/functions/_shared/aurelys.js");
  const t0 = 1900000000, S = initState(t0, 99), miss = new Set(); let v = t0;
  for (let i = 0; i < 10 * 1440 / 240; i++) {
    v += 240 * SPM; const o = advance(S, v); addNames(Object.values(S.extra).map(d => d.name));
    for (const n of o.news) for (const p of [n.title, ...(n.text ?? "").split("\n\n")]) if (p && t(p) === p) miss.add(p);
  }
  assert.deepEqual([...miss], [], "lancer scripts/i18n-keys.mjs puis traduire les nouvelles clés");
});
