// Prix crypto en direct pour l'écran : flux public Coinbase (WebSocket, à la seconde) et bougies d'une minute (REST).
// Ces prix servent à l'affichage ; le prix d'un ordre est relevé par le serveur (fonction crypto) au moment de l'ordre.
import { useEffect, useState } from "react";

export const CB = "https://api.exchange.coinbase.com";
export const FEE = 0.001; // 0,1 % du montant engagé, à l'ouverture et à la clôture
export const ASSETS = [
  ["BTC", "Bitcoin", "#F7931A"], ["ETH", "Ethereum", "#8A92B2"], ["SOL", "Solana", "#9945FF"], ["XRP", "XRP", "#3B82F6"],
  ["DOGE", "Dogecoin", "#C2A633"], ["ADA", "Cardano", "#2A6CF0"], ["AVAX", "Avalanche", "#E84142"], ["LINK", "Chainlink", "#2A5ADA"],
  ["DOT", "Polkadot", "#E6007A"], ["LTC", "Litecoin", "#A6A9AA"], ["SHIB", "Shiba Inu", "#E0602E"], ["UNI", "Uniswap", "#FF007A"],
  ["ATOM", "Cosmos", "#6F7390"], ["BCH", "Bitcoin Cash", "#8DC351"],
].map(([sym, name, color]) => ({ sym, name, color, pair: `${sym}-EUR` }));
export const BY_SYM = Object.fromEntries(ASSETS.map(a => [a.sym, a]));

// Prix en euros : 2 décimales au-dessus de 1 €, 4 chiffres significatifs en dessous (SHIB vaut quelques millionièmes).
const big = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const small = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 4 });
export const eur = v => v == null || isNaN(v) ? "—" : (v >= 1 ? big : small).format(v) + " €";

export function useCrypto() {
  const [quotes, setQuotes] = useState({}), [candles, setCandles] = useState({}), [live, setLive] = useState(false);
  // Premier affichage : statistiques sur 24 h, avant que le flux en direct ne réponde.
  useEffect(() => {
    ASSETS.forEach(a => fetch(`${CB}/products/${a.pair}/stats`).then(r => r.json()).then(s =>
      setQuotes(q => q[a.sym] ? q : { ...q, [a.sym]: { price: +s.last, open24: +s.open, high24: +s.high, low24: +s.low, vol24: +s.volume } })).catch(() => {}));
  }, []);
  // Flux en direct : on regroupe les messages et on rafraîchit l'écran deux fois par seconde au plus.
  useEffect(() => {
    let ws, alive = true, buf = {};
    const bySym = Object.fromEntries(ASSETS.map(a => [a.pair, a.sym]));
    const connect = () => {
      ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
      ws.onopen = () => { setLive(true); ws.send(JSON.stringify({ type: "subscribe", product_ids: ASSETS.map(a => a.pair), channels: ["ticker"] })) };
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === "ticker" && bySym[m.product_id]) buf[bySym[m.product_id]] = { price: +m.price, open24: +m.open_24h, high24: +m.high_24h, low24: +m.low_24h, vol24: +m.volume_24h, t: Date.parse(m.time) } };
      ws.onclose = () => { setLive(false); if (alive) setTimeout(connect, 3000) };
    };
    connect();
    const id = setInterval(() => { if (Object.keys(buf).length) { const b = buf; buf = {}; setQuotes(q => ({ ...q, ...b })) } }, 500);
    return () => { alive = false; clearInterval(id); ws?.close() };
  }, []);
  // Bougies d'une minute (1 h 30), pour les mini-courbes et les graphiques des positions.
  useEffect(() => {
    const load = () => ASSETS.forEach(a => fetch(`${CB}/products/${a.pair}/candles?granularity=60`).then(r => r.json())
      .then(k => Array.isArray(k) && setCandles(c => ({ ...c, [a.sym]: k.slice(0, 90).reverse().map(([t, l, h, o, cl]) => [t * 1000, o, h, l, cl]) }))).catch(() => {}));
    load(); const id = setInterval(load, 60000); return () => clearInterval(id);
  }, []);
  return { quotes, candles, live };
}

// Bougies d'une autre unité de temps, pour la fiche détaillée (granularité en secondes : 60, 300, 900, 3600).
export const fetchCandles = (pair, gran) => fetch(`${CB}/products/${pair}/candles?granularity=${gran}`).then(r => r.json())
  .then(k => Array.isArray(k) ? k.slice(0, 80).reverse().map(([t, l, h, o, c]) => ({ t: t * 1000, o, h, l, c })) : []);
