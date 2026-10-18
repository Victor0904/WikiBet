// Leviers hauts face au vrai moteur : `node scripts/sim-levier.mjs [jours] [graine]`.
// Sur des cours simulés (un par seconde réelle), des positions ouvertes au hasard et tenues 150 s, 10 min ou 1 h réelles :
// part liquidée, coût d'un aller-retour (frais 0,1 % ×2 et impact de l'ordre, en % de la mise) et résultat moyen.
import { initState, advance, slip, STOCKS, DAY, SPM, FEE } from "../supabase/functions/_shared/aurelys.js";

const days = +(process.argv[2] ?? 6), seed = +(process.argv[3] ?? 11);
const t0 = 1_800_000_000, S = initState(t0, seed), P = Object.fromEntries(STOCKS.map(s => [s.tk, []]));
for (let t = t0; t < t0 + days * DAY * SPM; t += 200) for (const k of advance(S, t + 200).ticks) if (P[k.tk]) P[k.tk].push(k.p);

let r = 3; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
const STAKE = 1000, TRIES = 4000;
console.log(`${days} jours d'Aurelys simulés, mise ${STAKE} W, ${TRIES} positions par case (moitié ▲, moitié ▼)`);
for (const tk of ["NXR", "HLV", "PXF", "SLM"]) {
  const p = P[tk];
  console.log(`\n${tk} (liquidité ${STOCKS.find(s => s.tk === tk).liq})`);
  for (const lev of [5, 10, 15, 20]) {
    const cost = 2 * FEE * lev + 2 * slip(S, tk, STAKE * lev) * lev; // aller-retour, en part de la mise
    const cells = [150, 600, 3600].map(hold => {
      let liq = 0, net = 0;
      for (let n = 0; n < TRIES; n++) {
        const i = Math.floor(rnd() * (p.length - hold - 1)), sg = n % 2 ? 1 : -1, e = p[i], lq = e * (1 - sg / lev);
        let hit = false;
        for (let j = i + 1; j <= i + hold; j++) if (sg * (p[j] - lq) <= 0) { hit = true; break }
        if (hit) { liq++; net -= 1 } else net += Math.max(-1, lev * sg * (p[i + hold] / e - 1)) - cost;
      }
      return `${hold < 600 ? "150 s" : hold === 600 ? "10 min" : "1 h"} : ${(liq / TRIES * 100).toFixed(1).padStart(4)} % liquidées, ${(net / TRIES * 100).toFixed(1).padStart(5)} %`;
    });
    console.log(`  ×${String(lev).padEnd(2)} coût aller-retour ${(cost * 100).toFixed(1).padStart(4)} % · ${cells.join(" · ")}`);
  }
}
