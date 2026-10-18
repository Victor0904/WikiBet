// Captures de la page d'accueil (visiteur), sur téléphone et sur grand écran : `node scripts/capture-accueil.mjs <dossier>`.
import { demoServer, launch } from "../tests/browser.js";

const out = process.argv[2] ?? ".";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await demoServer(), b = await launch();
try {
  for (const [w, h] of [[375, 812], [1280, 900]]) {
    await b.size(w, h);
    await b.goto(srv.url); await b.waitFor("!!document.querySelector('.landing h1')", 60000); await sleep(4000);
    await b.shot(`${out}/accueil-${w}.png`, true);
  }
} finally { await b.close(); await srv.close() }
