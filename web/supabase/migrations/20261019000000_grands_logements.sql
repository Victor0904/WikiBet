-- Quatre logements au-dessus du penthouse, aux prix qui montent fort. Chacun demande le précédent (buy_item).
insert into shop_items (id, kind, category, name, description, price, level, sort) values
  ('villa',   'home', null, 'Villa',      'Terrasse, palmiers et piscine à débordement.',          600000, 5, 5),
  ('manoir',  'home', null, 'Manoir',     'Boiseries, bibliothèque et grande cheminée.',          1500000, 6, 6),
  ('chateau', 'home', null, 'Château',    'Pierre de taille, bannières et salle du trône.',       4000000, 7, 7),
  ('ile',     'home', null, 'Île privée', 'Ton île, ton lagon, personne pour te déranger.',      10000000, 8, 8)
on conflict (id) do nothing;
