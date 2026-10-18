// Base de test : la vraie migration dans PGlite, avec le faux schéma auth du mode démo.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createEngine, PLAY_MS, T, CYCLE_MS } from "../src/engine.js";
import { seedRows } from "../src/seed.js";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
export const data = JSON.parse(read("../src/pageviews.json"));
export const engine = createEngine(data);

// `until` : s'arrêter avant cette migration (préparer des données d'avant), puis finir avec migrateFrom(db, until).
const MIGRATIONS = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
export async function migrateFrom(db, from, until) {
  for (const f of MIGRATIONS.filter(f => f >= from && (!until || f < until))) await db.exec(read("../supabase/migrations/" + f));
}
export async function freshDb({ until } = {}) {
  const db = new PGlite();
  await db.exec(read("../src/demo-stub.sql"));
  for (const f of MIGRATIONS.filter(f => !until || f < until)) await db.exec(read("../supabase/migrations/" + f));
  const rows = seedRows(engine);
  for (const t of ["game_config", "articles", "views", "prices", "duels"])
    await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rows[t])]);
  return db;
}

// Place l'horloge du jeu dans la séance k, au tout début de la minute de jeu t : il reste ainsi plus d'une seconde
// avant la minute suivante (une minute de jeu dure environ 1,18 s), assez pour les appels lents de PGlite.
export async function setClock(db, k, t) {
  const off = t >= T ? PLAY_MS + 30_000 : Math.ceil((t + 0.02) * PLAY_MS / T);
  const { rows: [{ now }] } = await db.query("select extract(epoch from now()) * 1000 as now");
  await db.query("update game_config set epoch = to_timestamp($1 / 1000.0)", [Number(now) - k * CYCLE_MS - off]);
}

// Joueur connecté : crée l'utilisateur et le profil, puis agit sous son identité. `level` : son niveau de trader (XP de la
// courbe), pour les tests qui ont besoin d'un levier ou d'une guilde (×10 au niveau 12, guilde au niveau 8).
export async function login(db, id, pseudo, level) {
  await db.query("insert into auth.users values ($1) on conflict do nothing", [id]);
  await db.query("select set_config('app.uid', $1, false)", [id]);
  if (pseudo) await db.query("select create_profile($1)", [pseudo]);
  if (level) await db.query("update profiles set xp = (select xp from xp_curve where level = $2) where id = $1", [id, level]);
}
export const cash = async (db, id) => (await db.query("select cash from profiles where id = $1", [id])).rows[0].cash;
