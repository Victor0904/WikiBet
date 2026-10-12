-- Réglages après les simulations de talents (octobre 2026, demandés par Victor) :
-- 1. (Salaire : inchangé. Baisser son plafond de patrimoine coupait surtout le salaire des joueurs moyens, pas celui du jeu
--    au hasard, qui reste sous le seuil ; voir scripts/sim-talents.mjs.)
-- 2. Amortisseur : plus de remboursement. La position est clôturée quand elle ne vaut plus que 3 % de sa mise par rang, et ce
--    reste est rendu (bets.amort, fixé à l'ouverture). Même espérance qu'avant le talent : plus de gain à se faire liquider
--    exprès (+760 W par jour au mieux avec l'ancienne version). Le plafond de 1 500 W et la limite d'une fois par jour tombent.
-- 3. Avance des actualités : le moteur calcule 15 à 35 s d'avance ; seules 15 s sont garanties. Agence de presse 5 s par
--    niveau, Avant-première 3 / 6 / 10 s, 15 s au plus en tout (avant : 25 s par niveau, en partie sans effet).
-- 4. Kraken : seulement pour un ordre passé à la main (un stop ou un ordre automatique ne le consomme plus).
-- 5. Rumeur d'une société radiée avant sa résolution : « Sans suite » (status void), sans révéler l'issue tirée.
-- 6. Renaissance : regagner en tradant (gain net, tal_cum) ce qu'on avait avant la liquidation ; le salaire n'y aide plus.
-- Retour arrière : réappliquer les fonctions depuis leurs migrations d'origine (indiquées à chaque fonction).

-- 2. Amortisseur : part de la mise gardée à la liquidation, fixée à l'ouverture.
alter table bets add column amort float8 not null default 0;
create or replace function bets_reg_open() returns trigger language plpgsql set search_path = public as $$
begin
  new.reg_open := (select x->>'reg' from aur_ticks where tk = 'AUR12' and x is not null and t <= now() order by t desc limit 1);
  new.amort := .03 * tal_rank(new.user_id, 'amort');
  return new;
end $$;
-- Cours de liquidation d'une position : la valeur y tombe à `amort` × mise (0 sans le talent).
create function aur_lq(b bets) returns float8 language sql immutable as $$
  select b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end) * (1 - b.amort) / b.lev)
$$;
-- 20261026000000_disque.sql
create or replace function aur_liquidate(p_id bigint, p_since timestamptz default '-infinity') returns bets
language plpgsql set search_path = public as $$
declare b bets; lq float8; t0 timestamptz;
begin
  -- Lecture sans verrou : on ne verrouille (donc n'écrit) que la position réellement touchée.
  select * into b from bets where id = p_id and kind = 'aurelys' and status = 'open';
  if not found then return null; end if;
  lq := aur_lq(b);
  select min(k.t) into t0 from aur_ticks k
   where k.tk = b.aur and k.t > greatest(b.created_at, p_since) and k.t <= now()
     and (case when b.dir = 'up' then k.p <= lq else k.p >= lq end);
  if t0 is null then return b; end if;
  select * into b from bets where id = p_id and status = 'open' for update;
  if not found then return null; end if; -- clôturée entre-temps
  update bets set status = 'lost', payout = b.amort * b.stake, exit = lq, exit_at = t0, closed_at = now(), closed_by = 'liq'
   where id = b.id returning * into b;
  -- Seulement la part de l'Amortisseur : l'assurance et la banque de guilde sont versées par bets_bonus.
  update profiles set cash = cash + b.amort * b.stake where id = b.user_id and b.amort > 0;
  return b;
end $$;
revoke execute on function aur_liquidate(bigint, timestamptz) from public, anon, authenticated;
-- 20261027200000_talents.sql : assurance et banque de guilde s'ajoutent à ce que rend l'Amortisseur ; plus de remboursement du talent.
create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
declare lv int; add float8;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
  elsif old.status = 'open' and new.status = 'lost' and (coalesce(new.payout, 0) = 0 or new.closed_by = 'liq')
        and new.kind in ('trade', 'stream', 'crypto', 'aurelys') and new.exit is not null then
    if consume_bonus(new.user_id, 'assurance') then
      add := new.stake * 0.5;
    elsif new.kind = 'aurelys' then
      lv := city_level(new.user_id, 'banque');
      if lv > 0 then
        insert into city_uses values (new.user_id, 'banque', paris_day()) on conflict do nothing;
        if found then add := new.stake * (.05 + .1 * lv); end if;
      end if;
    end if;
    if add > 0 then
      new.payout := coalesce(new.payout, 0) + add; new.insured := true;
      update profiles set cash = cash + add where id = new.user_id;
    end if;
  end if;
  return new;
end $$;
-- 20261027200000_talents.sql : le stop doit rester avant le cours de liquidation (Amortisseur compris).
create or replace function aur_set_auto(p_id bigint, p_sl float8, p_tp float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; sg int; lq float8;
begin
  if p_sl is not null and home_level(auth.uid()) < 3 and tal_rank(auth.uid(), 'filet') = 0 then raise exception 'Le stop se débloque avec le loft (QG) ou le talent Filet.'; end if;
  select * into b from bets where id = p_id and user_id = auth.uid() and kind = 'aurelys' and status = 'open' for update;
  if not found then raise exception 'Position introuvable ou déjà clôturée.'; end if;
  k := aur_last(b.aur); sg := case when b.dir = 'up' then 1 else -1 end;
  lq := aur_lq(b);
  if p_sl is not null and not (sg * (k.p - p_sl) > 0 and sg * (p_sl - lq) > 0) then
    raise exception 'Stop invalide : il doit être % du cours actuel et % du seuil de liquidation (%).',
      case when sg = 1 then 'sous' else 'au-dessus' end, case when sg = 1 then 'au-dessus' else 'sous' end, to_char(lq, 'FM999G990D00');
  end if;
  if p_tp is not null and not (sg * (p_tp - k.p) > 0) then
    raise exception 'Objectif invalide : il doit être % du cours actuel.', case when sg = 1 then 'au-dessus' else 'sous' end;
  end if;
  update bets set sl = p_sl, tp = p_tp, auto_at = now() where id = b.id returning * into b;
  return b;
end $$;
-- 20261027200000_talents.sql
create or replace function push_info(p_endpoint text) returns table (kind text, aur text, dir text, lev int, stake float8, lq float8)
language sql stable security definer set search_path = public as $$
  (select 'liq', b.aur, b.dir, b.lev, b.stake, b.exit from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.closed_by = 'liq' and b.push_at > now() - interval '10 minutes'
    order by b.closed_at desc limit 5)
  union all
  (select case when b.warn = 2 then '10' when tal_rank(b.user_id, 'sangfroid') > 0 then '40' else '25' end, b.aur, b.dir, b.lev, b.stake, aur_lq(b)
     from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.status = 'open' and b.warn_at > now() - interval '10 minutes'
    order by b.warn_at desc limit 5)
$$;
revoke execute on function push_info(text) from public, anon, authenticated;

-- 3. 20261027200000_talents.sql
create or replace function news_lead() returns interval language sql stable security definer set search_path = public as $$
  select make_interval(secs => least(15, 5 * city_level(auth.uid(), 'presse') + (array[0, 3, 6, 10])[tal_rank(auth.uid(), 'avant') + 1]))
$$;
update city_catalog set description = 'Les actualités d''Aurelys 5 s plus tôt par niveau (15 s au plus, talent Avant-première compris).' where id = 'presse';

-- 4. 20261027200000_talents.sql ; aur_auto_exec signale un ordre automatique (app.auto) : le Kraken ne s'y applique pas.
create or replace function talent_slip(p_user uuid, p_slip float8) returns float8 language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.auto', true), '') <> '1' then
    update profiles set kraken_armed = false, kraken_day = aur_day()
     where id = p_user and kraken_armed and coalesce(kraken_day, -1) < aur_day() and tal_rank(p_user, 'kraken') > 0;
    if found then return 0; end if;
  end if;
  return p_slip * (1 - .025 * tal_rank(p_user, 'discretion'));
end $$;
revoke execute on function talent_slip(uuid, float8) from public, anon, authenticated;
create or replace function aur_auto_exec(p_what text, p_id bigint, p_slip float8) returns void
language plpgsql security definer set search_path = public as $$
declare g aur_triggers; b bets; why text; hit float8;
begin
  perform set_config('app.auto', '1', true);
  if p_what = 'close' then
    select * into b from bets where id = p_id and status = 'open';
    if not found then return; end if;
    select case when (b.dir = 'up' and k.p <= b.sl) or (b.dir = 'down' and k.p >= b.sl) then 'stop' else 'objectif' end, k.p into why, hit
      from aur_ticks k where k.tk = b.aur and k.t > b.auto_at and k.t <= now()
       and (case when b.dir = 'up' then k.p <= b.sl or k.p >= b.tp else k.p >= b.sl or k.p <= b.tp end)
     order by k.t limit 1;
    perform aur_close_px(b.user_id, p_id, p_slip, case when tal_rank(b.user_id, 'timing') > 0 then hit end);
    update bets set closed_by = why where id = p_id and status <> 'open' and closed_by is null;
    perform set_config('app.auto', '', true);
    return;
  end if;
  select * into g from aur_triggers where id = p_id and status = 'wait' for update;
  if not found then perform set_config('app.auto', '', true); return; end if;
  begin
    b := aur_open(g.user_id, g.tk, g.dir, g.lev, g.stake, p_slip);
    update aur_triggers set status = 'done', bet_id = b.id, done_at = now() where id = g.id;
  exception when others then
    if sqlerrm ~ 'indisponible|suspendue' then raise; end if;
    update aur_triggers set status = 'failed', msg = sqlerrm, done_at = now() where id = g.id;
  end;
  perform set_config('app.auto', '', true);
end $$;

-- 5. 20261027200000_talents.sql : rumeur sans suite (société radiée avant la résolution).
create or replace function aur_rumor_list() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select r.*, r.res_t is not null and r.res_t <= now() + news_lead() as done,
           coalesce((select s.status = 'delisted' from aur_stocks s where s.tk = r.tk), false) and r.res_t is null as void,
           case when r.t > now() then null
                else (case when r.res_t <= now() then r.p1 else (aur_last(r.tk)).p end) / nullif(r.p0, 0) - 1 end as chg
    from aur_rumors r where r.t <= now() + news_lead() and r.t > now() - interval '7 days'
  ), f as (select tal_rank(auth.uid(), 'flair') as fr)
  select jsonb_build_object(
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tk', tk, 't', extract(epoch from t), 'title', title, 'sent', sent,
              'chg', chg, 'status', case when void then 'void' when not done then 'open' when ok then 'ok' else 'no' end,
              'res_t', case when done then extract(epoch from res_t) end,
              'flair', case when not done and not void and f.fr > 0 then
                 case when ((abs(hashtext(id::text || ':' || f.fr)) % 1000) / 1000.0 < (array[.6, .65, .7])[f.fr]) = ok then 'credible' else 'douteuse' end end)
              order by t desc, id desc)
            from (select * from v order by t desc limit 300) x, f), '[]'),
    'stats', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where ok),
              'chg', avg(chg * sign(sent)) filter (where chg is not null and res_t <= now())) from v where done))
$$;

-- 6. Renaissance au gain net de trading (20261027300000_succes.sql).
update profiles set renais_target = null;
update achievements set descr = 'Après une liquidation, regagner en tradant (gain net) ce que tu avais avant' where code = 'RENAISSANCE';
create or replace function ach_profile() returns trigger language plpgsql set search_path = public as $$
begin
  if new.bank < 5000 then new.bank_since := null; elsif new.bank_since is null then new.bank_since := now(); end if;
  return new;
end $$;
create or replace function ach_on_close() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid := new.user_id; v boolean := ach_valid(new); w boolean := ach_net(new) > 0; s int; z int;
begin
  if coalesce((select bot from profiles where id = u), true) then return null; end if;
  -- tal_cum compte déjà cette position (talents_gain passe avant) : la cible est le gain net d'avant la liquidation.
  update profiles set ach_streak = case when not w then 0 when v then ach_streak + 1 else ach_streak end,
                      ach_zl = case when ach_liq(new) then 0 when v then ach_zl + 1 else ach_zl end,
                      renais_target = case when ach_liq(new) then tal_cum - (case when new.closed_at - new.created_at >= interval '150 seconds' then ach_net(new) else 0 end)
                                           else renais_target end
   where id = u returning ach_streak, ach_zl into s, z;
  if s >= 5 then perform achievement_grant(u, 'SERIE_5'); end if;
  if s >= 10 then perform achievement_grant(u, 'SERIE_10'); end if;
  if z >= 100 then perform achievement_grant(u, 'ZERO_LIQ'); end if;
  if v then perform ach_trade(new); perform ach_counts(u); end if;
  perform ach_wealth(u);
  return null;
end $$;
create or replace function ach_wealth(u uuid) returns void language plpgsql set search_path = public as $$
declare h float8; c float8; tgt float8; pat float8;
begin
  select tal_hwm, tal_cum, renais_target into h, c, tgt from profiles where id = u and not bot;
  if not found then return; end if;
  if h >= 10000 then perform achievement_grant(u, 'GAIN_10K'); end if;
  if h >= 50000 then perform achievement_grant(u, 'GAIN_50K'); end if;
  if h >= 100000 then perform achievement_grant(u, 'GAIN_100K'); end if;
  if h >= 500000 then perform achievement_grant(u, 'GAIN_500K'); end if;
  if h >= 1000000 then perform achievement_grant(u, 'GAIN_1M'); end if;
  pat := patrimoine(u);
  if pat >= 250000 then perform achievement_grant(u, 'PAT_250K'); end if;
  if pat >= 1000000 then perform achievement_grant(u, 'PAT_1M'); end if;
  if tgt is not null and c > tgt then perform achievement_grant(u, 'RENAISSANCE'); update profiles set renais_target = null where id = u; end if;
end $$;
revoke execute on function ach_wealth(uuid), ach_on_close(), ach_profile(), aur_lq(bets) from public, anon, authenticated;
