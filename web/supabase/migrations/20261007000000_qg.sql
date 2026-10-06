-- Le QG du trader : boutique, inventaire, patrimoine et bonus.
-- On dépense ses W en logements (paliers), objets de déco 3D, cosmétiques et bonus consommables.
-- Le classement se fait au patrimoine : solde + mises en cours + 60 % du prix des objets (leur valeur de revente).
-- Les bonus agissent par déclencheurs, sans toucher aux fonctions de règlement.

create table shop_items (
  id text primary key,
  kind text not null check (kind in ('home', 'decor', 'cosmetic', 'bonus')),
  category text,                       -- cosmétiques : theme, title ou effect
  name text not null,
  description text not null,
  price int not null check (price >= 0),
  level int not null default 0,        -- logement : son palier ; autres : palier de logement requis
  sort int not null default 0
);

insert into shop_items (id, kind, category, name, description, price, level, sort) values
  -- Logements : la chambre (palier 0) est offerte, chaque palier suivant demande le précédent.
  ('studio',     'home', null, 'Studio',      'Un vrai bureau et de la place pour un setup.',                 12000, 1, 1),
  ('openspace',  'home', null, 'Open space',  'Baies vitrées, vue sur la ville, place pour un canapé.',       35000, 2, 2),
  ('loft',       'home', null, 'Loft',        'Briques, verrière et hauteur sous plafond.',                   90000, 3, 3),
  ('penthouse',  'home', null, 'Penthouse',   'Le dernier étage de la tour, la ville à tes pieds.',          250000, 4, 4),
  -- Déco 3D
  ('lampe',        'decor', null, 'Lampe de bureau',        'Pour les séances qui finissent tard.',                 400, 0, 10),
  ('plante',       'decor', null, 'Monstera',               'Un peu de vert entre deux graphiques.',                600, 0, 11),
  ('tapis',        'decor', null, 'Tapis',                  'Le sol de la chambre mérite mieux.',                  1200, 0, 12),
  ('ecran2',       'decor', null, 'Deuxième écran',         'Un écran de plus pour suivre tes positions.',         1500, 0, 13),
  ('chaise',       'decor', null, 'Fauteuil gamer',         'Dossier haut, accoudoirs, liseré ambre.',             2500, 0, 14),
  ('neon',         'decor', null, 'Néon wiki·bourse',       'Ton enseigne lumineuse au mur.',                      3000, 0, 15),
  ('ecran3',       'decor', null, 'Troisième écran',        'Le setup triple écran des pros.',                     4000, 1, 20),
  ('micro',        'decor', null, 'Micro de stream',        'Bras articulé et micro studio.',                      3500, 1, 21),
  ('camera',       'decor', null, 'Caméra et lumière',      'Webcam sur pied et panneau LED.',                     3000, 1, 22),
  ('bibliotheque', 'decor', null, 'Bibliothèque',           'Des livres de finance, jamais ouverts.',              5000, 1, 23),
  ('canape',       'decor', null, 'Canapé',                 'Pour regarder les lives entre deux séances.',         6000, 1, 24),
  ('aquarium',     'decor', null, 'Aquarium',               'Les poissons ne connaissent pas la volatilité.',     12000, 2, 30),
  ('trophee',      'decor', null, 'Trophée d''or',          'Il brille sur son socle.',                           15000, 2, 31),
  ('arcade',       'decor', null, 'Borne d''arcade',        'Pour décompresser après une liquidation.',           18000, 2, 32),
  ('piano',        'decor', null, 'Piano à queue',          'Noir laqué, personne ne sait en jouer.',             30000, 3, 40),
  ('taureau',      'decor', null, 'Taureau de Wall Street', 'Le taureau en bronze, symbole de la hausse.',        40000, 3, 41),
  ('murecrans',    'decor', null, 'Mur d''écrans',          'Neuf écrans qui affichent le marché.',               60000, 3, 42),
  ('lingots',      'decor', null, 'Vitrine de lingots',     'Des lingots d''or sous verre. Pour la frime.',      120000, 4, 50),
  -- Cosmétiques (un seul équipé par catégorie)
  ('theme_cyan',      'cosmetic', 'theme',  'Thème cyan',          'Couleur d''accent du jeu.',                     2000, 0, 60),
  ('theme_violet',    'cosmetic', 'theme',  'Thème violet',        'Couleur d''accent du jeu.',                     2000, 0, 61),
  ('theme_rose',      'cosmetic', 'theme',  'Thème rose',          'Couleur d''accent du jeu.',                     2000, 0, 62),
  ('theme_or',        'cosmetic', 'theme',  'Thème or',            'Couleur d''accent du jeu, réservée aux grands appartements.', 25000, 2, 63),
  ('title_porteur',   'cosmetic', 'title',  'Petit porteur',       'Titre affiché sous ton pseudo.',                1000, 0, 70),
  ('title_dimanche',  'cosmetic', 'title',  'Trader du dimanche',  'Titre affiché sous ton pseudo.',                3000, 0, 71),
  ('title_requin',    'cosmetic', 'title',  'Requin de Wikipédia', 'Titre affiché sous ton pseudo.',               30000, 2, 72),
  ('title_loup',      'cosmetic', 'title',  'Loup de Twitch',      'Titre affiché sous ton pseudo.',               30000, 2, 73),
  ('title_oracle',    'cosmetic', 'title',  'Oracle',              'Titre affiché sous ton pseudo.',              100000, 3, 74),
  ('effet_confettis', 'cosmetic', 'effect', 'Pluie de confettis',  'Quand tu gagnes, des confettis tombent.',      5000, 0, 80),
  ('effet_billets',   'cosmetic', 'effect', 'Pluie de billets',    'Quand tu gagnes, il pleut des billets.',      15000, 1, 81),
  -- Bonus consommables
  ('assurance',  'bonus', null, 'Assurance liquidation', 'Rembourse 50 % de la mise de ta prochaine position liquidée.', 2500, 0, 90),
  ('boost_duel', 'bonus', null, 'Cote boostée',          '+20 % de cote sur ton prochain pari sur un duel.',             1500, 0, 91),
  ('salaire_x2', 'bonus', null, 'Salaire doublé',        'Salaire de séance doublé pendant 1 h, à activer quand tu veux.', 3000, 0, 92);

create table inventory (
  user_id uuid not null references profiles on delete cascade,
  item_id text not null references shop_items,
  qty int not null default 1 check (qty >= 0),
  equipped boolean not null default false,
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table profiles add column salary_boost_until timestamptz;
alter table bets add column insured boolean not null default false;

alter table shop_items enable row level security;
alter table inventory enable row level security;
create policy "lecture publique" on shop_items for select using (true);
create policy "QG visitables" on inventory for select using (true);

-- ===== Calculs =====
create function home_level(p_user uuid) returns int language sql stable set search_path = public as $$
  select coalesce(max(s.level), 0) from inventory i join shop_items s on s.id = i.item_id
  where i.user_id = p_user and s.kind = 'home' and i.qty > 0
$$;

create function patrimoine(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash
       + coalesce((select sum(b.stake) from bets b where b.user_id = p_user and b.status = 'open'), 0)
       + coalesce((select sum(floor(s.price * 0.6)) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'bonus' and i.qty > 0), 0)
  from profiles p where p.id = p_user
$$;

-- Utilise un bonus s'il en reste ; renvoie vrai si c'est le cas.
create function consume_bonus(p_user uuid, p_item text) returns boolean language plpgsql set search_path = public as $$
begin
  update inventory set qty = qty - 1 where user_id = p_user and item_id = p_item and qty > 0;
  return found;
end $$;

-- ===== Actions du joueur =====
create function equip_item(p_item text) returns void language plpgsql security definer set search_path = public as $$
declare it shop_items;
begin
  select * into it from shop_items where id = p_item and kind = 'cosmetic';
  if not found then raise exception 'Ce n''est pas un cosmétique.'; end if;
  if not exists (select 1 from inventory where user_id = auth.uid() and item_id = p_item and qty > 0) then
    raise exception 'Achète-le d''abord.';
  end if;
  update inventory set equipped = (item_id = p_item)
   where user_id = auth.uid() and item_id in (select id from shop_items where kind = 'cosmetic' and category = it.category);
end $$;

create function unequip(p_category text) returns void language sql security definer set search_path = public as $$
  update inventory set equipped = false
   where user_id = auth.uid() and item_id in (select id from shop_items where kind = 'cosmetic' and category = p_category)
$$;

create function buy_item(p_item text) returns inventory language plpgsql security definer set search_path = public as $$
declare it shop_items; inv inventory; lvl int;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into it from shop_items where id = p_item;
  if not found then raise exception 'Objet inconnu.'; end if;
  lvl := home_level(auth.uid());
  if it.kind <> 'bonus' and exists (select 1 from inventory where user_id = auth.uid() and item_id = p_item and qty > 0) then
    raise exception 'Tu l''as déjà.';
  end if;
  if it.kind = 'home' and it.level <> lvl + 1 then raise exception 'Il faut d''abord emménager dans le logement précédent.'; end if;
  if it.kind <> 'home' and it.level > lvl then raise exception 'Disponible à partir d''un logement plus grand.'; end if;
  update profiles set cash = cash - it.price where id = auth.uid() and cash >= it.price;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into inventory (user_id, item_id, qty) values (auth.uid(), p_item, 1)
    on conflict (user_id, item_id) do update set qty = inventory.qty + 1, bought_at = now();
  if it.kind = 'cosmetic' then perform equip_item(p_item); end if;
  select * into inv from inventory where user_id = auth.uid() and item_id = p_item;
  return inv;
end $$;

-- Revente à 60 % (déco et cosmétiques ; les logements et les bonus ne se revendent pas).
create function sell_item(p_item text) returns float8 language plpgsql security definer set search_path = public as $$
declare it shop_items; v float8;
begin
  select * into it from shop_items where id = p_item;
  if not found or it.kind not in ('decor', 'cosmetic') then raise exception 'Cet objet ne se revend pas.'; end if;
  update inventory set qty = 0, equipped = false where user_id = auth.uid() and item_id = p_item and qty > 0;
  if not found then raise exception 'Tu ne l''as pas.'; end if;
  v := floor(it.price * 0.6);
  update profiles set cash = cash + v where id = auth.uid();
  return v;
end $$;

-- Active le salaire doublé pour 1 h (cumulable).
create function use_bonus(p_item text) returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if p_item <> 'salaire_x2' then raise exception 'Ce bonus s''utilise tout seul, au bon moment.'; end if;
  if not consume_bonus(auth.uid(), p_item) then raise exception 'Tu n''en as plus.'; end if;
  update profiles set salary_boost_until = greatest(coalesce(salary_boost_until, now()), now()) + interval '1 hour'
   where id = auth.uid() returning * into p;
  return p;
end $$;

-- Classement au patrimoine, avec le logement et le titre de chacun.
create function leaderboard() returns table (id uuid, pseudo text, cash float8, patrimoine float8, bankruptcies int, home int, title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.cash, patrimoine(p.id), p.bankruptcies, home_level(p.id),
         (select s.name from inventory i join shop_items s on s.id = i.item_id
           where i.user_id = p.id and i.equipped and s.category = 'title' limit 1)
  from profiles p order by 4 desc limit 50
$$;

-- ===== Effets des bonus =====
-- Cote boostée : appliquée à la création d'un pari sur un duel.
-- Assurance : quand une position (article ou streamer) est liquidée, rend 50 % de la mise.
-- (La faillite ferme aussi les paris à 0, mais sans cours de sortie : elle n'est pas couverte.)
create function bets_bonus() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
  elsif old.status = 'open' and new.status = 'lost' and coalesce(new.payout, 0) = 0 and new.kind in ('trade', 'stream')
        and new.exit is not null and consume_bonus(new.user_id, 'assurance') then
    new.payout := new.stake * 0.5; new.insured := true;
    update profiles set cash = cash + new.payout where id = new.user_id;
  end if;
  return new;
end $$;
create trigger bets_bonus before insert or update on bets for each row execute function bets_bonus();

-- Salaire doublé : 500 W de plus à chaque salaire versé pendant l'heure active.
create function salary_bonus() returns trigger language plpgsql set search_path = public as $$
begin
  update profiles set cash = cash + 500 where id = new.user_id and salary_boost_until > now();
  return new;
end $$;
create trigger salary_bonus after insert on salaries for each row execute function salary_bonus();

revoke execute on function consume_bonus(uuid, text) from public, anon, authenticated;
revoke execute on function buy_item(text), sell_item(text), equip_item(text), unequip(text), use_bonus(text) from public, anon;
grant execute on function buy_item(text), sell_item(text), equip_item(text), unequip(text), use_bonus(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table inventory;
  end if;
end $$;
