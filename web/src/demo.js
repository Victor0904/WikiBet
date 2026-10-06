// Mode démo : la vraie migration SQL tourne dans le navigateur (PGlite, gardé dans IndexedDB).
// Un seul joueur, mêmes règles et mêmes fonctions que sur Supabase.
import { PGlite } from "@electric-sql/pglite";
import stub from "./demo-stub.sql?raw";
// Toutes les migrations, dans l'ordre de leur nom (horodaté).
const migrations = Object.entries(import.meta.glob("../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true })).sort(([a], [b]) => a.localeCompare(b)).map(([, sql]) => sql);
import { seedRows } from "./seed.js";
import { normBet, normStream, normMarket, normBoard } from "./api.js";

const UID = "00000000-0000-4000-8000-000000000001";

export async function demoApi(engine) {
  const db = new PGlite("idb://wikibourse-demo-4"); // changer le numéro quand la migration change
  const ready = (await db.query("select to_regclass('public.bets') is not null as ok")).rows[0].ok;
  if (!ready) {
    await db.exec(stub);
    for (const sql of migrations) await db.exec(sql);
    const rows = seedRows(engine);
    for (const t of ["game_config", "articles", "views", "prices", "duels"])
      await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rows[t])]);
    await db.query("insert into auth.users values ($1)", [UID]);
  }
  await db.query("select set_config('app.uid', $1, false)", [UID]);

  const listeners = new Set();
  const all = async (sql, args) => { try { return (await db.query(sql, args)).rows } catch (e) { throw new Error(e.message) } };
  const act = async (sql, args) => { const [r] = await all(sql, args); listeners.forEach(f => f()); return r };

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
    restart: () => act("select * from restart()"),
    settle: async () => (await all("select settle() as n"))[0].n,
    myBets: async min => (await all("select * from bets where user_id = $1 and (status = 'open' or session >= $2) order by id desc", [UID, min])).map(normBet),
    leaderboard: async () => (await all("select * from leaderboard()")).map(normBoard),
    shopItems: () => all("select * from shop_items order by sort"),
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
