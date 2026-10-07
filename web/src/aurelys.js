// Bourse d'Aurelys côté écran : cours de chaque seconde jusqu'à maintenant (jamais au-delà), bougies d'une minute,
// actualités publiées. La simulation tourne sur le serveur ; ici on ne fait que lire et afficher.
import { useEffect, useRef, useState } from "react";
import { STOCKS, INDEX, DAY, EPOCH_S } from "../supabase/functions/_shared/aurelys.js";

const KEEP_S = 600; // secondes de cours gardées pour les graphiques à la seconde et les positions récentes

// Ajoute un cours à la bougie de sa minute (bougies [t, o, h, l, c, v], t en secondes).
function toCandle(cs, t, p, v) {
  const m = t - t % 60, k = cs[cs.length - 1];
  if (k && k[0] === m) { k[2] = Math.max(k[2], p); k[3] = Math.min(k[3], p); k[4] = p; k[5] += v }
  else if (!k || k[0] < m) cs.push([m, p, p, p, p, v]);
}

export function useAurelys(api, active) {
  const [, render] = useState(0), data = useRef({ ticks: {}, candles: {}, quotes: {}, x: null, since: null, ok: false, news: [] });
  // Historique : bougies des 3 dernières heures, au démarrage et après une longue absence.
  const loadHistory = async () => {
    const h = await api.aurHistory(null, 180), d = data.current;
    for (const tk of [...STOCKS.map(s => s.tk), INDEX]) d.candles[tk] = (h[tk] ?? []).map(r => r.map(Number));
  };
  useEffect(() => {
    let alive = true, timer;
    const poll = async () => {
      const d = data.current;
      try {
        if (!d.ok) { await loadHistory(); d.ok = true }
        const f = await api.aurFeed(d.since);
        if (d.since && f.rows.length && f.rows[0][0] - d.since > 120) { d.since = null; d.ok = false; d.ticks = {} } // trou : on recharge
        for (const [t, tk, p, v, halt] of f.rows) {
          (d.ticks[tk] ??= []).push([t, p, v, halt]);
          toCandle(d.candles[tk] ??= [], t, p, v);
          d.quotes[tk] = { p, halt, t };
          d.since = Math.max(d.since ?? 0, t);
        }
        for (const tk in d.ticks) { const a = d.ticks[tk], lim = (d.since ?? 0) - KEEP_S; let i = 0; while (i < a.length && a[i][0] < lim) i++; if (i) a.splice(0, i) }
        for (const tk in d.candles) { const a = d.candles[tk]; if (a.length > 200) a.splice(0, a.length - 200) }
        if (f.x) d.x = f.x;
        d.live = f.rows.length > 0 || (d.since && f.now - d.since < 30);
        if (alive) render(n => n + 1);
      } catch { d.live = false }
      if (alive) timer = setTimeout(poll, active ? 1000 : 10000);
    };
    poll();
    return () => { alive = false; clearTimeout(timer) };
  }, [api, active]);
  // Actualités : toutes les 5 s quand on regarde le marché.
  useEffect(() => {
    let alive = true;
    const load = () => api.aurNews().then(n => { if (alive) { data.current.news = n.map(x => ({ ...x, id: Number(x.id), at: new Date(x.t).getTime() })); render(k => k + 1) } }).catch(() => {});
    load(); const id = setInterval(load, active ? 5000 : 30000);
    return () => { alive = false; clearInterval(id) };
  }, [api, active]);
  return data.current;
}

// Cours au début du jour d'Aurelys en cours (24 min réelles), pour la variation « du jour ».
export function dayOpen(aur, tk, sec) {
  const start = sec - ((sec - EPOCH_S) % DAY), cs = aur.candles[tk] ?? [];
  const k = cs.find(c => c[0] >= start) ?? cs[cs.length - 1];
  return k?.[1];
}
