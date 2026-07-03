-- Run this in Supabase SQL Editor for the project used by .env.local.
-- It grants authenticated users table access, then limits every row to its owner.

grant usage on schema public to authenticated;

create extension if not exists pg_trgm;

alter table public.meals add column if not exists notes text;
alter table public.meals add column if not exists date date default current_date;
alter table public.meals add column if not exists photo_url text;
alter table public.meal_plans add column if not exists plan_json jsonb default '{}'::jsonb;
alter table public.meal_plans add column if not exists plan_data jsonb;
alter table public.meal_plans add column if not exists plan_type text;
alter table public.meal_plans add column if not exists "filter" text;
alter table public.meal_plans add column if not exists date_generated date;
alter table public.meal_plans alter column plan_data drop not null;
alter table public.meal_plans alter column plan_data set default '{}'::jsonb;
alter table public.meal_plans alter column plan_type drop not null;
alter table public.meal_plans alter column plan_type drop default;
alter table public.meal_plans alter column "filter" drop not null;
alter table public.meal_plans alter column "filter" drop default;
alter table public.meal_plans alter column date_generated drop not null;
alter table public.meal_plans alter column date_generated drop default;

create table if not exists public.nutrition_foods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category text,
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fats_per_100g numeric not null default 0,
  source text not null default 'local',
  source_id text,
  verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_food_aliases (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.nutrition_foods(id) on delete cascade,
  alias text not null,
  search_key text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists nutrition_foods_source_id_idx
on public.nutrition_foods (source, source_id)
where source_id is not null;

create index if not exists nutrition_food_aliases_search_key_idx
on public.nutrition_food_aliases (search_key);

create index if not exists nutrition_food_aliases_search_key_trgm_idx
on public.nutrition_food_aliases using gin (search_key gin_trgm_ops);

create index if not exists nutrition_food_aliases_alias_trgm_idx
on public.nutrition_food_aliases using gin (alias gin_trgm_ops);

create unique index if not exists nutrition_food_aliases_food_alias_idx
on public.nutrition_food_aliases (food_id, search_key);

create table if not exists public.food_state_profiles (
  id uuid primary key default gen_random_uuid(),
  canonical_food_name text not null,
  search_key text not null,
  state text not null,
  region text,
  aliases text[] not null default '{}',
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fats_per_100g numeric not null default 0,
  default_serving_grams numeric,
  source text not null default 'state_profile',
  confidence numeric not null default 0.75,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists food_state_profiles_state_search_key_idx
on public.food_state_profiles (state, search_key);

create index if not exists food_state_profiles_search_key_idx
on public.food_state_profiles (search_key);

create index if not exists food_state_profiles_aliases_idx
on public.food_state_profiles using gin (aliases);

create table if not exists public.unresolved_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  food_name text not null,
  normalized_name text not null,
  quantity text not null default '',
  context text not null default 'nutrition_resolver',
  metadata jsonb not null default '{}'::jsonb,
  times_seen integer not null default 1,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.unresolved_foods add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.unresolved_foods add column if not exists times_seen integer not null default 1;
alter table public.unresolved_foods add column if not exists resolved boolean not null default false;

create unique index if not exists unresolved_foods_user_name_qty_context_idx
on public.unresolved_foods (user_id, normalized_name, quantity, context);

create index if not exists unresolved_foods_normalized_name_idx
on public.unresolved_foods (normalized_name);

create index if not exists unresolved_foods_resolved_idx
on public.unresolved_foods (resolved);

create index if not exists nutrition_foods_source_idx
on public.nutrition_foods (source);

create index if not exists nutrition_foods_name_trgm_idx
on public.nutrition_foods using gin (name gin_trgm_ops);

create index if not exists nutrition_foods_brand_trgm_idx
on public.nutrition_foods using gin (brand gin_trgm_ops)
where brand is not null;

create table if not exists public.serving_sizes (
  id uuid primary key default gen_random_uuid(),
  food_name text not null,
  search_key text not null,
  unit text not null,
  grams numeric,
  ml numeric,
  category text,
  source text not null default 'seed',
  source_detail text,
  source_url text,
  priority integer not null default 50,
  confidence numeric not null default 0.8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.serving_sizes add column if not exists source_detail text;
alter table public.serving_sizes add column if not exists source_url text;
alter table public.serving_sizes add column if not exists priority integer not null default 50;

create unique index if not exists serving_sizes_food_unit_idx
on public.serving_sizes (search_key, unit);

create index if not exists serving_sizes_search_key_idx
on public.serving_sizes (search_key);

create table if not exists public.user_serving_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  food_name text not null,
  search_key text not null,
  unit text not null,
  grams numeric,
  ml numeric,
  confidence numeric not null default 0.85,
  times_used integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_serving_corrections_user_food_unit_idx
on public.user_serving_corrections (user_id, search_key, unit);

create table if not exists public.recipe_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  search_key text not null,
  aliases text[] not null default '{}',
  category text,
  cuisine text,
  default_serving_grams numeric,
  source text not null default 'seed',
  confidence numeric not null default 0.75,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recipe_templates_search_key_idx
on public.recipe_templates (search_key);

create table if not exists public.recipe_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.recipe_templates(id) on delete cascade,
  ingredient_name text not null,
  quantity text not null,
  sort_order integer not null default 0,
  required boolean not null default true,
  source text not null default 'seed',
  created_at timestamptz not null default now()
);

alter table public.recipe_template_items add column if not exists percentage numeric;
alter table public.recipe_template_items add column if not exists min_percentage numeric;
alter table public.recipe_template_items add column if not exists max_percentage numeric;

create unique index if not exists recipe_template_items_template_sort_idx
on public.recipe_template_items (template_id, sort_order);

with foods(name, category, calories, protein, carbs, fats, aliases) as (
  values
    ('Egg', 'protein', 143, 12.6, 0.7, 9.5, array['egg', 'eggs', 'boiled egg']),
    ('Chicken breast cooked', 'protein', 165, 31, 0, 3.6, array['chicken', 'chicken breast', 'boiled chicken', 'grilled chicken', 'shredded chicken']),
    ('Toast', 'grains', 313, 11.3, 57.5, 4.2, array['toast', 'toasted bread', 'bread toast']),
    ('White bread', 'grains', 265, 9, 49, 3.2, array['bread', 'white bread']),
    ('Cooked quinoa', 'grains', 120, 4.4, 21.3, 1.9, array['quinoa', 'cooked quinoa']),
    ('Cucumber', 'vegetables', 15, 0.7, 3.6, 0.1, array['cucumber', 'cucumber slices']),
    ('Bell pepper', 'vegetables', 31, 1, 6, 0.3, array['bell pepper', 'red bell pepper', 'red pepper', 'yellow bell pepper', 'yellow pepper', 'green pepper']),
    ('Avocado', 'fruits', 160, 2, 8.5, 14.7, array['avocado']),
    ('Blueberries', 'fruits', 57, 0.7, 14.5, 0.3, array['blueberry', 'blueberries']),
    ('Raspberries', 'fruits', 52, 1.2, 11.9, 0.7, array['raspberry', 'raspberries']),
    ('Grapes', 'fruits', 69, 0.7, 18.1, 0.2, array['grape', 'grapes']),
    ('Crackers', 'snacks', 500, 10, 57, 27, array['cracker', 'crackers', 'simple mills crackers', 'almond flour crackers']),
    ('Cooked white rice', 'indian_grains', 130, 2.7, 28.2, 0.3, array['rice', 'white rice', 'cooked rice', 'steamed rice', 'plain rice', 'chawal', 'bhaat', 'annam', 'sadam']),
    ('Chapati', 'indian_grains', 244, 7.8, 40, 6.7, array['chapati', 'roti', 'phulka', 'fulka', 'rotli', 'plain roti']),
    ('Paratha', 'indian_grains', 300, 7, 42, 11, array['paratha', 'plain paratha', 'parantha', 'parota']),
    ('Poori', 'indian_grains', 330, 7, 46, 13, array['poori', 'puri']),
    ('Idli', 'indian_grains', 149, 5.1, 30, 0.8, array['idli', 'idly', 'steamed idli']),
    ('Dosa', 'indian_grains', 165, 3.9, 29, 3.7, array['dosa', 'plain dosa', 'dosai']),
    ('Masala dosa', 'indian_mixed', 139, 3.3, 21.1, 4.4, array['masala dosa', 'masala dosai']),
    ('Uttapam', 'indian_grains', 180, 5, 30, 4, array['uttapam', 'uthappam']),
    ('Poha', 'indian_breakfast', 180, 3.5, 28, 6, array['poha', 'pohe', 'aval upma', 'flattened rice']),
    ('Upma', 'indian_breakfast', 155, 4, 25, 5, array['upma', 'rava upma', 'sooji upma', 'suji upma']),
    ('Vermicelli upma', 'indian_breakfast', 170, 4, 31, 4, array['vermicelli upma', 'semiya upma', 'seviyan upma']),
    ('Dal', 'indian_legumes', 110, 6, 16, 2.5, array['dal', 'daal', 'dhal', 'dal soup', 'lentil soup', 'yellow dal', 'moong dal', 'toor dal', 'arhar dal', 'masoor dal', 'dal tadka']),
    ('Sambar', 'indian_legumes', 76, 3.4, 10, 2.4, array['sambar', 'sambhar', 'sambaar']),
    ('Rasam', 'indian_soup', 35, 1.2, 5.5, 1, array['rasam', 'charu', 'saaru']),
    ('Rajma curry', 'indian_legumes', 125, 6.5, 18, 3, array['rajma', 'rajma curry', 'kidney bean curry']),
    ('Chole', 'indian_legumes', 164, 7.5, 22, 5, array['chole', 'chana masala', 'chickpea curry', 'channa masala']),
    ('Kala chana', 'indian_legumes', 150, 8, 24, 3, array['kala chana', 'black chana', 'black chickpea curry']),
    ('Paneer curry', 'indian_curry', 190, 9, 7, 14, array['paneer curry', 'paneer sabzi', 'paneer gravy']),
    ('Paneer butter masala', 'indian_curry', 210, 8, 8, 16, array['paneer butter masala', 'paneer makhani']),
    ('Palak paneer', 'indian_curry', 170, 8, 7, 12, array['palak paneer', 'saag paneer']),
    ('Chicken curry', 'indian_curry', 170, 16, 5, 10, array['chicken curry', 'chicken gravy']),
    ('Egg curry', 'indian_curry', 155, 10, 5, 11, array['egg curry', 'anda curry']),
    ('Fish curry', 'indian_curry', 130, 14, 4, 7, array['fish curry', 'meen curry']),
    ('Bhindi sabzi', 'indian_vegetables', 95, 2, 10, 5, array['bhindi', 'bhindi sabzi', 'bhindi fry', 'okra', 'okra fry', 'fried okra', 'okra stir fry', 'lady finger']),
    ('Aloo sabzi', 'indian_vegetables', 120, 2.2, 18, 4.5, array['aloo sabzi', 'aloo curry', 'potato sabzi', 'potato curry']),
    ('Aloo gobi', 'indian_vegetables', 110, 3, 15, 4.5, array['aloo gobi', 'aloo gobhi', 'potato cauliflower']),
    ('Baingan bharta', 'indian_vegetables', 100, 2, 12, 5, array['baingan bharta', 'eggplant bharta', 'brinjal bharta']),
    ('Mixed veg sabzi', 'indian_vegetables', 85, 2.5, 12, 3.5, array['mixed veg', 'mixed veg sabzi', 'mixed vegetable sabzi', 'vegetable curry', 'mixed vegetables']),
    ('Cabbage sabzi', 'indian_vegetables', 70, 2, 9, 3, array['cabbage sabzi', 'cabbage poriyal']),
    ('Beans poriyal', 'indian_vegetables', 80, 3, 10, 3, array['beans poriyal', 'green beans sabzi', 'beans sabzi']),
    ('Carrot beans poriyal', 'indian_vegetables', 80, 2.5, 11, 3, array['carrot beans poriyal', 'carrot beans sabzi']),
    ('Curd rice', 'indian_rice', 118, 3.5, 18, 3.5, array['curd rice', 'yogurt rice', 'thayir sadam', 'dahi chawal']),
    ('Lemon rice', 'indian_rice', 165, 3, 28, 5, array['lemon rice', 'chitranna', 'nimbu rice']),
    ('Tomato rice', 'indian_rice', 150, 3, 27, 4, array['tomato rice', 'thakkali sadam']),
    ('Tamarind rice', 'indian_rice', 180, 4, 32, 5, array['tamarind rice', 'puliyogare', 'pulihora']),
    ('Vegetable pulao', 'indian_rice', 150, 3.5, 26, 4, array['pulao', 'pulav', 'veg pulao', 'vegetable pulao']),
    ('Biryani', 'indian_rice', 170, 7, 24, 5, array['biryani', 'chicken biryani', 'veg biryani', 'vegetable biryani', 'dum biryani']),
    ('Fried rice', 'indian_rice', 160, 4.5, 25, 5, array['fried rice', 'veg fried rice', 'vegetable fried rice', 'chicken fried rice', 'egg fried rice']),
    ('Khichdi', 'indian_mixed', 110, 4, 18, 2.5, array['khichdi', 'khichadi', 'kichadi', 'dal khichdi']),
    ('Pongal', 'indian_breakfast', 135, 4, 22, 4, array['pongal', 'ven pongal', 'khara pongal']),
    ('Curd', 'dairy', 61, 3.5, 4.7, 3.3, array['curd', 'dahi', 'yogurt', 'plain curd']),
    ('Raita', 'dairy', 70, 3, 6, 3.5, array['raita', 'boondi raita', 'cucumber raita']),
    ('Pakora', 'indian_snacks', 320, 8, 30, 18, array['pakora', 'pakoda', 'bhajiya', 'fritters']),
    ('Samosa', 'indian_snacks', 310, 6, 34, 17, array['samosa', 'samosas']),
    ('Vada', 'indian_snacks', 280, 8, 28, 15, array['vada', 'medu vada', 'vadai']),
    ('Pav bhaji', 'indian_snacks', 150, 4, 22, 5, array['pav bhaji', 'paav bhaji']),
    ('Dhokla', 'indian_snacks', 160, 6, 28, 3.5, array['dhokla', 'khaman']),
    ('Kachori', 'indian_snacks', 360, 8, 38, 20, array['kachori', 'kachodi']),
    ('Papad', 'indian_snacks', 330, 20, 60, 2, array['papad', 'papadum', 'appalam']),
    ('Gulab jamun', 'indian_sweets', 320, 5, 52, 10, array['gulab jamun']),
    ('Rasgulla', 'indian_sweets', 186, 4, 38, 2, array['rasgulla', 'rosogolla']),
    ('Jalebi', 'indian_sweets', 390, 3, 67, 12, array['jalebi']),
    ('Kheer', 'indian_sweets', 135, 4, 22, 4, array['kheer', 'payasam', 'payasa']),
    ('Halwa', 'indian_sweets', 300, 5, 42, 12, array['halwa', 'sheera', 'sooji halwa', 'suji halwa']),
    ('Laddu', 'indian_sweets', 430, 9, 55, 18, array['laddu', 'ladoo', 'besan laddu', 'motichoor laddu'])
),
inserted as (
  insert into public.nutrition_foods (name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fats_per_100g, source, verified)
  select name, category, calories, protein, carbs, fats, 'seed', true
  from foods
  on conflict do nothing
  returning id, name
)
insert into public.nutrition_food_aliases (food_id, alias, search_key)
select nf.id, alias, btrim(lower(regexp_replace(alias, '[^a-z0-9]+', ' ', 'g')))
from public.nutrition_foods nf
join foods f on f.name = nf.name
cross join unnest(f.aliases) as alias
on conflict do nothing;

with state_profiles(canonical_food_name, search_key, state, region, aliases, calories, protein, carbs, fats, default_serving_grams, confidence) as (
  values
    ('Dal Tadka', 'punjabi dal tadka', 'punjab', 'north_india', array['punjabi dal tadka', 'punjabi dal', 'north indian dal tadka'], 120, 6.2, 16, 3.5, 180, 0.74),
    ('Gujarati Dal', 'gujarati dal', 'gujarat', 'west_india', array['gujarati dal'], 95, 4.8, 15.8, 1.8, 180, 0.72),
    ('Andhra Pappu', 'andhra pappu', 'andhra_pradesh', 'south_india', array['andhra dal', 'andhra pappu', 'pappu'], 116, 6.4, 16.8, 2.8, 180, 0.72),
    ('Tamil Sambar', 'tamil sambar', 'tamil_nadu', 'south_india', array['tamil sambar', 'tamil nadu sambar'], 78, 3.6, 10.5, 2.3, 150, 0.72),
    ('Karnataka Sambar', 'karnataka sambar', 'karnataka', 'south_india', array['karnataka sambar', 'udupi sambar'], 84, 3.7, 12, 2.6, 150, 0.72),
    ('Tamil Rasam', 'tamil rasam', 'tamil_nadu', 'south_india', array['tamil rasam', 'milagu rasam'], 35, 1.2, 5.5, 1, 150, 0.72),
    ('Kerala Fish Curry', 'kerala fish curry', 'kerala', 'south_india', array['kerala fish curry', 'meen curry'], 150, 13, 4, 9, 150, 0.7),
    ('Bengali Fish Curry', 'bengali fish curry', 'west_bengal', 'east_india', array['bengali fish curry', 'macher jhol'], 118, 14, 5, 5, 150, 0.7),
    ('Punjabi Chole', 'punjabi chole', 'punjab', 'north_india', array['punjabi chole', 'punjabi chana masala'], 175, 7.6, 23, 6, 150, 0.72),
    ('Punjabi Rajma', 'punjabi rajma', 'punjab', 'north_india', array['punjabi rajma', 'rajma chawal rajma'], 135, 6.8, 19, 3.8, 150, 0.72),
    ('Maharashtrian Poha', 'maharashtrian poha', 'maharashtra', 'west_india', array['maharashtrian poha', 'kanda poha'], 185, 3.8, 29, 6.2, 180, 0.72),
    ('Gujarati Khichdi', 'gujarati khichdi', 'gujarat', 'west_india', array['gujarati khichdi'], 112, 4.2, 18.5, 2.5, 220, 0.7),
    ('Punjabi Kadhi', 'punjabi kadhi', 'punjab', 'north_india', array['punjabi kadhi', 'kadhi pakora'], 118, 4.5, 12, 5.8, 180, 0.68),
    ('Thayir Sadam', 'thayir sadam', 'tamil_nadu', 'south_india', array['tamil curd rice', 'thayir sadam'], 118, 3.5, 18, 3.5, 250, 0.72),
    ('Chitranna', 'chitranna', 'karnataka', 'south_india', array['karnataka lemon rice', 'chitranna'], 168, 3.2, 28, 5.2, 250, 0.72),
    ('Phulka', 'phulka', 'punjab', 'north_india', array['punjabi roti', 'punjabi chapati', 'phulka', 'fulka'], 230, 7.5, 42, 3.8, 40, 0.72)
)
insert into public.food_state_profiles (
  canonical_food_name,
  search_key,
  state,
  region,
  aliases,
  calories_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fats_per_100g,
  default_serving_grams,
  source,
  confidence
)
select canonical_food_name, search_key, state, region, aliases, calories, protein, carbs, fats, default_serving_grams, 'seed', confidence
from state_profiles
on conflict (state, search_key) do update
set canonical_food_name = excluded.canonical_food_name,
    region = excluded.region,
    aliases = excluded.aliases,
    calories_per_100g = excluded.calories_per_100g,
    protein_per_100g = excluded.protein_per_100g,
    carbs_per_100g = excluded.carbs_per_100g,
    fats_per_100g = excluded.fats_per_100g,
    default_serving_grams = excluded.default_serving_grams,
    source = excluded.source,
    confidence = excluded.confidence,
    updated_at = now();

with sizes(food_name, search_key, unit, grams, ml, category, source_detail, source_url, priority, confidence) as (
  values
    ('Egg', 'egg', 'piece', 50, null, 'protein', 'USDA/FDC common household measure', 'https://fdc.nal.usda.gov/', 20, 0.9),
    ('Fried egg', 'fried egg', 'piece', 46, null, 'protein', 'USDA/FDC common household measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Toast', 'toast', 'slice', 24, null, 'grains', 'USDA/FDC common household measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('White bread', 'bread', 'slice', 28, null, 'grains', 'USDA/FDC common household measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Whole wheat bread', 'whole wheat bread', 'slice', 32, null, 'grains', 'USDA/FDC common household measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Cooked rice', 'rice', 'cup', 158, null, 'grains', 'USDA/FDC cup measure', 'https://fdc.nal.usda.gov/', 20, 0.8),
    ('Cooked rice', 'rice', 'serving', 150, null, 'grains', 'Diet manual consensus portion', null, 45, 0.75),
    ('Cooked brown rice', 'brown rice', 'cup', 195, null, 'grains', 'USDA/FDC cup measure', 'https://fdc.nal.usda.gov/', 20, 0.8),
    ('Cooked brown rice', 'brown rice', 'serving', 150, null, 'grains', 'Diet manual consensus portion', null, 45, 0.75),
    ('Chicken breast cooked', 'chicken breast', 'serving', 100, null, 'protein', 'Dietitian/diet manual common portion', null, 45, 0.8),
    ('Grilled salmon', 'grilled salmon', 'serving', 120, null, 'protein', 'Dietitian/diet manual common portion', null, 45, 0.8),
    ('Paneer', 'paneer', 'serving', 100, null, 'protein', 'Indian diet manual common portion', null, 45, 0.8),
    ('Chapati', 'chapati', 'piece', 45, null, 'grains', 'Indian diet manual common portion', null, 45, 0.8),
    ('Roti', 'roti', 'piece', 45, null, 'grains', 'Indian diet manual common portion', null, 45, 0.8),
    ('Idli', 'idli', 'piece', 39, null, 'grains', 'Indian diet manual common portion', null, 45, 0.8),
    ('Dosa', 'dosa', 'piece', 100, null, 'grains', 'Indian diet manual common portion', null, 45, 0.75),
    ('Banana', 'banana', 'piece', 118, null, 'fruit', 'USDA/FDC medium fruit measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Orange', 'orange', 'piece', 131, null, 'fruit', 'USDA/FDC medium fruit measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Apple', 'apple', 'piece', 182, null, 'fruit', 'USDA/FDC medium fruit measure', 'https://fdc.nal.usda.gov/', 20, 0.85),
    ('Mango', 'mango', 'serving', 100, null, 'fruit', 'IFCT/NIN practical Indian serving', 'https://www.nin.res.in/ebooks/IFCT2017.pdf', 25, 0.75),
    ('Cucumber', 'cucumber', 'serving', 50, null, 'vegetables', 'Diet manual common side portion', null, 45, 0.75),
    ('Tomato', 'tomato', 'serving', 80, null, 'vegetables', 'Diet manual common side portion', null, 45, 0.75),
    ('Carrot', 'carrot', 'serving', 80, null, 'vegetables', 'Diet manual common side portion', null, 45, 0.75),
    ('Spinach', 'spinach', 'cup', 30, null, 'vegetables', 'USDA/FDC cup measure', 'https://fdc.nal.usda.gov/', 20, 0.8),
    ('Arugula', 'arugula', 'cup', 20, null, 'vegetables', 'USDA/FDC cup measure', 'https://fdc.nal.usda.gov/', 20, 0.8),
    ('Olive oil', 'olive oil', 'tbsp', 13.5, 15, 'oil', 'FDA RACC/USDA tablespoon convention', 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.12', 10, 0.9),
    ('Ghee', 'ghee', 'tbsp', 13, 15, 'oil', 'Indian cooking measure consensus', null, 45, 0.85),
    ('Butter', 'butter', 'tbsp', 14, 15, 'oil', 'USDA/FDC tablespoon measure', 'https://fdc.nal.usda.gov/', 20, 0.9),
    ('Peanut butter', 'peanut butter', 'tbsp', 16, null, 'spread', 'FDA RACC/USDA tablespoon convention', 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.12', 10, 0.85),
    ('Almonds', 'almonds', 'piece', 1.2, null, 'nuts', 'USDA/FDC nut piece approximation', 'https://fdc.nal.usda.gov/', 25, 0.75),
    ('Almonds', 'almonds', 'serving', 28, null, 'nuts', 'FDA RACC nut serving convention', 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.12', 10, 0.85),
    ('Walnuts', 'walnuts', 'piece', 2, null, 'nuts', 'USDA/FDC nut piece approximation', 'https://fdc.nal.usda.gov/', 25, 0.75),
    ('Walnuts', 'walnuts', 'serving', 28, null, 'nuts', 'FDA RACC nut serving convention', 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.12', 10, 0.85),
    ('Cooked white rice', 'rice', 'serving', 150, null, 'indian_grains', 'Indian practical serving', null, 30, 0.8),
    ('Cooked white rice', 'rice', 'cup', 158, null, 'indian_grains', 'USDA/FDC cup measure', 'https://fdc.nal.usda.gov/', 20, 0.8),
    ('Chapati', 'chapati', 'piece', 45, null, 'indian_grains', 'Indian practical serving', null, 30, 0.85),
    ('Roti', 'roti', 'piece', 45, null, 'indian_grains', 'Indian practical serving', null, 30, 0.85),
    ('Paratha', 'paratha', 'piece', 80, null, 'indian_grains', 'Indian practical serving', null, 35, 0.75),
    ('Poori', 'poori', 'piece', 40, null, 'indian_grains', 'Indian practical serving', null, 35, 0.75),
    ('Idli', 'idli', 'piece', 39, null, 'indian_grains', 'Indian practical serving', null, 30, 0.85),
    ('Dosa', 'dosa', 'piece', 100, null, 'indian_grains', 'Indian practical serving', null, 35, 0.75),
    ('Masala dosa', 'masala dosa', 'piece', 180, null, 'indian_grains', 'Indian practical serving', null, 35, 0.75),
    ('Poha', 'poha', 'serving', 180, null, 'indian_breakfast', 'Indian practical serving', null, 35, 0.75),
    ('Upma', 'upma', 'serving', 180, null, 'indian_breakfast', 'Indian practical serving', null, 35, 0.75),
    ('Dal', 'dal', 'serving', 150, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.8),
    ('Dal', 'dal', 'cup', 200, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.75),
    ('Sambar', 'sambar', 'serving', 150, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.75),
    ('Sambar', 'sambar', 'cup', 240, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.75),
    ('Rasam', 'rasam', 'serving', 150, null, 'indian_soup', 'Indian practical serving', null, 35, 0.75),
    ('Rajma curry', 'rajma', 'serving', 150, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.75),
    ('Chole', 'chole', 'serving', 150, null, 'indian_legumes', 'Indian practical serving', null, 35, 0.75),
    ('Paneer curry', 'paneer curry', 'serving', 150, null, 'indian_curry', 'Indian practical serving', null, 35, 0.75),
    ('Chicken curry', 'chicken curry', 'serving', 150, null, 'indian_curry', 'Indian practical serving', null, 35, 0.75),
    ('Egg curry', 'egg curry', 'serving', 150, null, 'indian_curry', 'Indian practical serving', null, 35, 0.75),
    ('Bhindi sabzi', 'bhindi', 'serving', 100, null, 'indian_vegetables', 'Indian practical serving', null, 35, 0.75),
    ('Aloo sabzi', 'aloo sabzi', 'serving', 120, null, 'indian_vegetables', 'Indian practical serving', null, 35, 0.75),
    ('Mixed veg sabzi', 'mixed veg', 'serving', 120, null, 'indian_vegetables', 'Indian practical serving', null, 35, 0.75),
    ('Curd rice', 'curd rice', 'serving', 250, null, 'indian_rice', 'Indian practical serving', null, 35, 0.75),
    ('Lemon rice', 'lemon rice', 'serving', 250, null, 'indian_rice', 'Indian practical serving', null, 35, 0.75),
    ('Vegetable pulao', 'pulao', 'serving', 300, null, 'indian_rice', 'Indian practical serving', null, 35, 0.75),
    ('Biryani', 'biryani', 'serving', 350, null, 'indian_rice', 'Indian practical serving', null, 35, 0.75),
    ('Fried rice', 'fried rice', 'serving', 300, null, 'indian_rice', 'Indian practical serving', null, 35, 0.75),
    ('Samosa', 'samosa', 'piece', 65, null, 'indian_snacks', 'Indian practical serving', null, 35, 0.75),
    ('Vada', 'vada', 'piece', 45, null, 'indian_snacks', 'Indian practical serving', null, 35, 0.75),
    ('Pakora', 'pakora', 'serving', 100, null, 'indian_snacks', 'Indian practical serving', null, 35, 0.75),
    ('Gulab jamun', 'gulab jamun', 'piece', 50, null, 'indian_sweets', 'Indian practical serving', null, 35, 0.75)
)
insert into public.serving_sizes (food_name, search_key, unit, grams, ml, category, source, source_detail, source_url, priority, confidence)
select food_name, search_key, unit, grams, ml, category, 'seed', source_detail, source_url, priority, confidence
from (
  select distinct on (search_key, unit)
    food_name, search_key, unit, grams, ml, category, source_detail, source_url, priority, confidence
  from sizes
  order by search_key, unit, priority asc
) deduped_sizes
on conflict (search_key, unit) do update
set food_name = excluded.food_name,
    grams = excluded.grams,
    ml = excluded.ml,
    category = excluded.category,
    source_detail = excluded.source_detail,
    source_url = excluded.source_url,
    priority = excluded.priority,
    confidence = excluded.confidence,
    updated_at = now();

with templates(name, search_key, aliases, category, cuisine, default_serving_grams, confidence) as (
  values
    ('Biryani', 'biryani', array['biryani', 'chicken biryani', 'veg biryani', 'vegetable biryani'], 'mixed_dish', 'indian', 350, 0.72),
    ('Pasta', 'pasta', array['pasta', 'red sauce pasta', 'white sauce pasta'], 'mixed_dish', 'global', 300, 0.68),
    ('Curry', 'curry', array['curry', 'indian curry', 'vegetable curry', 'chicken curry'], 'mixed_dish', 'indian', 250, 0.65),
    ('Sandwich', 'sandwich', array['sandwich', 'veg sandwich', 'chicken sandwich'], 'mixed_dish', 'global', 180, 0.7),
    ('Smoothie', 'smoothie', array['smoothie', 'fruit smoothie', 'protein smoothie'], 'mixed_dish', 'global', 300, 0.68),
    ('Fried rice', 'fried rice', array['fried rice', 'veg fried rice', 'chicken fried rice'], 'mixed_dish', 'asian', 300, 0.7),
    ('Paneer butter masala', 'paneer butter masala', array['paneer butter masala', 'paneer makhani'], 'mixed_dish', 'indian', 300, 0.74),
    ('Sambar rice', 'sambar rice', array['sambar rice', 'rice with sambar'], 'mixed_dish', 'indian', 350, 0.72),
    ('Dal rice', 'dal rice', array['dal rice', 'rice dal', 'dal chawal', 'rice with dal'], 'mixed_dish', 'indian', 350, 0.72),
    ('Rajma rice', 'rajma rice', array['rajma rice', 'rajma chawal'], 'mixed_dish', 'indian', 350, 0.72),
    ('Chole rice', 'chole rice', array['chole rice', 'chana rice'], 'mixed_dish', 'indian', 350, 0.72),
    ('Curd rice', 'curd rice', array['curd rice', 'yogurt rice', 'thayir sadam', 'dahi chawal'], 'mixed_dish', 'indian', 250, 0.72),
    ('Lemon rice', 'lemon rice', array['lemon rice', 'chitranna', 'nimbu rice'], 'mixed_dish', 'indian', 250, 0.72),
    ('Poha', 'poha', array['poha', 'pohe', 'aval upma'], 'mixed_dish', 'indian', 180, 0.7),
    ('Upma', 'upma', array['upma', 'rava upma', 'sooji upma', 'suji upma'], 'mixed_dish', 'indian', 180, 0.7),
    ('Pav bhaji', 'pav bhaji', array['pav bhaji', 'paav bhaji'], 'mixed_dish', 'indian', 300, 0.7),
    ('Aloo paratha', 'aloo paratha', array['aloo paratha', 'potato paratha'], 'mixed_dish', 'indian', 180, 0.7),
    ('Paneer curry', 'paneer curry', array['paneer curry', 'paneer sabzi', 'paneer gravy'], 'mixed_dish', 'indian', 250, 0.7),
    ('Chicken curry', 'chicken curry', array['chicken curry', 'chicken gravy'], 'mixed_dish', 'indian', 250, 0.7),
    ('Egg curry', 'egg curry', array['egg curry', 'anda curry'], 'mixed_dish', 'indian', 220, 0.7)
)
insert into public.recipe_templates (name, search_key, aliases, category, cuisine, default_serving_grams, source, confidence)
select name, search_key, aliases, category, cuisine, default_serving_grams, 'seed', confidence
from templates
on conflict (search_key) do update
set aliases = excluded.aliases,
    category = excluded.category,
    cuisine = excluded.cuisine,
    default_serving_grams = excluded.default_serving_grams,
    confidence = excluded.confidence,
    updated_at = now();

with template_items(template_key, ingredient_name, quantity, sort_order) as (
  values
    ('biryani', 'cooked rice', '190g', 1),
    ('biryani', 'chicken breast', '80g', 2),
    ('biryani', 'onion', '35g', 3),
    ('biryani', 'ghee', '1 tsp', 4),
    ('biryani', 'yogurt', '30g', 5),
    ('pasta', 'pasta', '180g', 1),
    ('pasta', 'tomato sauce', '80g', 2),
    ('pasta', 'olive oil', '1 tsp', 3),
    ('pasta', 'cheese', '20g', 4),
    ('curry', 'paneer', '90g', 1),
    ('curry', 'tomato sauce', '80g', 2),
    ('curry', 'onion', '50g', 3),
    ('curry', 'oil', '1 tsp', 4),
    ('sandwich', 'bread', '2 slices', 1),
    ('sandwich', 'cheese', '20g', 2),
    ('sandwich', 'tomato', '30g', 3),
    ('sandwich', 'cucumber', '30g', 4),
    ('smoothie', 'milk', '180ml', 1),
    ('smoothie', 'banana', '60g', 2),
    ('smoothie', 'yogurt', '80g', 3),
    ('fried rice', 'cooked rice', '220g', 1),
    ('fried rice', 'egg', '1 piece', 2),
    ('fried rice', 'oil', '1 tsp', 3),
    ('fried rice', 'carrot', '30g', 4),
    ('fried rice', 'onion', '25g', 5),
    ('paneer butter masala', 'paneer', '100g', 1),
    ('paneer butter masala', 'tomato sauce', '90g', 2),
    ('paneer butter masala', 'butter', '1 tbsp', 3),
    ('paneer butter masala', 'milk', '40ml', 4),
    ('sambar rice', 'cooked rice', '220g', 1),
    ('sambar rice', 'sambar', '130g', 2),
    ('dal rice', 'cooked rice', '220g', 1),
    ('dal rice', 'dal', '130g', 2),
    ('rajma rice', 'cooked rice', '210g', 1),
    ('rajma rice', 'rajma', '140g', 2),
    ('chole rice', 'cooked rice', '210g', 1),
    ('chole rice', 'chole', '140g', 2),
    ('curd rice', 'cooked rice', '170g', 1),
    ('curd rice', 'curd', '80g', 2),
    ('curd rice', 'oil', '1 tsp', 3),
    ('lemon rice', 'cooked rice', '220g', 1),
    ('lemon rice', 'oil', '1 tsp', 2),
    ('lemon rice', 'peanuts', '10g', 3),
    ('poha', 'poha', '160g', 1),
    ('poha', 'oil', '1 tsp', 2),
    ('poha', 'peanuts', '10g', 3),
    ('upma', 'upma', '170g', 1),
    ('upma', 'oil', '1 tsp', 2),
    ('upma', 'mixed vegetables', '30g', 3),
    ('pav bhaji', 'mixed vegetables', '180g', 1),
    ('pav bhaji', 'butter', '1 tbsp', 2),
    ('pav bhaji', 'bread', '2 slices', 3),
    ('aloo paratha', 'paratha', '100g', 1),
    ('aloo paratha', 'aloo sabzi', '80g', 2),
    ('paneer curry', 'paneer', '100g', 1),
    ('paneer curry', 'tomato sauce', '80g', 2),
    ('paneer curry', 'oil', '1 tsp', 3),
    ('chicken curry', 'chicken breast', '120g', 1),
    ('chicken curry', 'tomato sauce', '80g', 2),
    ('chicken curry', 'oil', '1 tsp', 3),
    ('egg curry', 'egg', '2 pieces', 1),
    ('egg curry', 'tomato sauce', '80g', 2),
    ('egg curry', 'oil', '1 tsp', 3)
),
deleted as (
  delete from public.recipe_template_items rti
  using public.recipe_templates rt
  where rti.template_id = rt.id
    and rt.search_key in (select distinct template_key from template_items)
)
insert into public.recipe_template_items (template_id, ingredient_name, quantity, sort_order, required, source)
select rt.id, ti.ingredient_name, ti.quantity, ti.sort_order, true, 'seed'
from template_items ti
join public.recipe_templates rt on rt.search_key = ti.template_key
on conflict (template_id, sort_order) do update
set ingredient_name = excluded.ingredient_name,
    quantity = excluded.quantity,
    required = excluded.required,
    source = excluded.source;

with templates(name, search_key, aliases, category, cuisine, default_serving_grams, confidence) as (
  values
    ('Shrimp Curry', 'shrimp curry', array['shrimp curry', 'prawn curry', 'prawns curry'], 'mixed_dish', 'indian', 250, 0.72),
    ('Chicken Biryani', 'chicken biryani', array['chicken biryani', 'dum biryani'], 'mixed_dish', 'indian', 380, 0.72),
    ('Vegetable Biryani', 'veg biryani', array['veg biryani', 'vegetable biryani'], 'mixed_dish', 'indian', 350, 0.72),
    ('Dal Tadka', 'dal tadka', array['dal tadka', 'yellow dal tadka'], 'mixed_dish', 'indian', 180, 0.72),
    ('Aloo Gobi', 'aloo gobi', array['aloo gobi', 'aloo gobhi'], 'mixed_dish', 'indian', 150, 0.7),
    ('Palak Paneer', 'palak paneer', array['palak paneer', 'saag paneer'], 'mixed_dish', 'indian', 250, 0.72),
    ('Mixed Vegetable Curry', 'mixed vegetable curry', array['mixed vegetable curry', 'vegetable curry', 'mixed veg curry'], 'mixed_dish', 'indian', 180, 0.7),
    ('Pizza', 'pizza', array['pizza', 'pizza slice'], 'mixed_dish', 'global', 250, 0.68)
)
insert into public.recipe_templates (name, search_key, aliases, category, cuisine, default_serving_grams, source, confidence)
select name, search_key, aliases, category, cuisine, default_serving_grams, 'seed', confidence
from templates
on conflict (search_key) do update
set aliases = excluded.aliases,
    category = excluded.category,
    cuisine = excluded.cuisine,
    default_serving_grams = excluded.default_serving_grams,
    confidence = excluded.confidence,
    updated_at = now();

with template_items(template_key, ingredient_name, percentage, min_percentage, max_percentage, sort_order) as (
  values
    ('shrimp curry', 'shrimp', 45, 35, 55, 1),
    ('shrimp curry', 'onion tomato gravy', 30, 22, 38, 2),
    ('shrimp curry', 'oil', 8, 4, 10, 3),
    ('shrimp curry', 'spices', 5, 2, 7, 4),
    ('shrimp curry', 'coconut curry base', 12, 5, 18, 5),
    ('chicken curry', 'chicken breast', 48, 38, 58, 1),
    ('chicken curry', 'onion tomato gravy', 34, 25, 42, 2),
    ('chicken curry', 'oil', 6, 3, 9, 3),
    ('chicken curry', 'spices', 4, 2, 6, 4),
    ('chicken curry', 'curd base', 8, 0, 14, 5),
    ('egg curry', 'egg', 45, 35, 52, 1),
    ('egg curry', 'onion tomato gravy', 40, 30, 48, 2),
    ('egg curry', 'oil', 7, 3, 10, 3),
    ('egg curry', 'spices', 4, 2, 6, 4),
    ('paneer butter masala', 'paneer', 38, 30, 48, 1),
    ('paneer butter masala', 'onion tomato gravy', 38, 30, 45, 2),
    ('paneer butter masala', 'butter', 7, 4, 10, 3),
    ('paneer butter masala', 'milk', 13, 5, 18, 4),
    ('dal tadka', 'dal', 82, 75, 88, 1),
    ('dal tadka', 'oil', 5, 2, 8, 2),
    ('dal tadka', 'onion tomato gravy', 9, 4, 14, 3),
    ('veg biryani', 'cooked rice', 62, 55, 70, 1),
    ('veg biryani', 'mixed vegetables', 22, 15, 30, 2),
    ('veg biryani', 'oil', 5, 3, 8, 3),
    ('veg biryani', 'curd', 7, 0, 12, 4),
    ('chicken biryani', 'cooked rice', 55, 48, 62, 1),
    ('chicken biryani', 'chicken breast', 27, 20, 35, 2),
    ('chicken biryani', 'oil', 5, 3, 8, 3),
    ('chicken biryani', 'curd', 8, 3, 12, 4),
    ('fried rice', 'cooked rice', 72, 65, 80, 1),
    ('fried rice', 'mixed vegetables', 15, 8, 22, 2),
    ('fried rice', 'oil', 5, 3, 8, 3),
    ('fried rice', 'egg', 8, 0, 16, 4),
    ('pulao', 'cooked rice', 72, 65, 80, 1),
    ('pulao', 'mixed vegetables', 17, 10, 24, 2),
    ('pulao', 'oil', 5, 3, 8, 3),
    ('poha', 'poha', 82, 75, 88, 1),
    ('poha', 'oil', 5, 3, 8, 2),
    ('poha', 'peanuts', 6, 2, 10, 3),
    ('upma', 'upma', 84, 76, 90, 1),
    ('upma', 'mixed vegetables', 9, 4, 14, 2),
    ('upma', 'oil', 5, 3, 8, 3),
    ('sambar', 'sambar', 88, 80, 94, 1),
    ('sambar', 'mixed vegetables', 7, 2, 12, 2),
    ('sambar', 'oil', 3, 1, 5, 3),
    ('rasam', 'rasam', 92, 86, 96, 1),
    ('rasam', 'tomato', 4, 1, 8, 2),
    ('rasam', 'oil', 2, 0, 4, 3),
    ('chole', 'chole', 82, 75, 90, 1),
    ('chole', 'onion tomato gravy', 12, 6, 18, 2),
    ('chole', 'oil', 4, 2, 7, 3),
    ('rajma', 'rajma', 82, 75, 90, 1),
    ('rajma', 'onion tomato gravy', 12, 6, 18, 2),
    ('rajma', 'oil', 4, 2, 7, 3),
    ('aloo gobi', 'aloo sabzi', 45, 35, 55, 1),
    ('aloo gobi', 'mixed vegetables', 42, 32, 52, 2),
    ('aloo gobi', 'oil', 7, 3, 10, 3),
    ('palak paneer', 'paneer', 36, 28, 45, 1),
    ('palak paneer', 'spinach', 42, 34, 52, 2),
    ('palak paneer', 'onion tomato gravy', 12, 6, 18, 3),
    ('palak paneer', 'oil', 6, 3, 9, 4),
    ('mixed vegetable curry', 'mixed vegetables', 78, 68, 86, 1),
    ('mixed vegetable curry', 'onion tomato gravy', 14, 8, 20, 2),
    ('mixed vegetable curry', 'oil', 5, 2, 8, 3),
    ('pasta', 'pasta', 70, 62, 78, 1),
    ('pasta', 'tomato sauce', 18, 10, 28, 2),
    ('pasta', 'cheese', 7, 0, 12, 3),
    ('pasta', 'oil', 5, 2, 8, 4),
    ('sandwich', 'bread', 55, 45, 65, 1),
    ('sandwich', 'cheese', 12, 0, 18, 2),
    ('sandwich', 'tomato', 10, 4, 16, 3),
    ('sandwich', 'cucumber', 10, 4, 16, 4),
    ('smoothie', 'milk', 55, 45, 65, 1),
    ('smoothie', 'banana', 20, 10, 30, 2),
    ('smoothie', 'yogurt', 20, 10, 30, 3),
    ('smoothie', 'berries', 5, 0, 12, 4),
    ('pizza', 'pizza dough', 55, 45, 65, 1),
    ('pizza', 'mozzarella cheese', 18, 12, 26, 2),
    ('pizza', 'tomato sauce', 15, 8, 22, 3),
    ('pizza', 'oil', 4, 2, 7, 4),
    ('pizza', 'mixed vegetables', 8, 0, 15, 5)
),
deleted as (
  delete from public.recipe_template_items rti
  using public.recipe_templates rt
  where rti.template_id = rt.id
    and rt.search_key in (select distinct template_key from template_items)
)
insert into public.recipe_template_items (template_id, ingredient_name, quantity, sort_order, required, source, percentage, min_percentage, max_percentage)
select rt.id, ti.ingredient_name, '', ti.sort_order, true, 'seed', ti.percentage, ti.min_percentage, ti.max_percentage
from template_items ti
join public.recipe_templates rt on rt.search_key = ti.template_key
on conflict (template_id, sort_order) do update
set ingredient_name = excluded.ingredient_name,
    quantity = excluded.quantity,
    required = excluded.required,
    source = excluded.source,
    percentage = excluded.percentage,
    min_percentage = excluded.min_percentage,
    max_percentage = excluded.max_percentage;

create table if not exists public.food_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_name text not null,
  food_name text not null,
  quantity text not null default '1 serving',
  calories numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fats numeric not null default 0,
  source text not null default 'manual',
  confidence numeric not null default 0.7,
  times_used integer not null default 1,
  verified_by_user boolean not null default true,
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.food_estimates add column if not exists ingredients jsonb not null default '[]'::jsonb;

create table if not exists public.custom_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barcode text not null,
  product_name text not null,
  brand text,
  serving_size text not null default '100g',
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fats_per_100g numeric not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists food_estimates_user_food_qty_idx
on public.food_estimates (user_id, normalized_name, quantity);

create unique index if not exists custom_products_user_barcode_idx
on public.custom_products (user_id, barcode);

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.meals to authenticated;
grant select, insert, update, delete on table public.workouts to authenticated;
grant select, insert, update, delete on table public.water_logs to authenticated;
grant select, insert, update, delete on table public.meal_plans to authenticated;
grant select, insert, update, delete on table public.food_estimates to authenticated;
grant select, insert, update, delete on table public.custom_products to authenticated;
grant select, insert, update, delete on table public.user_serving_corrections to authenticated;
grant select, insert, update on table public.unresolved_foods to authenticated;
grant select on table public.nutrition_foods to authenticated;
grant select on table public.nutrition_food_aliases to authenticated;
grant select on table public.food_state_profiles to authenticated;
grant select on table public.serving_sizes to authenticated;
grant select on table public.recipe_templates to authenticated;
grant select on table public.recipe_template_items to authenticated;

grant usage, select on all sequences in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.workouts enable row level security;
alter table public.water_logs enable row level security;
alter table public.meal_plans enable row level security;
alter table public.food_estimates enable row level security;
alter table public.custom_products enable row level security;
alter table public.nutrition_foods enable row level security;
alter table public.nutrition_food_aliases enable row level security;
alter table public.food_state_profiles enable row level security;
alter table public.serving_sizes enable row level security;
alter table public.user_serving_corrections enable row level security;
alter table public.unresolved_foods enable row level security;
alter table public.recipe_templates enable row level security;
alter table public.recipe_template_items enable row level security;

drop policy if exists "profiles are owned by user" on public.profiles;
create policy "profiles are owned by user"
on public.profiles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "meals are owned by user" on public.meals;
create policy "meals are owned by user"
on public.meals
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "workouts are owned by user" on public.workouts;
create policy "workouts are owned by user"
on public.workouts
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "water logs are owned by user" on public.water_logs;
create policy "water logs are owned by user"
on public.water_logs
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "meal plans are owned by user" on public.meal_plans;
create policy "meal plans are owned by user"
on public.meal_plans
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "food estimates are owned by user" on public.food_estimates;
create policy "food estimates are owned by user"
on public.food_estimates
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "custom products are owned by user" on public.custom_products;
create policy "custom products are owned by user"
on public.custom_products
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "nutrition foods are readable" on public.nutrition_foods;
create policy "nutrition foods are readable"
on public.nutrition_foods
for select
to authenticated
using (true);

drop policy if exists "nutrition aliases are readable" on public.nutrition_food_aliases;
create policy "nutrition aliases are readable"
on public.nutrition_food_aliases
for select
to authenticated
using (true);

drop policy if exists "food state profiles are readable" on public.food_state_profiles;
create policy "food state profiles are readable"
on public.food_state_profiles
for select
to authenticated
using (true);

drop policy if exists "serving sizes are readable" on public.serving_sizes;
create policy "serving sizes are readable"
on public.serving_sizes
for select
to authenticated
using (true);

drop policy if exists "serving corrections are owned by user" on public.user_serving_corrections;
create policy "serving corrections are owned by user"
on public.user_serving_corrections
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "unresolved foods are owned by user" on public.unresolved_foods;
create policy "unresolved foods are owned by user"
on public.unresolved_foods
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "recipe templates are readable" on public.recipe_templates;
create policy "recipe templates are readable"
on public.recipe_templates
for select
to authenticated
using (true);

drop policy if exists "recipe template items are readable" on public.recipe_template_items;
create policy "recipe template items are readable"
on public.recipe_template_items
for select
to authenticated
using (true);
