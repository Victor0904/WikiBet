// Accès au jeu. Avec les clés Supabase (.env.local) : la vraie base partagée.
// Sans clés : mode démo, la même base SQL tourne dans le navigateur (voir demo.js).
import { createClient } from "@supabase/supabase-js";

// Les identifiants bigint et les cotes numeric arrivent parfois en texte : on normalise une fois ici.
export const normBet = b => ({ ...b, id: Number(b.id), odds: b.odds == null ? null : Number(b.odds) });
export const normMarket = m => ({ ...m, id: Number(m.id), closes_at: new Date(m.closes_at).toISOString(), p_yes: Number(m.p_yes), odds_yes: Number(m.odds_yes), odds_no: Number(m.odds_no) });
export const normBoard = r => ({ ...r, cash: Number(r.cash), patrimoine: Number(r.patrimoine) });
export const normStream = s => ({ ...s, ts: (s.ts || []).map(Number), vs: (s.vs || []).map(Number) });

export async function connect(engine) {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return (await import("./demo.js")).demoApi(engine);

  const sb = createClient(url, key);
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const r = await sb.auth.signInAnonymously();
    if (r.error) throw new Error(`Connexion impossible : active « Anonymous sign-ins » dans Supabase (Authentication → Sign In / Providers). ${r.error.message}`);
    session = r.data.session;
  }
  const uid = session.user.id;
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data };
  const rows = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data };
  const invoke = async (fn, body) => {
    const { data, error } = await sb.functions.invoke(fn, { body });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error ?? msg } catch { } throw new Error(msg) }
    if (data?.error) throw new Error(data.error);
    return normBet(data);
  };

  // Écart entre l'horloge du téléphone et celle du serveur, pour que tout le monde voie la même minute.
  const t0 = Date.now(), st = await rpc("server_time"), offset = Date.parse(st) - (t0 + Date.now()) / 2;

  return {
    mode: "supabase", uid,
    now: () => Date.now() + offset,
    me: async () => (await rows(sb.from("profiles").select("*").eq("id", uid).maybeSingle())) ?? null,
    createProfile: pseudo => rpc("create_profile", { p_pseudo: pseudo }),
    openTrade: ({ tk, dir, lev, stake }) => rpc("open_trade", { p_tk: tk, p_dir: dir, p_lev: lev, p_stake: stake, p_horizon: "close" }), // ouverte jusqu'à la fin de séance
    closeTrade: id => rpc("close_trade", { p_id: id }),
    betDuel: ({ duel, side, stake }) => rpc("bet_duel", { p_duel: duel, p_side: side, p_stake: stake }),
    openStream: ({ login, dir, lev, stake, horizon }) => rpc("open_stream", { p_login: login, p_dir: dir, p_lev: lev, p_stake: stake, p_horizon: horizon }),
    streamBoard: async () => (await rpc("stream_board", { p_minutes: 120 })).map(normStream),
    openMarkets: async () => (await rpc("open_markets")).map(normMarket),
    betQuestion: ({ market, side, stake }) => rpc("bet_question", { p_market: market, p_side: side, p_stake: stake }),
    // Ordres crypto : la fonction serveur lit le vrai prix chez Coinbase au moment de l'ordre.
    cryptoOrder: body => invoke("crypto", body),
    // Bourse d'Aurelys : cours jusqu'à maintenant (jamais au-delà), bougies, actualités publiées, ordres par le serveur.
    aurFeed: since => rpc("aur_feed", { p_since: since ? new Date(since * 1000).toISOString() : null }),
    aurHistory: (tk, minutes) => rpc("aur_history", { p_tk: tk, p_minutes: minutes }),
    aurNews: () => rows(sb.from("aur_news").select("*").order("id", { ascending: false }).limit(150)),
    aurOrder: body => invoke("aurelys", body),
    restart: () => rpc("restart"),
    settle: () => rpc("settle"),
    myBets: async minSession => (await rows(sb.from("bets").select("*").eq("user_id", uid).or(`status.eq.open,session.gte.${minSession}`).order("id", { ascending: false }))).map(normBet),
    leaderboard: async () => (await rpc("leaderboard")).map(normBoard),
    shopItems: () => rows(sb.from("shop_items").select("*").order("sort")),
    inventoryOf: user => rows(sb.from("inventory").select("item_id,qty,equipped").eq("user_id", user).gt("qty", 0)),
    profileOf: async user => (await rows(sb.from("profiles").select("id,pseudo,cash,bankruptcies").eq("id", user).maybeSingle())) ?? null,
    buyItem: id => rpc("buy_item", { p_item: id }),
    sellItem: id => rpc("sell_item", { p_item: id }),
    equipItem: id => rpc("equip_item", { p_item: id }),
    unequip: category => rpc("unequip", { p_category: category }),
    useBonus: id => rpc("use_bonus", { p_item: id }),
    onChange(cb) {
      const ch = sb.channel("wikibourse")
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "bets", filter: `user_id=eq.${uid}` }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "inventory", filter: `user_id=eq.${uid}` }, cb)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
