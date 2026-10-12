// Navigateur pour les tests d'écran, sans dépendance : un Chrome sans fenêtre piloté par le protocole DevTools (WebSocket
// de Node 22), et l'app servie par Vite en mode démo (base PGlite dans la page). CHROME_PATH pour choisir le binaire.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CANDIDATES = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
export const chromePath = () => CANDIDATES.find(p => p && existsSync(p));

// L'app en mode démo (sans clés Supabase), sur un port libre.
export async function demoServer() {
  process.env.VITE_SUPABASE_URL = ""; process.env.VITE_SUPABASE_ANON_KEY = "";
  const { createServer } = await import("vite");
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent", server: { port: 5290 } });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

export async function launch() {
  const dir = mkdtempSync(join(tmpdir(), "wb-chrome-"));
  const proc = spawn(chromePath(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "about:blank"], { stdio: "ignore" });
  let port;
  for (let i = 0; i < 150 && !port; i++) { await sleep(100); try { port = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n")[0] } catch { } }
  if (!port) { proc.kill(); throw new Error("Chrome ne démarre pas"); }
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) });
  const evaluate = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return; await sleep(150) }
    throw new Error("Délai dépassé : " + expr);
  };
  return {
    evaluate, waitFor,
    size: (width, height = 820) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 }),
    goto: url => send("Page.navigate", { url }),
    // Clic sur le bouton dont le texte commence par `text` (dans `scope`, sélecteur CSS).
    click: (text, scope = "body") => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (!b) throw new Error("bouton introuvable : " + ${JSON.stringify(text)}); b.click(); return true })()`),
    // Page entière, ou seulement ce qui est à l'écran (full = false : feuilles et éléments fixes à leur place).
    shot: async (path, full = true) => {
      const { width, height } = (await send("Page.getLayoutMetrics")).cssContentSize;
      const r = await send("Page.captureScreenshot", full ? { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } } : { format: "png" });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    close: async () => { ws.close(); proc.kill(); await sleep(500); try { rmSync(dir, { recursive: true, force: true }) } catch { } },
  };
}

// Joueur de démo connecté, sur l'écran Talents.
export async function openTalents(b, url) {
  await b.goto(url);
  await b.waitFor("document.readyState === 'complete' && !!document.querySelector('input')");
  await b.evaluate(`localStorage.setItem("wb-howto", "1"); (() => { const i = document.querySelector("input"), set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(i, "Testeur"); i.dispatchEvent(new Event("input", { bubbles: true })); return true })()`);
  await b.click("Entrer");
  await b.waitFor("!!document.querySelector('.dock')", 120000); // première visite : la démo installe sa base
  await b.click("QG", ".dock");
  await b.waitFor("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Talents')");
  await b.evaluate(`[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Talents").click()`);
  await b.waitFor("!!document.querySelector('.talents .tal-card')");
  await sleep(700); // fin du fondu d'entrée de l'écran
}
// Mesure du débordement horizontal de la page.
export const overflow = b => b.evaluate("({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })");
// Données de démo forcées : niveau 20, 12 points en Prudence avec Phénix (ultime), 4 en Audace ; puis l'écran est relu.
export async function forceTalents(b) {
  await b.evaluate(`(async () => {
    await window.__wbDemo.query("update profiles set tal_hwm = 112500 where not bot");
    await window.__wbDemo.query("insert into talents select p.id, v.c, v.r from profiles p, (values ('amort', 5), ('frais', 5), ('sangfroid', 1), ('filet', 1), ('phenix', 1), ('discretion', 3), ('multitache', 1)) v(c, r) where not p.bot on conflict do nothing");
    return true })()`);
  // Rouvrir l'écran pour relire ; un rechargement lancé avant l'écriture peut arriver après : on réessaie.
  for (let i = 0; ; i++) {
    await b.evaluate(`[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "QG").click()`);
    await b.evaluate(`[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Talents").click()`);
    // Niveau 20 et Phénix pris (pas le nombre de points : un succès peut s'y ajouter, ex. « Trader confirmé » à 100 000 W).
    try { await b.waitFor("document.querySelector('.tal-lv b')?.textContent === '20' && !!document.querySelector('.tal-card.ult.on')", 10000); break } catch (e) {
      if (i >= 5) throw new Error(e.message + " ; affiché : " + await b.evaluate("document.querySelector('.talents')?.innerText.slice(0, 200) ?? document.body.innerText.slice(0, 300)"));
    }
  }
  await sleep(700); // fin du fondu d'entrée de l'écran
}
