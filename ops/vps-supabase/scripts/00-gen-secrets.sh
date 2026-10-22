#!/usr/bin/env bash
# Écrit stack/.env (chmod 600) à partir de stack/.env.template, avec des secrets neufs.
# Idempotent : une valeur déjà remplie dans stack/.env est gardée ; seules les vides sont générées.
# N'affiche jamais un secret, seulement le nom des lignes remplies.
#   --dry-run    dit ce qui serait généré, n'écrit rien
#   --jwt-cloud  demande (sans écho) le « Legacy JWT secret » de Supabase Cloud et l'utilise comme JWT_SECRET :
#                les sessions des joueurs restent valides après la bascule (recommandé, voir README.md)
#   --force      régénère tous les secrets (DANGEREUX une fois la base créée : POSTGRES_PASSWORD ne change pas dans la base)
. "$(dirname "$0")/_commun.sh"

JWT_CLOUD=0; FORCE=0
for a in "$@"; do case "$a" in --jwt-cloud) JWT_CLOUD=1;; --force) FORCE=1;; --dry-run) ;; *) echec "option inconnue : $a";; esac; done

jwt=""
if [ "$JWT_CLOUD" = 1 ] && [ "$DRY" = 0 ]; then
  read -rsp "Legacy JWT secret de Supabase Cloud (Settings → JWT Keys), rien ne s'affiche : " jwt; echo
  [ "${#jwt}" -ge 32 ] || echec "secret trop court (32 caractères au moins)"
fi

[ "$DRY" = 1 ] && info "simulation : rien n'est écrit"
# Le secret passe par l'environnement du processus Python, jamais par la ligne de commande.
JWT_IMPOSE="$jwt" FORCE="$FORCE" DRY="$DRY" py - "$(chemin "$STACK/.env.template")" "$(chemin "$STACK/.env")" <<'PY'
import base64, hashlib, hmac, json, os, secrets, sys, time

tpl, out = sys.argv[1], sys.argv[2]
force, dry = os.environ["FORCE"] == "1", os.environ["DRY"] == "1"

def lire(p):
    d = {}
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            if "=" in l and not l.lstrip().startswith("#"):
                k, v = l.rstrip("\n").split("=", 1); d[k.strip()] = v
    return d

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def jwt(role, secret):
    now = int(time.time())
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64(json.dumps({"role": role, "iss": "supabase", "iat": now, "exp": now + 10 * 365 * 86400}, separators=(",", ":")).encode())
    return f"{h}.{p}." + b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())

old = {} if force else lire(out)
have = lambda k: bool(old.get(k, "").strip())
gen = {}
for k, f in {"POSTGRES_PASSWORD": lambda: secrets.token_hex(24),     # hexadécimal : sans caractère à échapper dans une URL
             "DASHBOARD_PASSWORD": lambda: secrets.token_hex(16),
             "SECRET_KEY_BASE": lambda: secrets.token_hex(48),       # 96 caractères (64 au moins)
             "REALTIME_DB_ENC_KEY": lambda: secrets.token_hex(8),    # 16 caractères exactement
             "VAULT_ENC_KEY": lambda: secrets.token_hex(16),         # 32 caractères
             "PG_META_CRYPTO_KEY": lambda: secrets.token_hex(24),
             "TICK_SECRET": lambda: secrets.token_hex(32)}.items():
    if not have(k): gen[k] = f()

imposed = os.environ.get("JWT_IMPOSE", "")
if imposed: gen["JWT_SECRET"] = imposed
elif not have("JWT_SECRET"): gen["JWT_SECRET"] = secrets.token_hex(32)
# Clés signées avec le secret du moment : refaites si le secret change ou s'il en manque une.
secret = gen.get("JWT_SECRET", old.get("JWT_SECRET", ""))
if "JWT_SECRET" in gen or not have("ANON_KEY") or not have("SERVICE_ROLE_KEY"):
    gen["ANON_KEY"], gen["SERVICE_ROLE_KEY"] = jwt("anon", secret), jwt("service_role", secret)
# Clés de vérification, refaites à chaque passage (déduites de JWT_SECRET et de stack/cloud-jwks.json) : HS256 pour
# signer et vérifier (kid fixe), plus les clés publiques du Cloud, qui signe ses sessions en ES256.
jw = os.path.join(os.path.dirname(out), "cloud-jwks.json")
cloud = [dict(k, key_ops=["verify"]) for k in json.load(open(jw, encoding="utf-8"))["keys"]] if os.path.exists(jw) else []
hs = {"kty": "oct", "alg": "HS256", "kid": "aurelys-hs256", "k": b64(secret.encode())}
enc = lambda v: "'" + json.dumps(v, separators=(",", ":")) + "'"
gen["JWT_JWKS"] = enc({"keys": [dict(hs, key_ops=["verify"])] + cloud})
gen["JWT_KEYS"] = enc([dict(hs, key_ops=["sign", "verify"])] + cloud)

lines, seen = [], set()
for l in open(tpl, encoding="utf-8"):
    l = l.rstrip("\n")
    if "=" in l and not l.lstrip().startswith("#"):
        k, v = l.split("=", 1); k = k.strip(); seen.add(k)
        l = f"{k}={gen[k] if k in gen else old[k] if have(k) else v}"
    lines.append(l)
extra = [f"{k}={v}" for k, v in old.items() if k not in seen]  # lignes propres au serveur : gardées
if extra: lines += ["", "############ Lignes ajoutées à la main (gardées)"] + extra

print(("à générer : " if dry else "générés : ") + (", ".join(sorted(gen)) or "rien (tout est déjà rempli)"))
if not dry:
    if os.path.exists(out): os.replace(out, out + ".bak")
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f: f.write("\n".join(lines) + "\n")
    os.chmod(out, 0o600)
    if os.path.exists(out + ".bak"): os.chmod(out + ".bak", 0o600)
PY
[ "$DRY" = 1 ] && exit 0
ok "stack/.env écrit (chmod 600, ancienne version dans stack/.env.bak)"
grep -qE '^(API_DOMAIN=CHANGER|DISCORD_CLIENT_ID=$|TURNSTILE_SECRET=$)' "$STACK/.env" &&
  avert "à compléter à la main dans stack/.env : API_DOMAIN, DISCORD_CLIENT_ID, DISCORD_SECRET, TURNSTILE_SECRET, VAPID_PRIVATE (voir README.md)"
exit 0
