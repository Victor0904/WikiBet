// Relève chaque minute le nombre de spectateurs des lives Twitch francophones et l'écrit dans stream_ticks.
// Appelée par pg_cron (voir la migration twitch). Secrets : TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET
// (npx supabase secrets set …). SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CID = Deno.env.get("TWITCH_CLIENT_ID")!, SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const TOP = 40; // nombre de lives francophones suivis (les plus regardés)

type Stream = { user_login: string; id: string; viewer_count: number; title: string; game_name: string };

// Jeton d'application (client credentials), gardé en base jusqu'à son expiration.
async function token(): Promise<string> {
  const { data } = await sb.from("twitch_token").select("*").maybeSingle();
  if (data && Date.parse(data.expires_at) > Date.now() + 120_000) return data.token;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`jeton Twitch refusé : ${JSON.stringify(j)}`);
  await sb.from("twitch_token").upsert({ id: 1, token: j.access_token, expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString() });
  return j.access_token;
}

async function helix<T>(path: string, tok: string): Promise<T[]> {
  const r = await fetch("https://api.twitch.tv/helix/" + path, { headers: { "Client-Id": CID, Authorization: "Bearer " + tok } });
  if (!r.ok) throw new Error(`Twitch ${r.status} : ${await r.text()}`);
  return (await r.json()).data;
}
const q = (key: string, values: string[]) => values.map(v => `${key}=${encodeURIComponent(v)}`).join("&");

Deno.serve(async () => {
  try {
    // Garde-fou : une relève par minute au plus, même si quelqu'un appelle la fonction en boucle.
    const { data: last } = await sb.from("stream_ticks").select("at").order("at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.at) < 50_000) return Response.json({ skipped: true });

    const tok = await token();
    const top = await helix<Stream>(`streams?language=fr&type=live&first=${TOP}`, tok);
    const { data: watched, error: we } = await sb.rpc("streamers_to_watch");
    if (we) throw we;
    const logins = [...new Set([...top.map(s => s.user_login), ...(watched ?? []).map((w: { login: string }) => w.login)])].slice(0, 100);
    const extra = logins.filter(l => !top.some(s => s.user_login === l));
    const live = [...top, ...(extra.length ? await helix<Stream>(`streams?${q("user_login", extra)}&first=100`, tok) : [])];

    // Nom affiché et avatar des streamers qu'on ne connaît pas encore.
    const { data: known } = await sb.from("streamers").select("login").in("login", logins);
    const valid = new Set((known ?? []).map(k => k.login));
    const fresh = logins.filter(l => !valid.has(l));
    if (fresh.length) {
      const users = await helix<{ login: string; display_name: string; profile_image_url: string }>(`users?${q("login", fresh)}`, tok);
      const { error } = await sb.from("streamers").upsert(users.map(u => ({ login: u.login, display_name: u.display_name, avatar: u.profile_image_url })));
      if (error) throw error;
      users.forEach(u => valid.add(u.login));
    }

    const at = new Date().toISOString();
    const rows = logins.filter(l => valid.has(l)).map(l => {
      const s = live.find(x => x.user_login === l);
      return { login: l, at, viewers: s?.viewer_count ?? 0, live: !!s, stream_id: s?.id ?? null, title: s?.title ?? null, game: s?.game_name ?? null };
    });
    const { error } = await sb.from("stream_ticks").insert(rows);
    if (error) throw error;
    // On garde deux jours d'historique.
    await sb.from("stream_ticks").delete().lt("at", new Date(Date.now() - 2 * 86400_000).toISOString());
    return Response.json({ live: live.length, tracked: rows.length });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
