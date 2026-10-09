// Bourse d'Aurelys côté serveur. Trois actions :
// - tick (pg_cron, toutes les 10 s) : relève au besoin les chiffres réels (signaux), fait avancer la simulation jusqu'à
//   maintenant + `lead` secondes avec les ordres des joueurs reçus entre-temps, puis construit les bougies et vérifie les liquidations ;
// - open / close (joueur connecté) : calcule l'impact de l'ordre (loi de la racine carrée) et l'enregistre en base.
// L'état de la simulation (valeurs fondamentales, vrais résultats à venir) ne sort jamais du serveur.
import { createClient } from "npm:@supabase/supabase-js@2";
import { initState, advance, slip, BY, STOCKS, gameMin } from "../_shared/aurelys.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const must = <T,>({ data, error }: { data: T; error: unknown }) => { if (error) throw error; return data };

const loadState = async () => must(await admin.from("aur_state").select("t,state").maybeSingle()) as { t: number; state: any } | null;
// Un état d'avant le ralentissement du temps (t en secondes réelles) ne se reprend pas : on repart des derniers cours.
const usable = (S: any) => S && S.t < gameMin(Date.now() / 1000) + 1e6;

async function lastPrices() {
  const out: Record<string, number> = {};
  for (const s of STOCKS) {
    const { data } = await admin.from("aur_ticks").select("p").eq("tk", s.tk).lte("t", new Date().toISOString()).order("t", { ascending: false }).limit(1).maybeSingle();
    if (data) out[s.tk] = Number(data.p);
  }
  return out;
}

/* ===== Chiffres réels ===== */
const pct = (z: number) => Math.abs(z) < .005 ? "stable" : `${z >= 0 ? "+" : "−"}${Math.abs(Math.round(z * 100))} %`;
const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));
const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
const getJson = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() };

// Chaque source est relevée séparément : une panne n'empêche pas les autres, et l'ancienne valeur reste.
const SOURCES: Record<string, () => Promise<{ z: number; txt: string } | null>> = {
  async GTR() { // Beauce : la pluie aide les récoltes, la canicule les abîme.
    const d = (await getJson("https://api.open-meteo.com/v1/forecast?latitude=48.3&longitude=1.6&daily=precipitation_sum,temperature_2m_max&past_days=14&forecast_days=7&timezone=Europe%2FParis")).daily;
    const rain = d.precipitation_sum.slice(0, 14).reduce((a: number, b: number) => a + (b ?? 0), 0), heat = Math.max(...d.temperature_2m_max.slice(14));
    const z = clamp((rain - 25) / 100, .2) - Math.max(0, heat - 28) * .03;
    return { z, txt: `${fmt(rain)} mm de pluie en Beauce en 14 jours, jusqu'à ${fmt(heat)} °C prévus cette semaine` };
  },
  async HLV() { // Consommation électrique française, quart d'heure le plus récent contre la veille à la même heure.
    const r = (await getJson("https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records?select=date_heure,consommation&where=consommation%20is%20not%20null&order_by=date_heure%20desc&limit=100")).results;
    const now = r[0], then = r.find((x: any) => Date.parse(now.date_heure) - Date.parse(x.date_heure) >= 86400e3);
    if (!now || !then) return null;
    const z = clamp(now.consommation / then.consommation - 1, .3);
    return { z, txt: `consommation électrique française de ${fmt(now.consommation / 1000)} GW, ${pct(z)} sur la veille` };
  },
  async LMR() { // Supermarchés : un jour férié qui approche et un week-end ensoleillé font les bonnes semaines.
    const y = new Date().getFullYear(), fer = { ...await getJson(`https://calendrier.api.gouv.fr/jours-feries/metropole/${y}.json`), ...await getJson(`https://calendrier.api.gouv.fr/jours-feries/metropole/${y + 1}.json`) };
    const today = new Date().toISOString().slice(0, 10), in7 = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
    const next = Object.entries(fer).find(([d]) => d >= today && d <= in7) as [string, string] | undefined;
    const w = (await getJson("https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&daily=precipitation_sum,temperature_2m_max&forecast_days=7&timezone=Europe%2FParis")).daily;
    const we = w.time.map((d: string, i: number) => ({ d, day: new Date(d).getUTCDay(), rain: w.precipitation_sum[i], t: w.temperature_2m_max[i] })).filter((x: any) => x.day === 0 || x.day === 6);
    const rain = we.reduce((a: number, x: any) => a + x.rain, 0), warm = Math.max(...we.map((x: any) => x.t));
    const sky = rain < 1 && warm >= 16 ? "ensoleillé" : rain > 5 ? "pluvieux" : "mitigé";
    const z = (next ? .05 : 0) + (sky === "ensoleillé" ? .03 : sky === "pluvieux" ? -.03 : 0);
    return { z, txt: `week-end ${sky} prévu à Paris${next ? `, férié le ${next[1]}` : ""}` };
  },
};

async function signals() {
  const row = must(await admin.from("aur_signals").select("at,data").maybeSingle()) as { at: string; data: any } | null;
  if (row && Date.now() - Date.parse(row.at) < 15 * 60e3) return row.data;
  const data = { ...(row?.data ?? {}) };
  await Promise.all(Object.entries(SOURCES).map(async ([tk, f]) => {
    try { const v = await f(); if (v) data[tk] = { ...v, z: Math.round(v.z * 1000) / 1000, at: new Date().toISOString() } } catch (e) { console.error(tk, e) }
  }));
  await admin.from("aur_signals").upsert({ id: 1, at: new Date().toISOString(), data });
  return data;
}

async function tick(lead: number) {
  const row = await loadState(), now = Date.now() / 1000;
  const S = usable(row?.state) ? row!.state : initState(now, 20261011, await lastPrices());
  const until = Math.floor(now) + Math.min(90, Math.max(5, lead));
  if (gameMin(until) > S.t) {
    const orders = must(await admin.rpc("aur_take_orders")) as { tk: string; q: number }[];
    const out = advance(S, until, orders, await signals().catch(() => null));
    const from = usable(row?.state) ? row!.t : null;
    if (!from && row) await admin.from("aur_state").delete().eq("id", 1); // ancien format
    const { error } = await admin.rpc("aur_store", { p_from: from, p_state: S, p_ticks: out.ticks, p_news: out.news });
    if (error && !/conflit|duplicate/.test(error.message)) throw error; // un autre appel a déjà fait avancer le marché
    // Annonces, introductions et radiations de jeunes pousses : seulement si ce pas a bien été enregistré.
    if (!error && out.listing.length) must(await admin.rpc("aur_listing", { p_defs: out.listing }));
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

    // Compte : pseudo + mot de passe. Adresse interne déjà confirmée (aucun e-mail envoyé), même identifiant : rien n'est perdu.
    // Sert aussi à changer de mot de passe.
    if (body.action === "register") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Mot de passe trop court : 8 caractères au moins." }, 400);
      const { data: p } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
      if (!p) return json({ error: "Choisis d'abord ton pseudo." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user.id, { email: `${user.id}@joueurs.aurelys.invalid`, email_confirm: true, password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    const row = await loadState();
    if (!row || !usable(row.state)) return json({ error: "Marché indisponible, réessaie dans un instant." }, 503);

    if (body.action === "open") {
      const lev = Number(body.lev), stake = Number(body.stake);
      if (!(BY[body.tk] || row.state.extra?.[body.tk]) || !["up", "down"].includes(body.dir) || ![1, 5, 10, 15, 20, 25].includes(lev) || !(stake > 0)) return json({ error: "Ordre invalide." }, 400);
      const { data, error } = await admin.rpc("aur_open", { p_user: user.id, p_tk: body.tk, p_dir: body.dir, p_lev: lev, p_stake: stake, p_slip: slip(row.state, body.tk, stake * lev) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    // Portefeuille : acheter pour un montant, vendre une quantité (sans levier). L'impact se calcule comme pour un ordre.
    if (body.action === "buy") {
      const amount = Number(body.amount); if (!(amount > 0)) return json({ error: "Montant invalide." }, 400);
      const { data, error } = await admin.rpc("aur_buy", { p_user: user.id, p_tk: body.tk, p_amount: amount, p_slip: slip(row.state, body.tk, amount) });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (body.action === "sell") {
      const qty = Number(body.qty), { data: q } = await admin.rpc("holding_price", { p_tk: body.tk });
      const { data, error } = await admin.rpc("aur_sell", { p_user: user.id, p_tk: body.tk, p_qty: qty, p_slip: slip(row.state, body.tk, qty * Number(q || 0)) });
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
