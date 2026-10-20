// Confidentialité : ce qu'Aurelys garde, où et pourquoi. Affiché sur la page d'accueil et dans le jeu (Profil).
// Aucun cookie, aucun traceur tiers : si un jour on en ajoute (statistiques, publicité), il faudra un bandeau de consentement.
import { useState } from "react";

// Données de ce navigateur : session, préférences, partie d'essai. Le compte, lui, reste sur le serveur.
async function wipe() {
  try { for (const k of Object.keys(localStorage)) if (/^(wb-|sb-)/.test(k)) localStorage.removeItem(k) } catch { }
  try { for (const d of await indexedDB.databases()) if (d.name?.includes("wikibourse-demo-")) indexedDB.deleteDatabase(d.name) } catch { }
  location.href = "/";
}

export function PrivacyText() {
  const [sure, setSure] = useState(false);
  return (
    <div className="prose">
      <p><b>Aucun cookie, aucun traceur publicitaire ni outil de statistiques.</b> Rien n'est transmis à un réseau social ou à une régie. C'est pourquoi il n'y a pas de bandeau de cookies.</p>
      <p><b>Dans ton navigateur</b> (stockage local), seulement ce qui fait marcher le jeu : ta session de connexion, le code de parrainage reçu par lien (prérempli à l'inscription, tu peux l'effacer), tes alertes de prix, ce que tu as déjà vu (rumeurs, succès, aide) et la partie d'essai, qui ne quitte jamais ton appareil.</p>
      <p><b>Sur le serveur</b> (Supabase, à Londres : le Royaume-Uni est reconnu par l'Union européenne comme protégeant les données) : ton pseudo, ton mot de passe chiffré, ton e-mail si tu en as ajouté un (jamais utilisé pour t'écrire), ta partie (solde, positions, objets, guilde, amis). Les hébergeurs (Vercel, Supabase) gardent quelques jours des journaux techniques avec l'adresse IP, pour la sécurité. Contre les robots, l'inscription et la connexion passent par Cloudflare Turnstile, qui voit ton adresse IP et des informations techniques du navigateur, sans cookie publicitaire.</p>
      <p><b>Tes droits.</b> Pour consulter, corriger ou supprimer ton compte et ses données, écris-nous : <a href="https://github.com/Victor0904/WikiBet/issues" rel="noopener">contact</a>. Tu peux aussi saisir la CNIL.</p>
      {sure ? <p className="row"><span>Ceci te déconnecte et efface la partie d'essai. Ton compte reste sur le serveur.</span>
        <button type="button" className="btn" onClick={wipe}>Effacer</button></p>
        : <button type="button" className="btn" onClick={() => setSure(true)}>Effacer les données de ce navigateur</button>}
    </div>
  );
}
