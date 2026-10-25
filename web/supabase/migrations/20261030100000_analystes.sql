-- Analystes et tuyaux (Nouveaute.md, choix de Victor du 25 octobre 2026 après scripts/sim-analystes.mjs) : le joueur achète
-- à un analyste fictif un tuyau sur les prochains résultats d'une société. Un tuyau porte sur le chiffre publié (croissance
-- du chiffre d'affaires), jamais sur le cours : le moteur a déjà tiré ce chiffre (caché dans aur_state), le tuyau le
-- révèle ou ment. Les cours n'en savent rien (aucune écriture dans le moteur). Jugé à la publication, d'après le titre du
-- Courrier. Les W payés sont détruits (puits) ; le journal des achats est la table tuyaux (prix et patrimoine gardés).
-- Constantes : analyst_config (une ligne, modifiable sur le VPS sans redéployer), valeurs de départ dans
-- supabase/functions/_shared/analystes.js. Suivi : select analyst_stats(30) depuis le VPS.
-- Retour arrière : cron wikibourse-tuyaux, puis supprimer tuyaux, analysts, analyst_config, les fonctions de ce fichier,
-- les 3 quêtes, 4 succès et le titre ; réappliquer quest_progress (20261029800000_guildes_objectifs.sql).

create table analyst_config (id int primary key default 1 check (id = 1), c jsonb not null, week date);
insert into analyst_config (c, week) values ('{"maxPerDay": 3, "wealthDiv": 50000, "wealthCap": 9, "precision": [1, 1.4, 2, 3, 4.5],
  "delta": [-0.15, -0.08, 0, 0.04, 0.07], "pMin": 0.45, "pMax": 0.93, "range": [0, 4, 2, 1, 0.5], "noise": [0, 1.5, 0.8, 0.4, 0.2],
  "decoy": [1, 6], "flat": 0.5, "minLead": 60, "relMin": 0.55, "relMax": 0.90, "drift": 0.03, "disgrace": 0.7}', paris_date(paris_week(now())));
create function tcfg() returns jsonb language sql stable set search_path = public as $$ select c from analyst_config $$;
create function tcfg_n(k text, i int default null) returns float8 language sql stable set search_path = public as $$
  select case when i is null then (c->>k)::float8 else (c->k->>(i - 1))::float8 end from analyst_config $$;

create table analysts (
  id int generated always as identity primary key, slug text unique not null, name_fr text not null, name_en text not null,
  avatar text not null, bio_fr text not null, bio_en text not null,
  specialties text[] not null default '{}',                  -- vide : toutes les sociétés
  hidden_reliability float8 not null check (hidden_reliability between 0 and 1), -- jamais envoyée aux joueurs
  base_price int not null check (base_price > 0),
  correct_count int not null default 0, total_count int not null default 0, weekly_clients int not null default 0,
  disgrace_until date, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into analysts (slug, name_fr, name_en, avatar, bio_fr, bio_en, specialties, hidden_reliability, base_price) values
  ('hibou', 'Le Hibou', 'The Owl', 'hibou:7', 'Ne parle qu''une fois par trimestre. Quand il parle, la tech écoute.',
   'Speaks once a quarter. When he does, tech listens.', '{NXR,PXF,VLS}', .86, 800),
  ('varlet', 'Varlet & Associés', 'Varlet & Partners', 'loup:3', 'Costume trois pièces, notes de 40 pages. Banque, acier, fret.',
   'Three-piece suits, 40-page notes. Banking, steel, freight.', '{BCS,FRC,MRV}', .74, 400),
  ('meteo', 'Madame Météo', 'Madame Weather', 'colibri:5', 'Lit la pluie, les compteurs et les calendriers avant tout le monde.',
   'Reads rain, meters and calendars before anyone else.', '{GTR,HLV,LMR}', .80, 300),
  ('gazette', 'La Gazette du Port', 'The Harbour Gazette', 'pieuvre:8', 'Un avis sur tout, tous les jours, pour trois sous. Parfois juste.',
   'An opinion on everything, every day, for pennies. Sometimes right.', '{}', .65, 100),
  ('solar', 'Solal', 'Solal', 'eclair:0', 'Vingt-trois ans, trois écrans, aucun doute. Mines, labos, aéro.',
   'Twenty-three, three screens, zero doubt. Mines, labs, aerospace.', '{SLM,OMB,KST}', .70, 200),
  ('ondeo', 'L''Oreille', 'The Ear', 'chat:4', 'Traîne dans les coulisses des studios et des plateaux de live.',
   'Hangs around game studios and live-stream sets.', '{OND,PXF}', .78, 270);

create table tuyaux (
  id bigint generated always as identity primary key,
  player_id uuid not null references profiles on delete cascade, analyst_id int not null references analysts,
  company_id text not null references aur_stocks, precision_level smallint not null check (precision_level between 1 and 5),
  direction text not null check (direction in ('up', 'down', 'flat')), -- au-dessus, en dessous, conforme aux attentes
  target float8, range_low float8, range_high float8,        -- chiffre annoncé et fourchette, en points (niveaux 2 à 5)
  cons float8 not null,                                      -- consensus au moment de l'achat
  event_at timestamptz not null, deadline_at timestamptz not null,
  price_paid int not null, networth_at_purchase float8 not null, is_true boolean not null, -- is_true : jamais envoyé aux joueurs
  text_fr text not null, text_en text not null,
  resolved boolean not null default false, result text check (result in ('correct', 'wrong', 'void')), published float8,
  resolved_at timestamptz, created_at timestamptz not null default now());
create index on tuyaux (player_id, created_at desc);
create index on tuyaux (deadline_at) where not resolved;
create index on tuyaux (analyst_id, resolved_at desc) where result in ('correct', 'wrong');
create unique index tuyaux_un_actif on tuyaux (player_id, company_id) where not resolved;
alter table analyst_config enable row level security;
alter table analysts enable row level security;
alter table tuyaux enable row level security; -- aucune politique : tout passe par les fonctions ci-dessous

-- Prochains résultats d'une société (calendar() du moteur : tous les 7 jours d'Aurelys, à 14 h + 45 min × (i mod 3)).
create function tuyau_event(p_tk text, p_now timestamptz default now()) returns timestamptz language sql immutable as $$
  with s as (select array_position(array['NXR','PXF','OMB','HLV','FRC','VLS','BCS','MRV','GTR','LMR','SLM','KST','OND'], p_tk) - 1 as i,
                    floor((extract(epoch from p_now) - 1790812800) / 2.5)::bigint as m),
  d as (select i, m, m / 1440 + (((i - m / 1440) % 7) + 7) % 7 as d from s where i is not null),
  e as (select m, d * 1440 + 840 + (i % 3) * 45 as ev from d)
  select to_timestamp(1790812800 + 2.5 * case when ev > m then ev else ev + 7 * 1440 end) from e
$$;
-- Taux affiché : 30 dernières résolutions (tous joueurs), « — » sous 5.
create function analyst_rate(p_id int, p_n int default 30) returns float8 language sql stable set search_path = public as $$
  select case when count(*) >= least(5, p_n) then avg((result = 'correct')::int) end
    from (select result from tuyaux where analyst_id = p_id and result in ('correct', 'wrong') order by resolved_at desc limit p_n) x
$$;
create function tuyau_fmt(x float8, en boolean) returns text language sql immutable as $$
  select case when x < 0 then '−' else '+' end || case when en then to_char(abs(x), 'FM990.0') || '%' else replace(to_char(abs(x), 'FM990.0'), '.', ',') || ' %' end
$$;

-- Vérifications communes au devis et à l'achat : prix, ou raison du refus.
create function tuyau_check(p_user uuid, p_analyst int, p_tk text, p_level int, out price int, out reason text, out remaining int)
language plpgsql stable security definer set search_path = public as $$
declare a analysts; n int; ev timestamptz;
begin
  select count(*) into n from tuyaux where player_id = p_user and paris_date(created_at) = paris_date(now());
  remaining := greatest(0, tcfg_n('maxPerDay')::int - n);
  select * into a from analysts where id = p_analyst and active;
  if a.id is null then reason := 'Analyste inconnu.'; return; end if;
  if p_level is null or p_level not between 1 and 5 then reason := 'Précision de 1 à 5.'; return; end if;
  if not exists (select 1 from aur_stocks where tk = p_tk and status = 'core') or tuyau_event(p_tk) is null then reason := 'Société inconnue.'; return; end if;
  if cardinality(a.specialties) > 0 and not p_tk = any(a.specialties) then reason := 'Cet analyste ne suit pas cette société.'; return; end if;
  price := round(a.base_price * (1 + least(greatest(patrimoine(p_user), 0) / tcfg_n('wealthDiv'), tcfg_n('wealthCap'))) * tcfg_n('precision', p_level)
                 * case when a.disgrace_until > paris_date(now()) then tcfg_n('disgrace') else 1 end);
  if remaining = 0 then reason := 'Limite du jour atteinte : remise à zéro à minuit.'; return; end if;
  if exists (select 1 from tuyaux where player_id = p_user and company_id = p_tk and not resolved) then reason := 'Tu as déjà un tuyau en cours sur cette société.'; return; end if;
  ev := tuyau_event(p_tk);
  if ev < now() + make_interval(secs => tcfg_n('minLead')) then reason := 'Les résultats tombent dans moins d''une minute : trop tard.'; return; end if;
  if (select cash from profiles where id = p_user) < price then reason := 'Solde insuffisant.'; return; end if;
end $$;

create function analyst_quote(p_analyst int, p_tk text, p_level int) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from tuyau_check(auth.uid(), p_analyst, p_tk, p_level);
  return jsonb_build_object('price', c.price, 'remaining_today', c.remaining, 'allowed', c.reason is null, 'reason', c.reason,
    'missing', case when c.reason = 'Solde insuffisant.' then c.price - (select cash from profiles where id = auth.uid()) end);
end $$;

create function rumor_buy(p_analyst int, p_tk text, p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); c record; a analysts; st jsonb; act float8; cons float8; truth text; dir text; fig float8; w float8;
  ok boolean; d float8; sname text; v int; sens_fr text; sens_en text; tf text; te text; ev timestamptz; r tuyaux;
begin
  if not exists (select 1 from profiles where id = u and not bot) then raise exception 'Crée d''abord ton profil.'; end if;
  perform 1 from profiles where id = u for update; -- un achat à la fois par joueur : limite du jour et solde sûrs
  select * into c from tuyau_check(u, p_analyst, p_tk, p_level);
  if c.reason is not null then raise exception '%', c.reason; end if;
  select * into a from analysts where id = p_analyst;
  -- Vrai chiffre caché et consensus, après la révision des analystes en attente (le moteur la publiera avant les résultats).
  select state into st from aur_state where id = 1;
  act := (st->'st'->p_tk->'res'->>'act')::float8; cons := (st->'st'->p_tk->'res'->>'cons')::float8;
  if act is null then raise exception 'Le consensus des analystes n''est pas encore publié.'; end if;
  select coalesce((x->>'nc')::float8, cons) into cons from jsonb_array_elements(coalesce(st->'revq', '[]')) x
   where x->>'tk' = p_tk and (x->>'from')::float8 = cons and (x->>'act')::float8 = act limit 1;
  cons := coalesce(cons, (st->'st'->p_tk->'res'->>'cons')::float8);
  truth := case when abs(act - cons) < tcfg_n('flat') then 'flat' when act > cons then 'up' else 'down' end;
  w := tcfg_n('range', p_level);
  ok := random() < least(tcfg_n('pMax'), greatest(tcfg_n('pMin'), a.hidden_reliability + tcfg_n('delta', p_level)));
  d := tcfg_n('decoy', 1) + random() * (tcfg_n('decoy', 2) - tcfg_n('decoy', 1));
  if ok then dir := truth; -- bruit borné à 80 % de la fourchette : un tuyau vrai est jugé juste
    fig := act + greatest(-.8 * w, least(.8 * w, tcfg_n('noise', p_level) * sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random())));
  elsif p_level > 1 and truth <> 'flat' and random() < .5 then dir := truth; fig := act + (case when truth = 'up' then 1 else -1 end) * (w + d); -- bon sens, chiffre exagéré
  else dir := case when truth = 'flat' then (case when random() < .5 then 'up' else 'down' end) when truth = 'up' then 'down' else 'up' end;
       fig := cons + (case when dir = 'up' then 1 else -1 end) * (tcfg_n('flat') + d);
  end if;
  if p_level = 1 then fig := null; else fig := round(fig::numeric, 1); end if;
  -- Texte, trois tournures par niveau.
  select name into sname from aur_stocks where tk = p_tk;
  sens_fr := case dir when 'up' then 'au-dessus des attentes' when 'down' then 'en dessous des attentes' else 'conforme aux attentes' end;
  sens_en := case dir when 'up' then 'above expectations' when 'down' then 'below expectations' else 'in line with expectations' end;
  v := floor(random() * 3)::int;
  if p_level = 1 then
    tf := (array['Selon %1$s, %2$s publiera un chiffre d''affaires %3$s.', '%1$s en est sûr : les comptes de %2$s seront %3$s.',
                 'Bruit de couloir chez %1$s : %2$s sortira un chiffre %3$s.'])[v + 1];
    te := (array['According to %1$s, %2$s will report revenue %3$s.', '%1$s is sure of it: %2$s''s numbers will come in %3$s.',
                 'Word around %1$s: %2$s will post a figure %3$s.'])[v + 1];
    tf := format(tf, a.name_fr, sname, sens_fr); te := format(te, a.name_en, sname, sens_en);
  elsif p_level <= 3 then
    tf := (array['%1$s attend %2$s entre %3$s et %4$s sur un an, %5$s.', 'D''après %1$s, la croissance de %2$s tombera entre %3$s et %4$s.',
                 '%1$s parie sur %3$s à %4$s pour %2$s, %5$s.'])[v + 1];
    te := (array['%1$s expects %2$s between %3$s and %4$s year on year, %5$s.', 'According to %1$s, %2$s''s growth will land between %3$s and %4$s.',
                 '%1$s is betting on %3$s to %4$s for %2$s, %5$s.'])[v + 1];
    tf := format(tf, a.name_fr, sname, tuyau_fmt(fig - w, false), tuyau_fmt(fig + w, false), sens_fr);
    te := format(te, a.name_en, sname, tuyau_fmt(fig - w, true), tuyau_fmt(fig + w, true), sens_en);
  else
    tf := (array['%1$s : %2$s publiera %3$s, à %4$s point près, %5$s.', 'Chiffre soufflé à %1$s : %3$s pour %2$s, à %4$s point près.',
                 '%1$s a vu les comptes de %2$s : %3$s, à %4$s point près.'])[v + 1];
    te := (array['%1$s: %2$s will report %3$s, give or take %4$s point, %5$s.', 'Figure whispered to %1$s: %3$s for %2$s, give or take %4$s point.',
                 '%1$s has seen %2$s''s books: %3$s, give or take %4$s point.'])[v + 1];
    tf := format(tf, a.name_fr, sname, tuyau_fmt(fig, false), replace(w::text, '.', ','), sens_fr);
    te := format(te, a.name_en, sname, tuyau_fmt(fig, true), w::text, sens_en);
  end if;
  ev := tuyau_event(p_tk);
  update profiles set cash = cash - c.price where id = u and cash >= c.price;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into tuyaux (player_id, analyst_id, company_id, precision_level, direction, target, range_low, range_high, cons, event_at, deadline_at,
                      price_paid, networth_at_purchase, is_true, text_fr, text_en)
  values (u, a.id, p_tk, p_level, dir, fig, fig - w, fig + w, round(cons::numeric, 1), ev, ev, c.price, patrimoine(u) + c.price, ok, tf, te)
  returning * into r;
  update analysts set weekly_clients = weekly_clients + 1, updated_at = now() where id = a.id;
  perform achievement_grant(u, 'INITIE');
  if (select count(*) from tuyaux where player_id = u and analyst_id = a.id) >= 10 then perform achievement_grant(u, 'CLIENT_FIDELE'); end if;
  perform quests_check(u);
  return jsonb_build_object('rumor', jsonb_build_object('id', r.id, 'text_fr', r.text_fr, 'text_en', r.text_en, 'tk', r.company_id, 'direction', r.direction,
    'deadline_at', r.deadline_at, 'precision_level', r.precision_level, 'price_paid', r.price_paid));
end $$;

create function analyst_list() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'max', tcfg_n('maxPerDay')::int,
    'today', (select count(*) from tuyaux where player_id = auth.uid() and paris_date(created_at) = paris_date(now())),
    'list', coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'name_fr', a.name_fr, 'name_en', a.name_en, 'avatar', a.avatar,
      'bio_fr', a.bio_fr, 'bio_en', a.bio_en, 'specialties', to_jsonb(a.specialties), 'base_price', a.base_price,
      'displayed_rate', analyst_rate(a.id), 'resolved_count', a.total_count, 'weekly_clients', a.weekly_clients,
      'badges', to_jsonb(array_remove(array[
        case when a.total_count < 5 then 'nouveau' end,
        case when a.disgrace_until > paris_date(now()) then 'disgrace' end,
        case when a.total_count >= 10 and analyst_rate(a.id, 10) >= .8 then 'forme' end], null))) order by a.id), '[]'))
  from analysts a where a.active
$$;

-- Tuyaux du joueur, avec le gain réalisé sur la société entre l'achat et l'échéance (positions clôturées).
create function my_tuyaux(p_status text default null) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'analyst_fr', a.name_fr, 'analyst_en', a.name_en, 'avatar', a.avatar, 'tk', r.company_id,
    'direction', r.direction, 'target', r.target, 'range_low', r.range_low, 'range_high', r.range_high, 'cons', r.cons,
    'precision_level', r.precision_level, 'text_fr', r.text_fr, 'text_en', r.text_en, 'deadline_at', r.deadline_at, 'price_paid', r.price_paid,
    'resolved', r.resolved, 'result', r.result, 'published', r.published, 'resolved_at', r.resolved_at, 'created_at', r.created_at,
    'pnl', (select sum(ach_net(b)) from bets b where b.user_id = r.player_id and b.kind = 'aurelys' and b.aur = r.company_id and b.status <> 'open'
              and b.created_at >= r.created_at and b.created_at <= r.deadline_at)) order by r.created_at desc), '[]')
  from (select * from tuyaux where player_id = auth.uid() and (p_status is null or (p_status = 'active') = not resolved)
         order by created_at desc limit 50) r join analysts a on a.id = r.analyst_id
$$;

-- Page publique d'un joueur : tuyaux suivis et part de justes (rien d'autre).
create function player_tuyaux(p_pseudo text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(r.id), 'ok', avg((r.result = 'correct')::int) filter (where r.result in ('correct', 'wrong')))
    from profiles p left join tuyaux r on r.player_id = p.id
   where lower(p.pseudo) = lower(p_pseudo) and (not coalesce(p.hidden, false) or p.id = auth.uid())
   group by p.id
$$;

-- Chaque minute : dérive du lundi, puis résolution des tuyaux dont les résultats sont publiés.
create function analyst_resolve(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = public as $$
declare wk date := paris_date(paris_week(p_now)); r record; m text[]; pub float8; side text; ok boolean; n int := 0; nm text;
begin
  if (select week from analyst_config) is distinct from wk then
    update analysts a set hidden_reliability = least(tcfg_n('relMax'), greatest(tcfg_n('relMin'),
                            hidden_reliability + tcfg_n('drift') * sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random()))),
           weekly_clients = 0, updated_at = p_now,
           disgrace_until = case when a.total_count >= 20 and analyst_rate(a.id, 20) < .5 then wk + 7 else a.disgrace_until end;
    update analyst_config set week = wk;
  end if;
  for r in select t.*, s.name as sname from tuyaux t join aur_stocks s on s.tk = t.company_id
            where not t.resolved and t.deadline_at <= p_now order by t.id for update of t skip locked loop
    select regexp_match(title, 'chiffre d''affaires ([+−][0-9]+,[0-9]) %, (conforme|au-dessus|en dessous)') into m
      from aur_news where tk = r.company_id and cat = 'resultats' and t >= r.created_at and t <= r.deadline_at + interval '10 seconds' and t <= p_now
     order by t limit 1;
    if m is null then
      -- Moteur arrêté, société suspendue : pas de publication 2 h après l'échéance, tuyau sans suite et remboursé.
      if p_now > r.deadline_at + interval '2 hours' then
        update tuyaux set resolved = true, result = 'void', resolved_at = p_now where id = r.id;
        update profiles set cash = cash + r.price_paid where id = r.player_id;
      end if;
      continue;
    end if;
    pub := (case when left(m[1], 1) = '−' then -1 else 1 end) * replace(substr(m[1], 2), ',', '.')::float8;
    side := case m[2] when 'conforme' then 'flat' when 'au-dessus' then 'up' else 'down' end;
    ok := side = r.direction and (r.precision_level = 1 or abs(pub - r.target) <= tcfg_n('range', r.precision_level) + 1e-9);
    update tuyaux set resolved = true, result = case when ok then 'correct' else 'wrong' end, published = pub, resolved_at = p_now where id = r.id;
    update analysts set total_count = total_count + 1, correct_count = correct_count + ok::int, updated_at = p_now where id = r.analyst_id;
    insert into notices (user_id, kind, body) values (r.player_id, 'tuyau', jsonb_build_object('id', r.id, 'ok', ok, 'tk', r.company_id, 'pub', pub,
      'name', r.sname, 'analyst_fr', (select name_fr from analysts where id = r.analyst_id), 'analyst_en', (select name_en from analysts where id = r.analyst_id)));
    if (select count(*) from tuyaux where player_id = r.player_id and result = 'correct') >= 10 then perform achievement_grant(r.player_id, 'BIEN_RENSEIGNE'); end if;
    if not ok and (select bool_and(result = 'wrong') and count(*) = 5 from (select result from tuyaux where player_id = r.player_id and result in ('correct', 'wrong')
                    order by resolved_at desc, id desc limit 5) x) then perform achievement_grant(r.player_id, 'MAL_CONSEILLE'); end if;
    perform quests_check(r.player_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Suivi du puits, depuis le VPS uniquement : W brûlés et achats par jour, niveaux choisis, réussite réelle contre affichée.
create function analyst_stats(p_days int default 30) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'days', (select coalesce(jsonb_agg(x order by x.day desc), '[]') from (select paris_date(created_at) as day, count(*) as buys, sum(price_paid) as w_burned,
               sum(price_paid) filter (where result = 'void') as w_refunded from tuyaux where created_at > now() - make_interval(days => p_days) group by 1) x),
    'levels', (select coalesce(jsonb_object_agg(precision_level, n), '{}') from (select precision_level, count(*) as n from tuyaux
               where created_at > now() - make_interval(days => p_days) group by 1) x),
    'analysts', (select jsonb_agg(jsonb_build_object('slug', slug, 'hidden', round(hidden_reliability::numeric, 3), 'displayed', analyst_rate(id),
                 'real', case when total_count > 0 then round(correct_count::numeric / total_count, 3) end, 'resolved', total_count,
                 'weekly_clients', weekly_clients, 'disgrace_until', disgrace_until) order by id) from analysts))
$$;

revoke execute on function tcfg(), tcfg_n(text, int), tuyau_check(uuid, int, text, int), analyst_resolve(timestamptz), analyst_stats(int) from public, anon, authenticated;
revoke execute on function analyst_quote(int, text, int), rumor_buy(int, text, int), analyst_list(), my_tuyaux(text), player_tuyaux(text) from public, anon;
grant execute on function analyst_quote(int, text, int), rumor_buy(int, text, int), analyst_list(), my_tuyaux(text), player_tuyaux(text) to authenticated;

-- Quêtes (2 du jour, 1 de la semaine) : progression relue dans les tuyaux et les positions.
insert into quest_defs (code, period, tier, goal, needs, text) values
  ('tuyau_1', 'day', 'easy', 1, null, 'Acheter un tuyau à un analyste'),
  ('tuyau_suivi', 'day', 'medium', 1, null, 'Prendre position dans le sens d''un tuyau acheté'),
  ('w_tuyau_5', 'week', 'medium', 5, null, 'Suivre 5 tuyaux qui se révèlent justes');
-- 20261029800000_guildes_objectifs.sql ; + tuyau_1, tuyau_suivi, w_tuyau_5.
create or replace function quest_progress(p_user uuid, p_code text, p_t0 timestamptz, p_t1 timestamptz) returns int
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if p_code in ('stop_1') then
    select count(*) into n from player_events where user_id = p_user and kind = 'auto' and at >= p_t0 and at < p_t1;
  elsif p_code = 'invest_1' then
    select count(*) into n from player_events where user_id = p_user and kind = 'buy' and at >= p_t0 and at < p_t1;
  elsif p_code = 'tuyau_1' then
    select count(*) into n from tuyaux where player_id = p_user and created_at >= p_t0 and created_at < p_t1;
  elsif p_code = 'w_tuyau_5' then
    select count(*) into n from tuyaux where player_id = p_user and result = 'correct' and resolved_at >= p_t0 and resolved_at < p_t1;
  elsif p_code = 'tuyau_suivi' then
    select count(*) into n from bets b where b.user_id = p_user and b.kind = 'aurelys' and b.created_at >= p_t0 and b.created_at < p_t1
       and exists (select 1 from tuyaux r where r.player_id = p_user and r.company_id = b.aur and r.direction = b.dir
                      and r.created_at <= b.created_at and r.deadline_at >= b.created_at);
  elsif p_code in ('read_2', 'w_read_15') then
    select count(*) into n from news_reads where user_id = p_user and at >= p_t0 and at < p_t1;
  elsif p_code in ('pari_vote', 'w_pari_5') then
    select count(*) into n from aur_pari_vote where user_id = p_user and voted_at >= p_t0 and voted_at < p_t1;
  elsif p_code = 'w_quests_10' then
    select count(*) into n from quest_done d join quest_defs q on q.code = d.code
     where d.user_id = p_user and q.period = 'day' and d.done_at >= p_t0 and d.done_at < p_t1;
  elsif p_code in ('news_trade', 'news_trade_2') then
    select count(*) into n from bets b where b.user_id = p_user and b.kind = 'aurelys' and b.created_at >= p_t0 and b.created_at < p_t1
       and exists (select 1 from news_reads r where r.user_id = p_user and r.tk = b.aur and r.at <= b.created_at and r.at > b.created_at - interval '1 hour');
  else
    with v as (select b.*, ach_net(b) as g from bets b
                where b.user_id = p_user and b.kind = 'aurelys' and b.status <> 'open' and b.closed_at >= p_t0 and b.closed_at < p_t1
                  and b.stake >= 100 and b.closed_at - b.created_at >= interval '150 seconds')
    select case
      when p_code in ('trade_1', 'trade_5', 'trade_10', 'w_trade_15', 'w_trade_40') then count(*)
      when p_code in ('win_1', 'win_3', 'w_win_8', 'w_win_20') then count(*) filter (where g > 0)
      when p_code in ('trade_3co', 'trade_5co', 'w_co_8') then count(distinct aur)
      when p_code in ('real_1', 'real_3', 'w_real_10') then count(*) filter (where aur in ('GTR', 'HLV', 'LMR'))
      when p_code = 'short_1' then count(*) filter (where dir = 'down')
      when p_code = 'hold_10' then count(*) filter (where closed_at - created_at >= interval '10 minutes')
      when p_code = 'hold_30' then count(*) filter (where closed_at - created_at >= interval '30 minutes')
      when p_code = 'gain_10' then count(*) filter (where g >= .1 * stake)
      when p_code = 'lev10_win' then count(*) filter (where lev >= 10 and g > 0)
      when p_code = 'results' then count(*) filter (where g > 0 and exists (select 1 from aur_results r where r.tk = v.aur and r.t > v.created_at and r.t < v.closed_at))
      when p_code in ('guild_win', 'w_guild_10') then count(*) filter (where g > 0 and exists (select 1 from guild_goal_members m
                                                    where m.user_id = p_user and m.week = paris_date(paris_week(v.closed_at))))
      when p_code in ('w_days_3', 'w_days_5') then count(distinct paris_date(closed_at))
      when p_code = 'w_stop_5' then count(*) filter (where sl is not null or tp is not null)
      else 0 end into n from v;
  end if;
  return coalesce(n, 0);
end $$;
-- Ouvrir une position compte tout de suite pour « Prendre position dans le sens d'un tuyau » (les quêtes de trades se
-- vérifient à la clôture).
create function tuyau_on_open() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'aurelys' and exists (select 1 from tuyaux where player_id = new.user_id and company_id = new.aur and not resolved) then
    perform quests_check(new.user_id);
  end if;
  return new;
end $$;
create trigger tuyau_on_open after insert on bets for each row execute function tuyau_on_open();
revoke execute on function tuyau_on_open() from public, anon, authenticated;

-- Succès (Information) et titre.
insert into achievements (code, cat, ord, name, descr, points, goal, unit, secret, hint) values
  ('INITIE', 'Information', 72, 'Initié', 'Acheter son premier tuyau à un analyste', 0, null, null, false, null),
  ('BIEN_RENSEIGNE', 'Information', 73, 'Bien renseigné', '10 tuyaux achetés qui se révèlent justes', 1, null, null, false, null),
  ('CLIENT_FIDELE', 'Information', 74, 'Client fidèle', 'Acheter 10 tuyaux au même analyste', 1, null, null, false, null),
  ('MAL_CONSEILLE', 'Information', 75, 'Mal conseillé', '5 tuyaux faux d''affilée', 0, null, null, true, 'Écouter les mauvaises personnes, longtemps.');
insert into title_defs (code, text, ord, unlock, value) values ('bien_renseigne', 'Bien renseigné', 32, 'ach', 'BIEN_RENSEIGNE');

do $$ begin
  perform cron.schedule('wikibourse-tuyaux', '* * * * *', 'select public.analyst_resolve()');
exception when others then raise notice 'résolution des tuyaux non planifiée (%)', sqlerrm; end $$;
