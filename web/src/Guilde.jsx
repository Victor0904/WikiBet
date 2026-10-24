// Onglet Guilde (H7) : ma guilde (objectif de la semaine en direct, membres, réglages du chef), recherche et invitations.
// Tout est décidé par le serveur (guild_page, guild_list, guild_set…) ; les règles sont dans progression.js.
import { useCallback, useEffect, useState } from "react";
import { GUILD_MAX_RATIO } from "../supabase/functions/_shared/progression.js";
import { W, sW, cls } from "./format.js";
import { BotTag } from "./social.jsx";
import { PlayerAvatar } from "./avatars.jsx";
import { LOCALE } from "./i18n.js";
import { Segmented, SubHeader, Loading } from "./nav.jsx";

// Emblèmes et bannières : formes originales dessinées ici (viewBox 24 × 24), à la couleur de la guilde. Niveau requis :
// guild_emblem_level et guild_banner_level en SQL.
export const EMBLEM_LEVEL = [1, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18], BANNER_LEVEL = [1, 2, 4, 6, 9, 12, 16, 20];
const SHIELD = "M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5z";
const EMBLEMS = [
  [SHIELD],
  [SHIELD, "m7 13 5-4 5 4"],
  ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 16V8m-4 4 4-4 4 4"],
  ["M12 2 20.7 7v10L12 22l-8.7-5V7z", "M8 14l3-3 2 2 3-3"],
  ["M12 2 22 12 12 22 2 12z", "M7 12h10"],
  ["m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"],
  ["M4 6c0 4 3 6 8 6s8-2 8-6", "M12 12v8", "M8 20h8"],
  ["M5 21V9h14v12", "M5 9V5h3v2h3V5h2v2h3V5h3v4", "M10 21v-5h4v5"],
  ["M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z", "M3 21h18"],
  ["M13 2 4 14h7l-1 8 9-12h-7z"],
  ["M12 8c-3-4-7-4-10-2 2 1 3 3 3 5 2-1 5-1 7 1 2-2 5-2 7-1 0-2 1-4 3-5-3-2-7-2-10 2z", "M12 12v9"],
  ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7l1.5 3.2 3.5.4-2.6 2.4.7 3.5L12 14.8l-3.1 1.7.7-3.5L7 10.6l3.5-.4z"],
];
export const Emblem = ({ i = 0, color = "#F5B83D", size = 40 }) => (
  <svg className="emblem" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(EMBLEMS[i] ?? EMBLEMS[0]).map((d, k) => <path key={k} d={d} fill={k === 0 && EMBLEMS[i]?.length > 1 ? `${color}22` : "none"} />)}
  </svg>
);
const PATTERNS = [
  null,
  c => <path d="M-4 4 4-4M0 16 16 0M12 20l8-8" stroke={c} strokeWidth="3" />,
  c => <path d="M0 12 8 4l8 8" stroke={c} strokeWidth="2.5" fill="none" />,
  c => <circle cx="8" cy="8" r="2.2" fill={c} />,
  c => <path d="M0 8q4-6 8 0t8 0" stroke={c} strokeWidth="2.5" fill="none" />,
  c => <path d="M0 .5h16M.5 0v16" stroke={c} strokeWidth="1.5" />,
  c => <path d="M8 8 0 0M8 8l8-8M8 8 0 16M8 8l8 8" stroke={c} strokeWidth="1.5" />,
  c => <rect width="16" height="16" fill={c} />,
];
export const Banner = ({ i = 0, color = "#F5B83D" }) => (
  <svg className="banner" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
    {i > 0 && <><defs><pattern id={`bn${i}`} width="16" height="16" patternUnits="userSpaceOnUse">{PATTERNS[i]?.(color)}</pattern></defs>
      <rect width="100%" height="100%" fill={`url(#bn${i})`} opacity={i === 7 ? .18 : .22} /></>}
  </svg>
);

const left = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} j ${h} h` : `${h} h ${String(m).padStart(2, "0")} min` };
const Bar = ({ cur, goal, label, tone = "" }) => (
  <div className={"bar " + tone} role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.max(0, cur)} aria-label={label}><i style={{ width: `${100 * Math.max(0, Math.min(1, cur / goal))}%` }} /></div>
);
const STATUS = { reached: "atteint", partial: "presque atteint", missed: "manqué" };
const RATIOS = [1, 1.5, 2, 3, GUILD_MAX_RATIO];
const week = d => new Date(d + "T12:00:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" });

export function Guilds({ api, me, say, open = null, onPlayer }) {
  const [period, setPeriod] = useState("today"), [sel, setSel] = useState(open), [create, setCreate] = useState(false);
  const [q, setQ] = useState(""), [minLv, setMinLv] = useState(1), [size, setSize] = useState("all"), [openOnly, setOpenOnly] = useState(false);
  const [list, setList] = useState(null), [invites, setInvites] = useState([]);
  const reload = useCallback(() => {
    api.guildList(period, q.trim() || null).then(setList).catch(e => { console.error(e); setList([]) });
    api.myGuildInvites?.().then(setInvites).catch(() => setInvites([]));
  }, [api, period, q]);
  useEffect(() => { const id = setTimeout(reload, q ? 300 : 0); return () => clearTimeout(id) }, [reload, q]);
  const mine = list?.find(g => g.mine);
  const run = async (fn, ok) => { try { await fn(); if (ok) say(ok, "up"); setCreate(false); reload(); return true } catch (e) { say(e.message, "down") } };
  const shown = sel ?? (create ? null : mine?.id);
  const fit = g => g.level >= minLv && (!openOnly || g.open) && (size === "all" || (size === "s" ? g.members < 10 : size === "m" ? g.members >= 10 && g.members < 25 : g.members >= 25));
  return (
    <section className="guilds">
      <SubHeader title={sel && sel !== mine?.id ? "Guilde" : "Ma guilde"} onBack={sel ? () => setSel(null) : null} />
      {shown ? <GuildPage key={shown} api={api} me={me} id={shown} hasGuild={!!mine} run={run} onPlayer={onPlayer} />
        : create ? <GuildForm onCreate={v => run(() => api.guildCreate(v), `Guilde ${v.name} fondée.`)} onCancel={() => setCreate(false)} />
        : <div className="guild-intro">
            <p className="muted">Une guilde se fixe chaque semaine un objectif commun : la somme des gains de trading de ses membres. Atteint, il fait monter la guilde de niveau et rapporte de l'XP à chacun.</p>
            {invites.map(g => <p key={g.id} className="row"><span>Invitation : <b>{g.name}</b> <i className="gtag">{g.tag}</i></span>
              <button type="button" className="btn primary" onClick={() => run(() => api.guildJoin(g.id), `Bienvenue chez ${g.name}.`)}>Rejoindre</button></p>)}
            <button type="button" className="btn primary" onClick={() => setCreate(true)}>Fonder une guilde</button></div>}
      <h3 className="sec">{mine ? "Autres guildes" : "Trouver une guilde"}</h3>
      <div className="g-filters">
        <input type="search" placeholder="Nom ou sigle" value={q} onChange={e => setQ(e.target.value)} aria-label="Chercher une guilde" />
        <select value={minLv} onChange={e => setMinLv(+e.target.value)} aria-label="Niveau minimum">
          {[1, 3, 5, 10, 15].map(l => <option key={l} value={l}>{l === 1 ? "Tous niveaux" : `Niveau ${l} ou plus`}</option>)}</select>
        <select value={size} onChange={e => setSize(e.target.value)} aria-label="Taille">
          {[["all", "Toutes tailles"], ["s", "Moins de 10"], ["m", "10 à 24"], ["l", "25 ou plus"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="g-check"><input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> Ouvertes</label>
      </div>
      <Segmented label="Période" value={period} onChange={setPeriod} options={[["today", "Gains du jour"], ["total", "Gains au total"]]} />
      {list === null ? <Loading size={48} /> : !list.filter(fit).length ? <p className="muted">Aucune guilde ne correspond.</p> : (
        <div className="board">
          {list.filter(fit).map((g, i) => (
            <button type="button" key={g.id} className={"brow" + (g.mine ? " me" : "")} onClick={() => { setSel(g.id); window.scrollTo({ top: 0 }) }}>
              <span className="rk"><Emblem i={g.emblem} color={g.color} size={24} /></span>
              <span><b>{g.name} <i className="gtag">{g.tag}</i></b><small>{`niveau ${g.level}, ${g.members}/${g.cap} membres${g.open ? "" : ", sur invitation"}`}</small></span>
              <span className={"r mono " + cls(g.gain)}>{sW(g.gain)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function GuildPage({ api, me, id, hasGuild, run, onPlayer }) {
  const [g, setG] = useState(undefined), [now, setNow] = useState(Date.now());
  const load = useCallback(() => api.guildPage({ id }).then(setG).catch(() => setG(null)), [api, id]);
  useEffect(() => { load(); const t = setInterval(() => { setNow(Date.now()); if (!document.hidden) load() }, 30000); return () => clearInterval(t) }, [load]);
  if (g === undefined) return <Loading size={48} />;
  if (!g) return <p className="muted">Guilde introuvable.</p>;
  const act = async (fn, ok) => { if (await run(fn, ok)) load() };
  const goal = g.goal, done = goal && goal.total >= goal.target;
  return (
    <div className="guild">
      <header className="g-head" style={{ "--g": g.color }}>
        <Banner i={g.banner} color={g.color} />
        <Emblem i={g.emblem} color={g.color} size={52} />
        <div className="g-title"><b>{g.name}<i className="gtag">{g.tag}</i></b><small>{`Niveau ${g.level}, ${g.members.filter(m => !m.bot).length}/${g.cap} membres${g.open ? "" : ", sur invitation"}`}</small></div>
      </header>
      {g.next != null && <div className="g-xp"><Bar cur={g.xp - g.from} goal={g.next - g.from} label="Vers le niveau de guilde suivant" />
        <small className="mono muted">{`${g.xp - g.from} / ${g.next - g.from} XP vers le niveau ${g.level + 1}`}</small></div>}
      {g.motto && <p className="muted">« {g.motto} »</p>}
      {g.descr && <p>{g.descr}</p>}

      <div className="panel pari g-goal">
        <div className="ach-h"><b>Objectif de la semaine</b><small className="muted">{`fin dans ${left(g.week_end - now / 1000)}`}</small></div>
        {goal ? <>
          <p className="g-goal-n"><b className={"mono " + cls(goal.total)}>{sW(goal.total)}</b><span className="muted">{` sur ${W(goal.target)}`}</span></p>
          <Bar cur={goal.total} goal={goal.target} label="Progression de l'objectif" tone={done ? "up" : ""} />
          <small className="muted">{`${goal.members} membre${goal.members > 1 ? "s comptés" : " compté"}, minimum ${W(goal.min)} ; atteint : ${goal.xp} XP de guilde, et +50 XP à chaque membre qui a fait 3 trades valides.`}</small>
        </> : <p className="muted">Pas d'objectif cette semaine. Les membres présents lundi à 0 h compteront pour la suivante.</p>}
        {g.streak > 0 && <small className="accent">{`Objectif atteint ${g.streak} semaine${g.streak > 1 ? "s" : ""} de suite`}</small>}
      </div>

      <h3 className="sec">Membres</h3>
      <div className="board">
        {g.members.map(m => (
          <div key={m.id} className={"brow frow" + (m.id === me.id ? " me" : "")}>
            <span className="fname g-mem">
              {!m.bot && <PlayerAvatar avatar={m.avatar} pseudo={m.pseudo} size={32} division={m.division} />}
              <span>
              {m.bot || !onPlayer ? <b>{m.pseudo}<BotTag id={m.id} />{m.owner && <small className="accent"> chef</small>}</b>
                : <button type="button" className="g-name" onClick={() => onPlayer(m.pseudo)}><b>{m.pseudo}</b>{m.owner && <small className="accent"> chef</small>}</button>}
              {m.title && <small className="accent">{m.title}</small>}
              <small>{m.counted ? `${m.level != null ? `niveau ${m.level}, ` : ""}${m.trades} trade${m.trades > 1 ? "s" : ""} valide${m.trades > 1 ? "s" : ""}` : m.bot ? "ne compte pas dans l'objectif" : "comptera à partir de lundi"}</small>
              </span>
            </span>
            <span className="f-acts">
              {m.counted && <b className={"mono " + cls(m.contribution)}>{sW(m.contribution)}</b>}
              {g.chef && m.id !== me.id && !m.bot && <>
                <button type="button" className="btn ghost" onClick={() => act(() => api.guildTransfer(m.id), `${m.pseudo} est le nouveau chef.`)}>Chef</button>
                <button type="button" className="btn ghost" onClick={() => act(() => api.guildKick(m.id), `${m.pseudo} a quitté la guilde.`)}>Exclure</button></>}
            </span>
          </div>
        ))}
      </div>

      {g.chef && <ChefPanel api={api} g={g} act={act} />}

      {g.history.length > 0 && <><h3 className="sec">Objectifs passés</h3>
        <div className="plain">{g.history.map(h => (
          <div key={h.week} className="plain-row"><span>Semaine du <time>{week(h.week)}</time></span>
            <span className={"mono " + (h.status === "reached" ? "up" : h.status === "missed" ? "down" : "")}>{`${sW(h.total)} / ${W(h.target)}, ${STATUS[h.status]}`}</span></div>))}</div></>}
      {g.top.length > 0 && <><h3 className="sec">Meilleurs contributeurs</h3>
        <div className="plain">{g.top.map(t => <div key={t.pseudo} className="plain-row"><span>{t.pseudo}</span><span className={"mono " + cls(t.total)}>{sW(t.total)}</span></div>)}</div></>}
      {g.trophies.length > 0 && <><h3 className="sec">Trophées</h3>
        <div className="plain">{g.trophies.map(t => <div key={t.month} className="plain-row"><span>{new Date(t.month + "T12:00:00").toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}</span><span className="accent">{t.rank === 1 ? "1re place" : `${t.rank}e place`}</span></div>)}</div></>}

      {g.mine ? <button type="button" className="btn" onClick={() => act(() => api.guildLeave(), "Tu as quitté la guilde. Tu pourras en rejoindre une autre dans 24 h.")}>Quitter la guilde</button>
        : hasGuild ? <p className="muted">Quitte ta guilde pour rejoindre celle-ci.</p>
        : g.members.filter(m => !m.bot).length >= g.cap ? <p className="muted">Guilde complète.</p>
        : g.open ? <button type="button" className="btn primary" onClick={() => act(() => api.guildJoin(g.id), `Bienvenue chez ${g.name}.`)}>Rejoindre</button>
        : <p className="muted">Guilde sur invitation : demande au chef de t'inviter.</p>}
    </div>
  );
}

function ChefPanel({ api, g, act }) {
  const [pseudo, setPseudo] = useState(""), [motto, setMotto] = useState(g.motto ?? ""), [descr, setDescr] = useState(g.descr ?? "");
  const set = (v, ok = "Guilde mise à jour.") => act(() => api.guildSet(v), ok);
  return (
    <details className="t-more g-chef">
      <summary>Réglages du chef</summary>
      <p className="small">Cible de la semaine prochaine (verrouillée lundi à 0 h). Plus elle est haute, plus l'objectif atteint rapporte d'XP à la guilde.</p>
      <Segmented label="Cible" value={String(g.ratio)} onChange={r => set({ ratio: +r }, "Cible enregistrée pour lundi.")}
        options={RATIOS.map(r => [String(r), `×${String(r).replace(".", ",")}`])} />
      <small className="muted">{`Soit ${W(g.next_min * g.ratio)} avec les membres actuels (minimum ${W(g.next_min)}).`}</small>
      <Segmented label="Accès" value={g.open ? "open" : "invite"} onChange={v => set({ open: v === "open" })} options={[["open", "Ouverte"], ["invite", "Sur invitation"]]} />
      <form className="row" onSubmit={e => { e.preventDefault(); act(() => api.guildInvite(pseudo), `${pseudo} est invité.`); setPseudo("") }}>
        <input placeholder="Pseudo à inviter" value={pseudo} onChange={e => setPseudo(e.target.value)} aria-label="Pseudo à inviter" required />
        <button type="submit" className="btn">Inviter</button>
      </form>
      <p className="small">Emblème</p>
      <div className="g-pick">{EMBLEM_LEVEL.map((l, i) => (
        <button key={i} type="button" aria-pressed={g.emblem === i} disabled={l > g.level} title={l > g.level ? `Niveau ${l}` : undefined} onClick={() => set({ emblem: i })}>
          <Emblem i={i} color={g.color} size={28} />{l > g.level && <small className="mono">{l}</small>}</button>))}</div>
      <p className="small">Bannière</p>
      <div className="g-pick">{BANNER_LEVEL.map((l, i) => (
        <button key={i} type="button" className="g-bn" aria-pressed={g.banner === i} disabled={l > g.level} title={l > g.level ? `Niveau ${l}` : undefined} onClick={() => set({ banner: i })}>
          <Banner i={i} color={g.color} />{l > g.level && <small className="mono">{l}</small>}</button>))}</div>
      <label className="row"><span>Couleur</span><input type="color" value={g.color} onChange={e => set({ color: e.target.value })} aria-label="Couleur de la guilde" /></label>
      <form className="g-text" onSubmit={e => { e.preventDefault(); set({ motto, ...(g.level >= 3 ? { descr } : {}) }) }}>
        <input placeholder="Devise" value={motto} onChange={e => setMotto(e.target.value)} maxLength={80} aria-label="Devise" />
        {g.level >= 3 ? <textarea placeholder="Description" value={descr} onChange={e => setDescr(e.target.value)} maxLength={280} rows={3} aria-label="Description" />
          : <small className="muted">Description : au niveau 3 de guilde.</small>}
        <button type="submit" className="btn">Enregistrer</button>
      </form>
    </details>
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
