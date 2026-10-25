// Analystes et tuyaux : `node scripts/sim-analystes.mjs [heures=100] [graine=7]`.
// 1. Fait tourner le vrai moteur et achète, chaque minute, un tuyau de chaque niveau sur chaque société auprès de chaque
//    analyste, comme rumor_buy (prochains résultats, consensus après la révision en attente, vrai chiffre caché). Jugé
//    comme analyst_resolve, sur le titre du Courrier : taux affiché par analyste et par niveau.
// 2. Valeur d'un tuyau : gain moyen d'une position ouverte juste avant la publication dans le sens du tuyau, fermée 5 min
//    après (la réaction aux résultats s'efface ensuite dans le bruit), en % de l'exposition. « sélectif » : au niveau 3,
//    on ne joue que si le chiffre annoncé s'écarte d'au moins 2 points du consensus.
// 3. Prix contre patrimoine et valeur pour les profils de scripts/sim-saisons.mjs.
// Constat de départ (25 octobre 2026, 100 h, graine 7) : avec la règle du cahier des charges (cours de l'achat jusqu'aux
// résultats + 30 min), même une information parfaite ne donnait que 57 % ; d'où un tuyau jugé sur le chiffre publié.
import { initState, advance, calendar, STOCKS, FEE } from "../supabase/functions/_shared/aurelys.js";
import { TUYAU, ANALYSTS, tuyauPrice, drawTuyau, tuyauOk, parseResults } from "../supabase/functions/_shared/analystes.js";

const hours = +(process.argv[2] ?? 100), seed = +(process.argv[3] ?? 7), t0 = 1_800_000_000, N = hours * 3600;
let rs = 99; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());

const S = initState(t0, seed), P = Object.fromEntries(STOCKS.map(s => [s.tk, new Float64Array(N + 10)])), pubs = [], buys = [];
for (let t = t0; t < t0 + N; t += 60) {
  if (t > t0 + 3600) for (const s of STOCKS) {
    const r = S.st[s.tk]?.res, ev = calendar(t, 40).find(e => e.tk === s.tk && e.kind === "resultats");
    if (!r || !ev || ev.at / 1000 - t < TUYAU.minLead) continue;
    buys.push({ tk: s.tk, t, act: r.act, cons: S.revq?.find(v => v.tk === s.tk)?.nc ?? r.cons, ev: Math.ceil(ev.at / 1000) });
  }
  const out = advance(S, t + 60);
  for (const k of out.ticks) if (P[k.tk]) P[k.tk][k.t - t0] = k.p;
  for (const n of out.news) if (n.cat === "resultats" && P[n.tk]) pubs.push({ tk: n.tk, t: n.t, ...parseResults(n.title) });
}
for (const a of Object.values(P)) for (let i = 1; i < a.length; i++) if (!a[i]) a[i] = a[i - 1];
for (const b of buys) b.r = pubs.find(p => p.tk === b.tk && p.t >= b.t && p.t <= b.ev + 5);
const done = buys.filter(b => b.r && b.ev + 300 < t0 + N);
const pct = x => `${(100 * x).toFixed(0).padStart(3)} %`, px = (tk, s) => P[tk][s - t0];
const move = (b, dir) => (dir === "up" ? 1 : -1) * (px(b.tk, b.ev + 300) / px(b.tk, b.ev - 1) - 1) - 2 * FEE;
console.log(`${hours} h de marché, ${done.length} achats par analyste et par niveau (${pubs.length} publications)`);
console.log(`publications « conformes » : ${pct(pubs.filter(p => p.side === "flat").length / pubs.length)}\n`);

console.log("analyste    fiab   taux affiché niv1 → niv5              valeur (% de l'exposition) niv1 → niv5, sélectif niv3");
const value = {};
for (const [slug, , rel] of ANALYSTS) {
  const rate = [], val = [];
  let sel = 0, nSel = 0;
  for (let l = 1; l <= 5; l++) {
    let ok = 0, g = 0;
    for (const b of done) {
      const x = drawTuyau(b.act, b.cons, rel, l, rnd, gauss);
      ok += tuyauOk(x, l, b.r);
      if (x.dir === "flat") continue;
      g += move(b, x.dir);
      if (l === 3 && Math.abs(x.fig - b.cons) >= 2) { sel += move(b, x.dir); nSel++ }
    }
    rate.push(pct(ok / done.length)); val.push((100 * g / done.length).toFixed(2).padStart(5));
  }
  value[slug] = +val[2] / 100;
  console.log(slug.padEnd(10), rel.toFixed(2), rate.join(" "), "     ", val.join(" "), `   ${(100 * sel / done.length).toFixed(2)} (joué ${pct(nSel / done.length)})`);
}
const perfect = done.filter(b => b.r.side !== "flat").reduce((a, b) => a + move(b, b.r.side), 0) / done.length;
console.log(`information parfaite (sens publié, sans les conformes) : valeur ${(100 * perfect).toFixed(2)} % de l'exposition`);
console.log("heure de publication (niveau 5 du cahier des charges) : déjà publique (fiche société, « À venir »), valeur nulle");

console.log("\nprix (W, part du patrimoine) et valeur d'un tuyau de niveau 3 suivi");
const PROF = [["débutant", 10000, .08, 5], ["régulier", 25000, .08, 10], ["confirmé", 60000, .06, 15], ["riche", 200000, .05, 10], ["baleine", 500000, .05, 5]];
for (const [name, nw, f, lev] of PROF) {
  console.log(`\n${name} (${nw.toLocaleString("fr")} W, mise ${f * 100} %, ×${lev}, exposition ${(nw * f * lev).toLocaleString("fr")} W)`);
  for (const [slug, , , base] of ANALYSTS) {
    const p = [1, 3, 5].map(l => tuyauPrice(base, nw, l)), sh = x => `${String(x).padStart(6)} (${(100 * x / nw).toFixed(1)} %)`;
    console.log(`  ${slug.padEnd(8)} niv1 ${sh(p[0])}  niv3 ${sh(p[1])}  niv5 ${sh(p[2])}  valeur niv3 ≈ ${Math.round(nw * f * lev * value[slug])} W`);
  }
}
