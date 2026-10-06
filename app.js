/* ===================== Données réelles ===================== */
const RAW = window.WIKI_DATA.views; // chargé depuis data/pageviews.js
const META = window.WIKI_DATA.articles; // [ticker, titre Wikipédia, nom affiché, catégorie]
const NDAYS=window.WIKI_DATA.views[META[0][1]].length;
const END=NDAYS-1, START=Math.max(1,END-30); // les 30 dernières séances des données
const CAP0=10000, SALARY=500, BK_LIMIT=2000, MARGIN=.93;
const T=510, BASE_MS=250, D0=new Date(window.WIKI_DATA.start+"T00:00:00");
const STOCKS=META.map(([tk,slug,name,sector])=>{const views=RAW[slug];return {tk,slug,name,sector,views,px:views.map(v=>Math.round(Math.sqrt(Math.max(v,1))*50)/100)}});
const BY=Object.fromEntries(STOCKS.map(s=>[s.tk,s]));
const SECTORS=["Tout",...new Set(STOCKS.map(s=>s.sector))];

/* ===================== Outils ===================== */
const nf0=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});
const W=v=>nf0.format(Math.round(v))+" W";
const pct=v=>(v>0?"+":v<0?"−":"")+nf2.format(Math.abs(v*100))+" %";
const cls=v=>v>1e-9?"up":v<-1e-9?"down":"flat";
const dateOf=i=>{const d=new Date(D0);d.setDate(d.getDate()+i);return d};
const fmtDate=(i,long)=>dateOf(i).toLocaleDateString("fr-FR",long?{weekday:"long",day:"numeric",month:"long"}:{day:"numeric",month:"short"});
const hhmm=t=>{const m=540+t;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")};
const hashStr=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const rngOf=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const gauss=r=>{let u=0,v=0;while(!u)u=r();while(!v)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
const $=id=>document.getElementById(id);
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
const oddsFmt=o=>nf2.format(o);

/* ===================== Moteur de marché =====================
   Clôtures réelles (√vues ÷ 2). Entre deux clôtures : pont brownien déterministe avec un choc
   quand la vraie variation du jour est forte. */
const pathCache=new Map();
function histVol(s,d){let a=0,n=0;for(let i=Math.max(1,d-20);i<=d;i++){const r=Math.log(s.px[i]/s.px[i-1]);a+=r*r;n++}return Math.sqrt(a/Math.max(1,n))}
function pathOf(tk,d){
  const key=tk+d; if(pathCache.has(key))return pathCache.get(key);
  const s=BY[tk], o=Math.log(s.px[d]), c=Math.log(s.px[Math.min(d+1,s.px.length-1)]), mv=c-o, r=rngOf(hashStr(tk)+d*9973);
  const step=Math.min(.6,Math.max(.03,histVol(s,d)*.55))/Math.sqrt(T)*1.6;
  const w=new Float64Array(T+1); for(let i=1;i<=T;i++)w[i]=w[i-1]+step*gauss(r)*(i<30||i>T-30?1.5:1);
  const big=Math.abs(mv)>.25, j=Math.floor((.12+.7*r())*T), jl=3+Math.floor(r()*8), p=new Float64Array(T+1);
  for(let i=0;i<=T;i++){const lin=big?.25*mv*i/T+(i>=j?.75*mv*Math.min(1,(i-j+1)/jl):0):mv*i/T;p[i]=o+lin+w[i]-(i/T)*w[T]}
  pathCache.set(key,p); return p;
}

/* ===================== État ===================== */
const SAVE_KEY="wikibourse-save-v3-"+window.WIKI_DATA.end; // nouvelle sauvegarde quand les données changent
const BOTS=[
  {name:"Le Prudent",style:"Ne joue que les favoris",mu:.02,sd:.05},
  {name:"La Risque-tout",style:"Combinés à cinq sélections",mu:-.04,sd:.55},
  {name:"Madame Statistique",style:"Suit les tendances sur 7 jours",mu:.035,sd:.12},
  {name:"Le Superstitieux",style:"Parie toujours sur la baisse",mu:-.01,sd:.18},
  {name:"Le Chat",style:"Choisit au hasard",mu:0,sd:.22}
];
const freshState=()=>({day:START,cash:CAP0,bk:0,ref:"WB-"+Math.random().toString(36).slice(2,6).toUpperCase(),won:0,lost:0,streak:0,bestStreak:0,best:null,pending:0,bots:BOTS.map(()=>({v:CAP0,bk:0})),history:[],curve:[{d:START,v:Array(BOTS.length+1).fill(CAP0)}]});
const curvePoint=()=>({d:S.day,v:[S.cash,...S.bots.map(b=>b.v)]});
let S=null, L=null;
let ui={view:"direct",h:"15",lev:5,sector:"Tout",speed:1,mode:"simple",stake:500,sheet:null,detail:null};
let coupon=[]; // sélections
function load(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY));if(s&&typeof s.day==="number")return s}catch(e){}return null}
function save(){try{S.pending=openStake();localStorage.setItem(SAVE_KEY,JSON.stringify(S))}catch(e){}}

function newSession(){L={d:S.day,t:0,phase:S.day>=END?"over":"pre",bets:[],timer:null,startCash:S.cash,duels:makeDuels(S.day)}}
const price=(tk,t=L.t)=>L.phase==="done"?BY[tk].px[L.d+1]:Math.exp(pathOf(tk,L.d)[Math.min(t,T)]);
const prevClose=tk=>BY[tk].px[L.d];
const dayChg=tk=>price(tk)/prevClose(tk)-1;
const openStake=()=>L?L.bets.filter(b=>b.status==="open").reduce((a,b)=>a+b.stake,0):0;
const isClosed=()=>!L||L.phase==="done"||L.phase==="over";

/* ===================== Positions =====================
   « Monte » et « Baisse » sont des positions comme en trading : la valeur suit la variation du cours
   depuis l'entrée, multipliée par le levier. Liquidée quand la mise est perdue. Les duels gardent des cotes. */
const LEVS=[1,5,10];
const tradeValue=(b,px=price(b.tk))=>Math.max(0,b.stake*(1+b.lev*(b.dir==="up"?1:-1)*(px/b.entry-1)));
const toOdds=p=>Math.max(1.08,Math.round(MARGIN/p*100)/100);
function endTick(h,t=L.t){return h==="close"?T:Math.min(T,t+ +h)}
const hLabel=h=>h==="close"?"à 17 h 30":h==="60"?"dans 1 h":"dans 15 min";

/* Duels : deux articles d'audience proche, réglés sur les vraies vues du jour */
function makeDuels(d){
  if(d>=END)return [];
  const r=rngOf(9001+d*31), pool=[...STOCKS].sort(()=>r()-.5), used=new Set(), out=[];
  for(const a of pool){
    if(used.has(a.tk)||out.length>=4)continue;
    let best=null,bd=1e9;
    for(const b of pool){if(b===a||used.has(b.tk))continue;const q=Math.abs(Math.log(a.views[d]/b.views[d]));if(q<bd){bd=q;best=b}}
    if(best&&bd<Math.log(3)){used.add(a.tk);used.add(best.tk);
      const wa=Math.pow(a.views[d],.85), wb=Math.pow(best.views[d],.85), pa=wa/(wa+wb);
      out.push({id:"D"+d+a.tk+best.tk,a:a.tk,b:best.tk,oa:toOdds(pa),ob:toOdds(1-pa),boost:false});
    }
  }
  if(out.length){const x=out[0];if(x.oa>x.ob){x.boostSide="a";x.base=x.oa;x.oa=Math.round(x.oa*1.4*100)/100}else{x.boostSide="b";x.base=x.ob;x.ob=Math.round(x.ob*1.4*100)/100}x.boost=true}
  return out;
}

/* ===================== Coupon & paris ===================== */
const selKey=s=>s.kind==="live"?`L:${s.tk}:${s.h}`:`D:${s.id}`;
function selOdds(s){if(s.kind==="live")return null;const d=L.duels.find(x=>x.id===s.id);return s.side==="a"?d.oa:d.ob}
function selLabel(s){if(s.kind==="live")return {t:`${BY[s.tk].name} ${s.dir==="up"?"monte":"baisse"}`,sub:hLabel(s.h)};const d=L.duels.find(x=>x.id===s.id);const w=s.side==="a"?d.a:d.b,o=s.side==="a"?d.b:d.a;return {t:`${BY[w].name} bat ${BY[o].name}`,sub:"duel · vues du jour"}}
function toggleSel(s){
  const k=selKey(s), i=coupon.findIndex(x=>selKey(x)===k);
  if(i>=0&&coupon[i].dir===s.dir&&coupon[i].side===s.side){coupon.splice(i,1)}
  else if(i>=0){coupon[i]=s}
  else{coupon.push(s);s.added=selOdds(s)}
  if(!canCombo())ui.mode="simple";
  renderSlip(); updateFeed(); renderDuels(); renderBoost();
}
const canCombo=()=>coupon.length>1&&coupon.every(s=>s.kind==="duel"); // le combiné ne prend que des duels
function couponOdds(){return ui.mode==="combo"?coupon.reduce((a,s)=>a*selOdds(s),1):null}
function totalStake(){return ui.mode==="combo"?ui.stake:ui.stake*coupon.length}
const potentialGain=()=>ui.mode==="combo"?ui.stake*couponOdds():coupon.filter(s=>s.kind==="duel").reduce((a,s)=>a+ui.stake*selOdds(s),0);
function placeBets(){
  if(!coupon.length||isClosed())return;
  const st=totalStake(); if(st<=0||st>S.cash)return;
  const mk=s=>({id:s.id,side:s.side,odds:selOdds(s),end:T,status:"open",label:selLabel(s)});
  if(ui.mode==="combo"){const legs=coupon.map(mk);L.bets.push({id:Date.now(),mode:"combo",stake:ui.stake,odds:legs.reduce((a,l)=>a*l.odds,1),legs,status:"open",placed:L.t})}
  else coupon.forEach((s,i)=>{const id=Date.now()+i;
    if(s.kind==="live")L.bets.push({id,mode:"trade",tk:s.tk,dir:s.dir,lev:ui.lev,stake:ui.stake,entry:price(s.tk),start:L.t,end:endTick(s.h),status:"open",label:selLabel(s)});
    else{const l=mk(s);L.bets.push({id,mode:"simple",stake:ui.stake,odds:l.odds,legs:[l],status:"open",placed:L.t})}});
  const wasCombo=ui.mode==="combo", n=coupon.length, trade=coupon[0].kind==="live";
  S.cash-=st; coupon=[]; ui.mode="simple";
  save(); closeSheet(); toast(`${wasCombo?`Combiné de ${n} validé`:n>1?`${n} paris validés`:trade?`Position ×${ui.lev} ouverte`:"Pari validé"} · ${W(st)}`);
  renderAll();
}
// g = somme rendue au joueur (mise comprise)
function finish(b,won,g){
  b.status=won?"won":"lost"; b.gain=g; S.cash+=g; S.history.push({won,odds:g/b.stake,stake:b.stake});
  if(!won){S.lost++;S.streak=0;return}
  S.won++; S.streak++; S.bestStreak=Math.max(S.bestStreak,S.streak); pulseWallet();
  if(!S.best||g/b.stake>S.best.odds)S.best={odds:g/b.stake,gain:g,label:b.mode==="combo"?`combiné de ${b.legs.length}`:(b.label||b.legs[0].label).t};
}
function closeTrade(b){
  b.exit=price(b.tk); b.closedAt=L.t; const g=tradeValue(b,b.exit), net=g-b.stake;
  finish(b,net>0,g);
  toast(g<=0?`Liquidé · ${b.label.t}`:`${net>=0?"+":"−"}${W(Math.abs(net))} (${pct(net/b.stake)}) · ${b.label.t}`,net>0);
}
function settle(){
  for(const b of L.bets){
    if(b.status!=="open")continue;
    if(b.mode==="trade"){if(L.t>=b.end||tradeValue(b)<=0)closeTrade(b);continue}
    for(const l of b.legs){
      if(l.status!=="open"||L.t<l.end)continue;
      const d=L.duels.find(x=>x.id===l.id),va=BY[d.a].views[L.d+1],vb=BY[d.b].views[L.d+1];l.va=va;l.vb=vb;l.status=((va>vb)===(l.side==="a"))?"won":"lost";
    }
    if(b.legs.some(l=>l.status==="lost")){finish(b,false,0);toast(`Perdu · ${b.legs.length>1?"combiné":b.legs[0].label.t}`)}
    else if(b.legs.every(l=>l.status==="won")){const g=b.stake*b.odds;finish(b,true,g);toast(`Gagné ! +${W(g)}${S.streak>1?` · série ×${S.streak}`:""}`,true)}
  }
}

/* ===================== Séance ===================== */
function tick(){
  if(!L||L.phase!=="open")return;
  L.t=Math.min(T,L.t+1); settle(); renderLive();
  if(L.t>=T)endSession();
}
function startTimer(){clearInterval(L.timer);L.timer=setInterval(tick,BASE_MS/ui.speed)}
function kickoff(){
  if(!L||L.phase!=="pre")return; L.phase="countdown"; renderSession();
  let n=3; const c=$("count"); c.hidden=false;
  const step=()=>{if(n>0){$("countTxt").innerHTML=`${n}<small>coup d'envoi</small>`;n--;setTimeout(step,reduced?150:600)}else{c.hidden=true;L.phase="open";startTimer();renderAll()}};step();
}
function endSession(){
  clearInterval(L.timer); settle(); L.phase="done";
  const net=S.cash-L.startCash, settled=L.bets.filter(b=>b.status!=="open");
  // bots
  const r=rngOf(777+L.d*13);
  S.bots.forEach((b,i)=>{const B=BOTS[i];b.v=Math.max(0,b.v*(1+B.mu+B.sd*gauss(r)))+SALARY;if(b.v<BK_LIMIT){b.v=CAP0;b.bk++}});
  S.cash+=SALARY; S.day=L.d+1; S.curve.push(curvePoint()); save();
  const rank=standings().findIndex(p=>p.me)+1;
  const movers=STOCKS.map(s=>({s,c:s.px[L.d+1]/s.px[L.d]-1})).sort((a,b)=>b.c-a.c);
  const won=settled.filter(b=>b.status==="won").length, lost=settled.filter(b=>b.status==="lost").length;
  renderAll();
  openSheet(`<div class="grab"></div><h2>Coup de sifflet final</h2><p style="margin-top:6px">${fmtDate(L.d+1,true)}</p>
   <div style="margin-top:12px">
    <div class="row"><span>Bilan des paris</span><b class="${cls(net)}">${net>=0?"+":"−"}${W(Math.abs(net))}</b></div>
    <div class="row"><span>Paris gagnés / perdus</span><b>${won} / ${lost}</b></div>
    <div class="row"><span>Salaire de séance</span><b class="up">+${W(SALARY)}</b></div>
    <div class="row"><span>Solde</span><b>${W(S.cash)}</b></div>
    <div class="row"><span>Rang dans la ligue</span><b>${rank}ᵉ sur ${BOTS.length+1}</b></div>
    ${L.duels.map(d=>{const va=BY[d.a].views[L.d+1],vb=BY[d.b].views[L.d+1];return `<div class="row"><span>${BY[d.a].name} – ${BY[d.b].name}</span><b>${nf0.format(va)} – ${nf0.format(vb)} vues</b></div>`}).join("")}
    <div class="row"><span>Plus forte hausse</span><b class="up">${movers[0].s.name} ${pct(movers[0].c)}</b></div>
    <div class="row"><span>Plus forte baisse</span><b class="down">${movers[movers.length-1].s.name} ${pct(movers[movers.length-1].c)}</b></div>
   </div>
   <div class="sheet-f">${S.day>=END?`<button class="btn btn-y" type="button" data-act="final">Voir le classement final</button>`:`<button class="btn btn-y" type="button" data-act="next">Séance suivante</button>`}</div>`,true);
}
function nextSession(){closeSheet(true);coupon=[];newSession();renderAll();window.scrollTo({top:0,behavior:reduced?"auto":"smooth"})}

/* ===================== Ligue ===================== */
function standings(){
  const me={name:"Toi",style:S.bk?`${S.bk} faillite${S.bk>1?"s":""}`:`${S.won} paris gagnés`,v:S.cash+openStake(),me:true};
  return [me,...S.bots.map((b,i)=>({name:BOTS[i].name,style:BOTS[i].style+(b.bk?` · ${b.bk} faillite${b.bk>1?"s":""}`:""),v:b.v}))].sort((a,b)=>b.v-a.v);
}

/* ===================== Rendu ===================== */
const ICONS={
  direct:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8 3 4"/></svg>',
  duels:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l7 7M19 4l-7 7M4 15l5 5M20 15l-5 5M8 18l8-8M16 18l-8-8"/></svg>',
  bets:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  league:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>'
};
const TABS=[["direct","Direct"],["duels","Duels"],["bets","Mes paris"],["league","Ligue"]];
function renderTabs(){
  const open=L?L.bets.filter(b=>b.status==="open").length:0;
  const html=TABS.map(([k,l])=>`<button type="button" class="tab" data-view="${k}" aria-selected="${ui.view===k}">${ICONS[k]}<span>${l}</span>${k==="bets"&&open?`<span class="badge">${open}</span>`:""}</button>`).join("");
  $("tabbar").innerHTML=html; $("navSide").innerHTML=html;
  TABS.forEach(([k])=>$("view-"+k).hidden=ui.view!==k);
}
function renderSession(){
  const ph=L.phase;
  $("clock").textContent=ph==="done"||ph==="over"?"17:30":hhmm(L.t);
  const on=ph==="open"; $("liveBadge").className="live-badge"+(on?" on":"");
  $("liveTxt").textContent=on?(L.t>T-45?"Dernières minutes":"En direct"):ph==="done"||ph==="over"?"Terminé":"Avant-match";
  const n=Math.min(30,L.d-START+1);
  $("sessSub").textContent=ph==="over"?"Les 30 séances sont jouées":`Séance ${n} sur 30 · ${fmtDate(L.d+1,true)}`;
  $("prog").style.width=(L.t/T*100)+"%";
  const kick=$("kick"); kick.hidden=on||ph==="countdown";
  kick.textContent=ph==="pre"?"Coup d'envoi":ph==="over"?"Classement final":"Séance suivante";
  $("speed").hidden=!on;
  $("cash").textContent=nf0.format(Math.round(S.cash));
}
function renderSectors(){$("sectors").innerHTML=SECTORS.map(s=>`<button type="button" class="pill" data-sec="${s}" aria-pressed="${ui.sector===s}">${s}</button>`).join("")}
function sparkVals(tk){
  if(L.t>2){const P=pathOf(tk,L.d),n=L.t,step=Math.max(1,Math.floor(n/60)),a=[];for(let i=0;i<=n;i+=step)a.push(Math.exp(P[i]));a.push(Math.exp(P[n]));return a}
  return BY[tk].px.slice(Math.max(0,L.d-20),L.d+1);
}
function sparkSVG(vals,w=300,h=38){
  const mn=Math.min(...vals),mx=Math.max(...vals),r=mx-mn||1,pad=3;
  const pts=vals.map((v,i)=>[pad+i*(w-2*pad)/Math.max(1,vals.length-1),h-pad-(v-mn)/r*(h-2*pad)]);
  const line=pts.map((p,i)=>`${i?"L":"M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return {line,area:line+`L${pts[pts.length-1][0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`,end:pts[pts.length-1]};
}
const isHot=tk=>L.t>15&&Math.abs(price(tk)/price(tk,L.t-15)-1)>.08;
function cardHTML(s){
  return `<article class="card" data-card="${s.tk}">
    <button type="button" class="card-top" data-detail="${s.tk}">
      <span class="name"><span>${s.name}</span><span class="hot" hidden>En feu</span><span class="status mypos" hidden></span></span><span class="px"></span>
      <span class="meta"><span>${s.sector}</span><span class="vw"></span></span><span class="chg"></span>
    </button>
    <svg class="spark" viewBox="0 0 300 38" preserveAspectRatio="none" aria-hidden="true"><path class="ar" stroke="none"/><path class="ln" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
    <div class="odds">
      <button type="button" class="odd" data-bet="${s.tk}" data-dir="up"><span>▲ Monte</span><b></b></button>
      <button type="button" class="odd" data-bet="${s.tk}" data-dir="down"><span>▼ Baisse</span><b></b></button>
    </div></article>`;
}
let lastPx={};
function renderFeed(){
  const list=STOCKS.filter(s=>ui.sector==="Tout"||s.sector===ui.sector).sort((a,b)=>!!myPos(b.tk)-!!myPos(a.tk)||Math.abs(dayChg(b.tk))-Math.abs(dayChg(a.tk)));
  $("feed").innerHTML=list.map(cardHTML).join(""); $("liveCount").textContent=`${list.length} article${list.length>1?"s":""}`;
  updateFeed();
}
function updateFeed(){
  const closed=isClosed();
  document.querySelectorAll("#feed .card").forEach(card=>{
    const tk=card.dataset.card, s=BY[tk], p=price(tk), c=dayChg(tk), pe=card.querySelector(".px");
    if(lastPx[tk]&&Math.abs(p/lastPx[tk]-1)>.006){pe.classList.remove("f-up","f-down");void pe.offsetWidth;pe.classList.add(p>lastPx[tk]?"f-up":"f-down");clearTimeout(pe._t);pe._t=setTimeout(()=>pe.classList.remove("f-up","f-down"),400)}
    lastPx[tk]=p; pe.textContent=nf2.format(p)+" W";
    const ce=card.querySelector(".chg"); ce.className="chg "+cls(c); ce.textContent=(c>0?"▲ ":c<0?"▼ ":"")+pct(c);
    card.querySelector(".vw").textContent=`${nf0.format(s.views[L.d])} vues hier`;
    card.querySelector(".hot").hidden=!isHot(tk);
    const pos=myPos(tk), mp=card.querySelector(".mypos"); card.classList.toggle("mine",!!pos); mp.hidden=!pos;
    if(pos){const net=tradeValue(pos)-pos.stake;mp.className="status mypos "+(net>=0?"win":"lose");mp.textContent=`toi ${net>=0?"+":"−"}${W(Math.abs(net))}`}
    const sp=sparkSVG(sparkVals(tk)), col=c>=0?"var(--up)":"var(--down)";
    const ln=card.querySelector(".ln"), ar=card.querySelector(".ar");
    ln.setAttribute("d",sp.line); ln.setAttribute("stroke",col); ar.setAttribute("d",sp.area); ar.setAttribute("fill",c>=0?"var(--up-soft)":"var(--down-soft)");
    card.querySelectorAll(".odd").forEach(b=>{
      b.querySelector("b").textContent="×"+ui.lev;
      b.setAttribute("aria-pressed",coupon.some(x=>x.kind==="live"&&x.tk===tk&&x.h===ui.h&&x.dir===b.dataset.dir));
      b.disabled=closed;
    });
  });
}
function duelHTML(d,big){
  const A=BY[d.a],B=BY[d.b], selA=coupon.some(x=>x.id===d.id&&x.side==="a"), selB=coupon.some(x=>x.id===d.id&&x.side==="b"), closed=isClosed();
  const res=L.phase==="done"?[A.views[L.d+1],B.views[L.d+1]]:null;
  return `<div class="duel">
    <div class="side"><span class="who">${A.name}</span><span class="views">${res?`${nf0.format(res[0])} vues aujourd'hui`:`${nf0.format(A.views[L.d])} vues hier`}</span>
      <button type="button" class="odd" data-duel="${d.id}" data-side="a" aria-pressed="${selA}" ${closed?"disabled":""}><span>Gagne</span><b>${d.boost&&d.boostSide==="a"?`<s>${oddsFmt(d.base)}</s>`:""}${oddsFmt(d.oa)}</b></button></div>
    <span class="vs">vs</span>
    <div class="side r"><span class="who">${B.name}</span><span class="views">${res?`${nf0.format(res[1])} vues aujourd'hui`:`${nf0.format(B.views[L.d])} vues hier`}</span>
      <button type="button" class="odd" data-duel="${d.id}" data-side="b" aria-pressed="${selB}" ${closed?"disabled":""}><span>Gagne</span><b>${d.boost&&d.boostSide==="b"?`<s>${oddsFmt(d.base)}</s>`:""}${oddsFmt(d.ob)}</b></button></div>
  </div>`;
}
function renderBoost(){
  const d=L.duels.find(x=>x.boost);
  $("boostWrap").innerHTML=d?`<div class="boost"><div class="boost-in"><div class="boost-h"><strong>Cote boostée</strong><span>Duel réglé à 17 h 30</span></div>${duelHTML(d)}</div></div>`:"";
}
function renderDuels(){
  $("duels").innerHTML=L.duels.length?L.duels.map(d=>`<div class="card duel-card">${duelHTML(d)}${d.boost?`<p class="note">Cote boostée de 40 % sur l'outsider.</p>`:""}</div>`).join(""):`<div class="empty"><b>Pas de duel</b>Les 30 séances sont terminées.</div>`;
}
function renderBets(){
  const all=L?[...L.bets].reverse():[];
  $("betStats").textContent=`${S.won} gagnés · ${S.lost} perdus${S.streak>1?` · série ×${S.streak}`:""}`;
  if(!all.length){$("bets").innerHTML=`<div class="empty"><b>Aucun pari sur cette séance</b>Touche une cote dans Direct ou Duels pour l'ajouter au coupon.</div>`;return}
  $("bets").innerHTML=all.map(b=>{
    if(b.mode==="trade")return tradeHTML(b);
    const st=b.status==="won"?`<span class="status paid">Payé ${W(b.gain)}</span>`:b.status==="lost"?`<span class="status lose">Perdu</span>`:`<span class="status open">En cours</span>`;
    const legs=b.legs.map(l=>{
      let state="";
      state=l.status==="open"?`<span class="status open">Résultat à 17 h 30</span>`:`<span class="status ${l.status==="won"?"win":"lose"}">${l.status==="won"?"Gagné":"Perdu"}</span>`;
      return `<div class="leg"><span>${l.label.t}</span>${state}<small>${l.status==="open"?"duel · vues du jour":`${nf0.format(l.va)} – ${nf0.format(l.vb)} vues`}</small><small style="text-align:right">cote ${oddsFmt(l.odds)}</small>${duelChart(l)}</div>`;
    }).join("");
    return `<div class="bet ${b.status==="won"?"won":""}"><div class="bet-h"><strong>${b.mode==="combo"?`Combiné · ${b.legs.length} sélections`:"Pari simple"}</strong>${st}</div>${legs}
      <div class="bet-f"><span>Mise ${W(b.stake)} · cote ${oddsFmt(b.odds)}</span><span>Gain potentiel <b>${W(b.stake*b.odds)}</b></span></div></div>`;
  }).join("");
}
/* Mini-graphiques de Mes paris. Position : le cours de l'ouverture à l'échéance, la ligne pointillée est
   le cours d'entrée, la zone colorée le gain ou la perte. Duel : les vues des deux articles sur 7 jours. */
const bdot=(x,y,col)=>`<span class="bd" style="left:${x}%;top:${y/70*100}%;background:${col}"></span>`;
const pathD=pts=>pts.map(([x,y],k)=>`${k?"L":"M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
function tradeChart(b,pre=""){
  const P=pathOf(b.tk,L.d), a=b.start, z=b.end, open=b.status==="open", n=Math.max(a,Math.min(z,open?L.t:b.closedAt??L.t));
  const v=[];for(let i=a;i<=n;i++)v.push(Math.exp(P[i]));
  const mn=Math.min(b.entry,...v), r=(Math.max(b.entry,...v)-mn)||b.entry*.01;
  const X=i=>(i-a)/Math.max(1,z-a)*100, Y=p=>10+(1-(p-mn)/r)*50, ye=Y(b.entry);
  const last=v[v.length-1], win=(b.dir==="up"?1:-1)*(last-b.entry)>=0, col=win?"var(--up)":"var(--down)";
  const line=pathD(v.map((p,k)=>[X(a+k),Y(p)])), area=`${line}L${X(n).toFixed(2)},${ye.toFixed(2)}L0,${ye.toFixed(2)}Z`;
  const [over,under]=b.dir==="up"?["var(--up-soft)","var(--down-soft)"]:["var(--down-soft)","var(--up-soft)"]; // au-dessus de l'entrée : gagnant si on joue la hausse
  return `<div class="bchart"><svg viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      <clipPath id="${pre}ca${b.id}"><rect x="0" y="0" width="100" height="${ye}"/></clipPath><clipPath id="${pre}cb${b.id}"><rect x="0" y="${ye}" width="100" height="${70-ye}"/></clipPath>
      <path d="${area}" fill="${over}" clip-path="url(#${pre}ca${b.id})"/><path d="${area}" fill="${under}" clip-path="url(#${pre}cb${b.id})"/>
      <line x1="0" x2="100" y1="${ye}" y2="${ye}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>${bdot(0,ye,"var(--muted)")}${bdot(X(n),Y(last),col)}</div>
    <div class="bx"><span>ouverte ${hhmm(a)}</span><span class="be">entrée ${nf2.format(b.entry)} W</span><span>${open?"fin":"échéance"} ${hhmm(z)}</span></div>`;
}
function duelChart(l){
  const d=L.duels.find(x=>x.id===l.id), A=BY[d.a], B=BY[d.b], i0=Math.max(0,L.d-6), i1=l.status==="open"?L.d:L.d+1;
  const days=[];for(let i=i0;i<=i1;i++)days.push(i);
  const all=days.flatMap(i=>[A.views[i],B.views[i]]), mn=Math.min(...all), r=(Math.max(...all)-mn)||1;
  const X=i=>(i-i0)/Math.max(1,L.d+1-i0)*100, Y=v=>10+(1-(v-mn)/r)*50; // la place du jour du duel reste visible
  const side=(s,col)=>`<path d="${pathD(days.map(i=>[X(i),Y(s.views[i])]))}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return `<div class="blg"><span><i style="background:var(--yellow)"></i>${A.name}</span><span><i style="background:var(--violet)"></i>${B.name}</span></div>
    <div class="bchart"><svg viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${X(L.d+1)}" x2="${X(L.d+1)}" y1="4" y2="66" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      ${side(A,"var(--yellow)")}${side(B,"var(--violet)")}
    </svg>${bdot(X(i1),Y(A.views[i1]),"var(--yellow)")}${bdot(X(i1),Y(B.views[i1]),"var(--violet)")}</div>
    <div class="bx"><span>vues du ${fmtDate(i0)}</span><span>${l.status==="open"?"résultat":"jour du duel"} : ${fmtDate(L.d+1)}</span></div>`;
}
/* Mes paris en direct : en tête de l'onglet Direct, mis à jour à chaque minute de jeu */
const myPos=tk=>L.bets.find(b=>b.status==="open"&&b.mode==="trade"&&b.tk===tk);
function liveBetCard(b){
  if(b.mode==="trade"){const val=tradeValue(b),net=val-b.stake;
    return `<div class="lcard"><div class="lc-h"><b>${b.label.t} ×${b.lev}</b><span class="status ${net>=0?"win":"lose"}">${net>=0?"+":"−"}${W(Math.abs(net))} · ${pct(net/b.stake)}</span></div>
      ${tradeChart(b,"s")}<button type="button" class="btn btn-y" data-cashout="${b.id}">Encaisser ${W(val)}</button></div>`}
  const combo=b.mode==="combo";
  return `<div class="lcard"><div class="lc-h"><b>${combo?`Combiné · ${b.legs.length} duels`:b.legs[0].label.t}</b><span class="status open">17 h 30</span></div>
    ${combo?b.legs.map(l=>`<small class="lc-l">${l.label.t} · cote ${oddsFmt(l.odds)}</small>`).join(""):duelChart(b.legs[0])}
    <div class="lc-f"><span>Mise ${W(b.stake)}</span><span>Gain potentiel <b>${W(b.stake*b.odds)}</b></span></div></div>`;
}
function renderLiveBets(){
  const box=$("liveBets"), open=L?L.bets.filter(b=>b.status==="open").reverse().sort((a,b)=>(b.mode==="trade")-(a.mode==="trade")):[]; // positions d'abord, les plus récentes en tête
  if(!open.length){box.innerHTML="";return}
  const keep=box.querySelector(".lb-strip")?.scrollLeft||0;
  box.innerHTML=`<div class="sec-title"><h2>Mes paris en direct</h2><span>${open.length} en cours</span></div><div class="lb-strip">${open.map(liveBetCard).join("")}</div>`;
  box.querySelector(".lb-strip").scrollLeft=keep;
}
function tradeHTML(b){
  const open=b.status==="open", px=open?price(b.tk):b.exit, val=open?tradeValue(b):b.gain||0, net=val-b.stake;
  const res=`${net>=0?"+":"−"}${W(Math.abs(net))} · ${pct(net/b.stake)}`;
  const st=open?`<span class="status ${net>=0?"win":"lose"}">${res}</span>`:px===undefined?`<span class="status lose">Perdu</span>`:val<=0?`<span class="status lose">Liquidé</span>`:`<span class="status ${net>0?"paid":"lose"}">${res}</span>`;
  return `<div class="bet ${b.status==="won"?"won":""}"><div class="bet-h"><strong>${b.label.t} · ×${b.lev}</strong>${st}</div>
    <div class="leg"><span>Entrée ${nf2.format(b.entry)} W${px===undefined?"":` · ${open?"actuel":"sortie"} ${nf2.format(px)} W`}</span>${px===undefined?"":`<span class="${cls(px/b.entry-1)}">${pct(px/b.entry-1)}</span>`}
      <small>${b.label.sub}${open?` · fin ${hhmm(b.end)}`:""}</small>${tradeChart(b)}${open?`<span class="lb"><i style="width:${Math.min(100,(L.t-b.start)/Math.max(1,b.end-b.start)*100)}%"></i></span>`:""}</div>
    <div class="bet-f"><span>Mise ${W(b.stake)} · levier ×${b.lev}</span><span>Valeur <b>${W(val)}</b></span></div>
    ${open&&!isClosed()?`<button type="button" class="btn btn-y" data-cashout="${b.id}">Encaisser ${W(val)}</button>`:""}</div>`;
}
function renderLeague(){
  $("league").innerHTML=standings().map((p,i)=>{const g=p.v/CAP0-1;return `<div class="lrow ${p.me?"me":""}"><span class="rk">${i+1}</span><span style="min-width:0"><b>${p.name}</b><small>${p.style}</small></span><span class="val">${W(p.v)}<small class="${cls(g)}" style="display:block;font-size:12.5px">${pct(g)}</small></span></div>`}).join("");
  $("bkCount").textContent=`${S.bk} faillite${S.bk>1?"s":""} au compteur`;
  $("btnBk").disabled=S.cash+openStake()>=BK_LIMIT; $("refCode").textContent=S.ref;
}
function slipHTML(inSheet){
  if(!coupon.length)return `<div class="slip"><div class="slip-h"><h3>Coupon</h3></div><div class="empty" style="padding:20px 0"><b>Coupon vide</b>Touche une cote pour l'ajouter.</div></div>`;
  const combo=ui.mode==="combo", co=couponOdds(), st=totalStake(), closed=isClosed(), trades=coupon.some(s=>s.kind==="live"), duels=coupon.some(s=>s.kind==="duel");
  const note=closed?"La séance est terminée.":st>S.cash?`Solde insuffisant : il te manque ${W(st-S.cash)}.`:L.phase==="pre"&&trades?"Avant-match : tes positions partent du cours d'ouverture.":combo?"Combiné : tous les duels doivent passer.":trades?`Ta position est liquidée si le cours part de ${nf0.format(100/ui.lev)} % dans le mauvais sens.`:"";
  return `<div class="slip">
    <div class="slip-h"><h3>Coupon</h3><button type="button" class="btn" data-act="clear">Vider</button></div>
    <div class="seg" role="group" aria-label="Type de pari"><button type="button" data-mode="simple" aria-pressed="${!combo}">Simple</button><button type="button" data-mode="combo" aria-pressed="${combo}" ${canCombo()?"":"disabled"}>Combiné</button></div>
    ${trades?`<div class="seg seg3" role="group" aria-label="Levier">${LEVS.map(v=>`<button type="button" data-lev="${v}" aria-pressed="${ui.lev===v}">Levier ×${v}</button>`).join("")}</div>`:""}
    ${coupon.map((s,i)=>{const lb=selLabel(s),o=selOdds(s),ch=s.added&&Math.abs(o-s.added)>=.05;return `<div class="sel"><b>${lb.t}</b><span class="o">${s.kind==="live"?"×"+ui.lev:oddsFmt(o)}${ch?`<em>cote modifiée</em>`:""}</span><button type="button" class="x" data-rm="${i}" aria-label="Retirer">×</button><small>${lb.sub}</small></div>`}).join("")}
    <div class="stake"><label for="${inSheet?"stakeM":"stakeD"}">Mise${combo?"":" par pari"}</label><input id="${inSheet?"stakeM":"stakeD"}" data-stake type="number" inputmode="numeric" min="0" step="50" value="${ui.stake}"></div>
    <div class="chips"><button type="button" data-chip="100">100</button><button type="button" data-chip="500">500</button><button type="button" data-chip="1000">1 000</button><button type="button" data-chip="max">Max</button></div>
    ${combo?`<div class="gain"><span>Cote totale</span><b style="font-size:22px;color:var(--ink)">${oddsFmt(co)}</b></div>`:""}
    ${duels?`<div class="gain g-duel"><span>Gain potentiel${trades?" des duels":""}</span><b>${W(potentialGain())}</b></div>`:""}
    ${trades?`<div class="gain g-trade"><span>Par 1 % de variation</span><b>±${W(ui.stake*ui.lev/100)}</b></div>`:""}
    <p class="slip-note">${note}</p>
    <button type="button" class="slip-go" data-act="place" ${closed||st<=0||st>S.cash?"disabled":""}>Parier ${W(st)}</button>
  </div>`;
}
function renderSlip(){
  if(document.activeElement?.dataset?.stake===undefined)$("slipSide").innerHTML=slipHTML(false);
  const bar=$("slipbar"); bar.hidden=!coupon.length||ui.sheet==="slip";
  $("slipN").textContent=coupon.length;
  $("slipO").textContent=coupon.length>1&&ui.mode==="combo"?`Cote ${oddsFmt(couponOdds())}`:coupon.length===1?(coupon[0].kind==="live"?`Levier ×${ui.lev}`:`Cote ${oddsFmt(selOdds(coupon[0]))}`):`${coupon.length} paris`;
  if(ui.sheet==="slip"&&document.activeElement?.dataset?.stake===undefined)$("sheet").innerHTML=`<div class="grab"></div>`+slipHTML(true);
}

/* Courbe de la saison : ton solde en jaune, les bots en gris, un point par clôture */
function renderCurve(id){
  const box=$(id); if(!box||!box.offsetWidth)return;
  const C=S.curve, names=["Toi",...BOTS.map(b=>b.name)];
  if(C.length<2){box.innerHTML=`<p class="curve-empty">La courbe démarre au premier coup de sifflet final.</p>`;return}
  const Wd=box.clientWidth-28, Hd=180, pr=56, pt=12, pb=22, w=Wd-pr, h=Hd-pt-pb;
  let mn=Math.min(...C.flatMap(c=>c.v)), mx=Math.max(...C.flatMap(c=>c.v));
  const raw=(mx-mn||1000)/3, mag=10**Math.floor(Math.log10(raw)), st=[1,2,2.5,5,10].map(m=>m*mag).find(x=>x>=raw);
  mn=Math.floor(mn/st)*st; mx=Math.max(mn+st,Math.ceil(mx/st)*st);
  const X=i=>i*w/(C.length-1), Y=v=>pt+h-(v-mn)/(mx-mn)*h;
  const line=k=>C.map((c,i)=>`${i?"L":"M"}${X(i).toFixed(1)},${Y(c.v[k]).toFixed(1)}`).join("");
  let grid="";
  for(let v=mn;v<=mx+1e-6;v+=st)grid+=`<line class="grid" x1="0" x2="${w}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${w+8}" y="${Y(v)}">${nf0.format(v)}</text>`;
  const n=C.length-1, end=C[n].v[0], label=(c,i)=>i?`Séance ${c.d-START} · ${fmtDate(c.d)}`:"Départ";
  box.innerHTML=`<div class="legend"><span><i class="k-me"></i>Toi</span><span><i class="k-bot"></i>Les ${BOTS.length} bots</span></div>
    <svg width="${Wd}" height="${Hd}" tabindex="0" role="img" aria-label="Évolution des soldes, séance par séance. Flèches gauche et droite pour parcourir.">
      ${grid}<text class="xl" x="0" y="${Hd-4}">départ</text><text class="xl" x="${w}" y="${Hd-4}" text-anchor="end">séance ${C[n].d-START}</text>
      ${BOTS.map((_,k)=>`<path class="bot" d="${line(k+1)}"/>`).join("")}<path class="me" d="${line(0)}"/>
      <circle class="dot" cx="${X(n)}" cy="${Y(end)}" r="4"/><text class="lab" x="${X(n)-8}" y="${Y(end)-10}" text-anchor="end">${W(end)}</text>
      <line class="cross" y1="${pt}" y2="${pt+h}" visibility="hidden"/>
    </svg><div class="tip" hidden></div>
    <details class="curve-table"><summary>Voir en tableau</summary><div class="tw"><table><thead><tr><th></th>${names.map(x=>`<th>${x}</th>`).join("")}</tr></thead>
      <tbody>${C.map((c,i)=>`<tr><th>${label(c,i)}</th>${c.v.map(v=>`<td>${nf0.format(Math.round(v))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  const svg=box.querySelector("svg"), cross=svg.querySelector(".cross"), tip=box.querySelector(".tip");
  let cur=n;
  const show=i=>{
    cur=Math.max(0,Math.min(n,i)); const c=C[cur];
    cross.setAttribute("x1",X(cur)); cross.setAttribute("x2",X(cur)); cross.setAttribute("visibility","visible");
    tip.innerHTML=`<h4>${label(c,cur)}</h4>`+c.v.map((v,k)=>({v,k})).sort((a,b)=>b.v-a.v).map(({v,k})=>`<div><i class="${k?"k-bot":"k-me"}"></i><b>${W(v)}</b><span>${names[k]}</span></div>`).join("");
    tip.hidden=false; const x=X(cur)+14+svg.getBoundingClientRect().left-box.getBoundingClientRect().left;
    tip.style.left=Math.max(4,x+tip.offsetWidth>box.clientWidth?x-tip.offsetWidth-28:x)+"px";
  };
  const hide=()=>{cross.setAttribute("visibility","hidden");tip.hidden=true};
  svg.addEventListener("pointermove",e=>show(Math.round((e.clientX-svg.getBoundingClientRect().left)/w*n)));
  svg.addEventListener("pointerleave",hide);
  svg.addEventListener("focus",()=>show(cur)); svg.addEventListener("blur",hide);
  svg.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();show(cur+(e.key==="ArrowRight"?1:-1))}});
}

/* Fiche détaillée avec bougies */
function detailHTML(tk){
  const s=BY[tk], p=price(tk), c=dayChg(tk);
  return `<div class="grab"></div><div class="detail-head"><div><p>${s.sector} · ${nf0.format(s.views[L.d])} vues hier</p><h2>${s.name}</h2></div><div style="text-align:right"><div class="px">${nf2.format(p)} W</div><span class="${cls(c)}" style="font-weight:600">${pct(c)}</span></div></div>
   <canvas class="chart" id="dChart" aria-label="Bougies de 15 minutes"></canvas>
   <div class="hz-rows">${["15","60","close"].map(h=>`<div class="hz-row"><span>${hLabel(h)}</span>${["up","down"].map(dir=>`<button type="button" class="odd" data-bet="${tk}" data-dir="${dir}" data-hh="${h}" aria-pressed="${coupon.some(x=>x.kind==="live"&&x.tk===tk&&x.h===h&&x.dir===dir)}" ${isClosed()?"disabled":""}><span>${dir==="up"?"▲ Monte":"▼ Baisse"}</span><b>×${ui.lev}</b></button>`).join("")}</div>`).join("")}</div>
   <p style="margin-top:14px;font-size:13px">Bougies de 15 minutes : la veille puis la séance en cours. <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent(s.slug)}" target="_blank" rel="noopener" style="color:var(--yellow)">Lire l'article sur Wikipédia</a></p>`;
}
function drawCandles(tk){
  const cv=$("dChart"); if(!cv)return;
  const dpr=window.devicePixelRatio||1, Wd=cv.clientWidth||500, Hd=cv.clientHeight||220;
  cv.width=Wd*dpr; cv.height=Hd*dpr; const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  const tf=15, cs=[];
  const add=(get,n,day)=>{for(let a=0;a<n;a+=tf){const b=Math.min(n,a+tf);let o=get(a),h=o,l=o,c=o;for(let i=a;i<=b;i++){const x=get(i);h=Math.max(h,x);l=Math.min(l,x);c=x}cs.push({o,h,l,c,day})}};
  if(L.d>0){const P=pathOf(tk,L.d-1);add(i=>Math.exp(P[i]),T,0)}
  const n=L.phase==="done"?T:L.t; if(n>0){const P=pathOf(tk,L.d);add(i=>Math.exp(P[i]),n,1)}
  const pr=54,pt=8,pb=8,w=Wd-pr,h=Hd-pt-pb, slot=w/Math.max(cs.length,40);
  let mn=Math.min(...cs.map(c=>c.l)),mx=Math.max(...cs.map(c=>c.h));const sp=(mx-mn)||mx*.02;mn-=sp*.05;mx+=sp*.05;
  const y=v=>pt+h-(v-mn)/(mx-mn)*h;
  g.font="12px Barlow, system-ui, sans-serif"; g.fillStyle="#7C74A6"; g.strokeStyle="#2A2350"; g.textBaseline="middle";
  for(let k=0;k<=3;k++){const v=mn+(mx-mn)*k/3,yy=Math.round(y(v))+.5;g.beginPath();g.moveTo(0,yy);g.lineTo(w,yy);g.stroke();g.fillText(nf2.format(v),w+8,yy)}
  cs.forEach((c,i)=>{
    const x=i*slot+slot/2;
    if(i>0&&c.day!==cs[i-1].day){g.strokeStyle="#4A3F80";g.setLineDash([3,3]);g.beginPath();g.moveTo(x-slot/2,pt);g.lineTo(x-slot/2,Hd-pb);g.stroke();g.setLineDash([]);g.fillStyle="#A79FCB";g.fillText("Aujourd'hui",x-slot/2+5,pt+8)}
    const col=c.c>=c.o?"#3BE3A0":"#FF5E7E";g.strokeStyle=col;g.fillStyle=col;
    g.beginPath();g.moveTo(Math.round(x)+.5,y(c.h));g.lineTo(Math.round(x)+.5,y(c.l));g.stroke();
    const top=y(Math.max(c.o,c.c)),bh=Math.max(1.5,Math.abs(y(c.o)-y(c.c)));g.fillRect(x-slot*.34,top,slot*.68,bh);
  });
}

/* Rendu global */
let frame=0,lastPD=0,lastSlip=0,lastDet=0,tabSig=null;
document.addEventListener("pointerdown",()=>{lastPD=performance.now()},true);
function renderLive(){
  frame++; renderSession(); updateFeed();
  const now=performance.now(), idle=now-lastPD>450;
  if(ui.view==="bets"&&frame%2===0&&idle)renderBets();
  if(ui.view==="direct"&&idle)renderLiveBets();
  const sig=L.bets.filter(b=>b.status==="open").length+ui.view; if(sig!==tabSig){tabSig=sig;renderTabs()}
  if(idle&&now-lastSlip>900){lastSlip=now;renderSlip();if(ui.view==="league")renderLeague()}
  if(ui.sheet==="detail"&&idle&&now-lastDet>600){lastDet=now;const keep=$("sheet").scrollTop;$("sheet").innerHTML=detailHTML(ui.detail);$("sheet").scrollTop=keep;drawCandles(ui.detail)}
}
function renderAll(){renderTabs();renderSession();renderLiveBets();renderSectors();renderBoost();renderFeed();renderDuels();renderBets();renderLeague();renderCurve("curve");renderSlip()}

/* ===================== Feuilles, toasts ===================== */
function openSheet(html,locked){ui.sheet=locked?"locked":"other";$("sheet").innerHTML=html;$("scrim").hidden=false;$("sheet").querySelector(".btn-y,.slip-go")?.focus?.()}
function closeSheet(force){if(ui.sheet==="locked"&&!force)return;ui.sheet=null;$("scrim").hidden=true;renderSlip()}
function openSlip(){ui.sheet="slip";$("sheet").innerHTML=`<div class="grab"></div>`+slipHTML(true);$("scrim").hidden=false;renderSlip()}
function openDetail(tk){ui.sheet="detail";ui.detail=tk;$("sheet").innerHTML=detailHTML(tk);$("scrim").hidden=false;requestAnimationFrame(()=>drawCandles(tk))}
let toastT;function toast(m,win){const t=$("toast");t.className="toast"+(win?" win":"");t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,win?2600:2000)}
function pulseWallet(){const w=$("wallet");w.classList.remove("pulse");void w.offsetWidth;w.classList.add("pulse")}
async function copy(text,ok){try{await navigator.clipboard.writeText(text);toast(ok)}catch(e){toast("Copie impossible ici : sélectionne le texte à la main.")}}
function shareText(){
  const st=standings(),rank=st.findIndex(p=>p.me)+1,g=S.cash/CAP0-1;
  return `wiki·bourse · 30 séances\n${g>=0?"📈":"📉"} ${pct(g)} · ${rank}ᵉ sur ${st.length}\n${S.best?`Plus gros coup : ×${oddsFmt(S.best.odds)} (${S.best.label}), +${W(S.best.gain)}`:"Plus gros coup : à venir"}\nMeilleure série : ×${S.bestStreak}\nTu fais mieux ?`;
}
function finalSheet(){
  const st=standings(),rank=st.findIndex(p=>p.me)+1;
  openSheet(`<div class="grab"></div><h2>${rank===1?"Champion de la ligue":`${rank}ᵉ de la ligue`}</h2><p style="margin-top:6px">30 séances jouées · solde ${W(S.cash)}</p>
    <div class="curve" id="curveFinal" style="margin:14px 0 0"></div>
    <div class="share">${shareText()}</div>
    <div class="sheet-f"><button class="btn" type="button" data-act="copy">Copier</button><button class="btn btn-y" type="button" data-act="replay">Rejouer</button></div>`,true);
  renderCurve("curveFinal");
}

/* ===================== Événements ===================== */
document.addEventListener("click",e=>{
  const v=e.target.closest("[data-view]"); if(v){ui.view=v.dataset.view;renderTabs();if(ui.view==="bets")renderBets();if(ui.view==="league"){renderLeague();renderCurve("curve")}window.scrollTo({top:0});return}
  const ob=e.target.closest("[data-bet]"); if(ob&&!ob.disabled){toggleSel({kind:"live",tk:ob.dataset.bet,dir:ob.dataset.dir,h:ob.dataset.hh||ui.h});if(ui.sheet==="detail"){$("sheet").innerHTML=detailHTML(ui.detail);drawCandles(ui.detail)}return}
  const od=e.target.closest("[data-duel]"); if(od&&!od.disabled){toggleSel({kind:"duel",id:od.dataset.duel,side:od.dataset.side});return}
  const dt=e.target.closest("[data-detail]"); if(dt){openDetail(dt.dataset.detail);return}
  const sc=e.target.closest("[data-sec]"); if(sc){ui.sector=sc.dataset.sec;renderSectors();renderFeed();return}
  const co=e.target.closest("[data-cashout]"); if(co){const b=L.bets.find(x=>x.id===+co.dataset.cashout);if(b&&b.status==="open"&&!isClosed()){closeTrade(b);save();renderAll()}return}
  const lv=e.target.closest("[data-lev]"); if(lv){ui.lev=+lv.dataset.lev;document.querySelectorAll("[data-lev]").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.lev===ui.lev));updateFeed();forceSlip();if(ui.sheet==="detail"){$("sheet").innerHTML=detailHTML(ui.detail);drawCandles(ui.detail)}return}
  const hz=e.target.closest("[data-h]"); if(hz){ui.h=hz.dataset.h;document.querySelectorAll("[data-h]").forEach(b=>b.setAttribute("aria-pressed",b===hz));updateFeed();return}
  const sp=e.target.closest("[data-speed]"); if(sp){ui.speed=+sp.dataset.speed;document.querySelectorAll("[data-speed]").forEach(b=>b.setAttribute("aria-pressed",b===sp));startTimer();return}
  const md=e.target.closest("[data-mode]"); if(md&&!md.disabled){ui.mode=md.dataset.mode;forceSlip();return}
  const rm=e.target.closest("[data-rm]"); if(rm){coupon.splice(+rm.dataset.rm,1);if(!canCombo())ui.mode="simple";if(!coupon.length&&ui.sheet==="slip")closeSheet();forceSlip();updateFeed();renderDuels();renderBoost();return}
  const ch=e.target.closest("[data-chip]"); if(ch){const n=ui.mode==="combo"?1:Math.max(1,coupon.length);ui.stake=ch.dataset.chip==="max"?Math.floor(S.cash/n):+ch.dataset.chip;forceSlip();return}
  const a=e.target.closest("[data-act]"); if(a){
    const k=a.dataset.act;
    if(k==="place")placeBets();
    if(k==="clear"){coupon=[];ui.mode="simple";if(ui.sheet==="slip")closeSheet();forceSlip();updateFeed();renderDuels();renderBoost()}
    if(k==="next")nextSession();
    if(k==="final")finalSheet();
    if(k==="copy")copy(shareText(),"Résultat copié");
    if(k==="replay"){const r=S.ref,bk=S.bk;S=freshState();S.ref=r;S.bk=bk;save();closeSheet(true);coupon=[];newSession();renderAll();toast("Nouvelle saison : 10 000 W")}
    if(k==="bk"){S.cash=CAP0;S.bk++;if(L)L.bets.forEach(b=>{if(b.status==="open")b.status="lost"});save();closeSheet(true);renderAll();toast("Nouveau départ : 10 000 W")}
    if(k==="close")closeSheet();
  }
});
function forceSlip(){const ae=document.activeElement;if(ae&&ae.dataset&&ae.dataset.stake!==undefined)ae.blur();renderSlip()}
document.addEventListener("input",e=>{if(e.target.dataset.stake!==undefined){ui.stake=Math.max(0,Math.floor(+e.target.value||0));const o=e.target.closest(".slip");if(o){const st=totalStake(),gd=o.querySelector(".g-duel b"),gt=o.querySelector(".g-trade b");if(gd)gd.textContent=W(potentialGain());if(gt)gt.textContent="±"+W(ui.stake*ui.lev/100);const go=o.querySelector(".slip-go");go.textContent=`Parier ${W(st)}`;go.disabled=st<=0||st>S.cash||isClosed()}}});
document.addEventListener("focusout",e=>{if(e.target.dataset&&e.target.dataset.stake!==undefined)setTimeout(renderSlip,0)});
$("kick").addEventListener("click",()=>{if(L.phase==="pre")kickoff();else if(L.phase==="over")finalSheet();else if(S.day>=END)finalSheet();else nextSession()});
$("slipOpen").addEventListener("click",openSlip);
$("scrim").addEventListener("click",e=>{if(e.target===$("scrim"))closeSheet()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("scrim").hidden)closeSheet()});
$("btnBk").addEventListener("click",()=>openSheet(`<div class="grab"></div><h2>Repartir à zéro ?</h2><p style="margin-top:8px">Tes paris en cours sont perdus, ton solde repasse à 10 000 W et ton compteur de faillites passe à ${S.bk+1}. Il s'affiche dans la ligue.</p><div class="sheet-f"><button class="btn" type="button" data-act="close">Annuler</button><button class="btn btn-y" type="button" data-act="bk">Repartir</button></div>`));
$("btnRef").addEventListener("click",()=>copy(`Rejoins ma ligue wiki·bourse avec le code ${S.ref} : 2 000 W pour toi et pour moi.`,"Message de parrainage copié"));
window.addEventListener("resize",()=>{if(ui.sheet==="detail")drawCandles(ui.detail);renderCurve("curve");renderCurve("curveFinal")});

/* ===================== Démarrage ===================== */
function start(){
  S=load()||freshState();
  if(S.pending>0){S.cash+=S.pending;const p=S.pending;S.pending=0;setTimeout(()=>toast(`Paris non terminés remboursés : ${W(p)}`),400)}
  if(S.day>END)S.day=END;
  if(!S.curve)S.curve=[curvePoint()]; // sauvegarde d'avant la courbe
  $("dataSpan").textContent=`du ${dateOf(0).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})} au ${dateOf(NDAYS-1).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}`;
  newSession(); renderAll();
}
start();
