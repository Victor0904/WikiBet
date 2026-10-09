// Pages du menu « Plus » : menu, Comment jouer, Mon compte, Sources des données.
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

export function MoreMenu({ go, me, title }) {
  const rows = [
    ["board", "Classement", "Meilleurs gains du jour, de tous les temps, patrimoine"],
    ["friends", "Amis", "Ajoute tes amis et compare vos gains"],
    ["guilds", "Guildes", "Rejoins une équipe de traders"],
    ["howto", "Comment jouer", "Les règles en deux minutes"],
    ["account", "Mon compte", `${me.pseudo}${title ? ` · ${title}` : ""}`],
    ["legal", "Sources des données", "Ce qui est réel, ce qui est simulé"],
  ];
  return (
    <section className="menu">
      {rows.map(([k, t, sub]) => (
        <button key={k} type="button" className="menu-row" onClick={() => go(k)}>
          <span><b>{t}</b><small>{sub}</small></span><span className="chev" aria-hidden="true">›</span>
        </button>
      ))}
    </section>
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
  ["Salaire et faillite", "Toutes les 11 minutes, un salaire de 10 % de tes mises sur Aurelys (500 W au plus) ; une position compte si elle est restée ouverte au moins 1 minute. Sous 2 000 W (solde, mises et valeur de revente de tes objets), tu peux repartir à " + CAP0_TXT + " depuis Mon compte. Le compteur de faillites est visible de tous."],
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
