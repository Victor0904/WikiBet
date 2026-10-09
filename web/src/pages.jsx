// Pages du menu « Plus » : profil, Comment jouer, Mon compte, Sources des données.
import { W, CAP0_TXT } from "./format.js";
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

// Page Profil (onglet « Plus ») : qui je suis, inviter des amis, accès rapides. Ne relit rien de lourd : les
// données du jeu déjà chargées d'abord, guilde / amis / trophées ensuite, une fois la page affichée.
const initials = p => (p ?? "?").split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
const ordinal = n => n === 1 ? "1er" : `${n}e`;
export const Avatar = ({ pseudo, size = 56, accent }) => (
  <span className="avatar" style={{ width: size, height: size, fontSize: size * .38, background: accent }} aria-hidden="true">{initials(pseudo)}</span>
);

export function Profile({ api, me, title, home, board, patrimoine, refs, accent, say, go, onTrophies, hasPush }) {
  const [guild, setGuild] = useState(undefined), [friends, setFriends] = useState(null), [troph, setTroph] = useState(null);
  useEffect(() => {
    let alive = true;
    api.guildList?.("today").then(l => { if (!alive) return; const i = l.findIndex(g => g.mine); setGuild(i < 0 ? null : { ...l[i], rank: i + 1 }) }).catch(() => alive && setGuild(null));
    api.myFriends?.().then(f => alive && setFriends(f.filter(x => x.state === "ami"))).catch(() => {});
    api.trophies?.(me.id).then(t => alive && setTroph(t)).catch(() => {});
    return () => { alive = false };
  }, [api, me.id]);

  const rank = board.findIndex(r => r.id === me.id) + 1 || null, delta = rank && refs?.rank_day ? refs.rank_day - rank : 0;
  const mine = refs?.mine ?? [], rewarded = mine.filter(r => r.paid > 0).length;
  const slots = [...mine.filter(r => r.status === "validé"), ...mine.filter(r => r.status !== "validé")].slice(0, 4);
  const link = refs?.code ? `${location.origin}/?ref=${refs.code}` : null;
  const share = async () => {
    const text = `Rejoins-moi sur Aurelys, la bourse inventée où les joueurs font les cours. Mon code : ${refs.code}`;
    if (navigator.share) { try { await navigator.share({ title: "Aurelys", text, url: link }); return } catch (e) { if (e?.name === "AbortError") return } }
    try { await navigator.clipboard.writeText(link); say("Lien copié : colle-le à tes amis.") } catch { say(`Ton lien : ${link}`) }
  };
  const online = friends?.filter(f => f.online).length ?? 0, best = friends?.length ? friends.reduce((a, f) => f.today > a.today ? f : a) : null;

  return (
    <div className="profile">
      <header className="profile-head">
        <Avatar pseudo={me.pseudo} accent={accent} />
        <div className="who-txt">
          <h1>{me.pseudo}{guild && <span className="gtag">{guild.tag}</span>}</h1>
          <small>{[title, home].filter(Boolean).join(" · ")}</small>
        </div>
        <button type="button" className="gear" onClick={() => go("account")} aria-label="Mon compte">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.0 10.5L21.4 10.8L21.4 13.2L19.0 13.5L18.1 15.9L19.5 17.8L17.8 19.5L15.9 18.1L13.5 19.0L13.2 21.4L10.8 21.4L10.5 19.0L8.1 18.1L6.2 19.5L4.5 17.8L5.9 15.9L5.0 13.5L2.6 13.2L2.6 10.8L5.0 10.5L5.9 8.1L4.5 6.2L6.2 4.5L8.1 5.9L10.5 5.0L10.8 2.6L13.2 2.6L13.5 5.0L15.9 5.9L17.8 4.5L19.5 6.2L18.1 8.1Z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </header>
      <div className="profile-stats">
        <div><small>Patrimoine</small><b className="mono">{W(patrimoine)}</b></div>
        <div><small>Classement</small><b className="mono">{rank ? ordinal(rank) : "au-delà du 50e"}
          {delta !== 0 && <span className={delta > 0 ? "up" : "down"}> {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}<span className="sr"> place{Math.abs(delta) > 1 ? "s" : ""} depuis hier</span></span>}</b></div>
      </div>

      {link && <section className="invite panel">
        <div className="invite-h"><h2>Invite tes amis</h2><span className="mono">{rewarded}/4</span></div>
        <p className="muted small">+10 000 W pour toi et +2 000 W pour ton ami quand il a clôturé 5 positions (100 W ou plus, sur 2 jours) et acheté son premier logement.</p>
        <ul className="slots">
          {[0, 1, 2, 3].map(i => { const r = slots[i]; return (
            <li key={i} className={"slot" + (r ? (r.status === "validé" ? " done" : " wait") : "")}>
              {r ? <><Avatar pseudo={r.pseudo} size={40} accent={r.status === "validé" ? accent : undefined} /><small>{r.status === "validé" ? r.pseudo : "en cours"}</small></>
                 : <><span className="avatar empty" aria-hidden="true">+</span><small>libre</small></>}
            </li>) })}
        </ul>
        <div className="invite-code"><span><small>Ton code</small><b className="mono">{refs.code}</b></span>
          <button type="button" className="btn primary" onClick={share}>Partager</button></div>
      </section>}

      <div className="ptiles">
        <button type="button" className="ptile panel" onClick={() => go("board")}>
          <b>Classement</b><span>{board[0] ? `1er : ${board[0].pseudo}` : "—"}</span><small>{rank ? `Toi : ${ordinal(rank)}` : "Toi : au-delà du 50e"}</small>
        </button>
        <button type="button" className="ptile panel" onClick={() => go("guilds")}>
          <b>Ma guilde</b>{guild === undefined ? <span>…</span> : guild ? <><span>{guild.name}</span><small>{ordinal(guild.rank)} du jour</small></> : <span>Rejoindre une guilde</span>}
        </button>
        <button type="button" className="ptile panel" onClick={() => go("friends")}>
          <b>Amis</b>{!friends ? <span>…</span> : <><span>{friends.length ? `${online} en ligne` : "Ajouter des amis"}</span>
            {best && best.today > 0 && <small>Meilleur gain du jour : {best.pseudo}</small>}</>}
        </button>
        <button type="button" className="ptile panel" onClick={onTrophies}>
          <b>Trophées</b><span>{troph ? `${troph.filter(t => t.got).length}/${troph.length}` : "…"}</span><small>Voir mon QG</small>
        </button>
      </div>

      <nav className="menu discreet" aria-label="Autres pages">
        {[["howto", "Comment jouer"], ...(hasPush ? [["notifs", "Notifications"]] : []), ["account", "Mon compte"], ["legal", "Sources des données"]].map(([k, t]) => (
          <button key={k} type="button" className="menu-row" onClick={() => go(k)}><span><b>{t}</b></span><span className="chev" aria-hidden="true">›</span></button>
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
  ["Prendre position", "▲ si tu penses que le cours va monter, ▼ s'il va baisser. Ton gain suit la variation, multipliée par le levier : à ×5, +2 % de cours font +10 % sur ta mise. Leviers ×1 à ×15 pour tous, ×20 avec un logement (QG), ×25 dans une guilde qui a une salle des marchés. Sur une jeune pousse, ×5 au plus. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture. Si la position perd toute sa mise, elle est liquidée."],
  ["Investir sur le long terme", "Dans la fiche d'une entreprise, « Investir » achète de vraies actions : sans levier, sans liquidation, à garder aussi longtemps que tu veux. Certaines versent un dividende chaque jour d'Aurelys. De jeunes entreprises entrent régulièrement en bourse : avec 50 000 W de patrimoine, tu peux souscrire à leur levée de fonds avant la cotation. Elles peuvent beaucoup rapporter… ou faire faillite. Lis leurs articles dans le Courrier d'Aurelys."],
  ["Ton QG", "Dépense tes gains : logements, déco en 3D, thèmes, titres et bonus. Un plus grand logement donne aussi un historique plus long et plus d'alertes de prix. Tes trophées s'affichent au mur. Le classement compte ton patrimoine (solde, valeur actuelle de tes positions, actions et 60 % de la valeur de tes objets)."],
  ["Classements, amis et guildes", "Trois classements : les gains du jour (remis à zéro à minuit), les gains de tous les temps et le patrimoine. Ajoute tes amis par leur pseudo, ou rejoins une guilde de 30 traders au plus. Lie ta partie à un e-mail dans Mon compte pour la garder."],
  ["Salaire et faillite", "Toutes les 11 minutes, un salaire de 10 % de tes mises sur Aurelys (500 W au plus). Une position compte si elle est restée ouverte une heure d'Aurelys (2 min 30) ; une hausse et une baisse sur la même action s'annulent. C'est une aide pour remonter : salaire plein sous 20 000 W de patrimoine, de moins en moins au-dessus, plus rien à 100 000 W. Sous 2 000 W (solde, mises et valeur de revente de tes objets), tu peux repartir à " + CAP0_TXT + " depuis Mon compte. Le compteur de faillites est visible de tous."],
];

export function HowTo({ onBack, first }) {
  return (
    <section className="howto">
      {first ? <h2 className="howto-title">Bienvenue sur Aurelys</h2> : <SubHeader title="Comment jouer" onBack={onBack} />}
      <ol className="steps">
        {STEPS.map(([t, p], i) => <li key={t} className="panel"><span className="step-n mono">{i + 1}</span><div><b>{t}</b><p>{p}</p></div></li>)}
      </ol>
      <button type="button" className="btn primary big" onClick={onBack}>{first ? "C'est parti" : "Retour"}</button>
    </section>
  );
}

export function Account({ account, push, me, title, patrimoine, openStake, objects, canRestart, onRestart, demo, onBack }) {
  return (
    <section className="account">
      <SubHeader title="Mon compte" onBack={onBack} />
      <div className="panel">
        <p className="acc-name"><b>{me.pseudo}</b>{title && <span className="title-tag">{title}</span>}</p>
        <div className="rows mono">
          <div className="row"><span>Patrimoine</span><b>{W(patrimoine)}</b></div>
          <div className="row"><span>Solde</span><b>{W(me.cash)}</b></div>
          <div className="row"><span>Positions (valeur actuelle)</span><b>{W(openStake)}</b></div>
          <div className="row"><span>Objets et logements du QG (60 %)</span><b>{W(objects)}</b></div>
          <div className="row"><span>Faillites</span><b>{me.bankruptcies}</b></div>
        </div>
      </div>
      {account && <AccountLink account={account} pseudo={me.pseudo} />}
      {push && <PushPanel push={push} />}
      <div className="panel bk">
        <p><b>Faillite</b>Sous 2 000 W (solde, valeur actuelle de tes positions et de tes actions, valeur de revente de tes objets et bonus), tu peux repartir à {CAP0_TXT}. Tes paris en cours sont perdus, tes objets restent à toi, et le compteur de faillites augmente.</p>
        <button type="button" className="btn" disabled={!canRestart} onClick={onRestart}>Repartir</button>
      </div>
      {demo && <p className="fine">Mode démo locale : ta partie est enregistrée dans ce navigateur uniquement, sans compte.</p>}
    </section>
  );
}

export function Legal({ onBack }) {
  return (
    <section className="legal">
      <SubHeader title="Sources des données" onBack={onBack} />
      <div className="panel prose">
        <p><b>Bourse d'Aurelys.</b> Fictive : pays, entreprises, personnages, cours et actualités sont simulés par le serveur, identiques pour tous les joueurs. Toute ressemblance avec une société réelle serait fortuite.</p>
        <p><b>Chiffres réels utilisés par Aurelys.</b> Météo en Beauce et à Paris (Open-Meteo), consommation électrique française (RTE éCO2mix, open data), jours fériés (calendrier.api.gouv.fr). Relevés au plus tous les quarts d'heure ; ils influencent la valeur de 3 entreprises fictives.</p>
        <p><b>Monnaie.</b> Les W sont fictifs : ils ne s'achètent pas et ne se revendent pas. Tout se gagne en jouant.</p>
      </div>
    </section>
  );
}
