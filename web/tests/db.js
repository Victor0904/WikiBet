// Base de test : la vraie migration dans PGlite, avec le faux schéma auth du mode démo.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createEngine, PLAY_MS, T, CYCLE_MS } from "../src/engine.js";
import { seedRows } from "../src/seed.js";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
export const data = JSON.parse(read("../src/pageviews.json"));
export const engine = createEngine(data);

export async function freshDb() {
  const db = new PGlite();
  await db.exec(read("../src/demo-stub.sql"));
  for (const f of readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort()) await db.exec(read("../supabase/migrations/" + f));
  const rows = seedRows(engine);
  for (const t of ["game_config", "articles", "views", "prices", "duels"])
    await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rows[t])]);
  return db;
}

// Place l'horloge du jeu dans la séance k, à la minute de jeu t (au milieu de la minute).
export async function setClock(db, k, t) {
  const off = t >= T ? PLAY_MS + 30_000 : Math.floor((t + 0.5) * PLAY_MS / T);
  const { rows: [{ now }] } = await db.query("select extract(epoch from now()) * 1000 as now");
  await db.query("update game_config set epoch = to_timestamp($1 / 1000.0)", [Number(now) - k * CYCLE_MS - off]);
}

// Joueur connecté : crée l'utilisateur et le profil, puis agit sous son identité.
export async function login(db, id, pseudo) {
  await db.query("insert into auth.users values ($1) on conflict do nothing", [id]);
  await db.query("select set_config('app.uid', $1, false)", [id]);
  if (pseudo) await db.query("select create_profile($1)", [pseudo]);
}
export const cash = async (db, id) => (await db.query("select cash from profiles where id = $1", [id])).rows[0].cash;
