// Comptes (pseudo et mot de passe), classement des gains, amis et guildes.
import { useCallback, useEffect, useState } from "react";
import { W, sW, cls, BOTS } from "./format.js";
import { Segmented, SubHeader, Loading } from "./nav.jsx";
import { discordOf } from "./discord.js";

// ===== Comptes =====
// Petit formulaire : un état « en cours », un message de réussite ou d'erreur.
function useAct() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const act = async (fn, ok) => { setBusy(true); setMsg(null); try { await fn(); if (ok) setMsg({ ok }) } catch (e) { setMsg({ err: e.message }) } finally { setBusy(false) } };
  const out = msg && <p className={msg.err ? "error" : "accent"} role="status">{msg.err ?? msg.ok}</p>;
  return [act, busy, out];
}

// Se connecter à un compte existant (pseudo ou e-mail, et mot de passe).
export function LoginPanel({ account, warn }) {
  const [pseudo, setPseudo] = useState(""), [pw, setPw] = useState(""), [act, busy, out] = useAct();
  return (
    <form className="auth" onSubmit={e => { e.preventDefault(); act(() => account.signIn(pseudo, pw)) }}>
      {warn && <p className="muted small">Ta partie actuelle n'a pas de mot de passe : elle sera remplacée par celle du compte.</p>}
      <input name="username" autoComplete="username" placeholder="Pseudo ou e-mail" value={pseudo} onChange={e => setPseudo(e.target.value)} required />
      <input name="password" type="password" autoComplete="current-password" placeholder="Mot de passe" value={pw} onChange={e => setPw(e.target.value)} required />
      <button className="btn primary" type="submit" disabled={busy}>Se connecter</button>
      {out}
    </form>
  );
}

// Discord : se connecter (retrouver une partie liée, ou en créer une) ou sauvegarder la partie en cours (link).
export function DiscordButton({ account, link, label }) {
  const [act, busy, out] = useAct();
  return <>
    <button type="button" className="btn discord" disabled={busy} onClick={() => act(link ? account.linkDiscord : account.discord)}>
      {label ?? (link ? "Sauvegarder ma partie avec Discord" : "Se connecter avec Discord")}</button>
    {out}
  </>;
}

// Retour de Discord : ce compte Discord a déjà une autre partie. Basculer dessus, en prévenant si la partie en cours sera perdue.
function DiscordTaken({ account, saved }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="discord-taken" role="alert">
      <p>Ce compte Discord a déjà une partie Aurelys. Basculer dessus ?</p>
      <p className="muted small">{saved ? "Tu pourras revenir sur ta partie actuelle avec ton pseudo et ton mot de passe."
        : "Ta partie actuelle n'est pas sauvegardée : elle sera perdue."}</p>
      <DiscordButton account={account} label="Basculer sur ce compte" />
      <button type="button" className="link" onClick={() => setGone(true)}>Rester sur cette partie</button>
    </div>
  );
}

// Choisir ou changer son mot de passe. Le pseudo, caché, sert d'identifiant au gestionnaire de mots de passe du navigateur.
function PasswordForm({ account, pseudo, label }) {
  const [pw, setPw] = useState(""), [act, busy, out] = useAct();
  return (
    <form className="auth" onSubmit={e => { e.preventDefault(); act(() => account.register(pseudo, pw)) }}>
      <input name="username" autoComplete="username" value={pseudo} readOnly hidden />
      <input name="password" type="password" autoComplete="new-password" placeholder="Mot de passe (8 caractères au moins)" minLength={8} value={pw} onChange={e => setPw(e.target.value)} required />
      <button className="btn primary" type="submit" disabled={busy}>{label}</button>
      {out}
    </form>
  );
}

// E-mail de connexion facultatif : un autre identifiant, jamais vérifié ni utilisé pour écrire (pas d'envoi d'e-mails).
function EmailForm({ account }) {
  const [email, setEmail] = useState(""), [act, busy, out] = useAct();
  useEffect(() => { account.loginEmail().then(e => setEmail(e ?? "")).catch(() => { }) }, [account]);
  return (
    <form className="auth" onSubmit={e => { e.preventDefault(); act(async () => setEmail(await account.setLoginEmail(email) ?? ""), email.trim() ? "E-mail enregistré : tu peux t'en servir pour te connecter." : "E-mail retiré.") }}>
      <label className="muted small" htmlFor="login-email">E-mail pour se connecter (facultatif, on ne t'écrira jamais)</label>
      <input id="login-email" type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} />
      <button className="btn" type="submit" disabled={busy}>Enregistrer l'e-mail</button>
      {out}
    </form>
  );
}

// Encadré « Compte » de Mon compte : choisir un mot de passe, se connecter, se déconnecter.
export function AccountLink({ account, pseudo }) {
  const [u, setU] = useState(undefined), [login, setLogin] = useState(false), [change, setChange] = useState(false), [quit, setQuit] = useState(false), [act, busy, out] = useAct();
  useEffect(() => { account.user().then(setU).catch(() => setU(null)) }, [account]);
  if (!u) return null;
  const discord = discordOf(u), oauth = account.oauth;
  return (
    <div className="panel auth-panel">
      <b>Compte</b>
      {oauth?.kind === "taken" ? <DiscordTaken account={account} saved={!!u.email} /> : oauth && <p className="error" role="status">{oauth.text}</p>}
      {discord && <p className="discord-me">{discord.avatar && <img src={discord.avatar} alt="" width="28" height="28" referrerPolicy="no-referrer" />}
        <span>Compte Discord lié : tu peux te connecter avec Discord.<br /><b>{discord.name}</b></span></p>}
      {u.email || discord ? <>
        <p className="muted">Connecté en tant que {pseudo}. Ta partie est sauvegardée.</p>
        {!discord && <DiscordButton account={account} link label="Lier mon compte Discord" />}
        <EmailForm account={account} />
        {change ? <PasswordForm account={account} pseudo={pseudo} label="Changer le mot de passe" />
          : <button type="button" className="link" onClick={() => setChange(true)}>Changer de mot de passe</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => act(() => account.signOut())}>Se déconnecter</button>
        {out}
      </> : login ? <>
        <LoginPanel account={account} warn />
        <button type="button" className="link" onClick={() => setLogin(false)}>Retour</button>
      </> : <>
        <p className="muted">Partie non sauvegardée : elle sera supprimée après 90 jours sans visite. Sauvegarde-la avec Discord ou un mot de passe.</p>
        <DiscordButton account={account} link />
        <PasswordForm account={account} pseudo={pseudo} label="Enregistrer" />
        <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>
        {/* Partie anonyme : se déconnecter la perd pour de bon (rien pour la retrouver), on le dit avant. */}
        {quit ? <div className="quit-warn" role="alert">
          <p>Ta partie n'est pas sauvegardée : si tu te déconnectes, tu la perds définitivement, avec ton solde et tes positions.</p>
          <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => account.signOut())}>Me déconnecter et perdre ma partie</button>
          <button type="button" className="link" onClick={() => setQuit(false)}>Annuler</button>
          {out}
        </div> : <button type="button" className="link muted" onClick={() => setQuit(true)}>Se déconnecter</button>}
      </>}
    </div>
  );
}

// ===== Classement des gains =====
const useLoad = (load, deps) => {
  const [rows, setRows] = useState(null);
  const reload = useCallback(() => load().then(setRows).catch(e => { console.error(e); setRows([]) }), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); reload() }, [reload]);
  return [rows, reload];
};
const sub = (...a) => a.filter(Boolean).join(", ");
export const BotTag = ({ id }) => BOTS.has(id) ? <i className="gtag bot" title="Joueur fictif, géré par le jeu">bot</i> : null;

export function Ranking({ api, me, wealth }) {
  const [period, setPeriod] = useState("today"), [scope, setScope] = useState("all");
  const [rows] = useLoad(() => period === "wealth" ? Promise.resolve([]) : api.gainsBoard(period, scope), [api, period, scope]);
  return (
    <section>
      <Segmented label="Période" value={period} onChange={setPeriod} options={[["today", "Aujourd'hui"], ["total", "Total"], ["wealth", "Patrimoine"]]} />
      {period === "wealth" ? wealth : <>
        <div className="chips">
          {[["all", "Tous"], ["friends", "Amis"], ["guild", "Ma guilde"]].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
        </div>
        {rows === null ? <Loading size={48} /> : !rows.length ? <p className="muted">{period === "today" ? "Aucun pari clôturé aujourd'hui pour l'instant." : "Aucun pari clôturé."}</p> : (
          <div className="board">
            {rows.map((p, i) => (
              <div key={p.id} className={"brow" + (p.id === me.id ? " me" : "")}>
                <span className="rk mono">{i + 1}</span>
                <span><b>{p.pseudo}<BotTag id={p.id} />{p.guild && <> <i className="gtag">{p.guild}</i></>}</b><small>{sub(p.level != null ? `niveau ${p.level}` : null, sub(p.title, `${p.bets} pari${p.bets > 1 ? "s" : ""} clôturé${p.bets > 1 ? "s" : ""}`))}</small></span>
                <span className={"r mono " + cls(p.gain)}>{sW(p.gain)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="fine">Gains nets des paris clôturés : ce qui est revenu, moins la mise et les frais. Le classement du jour repart à zéro à minuit, heure de Paris.</p>
      </>}
    </section>
  );
}

// ===== Amis =====
export function Friends({ api, say, onBack }) {
  const [rows, reload] = useLoad(() => api.myFriends(), [api]), [pseudo, setPseudo] = useState("");
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); reload() } catch (e) { say(e.message, "down") } };
  const part = st => (rows ?? []).filter(r => r.state === st);
  const row = (f, acts) => (
    <div key={f.id} className="brow frow">
      <span className="fname">
        <b>{f.pseudo}{f.guild && <> <i className="gtag">{f.guild}</i></>}</b>
        {f.state === "ami" && <small className="mono">jour <span className={cls(f.today)}>{sW(f.today)}</span>, total <span className={cls(f.total)}>{sW(f.total)}</span></small>}
      </span>
      <span className="f-acts">{acts}</span>
    </div>
  );
  return (
    <section>
      <SubHeader title="Amis" onBack={onBack} />
      <form className="add-row" onSubmit={e => { e.preventDefault(); run(() => api.friendAdd(pseudo), s => { setPseudo(""); return s === "ami" ? "Vous êtes amis." : "Demande envoyée." }) }}>
        <input placeholder="Pseudo d'un joueur" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required aria-label="Pseudo à ajouter" />
        <button className="btn primary" type="submit">Ajouter</button>
      </form>
      {rows === null ? <Loading size={48} /> : <>
        {part("recu").length > 0 && <><h3 className="sec">Demandes reçues</h3><div className="board">{part("recu").map(f => row(f, <>
          <button type="button" className="btn primary" onClick={() => run(() => api.friendAdd(f.pseudo), () => `${f.pseudo} est ton ami.`)}>Accepter</button>
          <button type="button" className="btn ghost" onClick={() => run(() => api.friendRemove(f.id))}>Refuser</button></>))}</div></>}
        <h3 className="sec">Mes amis</h3>
        {part("ami").length ? <div className="board">{part("ami").map(f => row(f,
          <button type="button" className="btn ghost" onClick={() => run(() => api.friendRemove(f.id))} aria-label={`Retirer ${f.pseudo}`}>Retirer</button>))}</div>
          : <p className="muted">Ajoute un ami avec son pseudo, puis comparez vos gains dans le classement « Amis ».</p>}
        {part("envoye").length > 0 && <><h3 className="sec">En attente</h3><div className="board">{part("envoye").map(f => row(f,
          <button type="button" className="btn ghost" onClick={() => run(() => api.friendRemove(f.id))}>Annuler</button>))}</div></>}
      </>}
    </section>
  );
}
