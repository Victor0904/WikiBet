// Accès au jeu. Avec les clés Supabase (.env.local) : la vraie base partagée.
// Sans clés : mode démo, la même base SQL tourne dans le navigateur (voir demo.js).
import { createClient } from "@supabase/supabase-js";

// Les identifiants bigint et les cotes numeric arrivent parfois en texte : on normalise une fois ici.
export const normBet = b => ({ ...b, id: Number(b.id), odds: b.odds == null ? null : Number(b.odds) });

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

  // Écart entre l'horloge du téléphone et celle du serveur, pour que tout le monde voie la même minute.
  const t0 = Date.now(), st = await rpc("server_time"), offset = Date.parse(st) - (t0 + Date.now()) / 2;

  return {
    mode: "supabase", uid,
    now: () => Date.now() + offset,
    me: async () => (await rows(sb.from("profiles").select("*").eq("id", uid).maybeSingle())) ?? null,
    createProfile: pseudo => rpc("create_profile", { p_pseudo: pseudo }),
    openTrade: ({ tk, dir, lev, stake, horizon }) => rpc("open_trade", { p_tk: tk, p_dir: dir, p_lev: lev, p_stake: stake, p_horizon: horizon }),
    closeTrade: id => rpc("close_trade", { p_id: id }),
    betDuel: ({ duel, side, stake }) => rpc("bet_duel", { p_duel: duel, p_side: side, p_stake: stake }),
    restart: () => rpc("restart"),
    settle: () => rpc("settle"),
    myBets: async minSession => (await rows(sb.from("bets").select("*").eq("user_id", uid).gte("session", minSession).order("id", { ascending: false }))).map(normBet),
    leaderboard: () => rows(sb.from("profiles").select("id,pseudo,cash,bankruptcies").order("cash", { ascending: false }).limit(50)),
    onChange(cb) {
      const ch = sb.channel("wikibourse")
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "bets", filter: `user_id=eq.${uid}` }, cb)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
