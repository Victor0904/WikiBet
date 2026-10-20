import { test } from "node:test";
import assert from "node:assert/strict";
import { oauthReturn, discordOf } from "../src/discord.js";

test("retour de Discord : déjà lié, annulé, autre erreur, succès", () => {
  assert.equal(oauthReturn("#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user", "").kind, "taken");
  assert.equal(oauthReturn("", "?error=access_denied&error_description=The+resource+owner+or+authorization+server+denied+the+request").kind, "cancel");
  const e = oauthReturn("#error=server_error&error_description=Error+getting+user+email+from+external+provider", "");
  assert.deepEqual(e, { kind: "error", text: "Discord : Error getting user email from external provider" });
  assert.equal(oauthReturn("#access_token=abc&refresh_token=def", ""), null, "connexion réussie : rien à afficher");
  assert.equal(oauthReturn("", "?ref=ABCD-123"), null);
});

test("identité Discord : nom affiché, avatar du CDN de Discord seulement", () => {
  assert.equal(discordOf({ identities: [{ provider: "email" }] }), null);
  const u = av => ({ identities: [{ provider: "discord", identity_data: { name: "vayk", full_name: "vayk", custom_claims: { global_name: "Vayk" }, avatar_url: av } }] });
  assert.deepEqual(discordOf(u("https://cdn.discordapp.com/avatars/1/a.png")), { name: "Vayk", avatar: "https://cdn.discordapp.com/avatars/1/a.png" });
  assert.equal(discordOf(u("https://evil.example/x.png")).avatar, null);
});
