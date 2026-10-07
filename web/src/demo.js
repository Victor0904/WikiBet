// Mode démo : la vraie migration SQL tourne dans le navigateur (PGlite, gardé dans IndexedDB).
// Un seul joueur, mêmes règles et mêmes fonctions que sur Supabase.
import { PGlite } from "@electric-sql/pglite";
import stub from "./demo-stub.sql?raw";
// Toutes les migrations, dans l'ordre de leur nom (horodaté).
const migrations = Object.entries(import.meta.glob("../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true })).sort(([a], [b]) => a.localeCompare(b)).map(([, sql]) => sql);
import { seedRows } from "./seed.js";
import { createEngine } from "./engine.js";
import data from "./pageviews.json"; // la démo remplit sa base locale (les tables du replay Wiki restent nécessaires à l'horloge des séances)
import { normBet, normStream, normMarket, normBoard, normGuild } from "./api.js";
import { initState, advance, slip } from "../supabase/functions/_shared/aurelys.js";

const UID = "00000000-0000-4000-8000-000000000001";

export async function demoApi() {
  const db = new PGlite("idb://wikibourse-demo-13"); // changer le numéro quand la migration change
  const ready = (await db.query("select to_regclass('public.bets') is not null as ok")).rows[0].ok;
  if (!ready) {
    await db.exec(stub);
    for (const sql of migrations) await db.exec(sql);
    const rows = seedRows(createEngine(data));
    for (const t of ["game_config", "articles", "views", "prices", "duels"])
      await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rows[t])]);
    await db.query("insert into auth.users values ($1)", [UID]);
  }
  await db.query("select set_config('app.uid', $1, false)", [UID]);

  const listeners = new Set();
  const all = async (sql, args) => { try { return (await db.query(sql, args)).rows } catch (e) { throw new Error(e.message) } };
  const act = async (sql, args) => { const [r] = await all(sql, args); listeners.forEach(f => f()); return r };

  // Bourse d'Aurelys : en démo, la simulation tourne dans le navigateur tant que la page est ouverte (5 s d'avance).
  let S = (await all("select state from aur_state"))[0]?.state ?? null, from = S?.t ?? null, busy = false;
  const step = async () => {
    if (busy) return; busy = true;
    try {
      const until = Math.floor(Date.now() / 1000) + 5;
      S ??= initState(Date.now() / 1000);
      if (S.t < until) {
        const out = advance(S, until, await all("select * from aur_take_orders()"));
        await db.query("select aur_store($1, $2, $3, $4)", [from, S, JSON.stringify(out.ticks), JSON.stringify(out.news)]);
        if (out.listing.length) await db.query("select aur_listing($1)", [JSON.stringify(out.listing)]);
        from = S.t;
      }
      if ((await all("select aur_settle() as n"))[0].n) listeners.forEach(f => f());
    } catch (e) { console.error(e) } finally { busy = false }
  };
  await step(); setInterval(step, 2000);

  return {
    mode: "demo", uid: UID,
    now: () => Date.now(),
    me: async () => (await all("select * from profiles where id = $1", [UID]))[0] ?? null,
    createProfile: p => act("select * from create_profile($1)", [p]),
    openTrade: ({ tk, dir, lev, stake }) => act("select * from open_trade($1, $2, $3, $4, 'close')", [tk, dir, lev, stake]),
    closeTrade: id => act("select * from close_trade($1)", [id]),
    betDuel: ({ duel, side, stake }) => act("select * from bet_duel($1, $2, $3)", [duel, side, stake]),
    openStream: ({ login, dir, lev, stake, horizon }) => act("select * from open_stream($1, $2, $3, $4, $5)", [login, dir, lev, stake, horizon]),
    streamBoard: async () => (await all("select * from stream_board(120)")).map(normStream),
    openMarkets: async () => (await all("select * from open_markets()")).map(normMarket),
    betQuestion: ({ market, side, stake }) => act("select * from bet_question($1, $2, $3)", [market, side, stake]),
    aurFeed: async since => (await all("select aur_feed($1) as f", [since ? new Date(since * 1000).toISOString() : null]))[0].f,
    aurHistory: async (tk, minutes) => (await all("select aur_history($1, $2) as h", [tk, minutes]))[0].h,
    aurTicks: async (tk, minutes) => (await all("select aur_ticks_of($1, $2) as k", [tk, minutes]))[0].k,
    aurMaxLev: async () => (await all("select my_max_lev() as n"))[0].n,
    aurStocks: () => all("select * from aur_stocks order by status, tk"),
    aurSubscribe: (tk, amount) => act("select * from aur_subscribe($1, $2)", [tk, amount]),
    myHoldings: () => all("select * from my_holdings()"),
    aurRounds: () => all("select * from aur_round_stats()"),
    myWealth: async () => (await all("select my_wealth() as w"))[0].w,
    touch: () => all("select touch()"),
    souvenirs: async user => (await all("select souvenirs($1) as s", [user]))[0].s,
    guildUpdate: (color, motto) => act("select * from guild_update($1, $2)", [color, motto]),
    myCity: async () => (await all("select my_city() as c"))[0].c,
    aurNews: () => all("select * from aur_news where t <= now() order by id desc limit 150"),
    aurOrder: async body => {
      if (body.action === "open") return normBet(await act("select * from aur_open($1, $2, $3, $4, $5, $6)", [UID, body.tk, body.dir, body.lev, body.stake, slip(S, body.tk, body.stake * body.lev)]));
      if (body.action === "buy") return act("select * from aur_buy($1, $2, $3, $4)", [UID, body.tk, body.amount, slip(S, body.tk, body.amount)]);
      if (body.action === "sell") { const [{ p }] = await all("select holding_price($1) as p", [body.tk]); return act("select * from aur_sell($1, $2, $3, $4)", [UID, body.tk, body.qty, slip(S, body.tk, body.qty * p)]) }
      const [b] = await all("select aur, stake, lev from bets where id = $1", [body.id]);
      return normBet(await act("select * from aur_close($1, $2, $3)", [UID, body.id, slip(S, b.aur, b.stake * b.lev)]));
    },
    restart: () => act("select * from restart()"),
    settle: async () => (await all("select settle() as n"))[0].n,
    myBets: async min => (await all("select * from bets where user_id = $1 and (status = 'open' or session >= $2) order by id desc", [UID, min])).map(normBet),
    leaderboard: async () => (await all("select * from leaderboard()")).map(normBoard),
    gainsBoard: (period, scope) => all("select * from gains_board($1, $2)", [period, scope]),
    myFriends: () => all("select * from my_friends()"),
    friendAdd: async pseudo => (await act("select friend_add($1) as s", [pseudo])).s,
    friendRemove: id => act("select friend_remove($1)", [id]),
    guildList: async period => (await all("select * from guild_list($1)", [period])).map(normGuild),
    guildMembers: id => all("select * from guild_members_of($1)", [id]),
    guildCreate: ({ name, tag, motto }) => act("select * from guild_create($1, $2, $3)", [name, tag, motto]),
    guildJoin: id => act("select guild_join($1)", [id]),
    guildLeave: () => act("select guild_leave()"),
    guildKick: id => act("select guild_kick($1)", [id]),
    cityView: async id => (await all("select city_view($1) as v", [id]))[0].v,
    cityCatalog: () => all("select * from city_catalog order by sort"),
    cityGive: (amount, kind) => act("select * from city_give($1, $2)", [amount, kind]),
    cityBuild: id => act("select * from city_build($1)", [id]),
    cityBuyLand: () => act("select * from city_buy_land()"),
    shopItems: () => all("select * from shop_items order by sort"),
    trophies: user => all("select * from trophies($1)", [user]),
    inventoryOf: user => all("select item_id, qty, equipped from inventory where user_id = $1 and qty > 0", [user]),
    profileOf: async user => (await all("select id, pseudo, cash, bankruptcies from profiles where id = $1", [user]))[0] ?? null,
    buyItem: id => act("select * from buy_item($1)", [id]),
    sellItem: async id => (await act("select sell_item($1) as v", [id])).v,
    equipItem: id => act("select equip_item($1)", [id]),
    unequip: category => act("select unequip($1)", [category]),
    useBonus: id => act("select * from use_bonus($1)", [id]),
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  };
}
