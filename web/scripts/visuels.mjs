// Visuels de la page d'accueil, regénérés par `npm run visuels` (Chrome sans fenêtre, comme les tests d'écran) :
//   public/og.png (1200 × 630, aperçu de partage), icônes PNG, captures WebP du jeu en démo (public/captures).
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launch } from "../tests/browser.js";
import { initState, advance, SPM } from "../supabase/functions/_shared/aurelys.js";

const root = fileURLToPath(new URL("..", import.meta.url)), pub = root + "public/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
process.env.VITE_SUPABASE_URL = ""; process.env.VITE_SUPABASE_ANON_KEY = ""; // le jeu en démo
const { createServer } = await import("vite");
const server = await createServer({ root, logLevel: "silent", server: { port: 5291 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const { TkIcon } = await server.ssrLoadModule("/src/logos.jsx");
const icon = (tk, size) => renderToStaticMarkup(createElement(TkIcon, { tk, size }));
const b = await launch();
// Page servie par Vite (polices, favicon), contenu remplacé.
const page = async (w, h, html) => {
  await b.size(w, h); await b.goto(url + "robots.txt"); await sleep(400);
  await b.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); document.fonts.ready.then(() => true)`); await sleep(300);
};
const FONTS = `<style>
@font-face { font-family: Plex; font-weight: 400; src: url(/fonts/ibm-plex-sans-latin-400-normal.woff2) }
@font-face { font-family: Cond; font-weight: 700; src: url(/fonts/ibm-plex-sans-condensed-latin-700-normal.woff2) }
@font-face { font-family: Mono; font-weight: 500; src: url(/fonts/ibm-plex-mono-latin-500-normal.woff2) }
html, body { margin: 0; background: #08090D; color: #E6E8EE }
.coin-icon { display: grid; place-items: center; border-radius: 8px; box-shadow: inset 0 -2px 0 rgba(0,0,0,.18) }
</style>`;

try {
  // Bougies de Pixelfold, tirées par le moteur (graine fixe, choisie pour un cours qui monte : même image à chaque génération).
  const t0 = 1800000000, S = initState(t0, 185), cs = [];
  for (let v = t0, i = 0; i < 4; i++) { v += 120 * SPM; for (const k of advance(S, v).ticks) if (k.tk === "PXF") {
    const m = Math.floor((k.t - t0) / SPM / 12), c = cs.at(-1);
    if (c && c.m === m) { c.h = Math.max(c.h, k.p); c.l = Math.min(c.l, k.p); c.c = k.p } else cs.push({ m, o: c?.c ?? k.p, h: k.p, l: k.p, c: k.p });
  } }
  const W = 520, H = 380, hi = Math.max(...cs.map(c => c.h)), lo = Math.min(...cs.map(c => c.l)), y = v => 10 + (hi - v) / (hi - lo) * (H - 20), st = W / cs.length;
  const candles = cs.map((c, i) => { const x = i * st + st / 2, col = c.c >= c.o ? "#1FCB8B" : "#F04B5C";
    return `<line x1="${x}" x2="${x}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}" stroke-width="2"/><rect x="${x - st * .32}" width="${st * .64}" y="${y(Math.max(c.o, c.c))}" height="${Math.max(2, Math.abs(y(c.o) - y(c.c)))}" fill="${col}" rx="1.5"/>` }).join("");
  const chg = cs.at(-1).c / cs[0].o - 1;
  await page(1200, 630, `${FONTS}<div style="width:1200px;height:630px;box-sizing:border-box;padding:70px 60px 0 80px;display:flex;gap:40px;font-family:Plex;overflow:hidden">
    <div style="width:540px;flex:none;display:flex;flex-direction:column;gap:22px">
      <div style="display:flex;align-items:center;gap:22px"><img src="/favicon.svg" width="96" height="96"><b style="font:700 86px/1 Cond">Aurelys</b></div>
      <p style="margin:6px 0 0;font:700 48px/1.08 Cond">Une bourse inventée, branchée sur le vrai monde.</p>
      <p style="margin:0;font-size:24px;line-height:1.35;color:#9097A8">13 sociétés fictives, de vrais chiffres. Gratuit, sans vraie monnaie, essai sans compte.</p>
      <div style="display:flex;gap:12px;margin-top:8px">${["NXR", "PXF", "HLV", "SLM", "VLS", "OMB", "GTR"].map(tk => icon(tk, 56)).join("")}</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:18px;padding-top:20px">
      <div style="font:500 24px Mono;color:${chg >= 0 ? "#1FCB8B" : "#F04B5C"};text-align:right">Pixelfold ${chg >= 0 ? "▲ +" : "▼ "}${(chg * 100).toFixed(1).replace(".", ",")} %</div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${candles}</svg>
    </div>
  </div>`);
  await b.shot(pub + "og.png", false);
  // Icônes : fond plein (iOS arrondit lui-même les coins).
  for (const [f, n] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
    await page(n, n, `${FONTS}<body style="background:#0F1117"><img src="/favicon.svg" width="${n}" height="${n}" style="display:block"></body>`);
    await b.shot(pub + f, false);
  }
  // Captures du jeu en démo, sur téléphone.
  mkdirSync(pub + "captures", { recursive: true });
  await b.size(375, 760); await b.goto(url + "jouer");
  await b.waitFor("!!document.querySelector('input')");
  await b.evaluate(`localStorage.setItem("wb-howto", "1"); (() => { const i = document.querySelector("input"), set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(i, "Camille"); i.dispatchEvent(new Event("input", { bubbles: true })); return true })()`);
  await b.click("Entrer"); await b.waitFor("!!document.querySelector('.dock')", 120000);
  await b.evaluate(`window.__wbDemo.query("update profiles set xp = 9999 where not bot").then(() => window.__wbDemo.query("select guild_create('Les Baleines', 'BAL', 'On achète la rumeur, on vend la nouvelle')")).then(() => true)`);
  await sleep(60000); // une base neuve : une minute de cours et de nouvelles
  await b.shot(pub + "captures/marche.webp", false, "webp");
  await b.evaluate(`document.querySelector("main .as-link").click(), true`); await b.waitFor("!!document.querySelector('.sheet.detail')");
  await b.click("1 min", ".sheet.detail"); await sleep(2500);
  await b.shot(pub + "captures/fiche.webp", false, "webp");
  await b.evaluate(`document.querySelector(".sheet.detail .x").click(), true`);
  await b.click("Guilde", ".dock"); await sleep(1500);
  await b.shot(pub + "captures/guilde.webp", false, "webp");
  for (const f of ["og.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "captures/marche.webp", "captures/fiche.webp", "captures/guilde.webp"])
    console.log(f, Math.round(statSync(pub + f).size / 1024), "Ko");
} finally { await b.close(); await server.close() }
