// Pages du menu « Plus » : profil, Comment jouer, Mon compte, Sources des données.
import { PrivacyText } from "./privacy.jsx";
import { t } from "./i18n.js";
import { W, CAP0_TXT } from "./format.js";
import { levelOf, XP_TOTAL, DIVISIONS } from "../supabase/functions/_shared/progression.js";
import { PlayerAvatar } from "./avatars.jsx";
import { SubHeader } from "./nav.jsx";
import { AccountLink } from "./social.jsx";
import { useEffect, useState } from "react";

// Notifications de liquidation (Web Push). compact : simple invitation au-dessus des positions, cachée une fois réglé.
export function PushPanel({ push, compact }) {
  const [st, setSt] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  useEffect(() => { push.status().then(setSt).catch(() => setSt("unsupported")) }, [push]);
  const run = async fn => { setBusy(true); setErr(null); try { await fn(); setSt(await push.status()) } catch (e) { setErr(e.message) } finally { setBusy(false) } };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!st || (compact && st !== "off")) return null;
  return (
    <div className={"panel push-panel" + (compact ? " compact" : "")}>
      {!compact && <b>Notifications</b>}
      {st === "on" ? <>
        <p className="muted small">Tu es prévenu sur cet appareil quand une position ne vaut plus que 25 %, puis 10 % de sa mise, et quand elle est liquidée, même site fermé.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => run(push.disable)}>Couper les notifications</button>
      </> : st === "off" ? <>
        <p className="muted small">Être prévenu sur cet appareil avant la liquidation d'une position (à 25 %, puis 10 % de la mise), et quand elle est liquidée, même site fermé.</p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => run(push.enable)}>Activer les notifications</button>
      </> : st === "denied" ? <p className="muted small">Notifications bloquées : autorise-les pour ce site dans les réglages du navigateur.</p>
        : <p className="muted small">{ios ? "Sur iPhone : ajoute Aurelys à l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »), ouvre-le depuis là, puis active les notifications ici." : "Ce navigateur ne gère pas les notifications."}</p>}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

// Page Profil (onglet « Plus ») : qui je suis (niveau, patrimoine, rang), mes accès (classement, succès, guilde,
// amis), le parrainage, puis les pages pratiques. Une seule chose marquante : l'anneau du niveau autour de l'avatar ;
// le reste est une liste sobre. Les données déjà chargées s'affichent tout de suite, guilde / amis / succès ensuite.
const initials = p => (p ?? "?").split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
const ordinal = n => n === 1 ? "1er" : `${n}e`;
export const Avatar = ({ pseudo, size = 56, accent, img }) => img
  ? <img className="avatar" src={img} alt="" style={{ width: size, height: size }} referrerPolicy="no-referrer" /> // avatar Discord, si lié
  : <span className="avatar" style={{ width: size, height: size, fontSize: size * .38, background: accent }} aria-hidden="true">{initials(pseudo)}</span>;
// Anneau de progression vers le niveau suivant (même calcul que trader_level en SQL : le niveau de départ est un plancher).
function LevelRing({ pseudo, xp, floor, img, avatar, division }) {
  const lvl = Math.max(levelOf(xp), floor ?? 1), from = XP_TOTAL[lvl], to = XP_TOTAL[lvl + 1];
  const part = to ? Math.min(1, Math.max(0, (xp - from) / (to - from))) : 1, R = 33, C = 2 * Math.PI * R;
  return (
    <div className="lv-ring" role="img" aria-label={`Niveau ${lvl}${to ? `, ${Math.round(part * 100)} % vers le niveau ${lvl + 1}` : ""}`}>
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r={R} className="track" />
        <circle cx="38" cy="38" r={R} className="fill" style={{ strokeDasharray: C, "--off": C * (1 - part), "--c": C }} />
      </svg>
      {avatar ? <PlayerAvatar avatar={avatar} pseudo={pseudo} size={58} division={division} /> : <Avatar pseudo={pseudo} size={58} img={img} />}
      <b className="lv-badge mono">{lvl}</b>
    </div>
  );
}

export function Profile({ api, me, board, patrimoine, refs, trial, say, go, hasPush }) {
  const [guild, setGuild] = useState(undefined), [friends, setFriends] = useState(null), [ach, setAch] = useState(null), [title, setTitle] = useState(null);
  useEffect(() => {
    let alive = true;
    api.guildList?.("today").then(l => { if (!alive) return; const i = l.findIndex(g => g.mine); setGuild(i < 0 ? null : { ...l[i], rank: i + 1 }) }).catch(() => alive && setGuild(null));
    api.myFriends?.().then(f => alive && setFriends(f.filter(x => x.state === "ami"))).catch(() => {});
    api.myAchievements?.().then(a => alive && setAch(a)).catch(() => {});
    if (me.title && !trial) api.myCosmetics?.().then(c => alive && setTitle(c.titles.find(x => x.code === me.title)?.text ?? null)).catch(() => {});
    return () => { alive = false };
  }, [api, me.id, me.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const xp = me.xp ?? 0, lvl = Math.max(levelOf(xp), me.lvl_floor ?? 1), toNext = XP_TOTAL[lvl + 1] != null ? XP_TOTAL[lvl + 1] - xp : null;
  const rank = board.findIndex(r => r.id === me.id) + 1 || null, delta = rank && refs?.rank_day ? refs.rank_day - rank : 0;
  const mine = refs?.mine ?? [], validated = mine.filter(r => r.status === "validé");
  const link = refs?.code ? `${location.origin}/?ref=${refs.code}` : null;
  const share = async () => {
    const text = t("Rejoins-moi sur Aurelys, la bourse inventée où les joueurs font les cours. Mon code : {code}", { code: refs.code }); // partagé hors de la page : traduit ici
    if (navigator.share) { try { await navigator.share({ title: "Aurelys", text, url: link }); return } catch (e) { if (e?.name === "AbortError") return } }
    try { await navigator.clipboard.writeText(link); say("Lien copié : colle-le à tes amis.") } catch { say(`Ton lien : ${link}`) }
  };
  const online = friends?.filter(f => f.online).length ?? 0;
  const row = (k, label, value) => (
    <button key={k} type="button" className="p-row" onClick={() => go(k)}>
      <span>{label}</span>{value != null && <span className="p-val">{value}</span>}<span className="chev" aria-hidden="true">›</span>
    </button>
  );

  return (
    <div className="profile">
      <header className="p-id">
        <LevelRing pseudo={me.pseudo} xp={xp} floor={me.lvl_floor} img={api.account?.discordInfo?.avatar} avatar={me.avatar} division={me.division ?? 0} />
        <div className="p-name">
          <h1>{me.pseudo}{guild && <span className="gtag">{guild.tag}</span>}</h1>
          {title && <p className="accent">{title}</p>}
          <p>{toNext != null ? `Niveau ${lvl}, encore ${toNext} XP pour le ${lvl + 1}` : `Niveau ${lvl}`}</p>
          {!trial && <p className="muted small">{`Ligue ${DIVISIONS[me.division ?? 0]}`}</p>}
        </div>
      </header>

      <dl className="p-figs">
        <div><dt>Patrimoine</dt><dd className="mono">{W(patrimoine)}</dd></div>
        <div><dt>Classement</dt><dd className="mono">{rank ? ordinal(rank) : "après le 50e"}
          {delta !== 0 && <span className={delta > 0 ? "up" : "down"}> {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}<span className="sr"> place{Math.abs(delta) > 1 ? "s" : ""} depuis hier</span></span>}</dd></div>
      </dl>

      <nav className="p-list" aria-label="Mon jeu">
        {!trial && row("me", "Ma page", null)}
        {!trial && row("edit", "Modifier mon profil", null)}
        {row("board", "Classements", board[0] && board[0].id !== me.id ? `1er : ${board[0].pseudo}` : null)}
        {row("succes", "Succès", ach ? `${ach.list.filter(a => a.at).length} sur ${ach.total}` : null)}
        {row("guilds", "Guilde", guild === undefined ? null : guild ? guild.name : "Rejoindre")}
        {row("friends", "Amis", !friends ? null : friends.length ? `${online} en ligne sur ${friends.length}` : "Ajouter")}
      </nav>

      {trial ? <section className="p-invite">
        <h2>Invite tes amis</h2>
        <p>Le parrainage demande un compte : +10 000 W pour toi à chaque ami validé.</p>
        <a className="btn primary" href="/jouer">Créer mon compte</a>
      </section>
      : link && <section className="p-invite">
        <h2>Invite tes amis</h2>
        <p>+10 000 W pour toi et +2 000 W pour ton ami, quand il a clôturé 5 positions (100 W ou plus, sur 2 jours) et atteint le niveau 3.</p>
        <div className="p-code">
          <span className="mono" aria-label="Ton code de parrainage">{refs.code}</span>
          <button type="button" className="btn primary" onClick={share}>Partager</button>
        </div>
        <p className="p-slots">
          <span className="dots" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className={i < validated.length ? "on" : i < mine.length ? "wait" : ""} />)}</span>
          {validated.length ? `${validated.length} sur 4 validés : ${validated.map(r => r.pseudo).join(", ")}` : mine.length ? `${mine.length} inscrit${mine.length > 1 ? "s" : ""}, en attente de validation` : "4 parrainages récompensés au plus"}
        </p>
      </section>}

      <nav className="p-more" aria-label="Autres pages">
        {[["howto", "Comment jouer"], ...(hasPush ? [["notifs", "Notifications"]] : []), ["account", "Mon compte"], ["legal", "Sources des données"], ["privacy", "Confidentialité"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => go(k)}>{l}</button>
        ))}
      </nav>
    </div>
  );
}

const STEPS = [
  ["Le principe", "Tu trades avec des W, une monnaie fictive, sur une bourse inventée, Aurelys. Tu commences avec " + CAP0_TXT + ". Ici, c'est le talent qui paie : lire les nouvelles, anticiper."],
  ["La Bourse d'Aurelys", "Un pays fictif, 13 entreprises inventées, une bourse ouverte 24 h/24. Un jour d'Aurelys dure 1 h réelle : tu as le temps de lire et de réfléchir. Les prix naissent des ordres de bots aux caractères différents, de baleines et des joueurs. Ton propre ordre fait bouger le prix : plus il est gros, et plus l'action est petite, plus tu paies cher."],
  ["Résultats et consensus", "Avant chaque publication de résultats, les analystes annoncent ce qu'ils attendent. Le cours réagit à la surprise, pas au chiffre : +12 % quand on attendait +8 %, ça monte ; +12 % quand on attendait +15 %, ça baisse. Les indices sortent avant : commandes, rumeurs, révisions des analystes."],
  ["Des entreprises branchées sur le réel", "Granterre la pluie et la chaleur en Beauce, Helvane la consommation électrique française, Lumirue les jours fériés et la météo du week-end. Ces chiffres sont réels et à venir : celui qui voit venir une canicule ou un pont a un temps d'avance."],
  ["Prendre position", "▲ si tu penses que le cours va monter, ▼ s'il va baisser. Ton gain suit la variation, multipliée par le levier : à ×5, +2 % de cours font +10 % sur ta mise. Le levier se débloque avec ton niveau de trader : ×2 au niveau 2, ×5 au 5, ×10 au 12 ; ×15 et ×20 demandent aussi une bonne ligue. Sur une jeune pousse, ×5 au plus. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture. Si la position perd toute sa mise, elle est liquidée."],
  ["Investir sur le long terme", "Dans la fiche d'une entreprise, « Investir » achète de vraies actions : sans levier, sans liquidation, à garder aussi longtemps que tu veux. Certaines versent un dividende chaque jour d'Aurelys. De jeunes entreprises entrent régulièrement en bourse : avec 50 000 W de patrimoine, tu peux souscrire à leur levée de fonds avant la cotation. Elles peuvent beaucoup rapporter… ou faire faillite. Lis leurs articles dans le Courrier d'Aurelys."],
  ["Stop, objectif et succès", "Sur chaque position, pose un stop (clôture si le cours va contre toi) et un objectif (clôture quand le gain est atteint). Le nombre de positions ouvertes en même temps grandit avec ton niveau. Tes succès se débloquent en jouant : séries, gains, données réelles, et quelques secrets."],
  ["Niveaux, quêtes et pari du jour", "Ton niveau de trader monte avec l'XP des quêtes (3 par jour, 3 par semaine), de ta série de jours et du pari du jour, jamais avec tes gains. Chaque niveau débloque quelque chose : levier, positions, ordres à déclenchement, guilde. Le pari du jour est gratuit : vote avant 14 h, réponse à 20 h."],
  ["Ligues", "Chaque semaine (lundi 0 h, heure de Paris) est une saison. Dès ton premier trade valide, tu rejoins un groupe de 100 joueurs au plus de ta division, de Bronze 1 à Maître. On y est classé au rendement de la semaine : les 5 % meilleurs montent de deux divisions, les 15 % suivants d'une, les 20 % derniers descendent. Avec 5 trades valides, tu touches la récompense de ta division (en W) ; ×15 et ×20 demandent les ligues Platine et Diamant."],
  ["Classements, amis et guildes", "Trois classements : les gains du jour (remis à zéro à minuit), les gains de tous les temps et le patrimoine (solde, valeur actuelle de tes positions et actions). Ajoute tes amis par leur pseudo, ou rejoins une guilde : chaque semaine, le chef fixe un objectif, la somme des gains de trading des membres. Atteint, il fait monter la guilde de niveau et donne de l'XP. Lie ta partie à un e-mail ou à Discord dans Mon compte pour la garder."],
  ["Ton profil", "Choisis un avatar et sa couleur, un titre et 3 trophées à épingler dans Plus, Modifier mon profil. Niveaux, ligues, succès et coffres de quêtes en débloquent d'autres. Ta page est visible des autres joueurs, sauf si tu la masques."],
  ["Salaire et faillite", "Toutes les 11 minutes, un salaire de 10 % de tes mises sur Aurelys (500 W au plus). Une position compte si elle est restée ouverte une heure d'Aurelys (2 min 30) ; une hausse et une baisse sur la même action s'annulent. C'est une aide pour remonter : salaire plein sous 20 000 W de patrimoine, de moins en moins au-dessus, plus rien à 100 000 W. Sous 2 000 W de patrimoine, tu peux repartir à " + CAP0_TXT + " depuis Mon compte. Le compteur de faillites est visible de tous."],
];

export function HowTo({ onBack, first }) {
  return (
    <section className="howto">
      {first ? <h2 className="howto-title">Bienvenue sur Aurelys</h2> : <SubHeader title="Comment jouer" onBack={onBack} />}
      <div className="guide">
        {STEPS.map(([t, p]) => <section key={t}><h2>{t}</h2><p>{p}</p></section>)}
      </div>
      <button type="button" className="btn primary big" onClick={onBack}>{first ? "C'est parti" : "Retour"}</button>
    </section>
  );
}

export function Account({ account, push, me, patrimoine, openStake, holds, canRestart, onRestart, onPseudo, onDelete, demo, onBack }) {
  return (
    <section className="account">
      <SubHeader title="Mon compte" onBack={onBack} />
      <h1 className="acc-name">{me.pseudo}</h1>
      <div className="plain">
        <div className="plain-row acc-total"><span>Patrimoine</span><b className="mono">{W(patrimoine)}</b></div>
        <div className="plain-row"><span>Solde</span><b className="mono">{W(me.cash)}</b></div>
        <div className="plain-row"><span>Positions (valeur actuelle)</span><b className="mono">{W(openStake)}</b></div>
        <div className="plain-row"><span>Actions</span><b className="mono">{W(holds)}</b></div>
        <div className="plain-row"><span>Faillites</span><b className="mono">{me.bankruptcies}</b></div>
      </div>
      {me.pseudo_free && <PseudoForm onPseudo={onPseudo} />}
      {account && <AccountLink account={account} pseudo={me.pseudo} />}
      {push && <PushPanel push={push} />}
      <section className="d-sec">
        <h2>Faillite</h2>
        <p className="muted">Sous 2 000 W de patrimoine (solde, valeur actuelle de tes positions et de tes actions), tu peux repartir à {CAP0_TXT}. Tes paris en cours sont perdus et le compteur de faillites augmente.</p>
        <button type="button" className="btn acc-restart" disabled={!canRestart} onClick={onRestart}>Repartir à zéro</button>
      </section>
      {demo && <p className="fine">Mode démo locale : ta partie est enregistrée dans ce navigateur uniquement, sans compte.</p>}
      {onDelete && <DeleteAccount pseudo={me.pseudo} onDelete={onDelete} />}
    </section>
  );
}

// Supprimer son compte : discret, tout en bas ; confirmation en retapant son pseudo. Le serveur efface tout (account_delete).
function DeleteAccount({ pseudo, onDelete }) {
  const [open, setOpen] = useState(false), [v, setV] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  if (!open) return <button type="button" className="link muted acc-delete" onClick={() => setOpen(true)}>Supprimer mon compte</button>;
  const same = v.trim().toLowerCase() === pseudo.toLowerCase();
  return (
    <form className="panel auth quit-warn acc-delete-form" role="alert" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await onDelete(v.trim()) } catch (x) { setErr(x.message); setBusy(false) }
    }}>
      <b>Supprimer mon compte</b>
      <p>C'est définitif et irréversible. Ton compte et toutes ses données sont effacés : solde, positions, actions, quêtes, succès, amis et parrainages. Personne ne pourra les retrouver.</p>
      <p className="muted small">Si tu diriges une guilde, elle passe à son membre le plus ancien.</p>
      <label className="muted small" htmlFor="del-pseudo">Pour confirmer, tape ton pseudo : <b translate="no">{pseudo}</b></label>
      <input id="del-pseudo" autoComplete="off" value={v} onChange={e => setV(e.target.value)} />
      <button className="btn danger" type="submit" disabled={busy || !same}>Supprimer définitivement</button>
      <button type="button" className="link" disabled={busy} onClick={() => { setOpen(false); setV(""); setErr(null) }}>Annuler</button>
      {err && <p className="error" role="status">{err}</p>}
    </form>
  );
}

// Pseudo renommé d'office (il ressemblait à une adresse e-mail) : un changement offert, vérifié par le serveur.
function PseudoForm({ onPseudo }) {
  const [v, setV] = useState(""), [busy, setBusy] = useState(false);
  return (
    <form className="panel auth" onSubmit={async e => { e.preventDefault(); setBusy(true); await onPseudo(v); setBusy(false) }}>
      <label className="muted small" htmlFor="new-pseudo">Choisis ton pseudo (une fois). Il est visible de tous : pas d'adresse e-mail.</label>
      <input id="new-pseudo" autoComplete="off" value={v} onChange={e => setV(e.target.value)} minLength={2} maxLength={20} required />
      <button className="btn primary" type="submit" disabled={busy}>Changer de pseudo</button>
    </form>
  );
}

export function Privacy({ onBack }) {
  return <section className="legal"><SubHeader title="Confidentialité" onBack={onBack} /><PrivacyText /></section>;
}

// Même forme que Comment jouer : des titres et du texte, sans encadré.
const SOURCES = [
  ["Bourse d'Aurelys", "Fictive : pays, entreprises, personnages, cours et actualités sont simulés par le serveur, identiques pour tous les joueurs. Toute ressemblance avec une société réelle serait fortuite."],
  ["Chiffres réels utilisés par Aurelys", "Météo en Beauce et à Paris (Open-Meteo), consommation électrique française (RTE éCO2mix, open data), jours fériés (calendrier.api.gouv.fr). Relevés au plus tous les quarts d'heure ; ils influencent la valeur de 3 entreprises fictives."],
  ["Monnaie", "Les W sont fictifs : ils ne s'achètent pas et ne se revendent pas. Tout se gagne en jouant."],
];
export function Legal({ onBack }) {
  return (
    <section className="legal">
      <SubHeader title="Sources des données" onBack={onBack} />
      <div className="guide">{SOURCES.map(([t, p]) => <section key={t}><h2>{t}</h2><p>{p}</p></section>)}</div>
    </section>
  );
}
