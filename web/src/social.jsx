// Comptes (e-mail, Apple), classement des gains, amis et guildes.
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
const City = lazy(() => import("./City.jsx")); // Three.js n'est chargé qu'à l'ouverture d'une ville
import { W, sW, cls } from "./format.js";
import { Segmented, SubHeader } from "./nav.jsx";

// ===== Comptes =====
const APPLE = "M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.3-1.8-1.4-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 6.9 1.2 9.2.8 1.1 1.7 2.3 2.9 2.3 1.1 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.4-.9-2.4-3.7zM14.1 5.9c.6-.8 1.1-1.8.9-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-.9 2.8 1 .1 2.1-.5 2.7-1.3z";
export const AppleButton = ({ label, onClick }) => (
  <button type="button" className="btn apple" onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={APPLE} fill="currentColor" /></svg>{label}
  </button>
);

// Petit formulaire : un état « en cours », un message de réussite ou d'erreur.
function useAct() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const act = async (fn, ok) => { setBusy(true); setMsg(null); try { await fn(); if (ok) setMsg({ ok }) } catch (e) { setMsg({ err: e.message }) } finally { setBusy(false) } };
  const out = msg && <p className={msg.err ? "error" : "accent"} role="status">{msg.err ?? msg.ok}</p>;
  return [act, busy, out];
}

// Se connecter à un compte existant (Apple ou e-mail et mot de passe).
export function LoginPanel({ account, warn }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [act, busy, out] = useAct();
  return (
    <form className="auth" onSubmit={e => { e.preventDefault(); act(() => account.emailSignIn(email, pw)) }}>
      {warn && <p className="muted small">Ta partie actuelle n'a pas de compte : elle sera remplacée par celle du compte.</p>}
      <AppleButton label="Se connecter avec Apple" onClick={() => act(() => account.appleSignIn())} />
      <span className="or">ou</span>
      <input type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" autoComplete="current-password" placeholder="Mot de passe" value={pw} onChange={e => setPw(e.target.value)} required />
      <button className="btn primary" type="submit" disabled={busy}>Se connecter</button>
      <button type="button" className="link" disabled={busy || !email}
        onClick={() => act(() => account.resetPassword(email), `Lien envoyé à ${email} pour choisir un nouveau mot de passe.`)}>Mot de passe oublié ?</button>
      {out}
    </form>
  );
}

// Encadré « Compte » de Mon compte : lier la partie, choisir un mot de passe, se déconnecter.
export function AccountLink({ account }) {
  const [u, setU] = useState(undefined), [login, setLogin] = useState(false), [form, setForm] = useState(false);
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [act, busy, out] = useAct();
  useEffect(() => { account.user().then(setU).catch(() => setU(null)) }, [account]);
  if (!u) return null;
  const apple = u.identities?.some(i => i.provider === "apple"), mail = u.identities?.some(i => i.provider === "email");
  const needPw = account.recovery || (mail && !u.user_metadata?.pw);
  return (
    <div className="panel auth-panel">
      <b>Compte</b>
      {account.error && <p className="error">{account.error}</p>}
      {needPw ? (
        <form className="auth" onSubmit={e => { e.preventDefault(); act(() => account.setPassword(pw)) }}>
          <p className="muted">E-mail confirmé : {u.email}. Choisis ton mot de passe.</p>
          <input type="password" autoComplete="new-password" placeholder="Mot de passe (8 caractères au moins)" minLength={8} value={pw} onChange={e => setPw(e.target.value)} required />
          <button className="btn primary" type="submit" disabled={busy}>Enregistrer</button>
          {out}
        </form>
      ) : u.is_anonymous ? (login ? <><LoginPanel account={account} warn /><button type="button" className="link" onClick={() => setLogin(false)}>Retour</button></> : <>
        <p className="muted">Ta partie n'est liée à aucun compte. Lie-la pour la garder et la retrouver sur un autre appareil.</p>
        {u.new_email && <p className="accent">Lien envoyé à {u.new_email}. Ouvre-le pour confirmer ton e-mail.</p>}
        <AppleButton label="Continuer avec Apple" onClick={() => act(() => account.appleLink())} />
        {form ? (
          <form className="auth" onSubmit={e => { e.preventDefault(); act(() => account.emailLink(email), `Lien envoyé à ${email}. Ouvre-le, puis choisis ton mot de passe.`) }}>
            <input type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            <button className="btn" type="submit" disabled={busy}>Recevoir le lien de confirmation</button>
          </form>
        ) : <button type="button" className="btn" onClick={() => setForm(true)}>Créer un compte avec un e-mail</button>}
        {out}
        <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>
      </>) : <>
        <p className="muted">Connecté{apple ? " avec Apple" : ""}{u.email ? ` · ${u.email}` : ""}. Ta partie est sauvegardée.</p>
        {!apple && <AppleButton label="Lier aussi Apple" onClick={() => act(() => account.appleLink())} />}
        <button type="button" className="btn" disabled={busy} onClick={() => act(() => account.signOut())}>Se déconnecter</button>
        {out}
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
const sub = (...a) => a.filter(Boolean).join(" · ");

export function Ranking({ api, me, wealth, onVisit }) {
  const [period, setPeriod] = useState("today"), [scope, setScope] = useState("all");
  const [rows] = useLoad(() => period === "wealth" ? Promise.resolve([]) : api.gainsBoard(period, scope), [api, period, scope]);
  return (
    <section>
      <Segmented label="Période" value={period} onChange={setPeriod} options={[["today", "Aujourd'hui"], ["total", "Total"], ["wealth", "Patrimoine"]]} />
      {period === "wealth" ? wealth : <>
        <div className="chips">
          {[["all", "Tous"], ["friends", "Amis"], ["guild", "Ma guilde"]].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
        </div>
        {rows === null ? <p className="muted">Chargement…</p> : !rows.length ? <p className="muted">{period === "today" ? "Aucun pari clôturé aujourd'hui pour l'instant." : "Aucun pari clôturé."}</p> : (
          <div className="board">
            {rows.map((p, i) => (
              <button type="button" key={p.id} className={"brow" + (p.id === me.id ? " me" : "")} onClick={() => onVisit(p)} aria-label={`Voir le QG de ${p.pseudo}`}>
                <span className="rk mono">{i + 1}</span>
                <span><b>{p.pseudo}{p.guild && <i className="gtag">{p.guild}</i>}</b><small>{sub(p.title, `${p.bets} pari${p.bets > 1 ? "s" : ""} clôturé${p.bets > 1 ? "s" : ""}`)}</small></span>
                <span className={"r mono " + cls(p.gain)}>{sW(p.gain)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="fine">Gains nets des paris clôturés : ce qui est revenu, moins la mise et les frais. Le classement du jour repart à zéro à minuit, heure de Paris.</p>
      </>}
    </section>
  );
}

// ===== Amis =====
export function Friends({ api, say, onVisit, onBack }) {
  const [rows, reload] = useLoad(() => api.myFriends(), [api]), [pseudo, setPseudo] = useState("");
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); reload() } catch (e) { say(e.message, "down") } };
  const part = st => (rows ?? []).filter(r => r.state === st);
  const row = (f, acts) => (
    <div key={f.id} className="brow frow">
      <button type="button" className="fname" onClick={() => onVisit(f)} aria-label={`Voir le QG de ${f.pseudo}`}>
        <b>{f.pseudo}{f.guild && <i className="gtag">{f.guild}</i>}</b>
        {f.state === "ami" && <small className="mono">jour <span className={cls(f.today)}>{sW(f.today)}</span> · total <span className={cls(f.total)}>{sW(f.total)}</span></small>}
      </button>
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
      {rows === null ? <p className="muted">Chargement…</p> : <>
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

// ===== Guildes =====
export function Guilds({ api, me, say, onVisit, onBack, accent }) {
  const [period, setPeriod] = useState("today"), [sel, setSel] = useState(null), [create, setCreate] = useState(false);
  const [list, reload] = useLoad(() => api.guildList(period), [api, period]);
  const mine = list?.find(g => g.mine);
  const run = async (fn, ok) => { try { await fn(); if (ok) say(ok, "up"); setSel(null); setCreate(false); reload() } catch (e) { say(e.message, "down") } };
  const shown = sel ?? (create ? null : mine);
  return (
    <section>
      <SubHeader title="Guildes" onBack={sel ? () => setSel(null) : onBack} />
      {shown ? <>
          <GuildView api={api} me={me} g={shown} mine={shown.id === mine?.id} canJoin={!mine} run={run} onVisit={onVisit} />
          <h3 className="sec">La ville de {shown.name}</h3>
          <Suspense fallback={<p className="muted small">Chargement de la ville…</p>}>
            <City key={shown.id} api={api} guildId={shown.id} me={me} mine={shown.id === mine?.id} say={say} onVisit={onVisit} accent={accent} />
          </Suspense>
        </>
        : create ? <GuildForm onCreate={v => run(() => api.guildCreate(v), `Guilde ${v.name} fondée.`)} onCancel={() => setCreate(false)} />
        : <div className="panel guild-intro"><p className="muted">Une guilde réunit jusqu'à 30 traders. Ses gains sont la somme de ceux de ses membres.</p>
            <button type="button" className="btn primary" onClick={() => setCreate(true)}>Fonder une guilde</button></div>}
      <h3 className="sec">Classement des guildes</h3>
      <Segmented label="Période" value={period} onChange={setPeriod} options={[["today", "Aujourd'hui"], ["total", "Total"]]} />
      {list === null ? <p className="muted">Chargement…</p> : !list.length ? <p className="muted">Aucune guilde pour l'instant. Fonde la première.</p> : (
        <div className="board">
          {list.map((g, i) => (
            <button type="button" key={g.id} className={"brow" + (g.mine ? " me" : "")} onClick={() => { setSel(g); window.scrollTo({ top: 0 }) }}>
              <span className="rk mono">{i + 1}</span>
              <span><b>{g.name}<i className="gtag">{g.tag}</i></b><small>{sub(`${g.members}/30 membres`, g.motto)}</small></span>
              <span className={"r mono " + cls(g.gain)}>{sW(g.gain)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function GuildView({ api, me, g, mine, canJoin, run, onVisit }) {
  const [members] = useLoad(() => api.guildMembers(g.id), [api, g.id, g.members]);
  const boss = members?.find(m => m.owner)?.id === me.id;
  return (
    <div className="panel guild">
      <div className="guild-h"><b>{g.name}</b><i className="gtag">{g.tag}</i></div>
      {g.motto && <p className="muted">« {g.motto} »</p>}
      <div className="board">
        {(members ?? []).map(m => (
          <div key={m.id} className={"brow frow" + (m.id === me.id ? " me" : "")}>
            <button type="button" className="fname" onClick={() => onVisit(m)} aria-label={`Voir le QG de ${m.pseudo}`}>
              <b>{m.pseudo}{m.owner && <small className="accent"> · fondateur</small>}</b>
              <small className="mono">jour <span className={cls(m.today)}>{sW(m.today)}</span> · total <span className={cls(m.total)}>{sW(m.total)}</span></small>
            </button>
            <span className="f-acts">{boss && m.id !== me.id && <button type="button" className="btn ghost" onClick={() => run(() => api.guildKick(m.id), `${m.pseudo} a quitté la guilde.`)}>Exclure</button>}</span>
          </div>
        ))}
      </div>
      {mine ? <button type="button" className="btn" onClick={() => run(() => api.guildLeave(), "Tu as quitté la guilde.")}>Quitter la guilde</button>
        : canJoin && g.members < 30 ? <button type="button" className="btn primary" onClick={() => run(() => api.guildJoin(g.id), `Bienvenue chez ${g.name}.`)}>Rejoindre</button>
        : canJoin ? <p className="muted">Guilde complète.</p> : <p className="muted">Quitte ta guilde pour rejoindre celle-ci.</p>}
    </div>
  );
}

function GuildForm({ onCreate, onCancel }) {
  const [v, setV] = useState({ name: "", tag: "", motto: "" }), set = k => e => setV({ ...v, [k]: k === "tag" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") : e.target.value });
  return (
    <form className="panel auth" onSubmit={e => { e.preventDefault(); onCreate(v) }}>
      <b>Fonder une guilde</b>
      <input placeholder="Nom (3 à 24 caractères)" value={v.name} onChange={set("name")} minLength={3} maxLength={24} required autoFocus aria-label="Nom" />
      <input placeholder="Sigle (2 à 4 lettres ou chiffres)" value={v.tag} onChange={set("tag")} minLength={2} maxLength={4} required aria-label="Sigle" />
      <input placeholder="Devise (facultatif)" value={v.motto} onChange={set("motto")} maxLength={80} aria-label="Devise" />
      <div className="empty-acts"><button className="btn primary" type="submit">Fonder</button><button type="button" className="btn" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}
