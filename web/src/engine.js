// Moteur partagé par le front, le seed de la base et les tests. Aucune dépendance au navigateur.
// Tout est déterministe : deux joueurs qui calculent le même cours au même instant obtiennent le même nombre,
// et la base contient exactement ces nombres (voir scripts/seed.mjs).

export const T = 510;                         // minutes de jeu par séance (9:00 → 17:30)
export const PLAY_MS = 600_000;               // 10 min de jeu…
export const PAUSE_MS = 60_000;               // …puis 1 min de pause
export const CYCLE_MS = PLAY_MS + PAUSE_MS;
export const EPOCH = Date.UTC(2026, 0, 1);    // séance 0
export const CAP0 = 10000, SALARY = 500, BK_LIMIT = 2000, MARGIN = 0.93;
export const LEVS = [1, 5, 10];
export const HORIZONS = { "15": "15 min", "60": "1 h", close: "fin de séance" };

const hashStr = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 };
const rngOf = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 };
const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) };
export const toOdds = p => Math.max(1.08, Math.round(MARGIN / p * 100) / 100);
export const endTick = (h, t) => h === "close" ? T : Math.min(T, t + +h);

// Valeur d'une position : mise × (1 + levier × sens × variation), jamais sous 0.
export const tradeValue = (b, px) => Math.max(0, b.stake * (1 + b.lev * (b.dir === "up" ? 1 : -1) * (px / b.entry - 1)));
// Cours qui liquide la position (valeur nulle).
export const liqPrice = b => b.entry * (1 - (b.dir === "up" ? 1 : -1) / b.lev);

export function createEngine(data) {
  const META = data.articles, RAW = data.views;
  const NDAYS = RAW[META[0][1]].length, END = NDAYS - 1, START = Math.max(1, END - 30), NSESS = END - START;
  const D0 = new Date(data.start + "T00:00:00Z");
  const STOCKS = META.map(([tk, slug, name, sector]) => { const views = RAW[slug]; return { tk, slug, name, sector, views, px: views.map(v => Math.round(Math.sqrt(Math.max(v, 1)) * 50) / 100) } });
  const BY = Object.fromEntries(STOCKS.map(s => [s.tk, s]));

  function histVol(s, d) { let a = 0, n = 0; for (let i = Math.max(1, d - 20); i <= d; i++) { const r = Math.log(s.px[i] / s.px[i - 1]); a += r * r; n++ } return Math.sqrt(a / Math.max(1, n)) }

  // Cours minute par minute de la clôture d à la clôture d+1 : pont brownien seedé, avec un « choc »
  // quand la vraie variation du jour est forte. Renvoie les cours (pas les logs), T+1 points.
  const cache = new Map();
  function pathOf(tk, d) {
    const key = tk + d; if (cache.has(key)) return cache.get(key);
    const s = BY[tk], o = Math.log(s.px[d]), c = Math.log(s.px[Math.min(d + 1, s.px.length - 1)]), mv = c - o, r = rngOf(hashStr(tk) + d * 9973);
    const step = Math.min(.6, Math.max(.03, histVol(s, d) * .55)) / Math.sqrt(T) * 1.6;
    const w = new Float64Array(T + 1); for (let i = 1; i <= T; i++) w[i] = w[i - 1] + step * gauss(r) * (i < 30 || i > T - 30 ? 1.5 : 1);
    const big = Math.abs(mv) > .25, j = Math.floor((.12 + .7 * r()) * T), jl = 3 + Math.floor(r() * 8), p = new Array(T + 1);
    for (let i = 0; i <= T; i++) { const lin = big ? .25 * mv * i / T + (i >= j ? .75 * mv * Math.min(1, (i - j + 1) / jl) : 0) : mv * i / T; p[i] = Math.exp(o + lin + w[i] - (i / T) * w[T]) }
    cache.set(key, p); return p;
  }

  // Duels : deux articles d'audience proche, réglés sur les vraies vues du lendemain. Le premier a une cote boostée.
  function makeDuels(d) {
    const r = rngOf(9001 + d * 31), pool = [...STOCKS].sort(() => r() - .5), used = new Set(), out = [];
    for (const a of pool) {
      if (used.has(a.tk) || out.length >= 4) continue;
      let best = null, bd = 1e9;
      for (const b of pool) { if (b === a || used.has(b.tk)) continue; const q = Math.abs(Math.log(a.views[d] / b.views[d])); if (q < bd) { bd = q; best = b } }
      if (best && bd < Math.log(3)) {
        used.add(a.tk); used.add(best.tk);
        const wa = Math.pow(a.views[d], .85), wb = Math.pow(best.views[d], .85), pa = wa / (wa + wb);
        out.push({ id: "D" + d + a.tk + best.tk, day: d, a: a.tk, b: best.tk, oa: toOdds(pa), ob: toOdds(1 - pa), boost: false });
      }
    }
    if (out.length) { const x = out[0], side = x.oa > x.ob ? "a" : "b"; x.base = x["o" + side]; x["o" + side] = Math.round(x.base * 1.4 * 100) / 100; x.boost = side }
    return out;
  }

  // Où en est la partie à l'instant `now` (ms) : numéro de séance, jour de données, minute de jeu.
  function session(now) {
    const ms = now - EPOCH, k = Math.floor(ms / CYCLE_MS), off = ms - k * CYCLE_MS, playing = off < PLAY_MS;
    const startsAt = EPOCH + k * CYCLE_MS;
    return { k, d: START + ((k % NSESS) + NSESS) % NSESS, playing, t: playing ? Math.floor(off * T / PLAY_MS) : T, // même calcul que game_now() en SQL
      startsAt, endsAt: startsAt + PLAY_MS, nextAt: startsAt + CYCLE_MS, off };
  }
  const dateOf = i => new Date(D0.getTime() + i * 86400000);

  return { STOCKS, BY, START, END, NSESS, pathOf, price: (tk, d, t) => pathOf(tk, d)[Math.max(0, Math.min(t, T))], makeDuels, session, dateOf };
}
