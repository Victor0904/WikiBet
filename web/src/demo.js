// Mode démo : la vraie migration SQL tourne dans le navigateur (PGlite, gardé dans IndexedDB).
// Un seul joueur, mêmes règles et mêmes fonctions que sur Supabase.
import { PGlite } from "@electric-sql/pglite";
import stub from "./demo-stub.sql?raw";
import migration from "../supabase/migrations/20261006000000_init.sql?raw";
import { seedRows } from "./seed.js";
import { normBet } from "./api.js";

const UID = "00000000-0000-4000-8000-000000000001";

export async function demoApi(engine) {
  const db = new PGlite("idb://wikibourse-demo-1"); // changer le numéro quand la migration change
  const ready = (await db.query("select to_regclass('public.bets') is not null as ok")).rows[0].ok;
  if (!ready) {
    await db.exec(stub);
    await db.exec(migration);
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
    openTrade: ({ tk, dir, lev, stake, horizon }) => act("select * from open_trade($1, $2, $3, $4, $5)", [tk, dir, lev, stake, horizon]),
    closeTrade: id => act("select * from close_trade($1)", [id]),
    betDuel: ({ duel, side, stake }) => act("select * from bet_duel($1, $2, $3)", [duel, side, stake]),
    restart: () => act("select * from restart()"),
    settle: async () => (await all("select settle() as n"))[0].n,
    myBets: async min => (await all("select * from bets where user_id = $1 and session >= $2 order by id desc", [UID, min])).map(normBet),
    leaderboard: () => all("select id, pseudo, cash, bankruptcies from profiles order by cash desc limit 50"),
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  };
}
