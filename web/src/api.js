// Accès au jeu. Avec les clés Supabase (.env.local) : la vraie base partagée.
// Sans clés : mode démo, la même base SQL tourne dans le navigateur (voir demo.js).
import { createClient } from "@supabase/supabase-js";

// Les identifiants bigint et les cotes numeric arrivent parfois en texte : on normalise une fois ici.
export const normBet = b => ({ ...b, id: Number(b.id), odds: b.odds == null ? null : Number(b.odds) });
export const normBoard = r => ({ ...r, cash: Number(r.cash), patrimoine: Number(r.patrimoine) });
export const normGuild = g => ({ ...g, id: Number(g.id) });

export async function connect() {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return (await import("./demo.js")).demoApi();

  const sb = createClient(url, key); // session gardée dans le navigateur (localStorage) : on reste connecté
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const r = await sb.auth.signInAnonymously();
    if (r.error) throw new Error(`Connexion impossible : active « Anonymous sign-ins » dans Supabase (Authentication → Sign In / Providers). ${r.error.message}`);
    session = r.data.session;
  }
  const uid = session.user.id;
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data };
  const rows = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data };
  // Appel direct (sans functions.invoke) pour toujours montrer le message du serveur, jamais « non-2xx status code ».
  const invoke = async (fn, body) => {
    const { data: { session: cur } } = await sb.auth.getSession();
    let r;
    try {
      r = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${cur?.access_token ?? key}` } });
    } catch { throw new Error("Pas de connexion au serveur du marché. Vérifie ta connexion et réessaie.") }
    const text = await r.text(); let j = null; try { j = JSON.parse(text) } catch { }
    if (!r.ok || j?.error) throw new Error(j?.error ?? (r.status >= 500 ? "Le serveur du marché est occupé, réessaie dans un instant." : `Ordre refusé par le serveur (code ${r.status}).`));
    return normBet(j);
  };

  // Écart entre l'horloge du téléphone et celle du serveur, pour que tout le monde voie la même minute.
  const t0 = Date.now(), st = await rpc("server_time"), offset = Date.parse(st) - (t0 + Date.now()) / 2;

  // Comptes : pseudo + mot de passe. La partie anonyme devient un compte (même identifiant, rien n'est perdu).
  const home = location.origin + location.pathname;
  const auth = async (p, reload) => { const { data, error } = await p; if (error) throw new Error(authMsg(error)); if (reload) location.replace(home); return data };
  const signIn = async (pseudo, password) => {
    const email = await rpc("login_email", { p_pseudo: pseudo });
    if (!email) throw new Error("Pseudo ou mot de passe incorrect.");
    return auth(sb.auth.signInWithPassword({ email, password }), true);
  };

  return {
    mode: "supabase", uid,
    account: {
      user: async () => (await sb.auth.getUser()).data.user,
      signIn,
      // Crée le compte ou change le mot de passe (côté serveur), puis se reconnecte : le navigateur propose d'enregistrer le mot de passe.
      register: async (pseudo, password) => { await invoke("aurelys", { action: "register", password }); return signIn(pseudo, password) },
      signOut: () => auth(sb.auth.signOut(), true),
    },
    now: () => Date.now() + offset,
    me: async () => (await rows(sb.from("profiles").select("*").eq("id", uid).maybeSingle())) ?? null,
    createProfile: pseudo => rpc("create_profile", { p_pseudo: pseudo }),
    openTrade: ({ tk, dir, lev, stake }) => rpc("open_trade", { p_tk: tk, p_dir: dir, p_lev: lev, p_stake: stake, p_horizon: "close" }), // ouverte jusqu'à la fin de séance
    closeTrade: id => rpc("close_trade", { p_id: id }),
    betDuel: ({ duel, side, stake }) => rpc("bet_duel", { p_duel: duel, p_side: side, p_stake: stake }),
    // Bourse d'Aurelys : cours jusqu'à maintenant (jamais au-delà), bougies, actualités publiées, ordres par le serveur.
    aurFeed: since => rpc("aur_feed", { p_since: since ? new Date(since * 1000).toISOString() : null }),
    aurHistory: (tk, minutes) => rpc("aur_history", { p_tk: tk, p_minutes: minutes }),
    aurTicks: (tk, minutes) => rpc("aur_ticks_of", { p_tk: tk, p_minutes: minutes }),
    aurMaxLev: () => rpc("my_max_lev"),
    aurStocks: () => rows(sb.from("aur_stocks").select("*").order("status").order("tk")),
    aurSubscribe: (tk, amount) => rpc("aur_subscribe", { p_tk: tk, p_amount: amount }),
    myHoldings: () => rpc("my_holdings"),
    aurRounds: () => rpc("aur_round_stats"),
    myCity: () => rpc("my_city"),
    myWealth: () => rpc("my_wealth"),
    touch: () => rpc("touch"),
    souvenirs: user => rpc("souvenirs", { p_user: user }),
    guildUpdate: (color, motto) => rpc("guild_update", { p_color: color, p_motto: motto }),
    aurNews: () => rows(sb.from("aur_news").select("*").order("id", { ascending: false }).limit(150)),
    aurOrder: body => invoke("aurelys", body),
    restart: () => rpc("restart"),
    myBets: async minSession => (await rows(sb.from("bets").select("*").eq("user_id", uid).or(`status.eq.open,session.gte.${minSession}`).order("id", { ascending: false }))).map(normBet),
    leaderboard: async () => (await rpc("leaderboard")).map(normBoard),
    gainsBoard: (period, scope) => rpc("gains_board", { p_period: period, p_scope: scope }),
    myFriends: () => rpc("my_friends"),
    friendAdd: pseudo => rpc("friend_add", { p_pseudo: pseudo }),
    friendRemove: id => rpc("friend_remove", { p_user: id }),
    guildList: async period => (await rpc("guild_list", { p_period: period })).map(normGuild),
    guildMembers: id => rpc("guild_members_of", { p_id: id }),
    guildCreate: ({ name, tag, motto }) => rpc("guild_create", { p_name: name, p_tag: tag, p_motto: motto }),
    guildJoin: id => rpc("guild_join", { p_id: id }),
    guildLeave: () => rpc("guild_leave"),
    guildKick: id => rpc("guild_kick", { p_user: id }),
    cityView: id => rpc("city_view", { p_guild: id }),
    cityCatalog: () => rows(sb.from("city_catalog").select("*").order("sort")),
    cityGive: (amount, kind) => rpc("city_give", { p_amount: amount, p_kind: kind }),
    cityBuild: id => rpc("city_build", { p_building: id }),
    cityBuyLand: () => rpc("city_buy_land"),
    shopItems: () => rows(sb.from("shop_items").select("*").order("sort")),
    trophies: user => rpc("trophies", { p_user: user }),
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

// Messages d'erreur de Supabase Auth, en français.
function authMsg(e) {
  const m = `${e.code ?? ""} ${e.message ?? ""}`;
  return /invalid_credentials|Invalid login/i.test(m) ? "Pseudo ou mot de passe incorrect."
    : /email_exists|already been registered|already registered/i.test(m) ? "Cet e-mail a déjà un compte : connecte-toi."
    : /weak_password|at least 6/i.test(m) ? "Mot de passe trop court : 8 caractères au moins."
    : /email_not_confirmed|not confirmed/i.test(m) ? "Confirme d'abord ton e-mail avec le lien reçu."
    : /rate_limit|security purposes|rate limit/i.test(m) ? "Trop de demandes : réessaie dans une minute."
    : /email_address_invalid|invalid format|Unable to validate email/i.test(m) ? "Adresse e-mail invalide."
    : e.message;
}
