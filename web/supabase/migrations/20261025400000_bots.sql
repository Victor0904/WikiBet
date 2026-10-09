-- Joueurs fictifs (revue d'octobre 2026 : le premier joueur ne doit pas arriver dans une ville fantôme). Des profils marqués
-- bot, affichés comme tels, qui tradent sur Aurelys par les mêmes règles que les joueurs (aur_open / aur_close : frais,
-- plafonds, liquidation, salaire). Créés une fois par un script (comptes anonymes, sans e-mail ni mot de passe).
-- Un bot agit toutes les 2 à 12 minutes réelles : la moitié suit la tendance des 2 dernières minutes, l'autre la contre.
-- Ses ordres passent sans impact calculé (p_slip = 0) mais entrent dans la simulation comme ceux des joueurs.
alter table profiles add column bot boolean not null default false;

create function bots_play() returns int language plpgsql security definer set search_path = public as $$
declare r record; b bets; s aur_stocks; p1 float8; p0 float8; dir text; lev int; n int := 0;
begin
  for r in select p.id, p.cash, p.pseudo from profiles p
            where p.bot and (p.last_seen is null or p.last_seen < now() - make_interval(secs => 120 + random() * 600)) loop
    update profiles set last_seen = now() where id = r.id; -- présence dans la ville de sa guilde
    begin
      select * into b from bets where user_id = r.id and kind = 'aurelys' and status = 'open'
         and created_at < now() - interval '3 minutes' order by random() limit 1;
      if found and random() < .5 then
        perform aur_close(r.id, b.id, 0);
      else
        select * into s from aur_stocks where status in ('core', 'listed') order by random() limit 1;
        p1 := (aur_last(s.tk)).p;
        select k.p into p0 from aur_ticks k where k.tk = s.tk and k.t < now() - interval '2 minutes' order by k.t desc limit 1;
        dir := case when (p1 >= coalesce(p0, p1)) = (hashtext(r.pseudo) % 2 = 0) then 'up' else 'down' end;
        lev := (array[1, 5, 5, 10])[1 + floor(random() * 4)::int];
        if s.status = 'listed' then lev := least(lev, 5); end if;
        perform aur_open(r.id, s.tk, dir, lev, greatest(50, round(r.cash * (.02 + random() * .06))), 0);
      end if;
      n := n + 1;
    exception when others then null; -- marché suspendu, plafond, nombre de positions : il réessaiera plus tard
    end;
  end loop;
  -- Faillite d'un bot : il repart à 10 000 W, comme un joueur.
  update profiles p set cash = 10000, bankruptcies = bankruptcies + 1
   where p.bot and bk_value(p.id) < 2000 and not exists (select 1 from bets where user_id = p.id and status = 'open');
  return n;
end $$;
revoke execute on function bots_play() from public, anon, authenticated;
