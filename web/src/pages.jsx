// Pages du menu « Plus » : menu, Comment jouer, Mon compte, Sources des données.
import { W, CAP0_TXT } from "./format.js";
import { SubHeader } from "./nav.jsx";

export function MoreMenu({ go, me, title }) {
  const rows = [
    ["board", "Classement", "Les meilleurs patrimoines, et les QG à visiter"],
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
  ["Le principe", "Tu trades avec des W, une monnaie fictive, sur des chiffres réels : le prix des cryptos, les vues de Wikipédia, les spectateurs Twitch, les joueurs Steam. Tu commences avec " + CAP0_TXT + "."],
  ["La crypto, le marché principal", "Bitcoin, Ethereum, Solana… au vrai prix de Coinbase, en direct, 24 h/24. Prends position à la hausse ou à la baisse avec un levier. Le prix retenu est celui du serveur au moment de l'ordre. Des frais de 0,1 % du montant engagé sont prélevés à l'ouverture et à la clôture. La position reste ouverte jusqu'à ce que tu la clôtures, ou jusqu'à la liquidation."],
  ["Les séances du Marché", "Le Marché Wikipédia vit par séances : 10 minutes de jeu, 1 minute de pause, en continu. Tout le monde voit les mêmes cours au même moment. L'horloge « marché » (9:00 → 17:30) est un décor : une séance rejoue une vraie journée de vues en 10 minutes."],
  ["Prendre position", "▲ si tu penses que le cours va monter, ▼ s'il va baisser. Ton gain suit la variation, multipliée par le levier : à ×5, +2 % de cours font +10 % sur ta mise. Clôture quand tu veux, sinon la position se ferme au coup de sifflet final. Si elle perd toute sa mise, elle est liquidée."],
  ["Les duels", "Deux articles d'audience proche : lequel fera le plus de vues ? Tu paries à cote fixe, réglé à la fin de la séance sur les vraies vues du jour."],
  ["Le Live : Twitch et Steam", "Des questions Oui / Non sur de vrais chiffres : « Ce streamer aura-t-il plus de 50 000 spectateurs à 21:30 ? », « Ce jeu dépassera-t-il 700 000 joueurs à 22:00 ? ». La cote est figée quand tu paries, et les paris ferment 5 min avant l'échéance. Twitch ne met ses chiffres à jour que toutes les 1 à 3 min."],
  ["Ton QG", "Dépense tes gains : logements, déco en 3D, thèmes, titres et bonus. Le classement compte ton patrimoine (solde, mises en cours et 60 % de la valeur de tes objets) : acheter ne fait pas perdre de places, et tes objets survivent à une faillite."],
  ["Salaire et faillite", "+500 W à la fin de chaque séance où tu as parié. Sous 2 000 W, tu peux repartir à " + CAP0_TXT + " depuis Mon compte. Le compteur de faillites est visible de tous."],
];

export function HowTo({ onBack, first }) {
  return (
    <section className="howto">
      {first ? <h2 className="howto-title">Bienvenue sur wiki·bourse</h2> : <SubHeader title="Comment jouer" onBack={onBack} />}
      <ol className="steps">
        {STEPS.map(([t, p], i) => <li key={t} className="panel"><span className="step-n mono">{i + 1}</span><div><b>{t}</b><p>{p}</p></div></li>)}
      </ol>
      <button type="button" className="btn primary big" onClick={onBack}>{first ? "C'est parti" : "Retour"}</button>
    </section>
  );
}

export function Account({ me, title, patrimoine, openStake, objects, canRestart, onRestart, demo, onBack }) {
  return (
    <section className="account">
      <SubHeader title="Mon compte" onBack={onBack} />
      <div className="panel">
        <p className="acc-name"><b>{me.pseudo}</b>{title && <span className="title-tag">{title}</span>}</p>
        <div className="rows mono">
          <div className="row"><span>Patrimoine</span><b>{W(patrimoine)}</b></div>
          <div className="row"><span>Solde</span><b>{W(me.cash)}</b></div>
          <div className="row"><span>Mises en cours</span><b>{W(openStake)}</b></div>
          <div className="row"><span>Objets du QG (revente 60 %)</span><b>{W(objects)}</b></div>
          <div className="row"><span>Faillites</span><b>{me.bankruptcies}</b></div>
        </div>
      </div>
      <div className="panel bk">
        <p><b>Faillite</b>Sous 2 000 W (solde et mises en cours), tu peux repartir à {CAP0_TXT}. Tes paris en cours sont perdus, tes objets restent à toi, et le compteur de faillites augmente.</p>
        <button type="button" className="btn" disabled={!canRestart} onClick={onRestart}>Repartir</button>
      </div>
      {demo && <p className="fine">Mode démo locale : ta partie est enregistrée dans ce navigateur uniquement.</p>}
    </section>
  );
}

export function Legal({ engine, onBack }) {
  const d = (i, y) => engine.dateOf(i).toLocaleDateString("fr-FR", { day: "numeric", month: "long", ...(y ? { year: "numeric" } : {}), timeZone: "UTC" });
  return (
    <section className="legal">
      <SubHeader title="Sources des données" onBack={onBack} />
      <div className="panel prose">
        <p><b>Crypto.</b> Prix réels de Coinbase (paires en euros), en direct. Le prix d'un ordre est relevé par le serveur au moment où il le reçoit ; la liquidation est vérifiée chaque minute sur les vrais plus hauts et plus bas.</p>
        <p><b>Marché Wikipédia.</b> Vues quotidiennes réelles de Wikipédia en français (API Wikimedia Pageviews, du {d(0)} au {d(engine.END, true)}, licence CC0). Les clôtures et les duels sont réels. Le mouvement minute par minute entre deux clôtures est simulé, identique pour tous les joueurs.</p>
        <p><b>Twitch.</b> Spectateurs réels des lives francophones (API Twitch), relevés chaque minute. Twitch met ses chiffres à jour toutes les 1 à 3 minutes.</p>
        <p><b>Steam.</b> Joueurs connectés réels (API publique de Steam), relevés chaque minute.</p>
        <p><b>Monnaie.</b> Les W sont fictifs : ils ne s'achètent pas et ne se revendent pas. Tout se gagne en jouant.</p>
      </div>
    </section>
  );
}
