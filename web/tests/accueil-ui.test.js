import { test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, demoServer, launch, overflow } from "./browser.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Page d'accueil → inscription → essai : le code de parrainage survit, l'essai verrouille ce qui exige un compte.
test("accueil, parrainage et essai sans compte", { skip: !chromePath() && !process.env.CI && "pas de Chrome sur cette machine (CHROME_PATH)", timeout: 300000 }, async () => {
  assert.ok(chromePath(), "Chrome introuvable : définir CHROME_PATH");
  const srv = await demoServer(), b = await launch(), text = () => b.evaluate("document.body.innerText");
  try {
    await b.size(375);
    await b.goto(srv.url + "?ref=ABCD-123");
    await b.waitFor("!!document.querySelector('.landing h1')");
    assert.equal(await b.evaluate("location.search"), "", "le code ne reste pas dans l'adresse");
    assert.equal(await b.evaluate("localStorage.getItem('wb-ref')"), "ABCD-123");
    await b.waitFor("document.querySelectorAll('.land-chart rect').length > 20", 15000); // le moteur tourne dans la page
    await sleep(600);
    const o = await overflow(b); assert.ok(o.scroll <= o.client, `accueil : ${o.scroll}/${o.client} px`);
    assert.ok((await b.evaluate("[...document.querySelectorAll('a')].map(a => a.getAttribute('href'))")).includes("/jouer?demo=1"));

    await b.goto(srv.url + "jouer"); // inscription : le code est déjà dans le champ
    await b.waitFor("!!document.querySelector('#ref')");
    assert.equal(await b.evaluate("document.querySelector('#ref').value"), "ABCD-123");

    await b.goto(srv.url + "jouer?demo=1"); // essai : présentation pendant la préparation, joueur local créé d'office
    await b.waitFor("!!document.querySelector('.intro-slide h1')", 20000);
    assert.match(await text(), /Bienvenue à Aurelys/);
    await sleep(5000); assert.match(await text(), /Les cours naissent des ordres/, "les diapositives défilent");
    { const o = await overflow(b); assert.ok(o.scroll <= o.client, `présentation : ${o.scroll}/${o.client} px`) }
    await b.waitFor("!!document.querySelector('.dock') && !!document.querySelector('.trial-bar')", 120000);
    assert.ok(await b.evaluate("!!document.querySelector('.coach')"), "bulles du tutoriel");
    assert.equal(await b.evaluate("localStorage.getItem('wb-ref')"), "ABCD-123", "l'essai garde le code pour la vraie inscription");
    await b.click("QG", ".dock"); await sleep(500); await b.click("Talents", "main"); await sleep(500);
    assert.match(await text(), /Les talents demandent un compte/);
    await b.click("Plus", ".dock"); await sleep(500);
    assert.match(await text(), /Le parrainage demande un compte/);
    await b.click("Ma guilde", "main"); await sleep(500);
    assert.match(await text(), /Les guildes demandent un compte/);
  } finally { await b.close(); await srv.close() }
});
