// Marché crypto côté serveur. Trois actions :
// - poll (pg_cron, chaque minute) : relève les bougies d'une minute chez Coinbase et vérifie les liquidations ;
// - open / close (joueur connecté) : lit le prix réel chez Coinbase au moment de l'ordre et l'enregistre en base.
// Le prix ne vient jamais du joueur : crypto_open / crypto_close ne sont appelables qu'avec la clé serveur.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CB = "https://api.exchange.coinbase.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

async function cb(path: string) {
  const r = await fetch(CB + path, { headers: { "User-Agent": "wikibet" } });
  if (!r.ok) throw new Error(`Coinbase ${r.status}`);
  return r.json();
}
const price = async (pair: string) => Number((await cb(`/products/${pair}/ticker`)).price);

async function poll() {
  const { data: assets } = await admin.from("crypto_assets").select("sym,pair");
  const rows = (await Promise.all((assets ?? []).map(async a => {
    try {
      const k: number[][] = await cb(`/products/${a.pair}/candles?granularity=60`);
      // [heure, plus bas, plus haut, ouverture, clôture, volume] ; on garde les 5 dernières minutes (rattrapage d'un appel manqué).
      return k.slice(0, 5).map(([t, l, h, o, c]) => ({ sym: a.sym, t: new Date(t * 1000).toISOString(), o, h, l, c }));
    } catch { return [] }
  }))).flat();
  const { error } = await admin.from("crypto_candles").upsert(rows);
  if (error) throw error;
  const { data: liquidated, error: e2 } = await admin.rpc("crypto_settle");
  if (e2) throw e2;
  return { candles: rows.length, liquidated };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "poll") return json(await poll());

    // Ordres : le joueur doit être connecté (jeton de session, pas la clé publique).
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Connexion requise." }, 401);

    if (body.action === "open") {
      const { data: asset } = await admin.from("crypto_assets").select("pair").eq("sym", body.sym).maybeSingle();
      if (!asset) return json({ error: "Crypto inconnue." }, 400);
      if (!["up", "down"].includes(body.dir) || ![1, 5, 10].includes(body.lev)) return json({ error: "Ordre invalide." }, 400);
      const { data, error } = await admin.rpc("crypto_open", { p_user: user.id, p_sym: body.sym, p_dir: body.dir, p_lev: body.lev, p_stake: body.stake, p_price: await price(asset.pair) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (body.action === "close") {
      const { data: bet } = await admin.from("bets").select("sym").eq("id", body.id).eq("user_id", user.id).maybeSingle();
      if (!bet?.sym) return json({ error: "Position introuvable." }, 404);
      const { data: asset } = await admin.from("crypto_assets").select("pair").eq("sym", bet.sym).single();
      const { data, error } = await admin.rpc("crypto_close", { p_user: user.id, p_id: body.id, p_price: await price(asset!.pair) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
