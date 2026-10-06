// Remplit la base Supabase avec les articles, les vues, les cours minute par minute et les duels.
// Usage : npm run seed (lit .env.local : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY).
// À relancer après chaque `python ../scripts/fetch_pageviews.py`.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { createEngine } from "../src/engine.js";
import { seedRows } from "../src/seed.js";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Il manque VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY dans web/.env.local."); process.exit(1) }

const sb = createClient(url, key, { auth: { persistSession: false } });
const rows = seedRows(createEngine(JSON.parse(readFileSync(new URL("../src/pageviews.json", import.meta.url), "utf8"))));
for (const [table, batch] of [["game_config", 1], ["articles", 500], ["views", 1000], ["prices", 40], ["duels", 500]]) {
  const all = rows[table];
  for (let i = 0; i < all.length; i += batch) {
    const { error } = await sb.from(table).upsert(all.slice(i, i + batch));
    if (error) { console.error(`${table} : ${error.message}`); process.exit(1) }
  }
  console.log(`${table.padEnd(12)} ${all.length} lignes`);
}
