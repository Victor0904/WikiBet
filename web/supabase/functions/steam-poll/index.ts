// Relève chaque minute le nombre de joueurs connectés sur une sélection de jeux Steam (API publique, sans clé)
// et l'écrit dans stream_ticks, sous le sujet 'steam:<appid>'. Appelée par pg_cron (migration steam).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Jeux suivis : les plus joués sur Steam et ceux qui parlent au public français. [appid, nom]
const GAMES: [number, string][] = [
  [730, "Counter-Strike 2"], [570, "Dota 2"], [578080, "PUBG: Battlegrounds"], [1172470, "Apex Legends"],
  [252490, "Rust"], [271590, "Grand Theft Auto V"], [2767030, "Marvel Rivals"], [1086940, "Baldur's Gate 3"],
  [1245620, "Elden Ring"], [553850, "Helldivers 2"], [440, "Team Fortress 2"], [230410, "Warframe"],
  [2694490, "Path of Exile 2"], [413150, "Stardew Valley"], [105600, "Terraria"], [1623730, "Palworld"],
  [892970, "Valheim"], [2246340, "Monster Hunter Wilds"], [236390, "War Thunder"], [1085660, "Destiny 2"],
  [1938090, "Call of Duty"], [289070, "Civilization VI"], [526870, "Satisfactory"],
  [2073850, "The Finals"], [1203220, "NARAKA: BLADEPOINT"], [359550, "Rainbow Six Siege"], [2923300, "Banana"],
  [1966720, "Lethal Company"], [381210, "Dead by Daylight"],
];
const login = (id: number) => `steam:${id}`;

Deno.serve(async () => {
  try {
    // Garde-fou : une relève par minute au plus.
    const { data: last } = await sb.from("stream_ticks").select("at").like("login", "steam:%").order("at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.at) < 50_000) return Response.json({ skipped: true });

    // Fiches des jeux (nom et image), créées une fois.
    const { data: known } = await sb.from("streamers").select("login").like("login", "steam:%");
    const missing = GAMES.filter(([id]) => !(known ?? []).some(k => k.login === login(id)));
    if (missing.length) {
      const { error } = await sb.from("streamers").upsert(missing.map(([id, name]) => ({
        login: login(id), display_name: name, avatar: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_184x69.jpg`,
      })));
      if (error) throw error;
    }

    const counts = await Promise.all(GAMES.map(async ([id]) => {
      try {
        const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`);
        const j = await r.json();
        return j?.response?.result === 1 ? { id, n: j.response.player_count as number } : null;
      } catch { return null }
    }));
    const at = new Date().toISOString();
    const rows = counts.filter(c => c && c.n > 0).map(c => ({ login: login(c!.id), at, viewers: c!.n, live: true, game: "Steam" }));
    const { error } = await sb.from("stream_ticks").insert(rows);
    if (error) throw error;
    return Response.json({ games: rows.length, failed: GAMES.length - rows.length });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
