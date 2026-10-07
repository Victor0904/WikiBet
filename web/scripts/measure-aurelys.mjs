// Mesure la volatilité réalisée et la corrélation des actions d'Aurelys sur N jours simulés. Usage : node scripts/measure-aurelys.mjs [jours] [graine]
import { initState, advance, STOCKS, slip, DAY, SPM, EPOCH_S } from "../supabase/functions/_shared/aurelys.js";
const days = +(process.argv[2] ?? 15), seed = +(process.argv[3] ?? 7);
const t0 = 1_800_000_000, S = initState(t0, seed), P = Object.fromEntries(STOCKS.map(s => [s.tk, []]));
let news = 0, regs = {};
for (let t = t0; t < t0 + days * DAY * SPM; t += 200) {
  if (process.env.CALM) { S.reg = "calme"; S.crisis = null; S.crisisCd = 1e12 }
  if (process.env.NONEWS) for (const k in S.next) S.next[k] = 1e12;
  if (process.env.NOWHALE) for (const w of ["kraken", "orca", "lev"]) S.whales[w] = { ph: "idle", until: 1e12, pos: 0 };
  const out = advance(S, t + 200);
  for (const k of out.ticks) if (P[k.tk]) P[k.tk].push(k.p);
  news += out.news.length; regs[S.reg] = (regs[S.reg] ?? 0) + 1;
}
const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) };
const rets = (p, h) => { const r = []; for (let i = h; i < p.length; i += h) r.push(Math.log(p[i] / p[i - h])); return r };
const pc = x => (x * 100).toFixed(1).padStart(5);
console.log("tk    cible  1min  1h    jour   (σ annualisé par jour)");
// Un cours par seconde réelle : une heure d'Aurelys = 60 × SPM secondes, un jour = 1 440 × SPM.
const H1 = 60 * SPM, D1 = DAY * SPM;
for (const s of STOCKS) { const p = P[s.tk]; console.log(s.tk.padEnd(5), pc(s.sig), "  —  ", pc(sd(rets(p, H1)) * Math.sqrt(24)), pc(sd(rets(p, D1)))) }
// Corrélation moyenne des rendements horaires et part des heures où presque tout monte ensemble.
const H = STOCKS.map(s => rets(P[s.tk], 60 * SPM)), n = H[0].length;
let c = 0, k = 0;
const corr = (a, b) => { const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length; let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2 } return s / Math.sqrt(sa * sb) };
for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) { c += corr(H[i], H[j]); k++ }
let same = 0; for (let i = 0; i < n; i++) { const up = H.filter(h => h[i] > 0).length; if (up >= 11 || up <= 1) same++ }
console.log(`corrélation horaire moyenne ${(c / k).toFixed(2)} · heures où ≥ 11/12 vont dans le même sens : ${(same / n * 100).toFixed(0)} %`);
console.log(`news/jour ${(news / days).toFixed(0)} · régimes`, regs);
for (const [tk, q] of [["SLM", 24890], ["SLM", 120000], ["NXR", 24890], ["HLV", 24890]]) console.log(`impact ${tk} ${q} : ${(slip(S, tk, q) * 100).toFixed(2)} %`);
