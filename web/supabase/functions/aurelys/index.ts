// Bourse d'Aurelys côté serveur. Trois actions :
// - tick (pg_cron, toutes les 10 s) : fait avancer la simulation jusqu'à maintenant + `lead` secondes, avec les ordres
//   des joueurs reçus entre-temps, puis construit les bougies et vérifie les liquidations ;
// - open / close (joueur connecté) : calcule l'impact de l'ordre (loi de la racine carrée) et l'enregistre en base.
// L'état de la simulation (valeurs fondamentales comprises) ne sort jamais du serveur.
import { createClient } from "npm:@supabase/supabase-js@2";
import { initState, advance, slip, BY } from "../_shared/aurelys.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const must = <T,>({ data, error }: { data: T; error: unknown }) => { if (error) throw error; return data };

const loadState = async () => must(await admin.from("aur_state").select("t,state").maybeSingle()) as { t: number; state: any } | null;

async function tick(lead: number) {
  const row = await loadState(), now = Date.now() / 1000;
  const S = row?.state ?? initState(now), until = Math.floor(now) + Math.min(90, Math.max(5, lead));
  if (S.t < until) {
    const orders = must(await admin.rpc("aur_take_orders")) as { tk: string; q: number }[];
    const out = advance(S, until, orders);
    const { error } = await admin.rpc("aur_store", { p_from: row?.t ?? null, p_state: S, p_ticks: out.ticks, p_news: out.news });
    if (error && !/conflit/.test(error.message)) throw error; // un autre appel a déjà fait avancer le marché
  }
  return { t: S.t, liquidated: must(await admin.rpc("aur_settle")) };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "tick") return json(await tick(Number(body.lead) || 20));

    // Ordres : le joueur doit être connecté (jeton de session, pas la clé publique).
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Connexion requise." }, 401);
    const row = await loadState();
    if (!row) return json({ error: "Marché indisponible, réessaie dans un instant." }, 503);

    if (body.action === "open") {
      const lev = Number(body.lev), stake = Number(body.stake);
      if (!BY[body.tk] || !["up", "down"].includes(body.dir) || ![1, 5, 10].includes(lev) || !(stake > 0)) return json({ error: "Ordre invalide." }, 400);
      const { data, error } = await admin.rpc("aur_open", { p_user: user.id, p_tk: body.tk, p_dir: body.dir, p_lev: lev, p_stake: stake, p_slip: slip(row.state, body.tk, stake * lev) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (body.action === "close") {
      const { data: bet } = await admin.from("bets").select("aur,stake,lev").eq("id", body.id).eq("user_id", user.id).maybeSingle();
      if (!bet?.aur) return json({ error: "Position introuvable." }, 404);
      const { data, error } = await admin.rpc("aur_close", { p_user: user.id, p_id: body.id, p_slip: slip(row.state, bet.aur, bet.stake * bet.lev) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
