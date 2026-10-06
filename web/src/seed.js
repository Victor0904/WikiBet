// Lignes à mettre en base, calculées par le moteur : utilisé par scripts/seed.mjs (Supabase) et par le mode démo.
import { EPOCH, PLAY_MS, PAUSE_MS, T } from "./engine.js";

export function seedRows(engine) {
  const { STOCKS, START, END, NSESS, pathOf, makeDuels } = engine;
  const days = []; for (let d = START; d < END; d++) days.push(d);
  return {
    game_config: [{ id: 1, epoch: new Date(EPOCH).toISOString(), play_ms: PLAY_MS, pause_ms: PAUSE_MS, ticks: T, start_day: START, nsess: NSESS }],
    articles: STOCKS.map(({ tk, slug, name, sector }) => ({ tk, slug, name, sector })),
    views: STOCKS.flatMap(s => s.views.map((views, day) => ({ tk: s.tk, day, views }))),
    prices: days.flatMap(day => STOCKS.map(s => ({ day, tk: s.tk, px: pathOf(s.tk, day) }))),
    duels: days.flatMap(d => makeDuels(d).map(({ id, day, a, b, oa, ob, boost }) => ({ id, day, a, b, oa, ob, boost: boost || null }))),
  };
}
