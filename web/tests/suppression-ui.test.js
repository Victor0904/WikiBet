import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, openApp } from "./browser.js";

const type = (b, v) => b.evaluate(`(() => { const i = document.querySelector("#del-pseudo"), set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true })()`);
const submitOff = b => b.evaluate(`document.querySelector(".acc-delete-form button[type=submit]").disabled`);

// Mon compte → Supprimer mon compte : bouton actif seulement avec le bon pseudo, textes en anglais, puis retour à l'accueil
// avec le message, session et base locale effacées (la langue reste).
test("suppression du compte : confirmation par le pseudo, puis accueil", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch();
  try {
    await b.size(375);
    await openApp(b, srv.url);
    await b.click("Plus", ".dock"); await b.click("Mon compte", "main");
    await b.click("Supprimer mon compte", "main"); await b.waitFor("!!document.querySelector('#del-pseudo')");
    assert.equal(await submitOff(b), true, "rien de tapé : bouton coupé");
    await type(b, "Autre"); assert.equal(await submitOff(b), true, "mauvais pseudo : bouton coupé");

    await b.evaluate(`localStorage.setItem("wb-lang", "en"); location.reload(), true`);
    await b.waitFor("!!document.querySelector('.dock')", 120000);
    await b.click("More", ".dock"); await b.click("My account", "main");
    await b.click("Delete my account", "main"); await b.waitFor("!!document.querySelector('#del-pseudo')");
    const form = await b.evaluate(`document.querySelector(".acc-delete-form").innerText.replace("Testeur", "")`);
    assert.doesNotMatch(form, /[àâçéèêëîïôûùœ]|\b(ton|tes|est|avec|compte|pseudo)\b/i, "confirmation traduite : " + form);

    await type(b, " testeur "); assert.equal(await submitOff(b), false, "bon pseudo (casse et espaces ignorés)");
    await b.click("Delete permanently", ".acc-delete-form");
    await b.waitFor("location.pathname === '/' && !!document.querySelector('.landing') && document.body.innerText.includes('Your account has been deleted')", 60000);
    assert.equal(await b.evaluate("location.search"), "", "adresse nettoyée");
    assert.deepEqual(await b.evaluate("Object.keys(localStorage)"), ["wb-lang"], "seule la langue reste");
    assert.deepEqual(await b.evaluate("indexedDB.databases().then(l => l.map(d => d.name).filter(n => n.startsWith('wikibourse-demo')))"), [], "base locale effacée");
  } finally { await b.close(); await srv.close() }
});
