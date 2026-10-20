// Discord (OAuth par Supabase) : lecture du retour et de l'identité, sans dépendance (testé dans tests/discord.test.js).

// Retour de Discord en échec : Supabase met l'erreur dans l'adresse (#… ou ?…). null si tout va bien.
// taken : ce compte Discord a déjà une partie (linkIdentity) ; cancel : refusé sur Discord ; error : le reste, message d'origine.
export function oauthReturn(hash, search) {
  const h = new URLSearchParams(hash.replace(/^#/, "")), q = new URLSearchParams(search);
  const get = k => h.get(k) ?? q.get(k);
  const code = get("error_code") ?? get("error"), desc = get("error_description") ?? "";
  if (!code && !desc) return null;
  if (/identity_already_exists|already linked/i.test(`${code} ${desc}`)) return { kind: "taken", text: "Ce compte Discord a déjà une partie Aurelys." };
  if (/access_denied/i.test(`${get("error")} ${code}`)) return { kind: "cancel", text: "Connexion Discord annulée." };
  return { kind: "error", text: `Discord : ${desc || code}` };
}

// Nom et avatar Discord d'un utilisateur Supabase, ou null s'il n'a pas lié Discord. Avatar accepté du CDN de Discord seulement.
export function discordOf(user) {
  const d = user?.identities?.find(i => i.provider === "discord")?.identity_data;
  if (!d) return null;
  const avatar = /^https:\/\/cdn\.discordapp\.com\//.test(d.avatar_url ?? "") ? d.avatar_url : null;
  return { name: d.custom_claims?.global_name || d.full_name || d.name || "Discord", avatar };
}
