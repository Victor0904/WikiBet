// Page d'un joueur (H2) : la sienne ou celle d'un autre (/joueur/<pseudo>), et l'écran « Modifier mon profil ».
// Tout est décidé par le serveur (player_page, my_cosmetics, profile_set, chest_open, pseudo_change).
import { useCallback, useEffect, useState } from "react";
import { DIVISIONS } from "../supabase/functions/_shared/progression.js";
import { W, sW, cls } from "./format.js";
import { LOCALE, t } from "./i18n.js";
import { SubHeader, Loading } from "./nav.jsx";
import { PlayerAvatar, COLORS } from "./avatars.jsx";

const Bar = ({ cur, goal, label }) => (
  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={cur} aria-label={label}><i style={{ width: `${100 * Math.max(0, Math.min(1, cur / goal))}%` }} /></div>
);

export function PlayerPage({ api, name, onBack, onEdit, onGuild }) {
  const [p, setP] = useState(undefined);
  useEffect(() => { setP(undefined); api.playerPage(name).then(setP).catch(() => setP(null)) }, [api, name]);
  return (
    <section className="player">
      <SubHeader title={p?.me ? "Ma page" : "Joueur"} onBack={onBack} />
      {p === undefined ? <Loading /> : !p ? <p className="muted">Ce profil est masqué ou n'existe pas.</p> : <>
        <header className="pl-head">
          <PlayerAvatar avatar={p.avatar} pseudo={p.pseudo} size={84} division={p.division} />
          <div>
            <h1>{p.pseudo}</h1>
            {p.title && <p className="accent">{p.title}</p>}
            <small className="muted">{`${DIVISIONS[p.division]}, niveau ${p.level}`}</small>
          </div>
        </header>
        {p.next != null && <div className="g-xp"><Bar cur={p.xp - p.from} goal={p.next - p.from} label="Vers le niveau suivant" />
          <small className="mono muted">{`${p.xp - p.from} / ${p.next - p.from} XP vers le niveau ${p.level + 1}`}</small></div>}
        {p.me && <div className="pl-acts"><button type="button" className="btn" onClick={onEdit}>Modifier mon profil</button>{p.hidden && <small className="muted">Profil masqué : seul toi le vois.</small>}</div>}
        <dl className="p-figs">
          <div><dt>Patrimoine</dt><dd className="mono">{W(p.patrimoine)}</dd></div>
          <div><dt>Taux de gain</dt><dd className="mono">{p.trades ? `${Math.round(100 * p.wins / p.trades)} %` : "—"}</dd></div>
        </dl>
        {p.pins.length > 0 && <div className="ach-cat"><h3>Trophées épinglés</h3>
          <div className="pl-pins">{p.pins.map(a => <div key={a.code} className="pl-pin"><span aria-hidden="true">★</span><b>{a.name}</b><small className="muted">{a.descr}</small></div>)}</div></div>}
        <div className="plain">
          <div className="plain-row"><span>Trades valides</span><span className="mono">{p.trades}</span></div>
          <div className="plain-row"><span>Meilleur trade</span><span className={"mono " + cls(p.best ?? 0)}>{p.best != null ? sW(p.best) : "—"}</span></div>
          <div className="plain-row"><span>Série de quêtes</span><span className="mono">{`${p.streak} jour${p.streak > 1 ? "s" : ""}`}</span></div>
          {p.guild && <button type="button" className="plain-row pl-guild" onClick={() => onGuild(p.guild.id)}><span>Guilde</span><span>{p.guild.name} <i className="gtag">{p.guild.tag}</i></span></button>}
          <div className="plain-row"><span>Joue depuis le</span><span>{new Date(p.since).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })}</span></div>
        </div>
        {p.seasons.length > 0 && <div className="ach-cat"><h3>Dernières saisons</h3>
          <div className="plain">{p.seasons.map(h => (
            <div key={h.week} className="plain-row"><span>{new Date(h.week + "T12:00:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}{" : "}{DIVISIONS[h.division]}{" → "}{DIVISIONS[h.after]}</span>
              <span className="mono">{`${h.rank}/${h.n}`}</span></div>))}</div></div>}
      </>}
    </section>
  );
}

const why = x => x.unlock === "level" ? `Niveau ${x.value}` : x.unlock === "div" ? `Ligue ${DIVISIONS[+x.value]}` : x.unlock === "chest" ? "Coffre de quêtes"
  : x.unlock === "guild" ? "Chef de la guilde du mois" : "Succès";
export function ProfileEdit({ api, me, say, onBack, onPseudo }) {
  const [c, setC] = useState(null), [pseudo, setPseudo] = useState("");
  const load = useCallback(() => api.myCosmetics().then(setC).catch(e => say(e.message, "down")), [api, say]);
  useEffect(() => { load() }, [load]);
  if (!c) return <section><SubHeader title="Modifier mon profil" onBack={onBack} /><Loading /></section>;
  const [code, col] = (c.avatar ?? "taureau:0").split(":");
  const set = async (v, ok) => { try { await api.profileSet(v); if (ok) say(ok, "up"); load() } catch (e) { say(e.message, "down") } };
  const pins = c.pins ?? [], pin = k => set({ pins: pins.includes(k) ? pins.filter(x => x !== k) : [...pins, k].slice(-3) });
  const open = async () => { try { const r = await api.chestOpen(); say(r.avatar ? t("Coffre ouvert : avatar {n} débloqué !", { n: t(r.name) }) : "Coffre ouvert : tu as déjà tous les avatars du coffre.", "up"); load() } catch (e) { say(e.message, "down") } };
  return (
    <section className="p-edit">
      <SubHeader title="Modifier mon profil" onBack={onBack} />
      <header className="pl-head"><PlayerAvatar avatar={c.avatar} pseudo={me.pseudo} size={72} division={me.division ?? 0} />
        <div><h1>{me.pseudo}</h1>{c.title && <p className="accent">{c.titles.find(t => t.code === c.title)?.text}</p>}</div></header>
      {c.chests > 0 && <button type="button" className="btn primary" onClick={open}>{`Ouvrir mon coffre de quêtes (${c.chests})`}</button>}

      <h3 className="sec">Avatar</h3>
      <div className="av-grid">{c.avatars.map(a => (
        <button key={a.code} type="button" aria-pressed={a.code === code} disabled={!a.ok} title={a.ok ? a.name : `${a.name} : ${why(a)}`} onClick={() => set({ avatar: `${a.code}:${col}` })}>
          <PlayerAvatar avatar={`${a.code}:${a.ok ? col : 7}`} size={44} />{!a.ok && <small>{why(a)}</small>}</button>))}</div>
      <div className="av-colors" role="group" aria-label="Couleur de fond">{COLORS.map((x, i) => (
        <button key={x} type="button" aria-pressed={String(i) === col} aria-label={`Couleur ${i + 1}`} style={{ background: x }} onClick={() => set({ avatar: `${code}:${i}` })} />))}</div>

      <h3 className="sec">Titre</h3>
      <select value={c.title ?? ""} onChange={e => set(e.target.value ? { title: e.target.value } : { clearTitle: true })} aria-label="Titre affiché sous le pseudo" className="p-select">
        <option value="">Aucun titre</option>
        {c.titles.filter(t => t.ok).map(t => <option key={t.code} value={t.code}>{t.text}</option>)}
      </select>
      <small className="muted">{`${c.titles.filter(t => t.ok).length} titre${c.titles.filter(t => t.ok).length > 1 ? "s" : ""} débloqué${c.titles.filter(t => t.ok).length > 1 ? "s" : ""} sur ${c.titles.length} : niveaux, ligues et succès en débloquent d'autres.`}</small>

      <h3 className="sec">Trophées épinglés</h3>
      {c.achievements.length ? <div className="chips pin-chips">{c.achievements.map(a => (
        <button key={a.code} type="button" aria-pressed={pins.includes(a.code)} onClick={() => pin(a.code)}>{a.name}</button>))}</div>
        : <p className="muted small">Débloque des succès pour les épingler ici (3 au plus).</p>}

      <h3 className="sec">Confidentialité</h3>
      <label className="row pl-check"><span>Masquer ma page publique (je reste dans les classements)</span>
        <input type="checkbox" checked={c.hidden} onChange={e => set({ hidden: e.target.checked })} /></label>

      <h3 className="sec">Pseudo</h3>
      {c.pseudo_next && Date.parse(c.pseudo_next) > Date.now()
        ? <p className="muted small">{t("Prochain changement possible le {d}.", { d: new Date(c.pseudo_next).toLocaleDateString(LOCALE, { day: "numeric", month: "long" }) })}</p>
        : <form className="row" onSubmit={async e => { e.preventDefault(); await onPseudo(pseudo); setPseudo(""); load() }}>
            <input value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={3} maxLength={16} required placeholder="Nouveau pseudo (3 à 16)" aria-label="Nouveau pseudo" autoComplete="off" />
            <button type="submit" className="btn">Changer</button></form>}
      <small className="muted">Un changement par 30 jours. Visible de tous : pas d'adresse e-mail.</small>
    </section>
  );
}
