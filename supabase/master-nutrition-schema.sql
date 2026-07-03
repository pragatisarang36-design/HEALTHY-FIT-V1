-- Master Nutrition Database schema.
-- Run after app-access-policies.sql. This is additive and does not change the
-- existing meal logging, photo, manual entry, or resolver flow.

grant usage on schema public to authenticated;
create extension if not exists pg_trgm;

create table if not exists public.master_food_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_name text not null,
  source_type text not null default 'nutrition',
  priority integer not null default 100,
  license text,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_foods (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  search_key text not null unique,
  category text,
  cuisine text,
  default_state_key text not null default 'unknown',
  confidence numeric not null default 0.75,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_food_states (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.master_foods(id) on delete cascade,
  state_key text not null,
  state_name text not null,
  preparation_method text,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists master_food_states_food_state_idx
on public.master_food_states (food_id, state_key);

create index if not exists master_food_states_state_key_idx
on public.master_food_states (state_key);

create table if not exists public.master_food_profiles (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.master_foods(id) on delete cascade,
  food_state_id uuid not null references public.master_food_states(id) on delete cascade,
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  fiber_per_100g numeric,
  water_per_100g numeric,
  nutrition_source_id uuid references public.master_food_sources(id) on delete set null,
  confidence numeric not null default 0.75,
  verified boolean not null default false,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_food_profiles_nonnegative_macros check (
    calories_per_100g >= 0 and
    protein_per_100g >= 0 and
    carbs_per_100g >= 0 and
    fat_per_100g >= 0 and
    coalesce(fiber_per_100g, 0) >= 0 and
    coalesce(water_per_100g, 0) >= 0
  )
);

create unique index if not exists master_food_profiles_selected_state_idx
on public.master_food_profiles (food_state_id)
where selected;

create index if not exists master_food_profiles_food_idx
on public.master_food_profiles (food_id);

create index if not exists master_food_profiles_source_idx
on public.master_food_profiles (nutrition_source_id);

create table if not exists public.master_food_aliases (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.master_foods(id) on delete cascade,
  food_state_id uuid references public.master_food_states(id) on delete cascade,
  alias text not null,
  search_key text not null,
  language text,
  region text,
  cuisine text,
  source_id uuid references public.master_food_sources(id) on delete set null,
  confidence numeric not null default 0.8,
  alias_status text not null default 'active',
  lookup_mode text not null default 'direct',
  requires_context boolean not null default false,
  risk_level text not null default 'safe',
  created_at timestamptz not null default now()
);

alter table public.master_food_aliases
add column if not exists alias_status text not null default 'active';

alter table public.master_food_aliases
add column if not exists lookup_mode text not null default 'direct';

alter table public.master_food_aliases
add column if not exists requires_context boolean not null default false;

alter table public.master_food_aliases
add column if not exists risk_level text not null default 'safe';

create unique index if not exists master_food_aliases_food_alias_state_idx
on public.master_food_aliases (food_id, search_key, coalesce(food_state_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists master_food_aliases_search_key_idx
on public.master_food_aliases (search_key);

create index if not exists master_food_aliases_lookup_mode_idx
on public.master_food_aliases (alias_status, lookup_mode, requires_context, risk_level);

create index if not exists master_food_aliases_search_key_trgm_idx
on public.master_food_aliases using gin (search_key gin_trgm_ops);

create index if not exists master_food_aliases_alias_trgm_idx
on public.master_food_aliases using gin (alias gin_trgm_ops);

create table if not exists public.master_serving_sizes (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.master_foods(id) on delete cascade,
  food_state_id uuid references public.master_food_states(id) on delete cascade,
  serving_name text not null,
  serving_key text not null,
  grams numeric,
  ml numeric,
  source_id uuid references public.master_food_sources(id) on delete set null,
  priority integer not null default 50,
  confidence numeric not null default 0.8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_serving_sizes_has_measure check (grams is not null or ml is not null)
);

create unique index if not exists master_serving_sizes_food_state_serving_idx
on public.master_serving_sizes (food_id, coalesce(food_state_id, '00000000-0000-0000-0000-000000000000'::uuid), serving_key);

create index if not exists master_serving_sizes_serving_key_idx
on public.master_serving_sizes (serving_key);

create table if not exists public.master_recipe_templates (
  id uuid primary key default gen_random_uuid(),
  canonical_food_id uuid references public.master_foods(id) on delete set null,
  canonical_name text not null,
  search_key text not null unique,
  cuisine text,
  default_serving_grams numeric,
  source_id uuid references public.master_food_sources(id) on delete set null,
  confidence numeric not null default 0.7,
  recipe_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_recipe_templates_name_trgm_idx
on public.master_recipe_templates using gin (canonical_name gin_trgm_ops);

create table if not exists public.master_recipe_template_items (
  id uuid primary key default gen_random_uuid(),
  recipe_template_id uuid not null references public.master_recipe_templates(id) on delete cascade,
  ingredient_food_id uuid references public.master_foods(id) on delete set null,
  ingredient_state_id uuid references public.master_food_states(id) on delete set null,
  ingredient_name text not null,
  ingredient_search_key text not null,
  percentage numeric not null,
  min_percentage numeric,
  max_percentage numeric,
  required boolean not null default true,
  sort_order integer not null default 0,
  source_id uuid references public.master_food_sources(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint master_recipe_item_percentage_bounds check (
    percentage >= 0 and percentage <= 100 and
    coalesce(min_percentage, percentage) >= 0 and
    coalesce(max_percentage, percentage) <= 100 and
    coalesce(min_percentage, percentage) <= percentage and
    coalesce(max_percentage, percentage) >= percentage
  )
);

create unique index if not exists master_recipe_template_items_template_sort_idx
on public.master_recipe_template_items (recipe_template_id, sort_order);

create index if not exists master_recipe_template_items_ingredient_idx
on public.master_recipe_template_items (ingredient_food_id);

create table if not exists public.master_branded_foods (
  id uuid primary key default gen_random_uuid(),
  food_id uuid references public.master_foods(id) on delete set null,
  brand text not null,
  product_name text not null,
  barcode text,
  serving_size text,
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  fiber_per_100g numeric,
  source_id uuid references public.master_food_sources(id) on delete set null,
  external_id text,
  confidence numeric not null default 0.75,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists master_branded_foods_barcode_idx
on public.master_branded_foods (barcode)
where barcode is not null;

create unique index if not exists master_branded_foods_source_external_idx
on public.master_branded_foods (source_id, external_id)
where external_id is not null;

create index if not exists master_branded_foods_product_trgm_idx
on public.master_branded_foods using gin (product_name gin_trgm_ops);

create table if not exists public.master_food_source_links (
  id uuid primary key default gen_random_uuid(),
  food_id uuid references public.master_foods(id) on delete cascade,
  food_state_id uuid references public.master_food_states(id) on delete cascade,
  recipe_template_id uuid references public.master_recipe_templates(id) on delete cascade,
  branded_food_id uuid references public.master_branded_foods(id) on delete cascade,
  source_id uuid not null references public.master_food_sources(id) on delete cascade,
  external_id text,
  external_name text,
  raw_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint master_food_source_links_one_target check (
    ((food_id is not null)::integer +
     (recipe_template_id is not null)::integer +
     (branded_food_id is not null)::integer) = 1
  )
);

create unique index if not exists master_food_source_links_source_external_idx
on public.master_food_source_links (source_id, external_id)
where external_id is not null;

create table if not exists public.master_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.master_food_sources(id) on delete set null,
  dataset_name text not null,
  dataset_version text,
  raw_path text,
  processed_path text,
  status text not null default 'pending',
  rows_processed integer not null default 0,
  foods_imported integer not null default 0,
  foods_merged integer not null default 0,
  aliases_created integer not null default 0,
  serving_sizes_created integer not null default 0,
  recipe_templates_created integer not null default 0,
  conflicts integer not null default 0,
  failed_rows integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.master_import_failures (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.master_import_batches(id) on delete cascade,
  source_id uuid references public.master_food_sources(id) on delete set null,
  row_number integer,
  raw_record jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists master_import_failures_batch_idx
on public.master_import_failures (batch_id);

create table if not exists public.master_nutrition_conflicts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.master_import_batches(id) on delete set null,
  food_id uuid references public.master_foods(id) on delete cascade,
  food_state_id uuid references public.master_food_states(id) on delete cascade,
  nutrient text not null,
  source_a_id uuid references public.master_food_sources(id) on delete set null,
  source_b_id uuid references public.master_food_sources(id) on delete set null,
  value_a numeric,
  value_b numeric,
  selected_value numeric,
  reason text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists master_nutrition_conflicts_food_idx
on public.master_nutrition_conflicts (food_id, food_state_id);

create table if not exists public.master_user_food_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  food_id uuid references public.master_foods(id) on delete set null,
  food_state_id uuid references public.master_food_states(id) on delete set null,
  original_food_name text not null,
  corrected_food_name text,
  original_quantity text,
  corrected_grams numeric,
  original_macros jsonb not null default '{}'::jsonb,
  corrected_macros jsonb not null default '{}'::jsonb,
  context text not null default 'meal_logging',
  times_used integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_user_food_corrections_user_idx
on public.master_user_food_corrections (user_id);

create table if not exists public.master_unresolved_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  food_name text not null,
  normalized_name text not null,
  source_context text not null default 'nutrition_resolver',
  meal_id uuid,
  image_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  times_seen integer not null default 1,
  resolved_food_id uuid references public.master_foods(id) on delete set null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_unresolved_foods_normalized_idx
on public.master_unresolved_foods (normalized_name);

create index if not exists master_unresolved_foods_resolved_idx
on public.master_unresolved_foods (resolved);

create table if not exists public.master_tiny_garnish_profiles (
  id uuid primary key default gen_random_uuid(),
  food_name text not null,
  search_key text not null unique,
  aliases text[] not null default '{}',
  default_grams numeric not null default 3,
  calories_per_100g numeric not null default 0,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  fiber_per_100g numeric,
  source_id uuid references public.master_food_sources(id) on delete set null,
  confidence numeric not null default 0.75,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_tiny_garnish_profiles_search_idx
on public.master_tiny_garnish_profiles (search_key);

create table if not exists public.master_food_classifications (
  id uuid primary key default gen_random_uuid(),
  search_key text not null unique,
  food_type text not null,
  food_state_key text,
  canonical_food_id uuid references public.master_foods(id) on delete set null,
  confidence numeric not null default 0.75,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_food_classifications_type_idx
on public.master_food_classifications (food_type);

insert into public.master_food_sources (source_key, source_name, source_type, priority, source_url)
values
  ('ifct', 'Indian Food Composition Tables 2017', 'nutrition', 10, 'https://www.nin.res.in/ebooks/IFCT2017.pdf'),
  ('indb', 'Indian Nutrient Database', 'nutrition', 20, null),
  ('usda_fdc', 'USDA FoodData Central', 'nutrition', 30, 'https://fdc.nal.usda.gov/'),
  ('open_food_facts', 'Open Food Facts', 'branded_food', 40, 'https://world.openfoodfacts.org/'),
  ('recipe_derived', 'Recipe-derived aggregate', 'recipe', 50, null),
  ('ai_internal', 'AI/Internal estimate', 'estimate', 60, null)
on conflict (source_key) do update
set source_name = excluded.source_name,
    source_type = excluded.source_type,
    priority = excluded.priority,
    source_url = excluded.source_url,
    updated_at = now();

create or replace view public.master_food_resolution_view
with (security_invoker = true) as
select
  f.id as food_id,
  fs.id as food_state_id,
  f.canonical_name,
  f.search_key,
  f.category,
  f.cuisine,
  fs.state_key,
  fs.state_name,
  p.calories_per_100g,
  p.protein_per_100g,
  p.carbs_per_100g,
  p.fat_per_100g,
  p.fiber_per_100g,
  p.water_per_100g,
  s.source_key as nutrition_source,
  p.confidence
from public.master_foods f
join public.master_food_states fs on fs.food_id = f.id
join public.master_food_profiles p on p.food_state_id = fs.id and p.selected = true
left join public.master_food_sources s on s.id = p.nutrition_source_id
where f.active = true;

grant select on table public.master_food_sources to anon, authenticated;
grant select on table public.master_foods to anon, authenticated;
grant select on table public.master_food_states to anon, authenticated;
grant select on table public.master_food_profiles to anon, authenticated;
grant select on table public.master_food_aliases to anon, authenticated;
grant select on table public.master_serving_sizes to anon, authenticated;
grant select on table public.master_recipe_templates to anon, authenticated;
grant select on table public.master_recipe_template_items to anon, authenticated;
grant select on table public.master_branded_foods to anon, authenticated;
grant select on table public.master_food_source_links to authenticated;
grant select on table public.master_import_batches to authenticated;
grant select on table public.master_import_failures to authenticated;
grant select on table public.master_nutrition_conflicts to authenticated;
grant select, insert, update on table public.master_user_food_corrections to authenticated;
grant select, insert, update on table public.master_unresolved_foods to authenticated;
grant select on table public.master_tiny_garnish_profiles to anon, authenticated;
grant select on table public.master_food_classifications to anon, authenticated;
grant select on public.master_food_resolution_view to anon, authenticated;

revoke insert, update, delete on table public.master_food_sources from anon, authenticated;
revoke insert, update, delete on table public.master_foods from anon, authenticated;
revoke insert, update, delete on table public.master_food_states from anon, authenticated;
revoke insert, update, delete on table public.master_food_profiles from anon, authenticated;
revoke insert, update, delete on table public.master_food_aliases from anon, authenticated;
revoke insert, update, delete on table public.master_serving_sizes from anon, authenticated;
revoke insert, update, delete on table public.master_recipe_templates from anon, authenticated;
revoke insert, update, delete on table public.master_recipe_template_items from anon, authenticated;
revoke insert, update, delete on table public.master_branded_foods from anon, authenticated;
revoke insert, update, delete on table public.master_tiny_garnish_profiles from anon, authenticated;
revoke insert, update, delete on table public.master_food_classifications from anon, authenticated;

alter table public.master_food_sources enable row level security;
alter table public.master_foods enable row level security;
alter table public.master_food_states enable row level security;
alter table public.master_food_profiles enable row level security;
alter table public.master_food_aliases enable row level security;
alter table public.master_serving_sizes enable row level security;
alter table public.master_recipe_templates enable row level security;
alter table public.master_recipe_template_items enable row level security;
alter table public.master_branded_foods enable row level security;
alter table public.master_food_source_links enable row level security;
alter table public.master_import_batches enable row level security;
alter table public.master_import_failures enable row level security;
alter table public.master_nutrition_conflicts enable row level security;
alter table public.master_user_food_corrections enable row level security;
alter table public.master_unresolved_foods enable row level security;
alter table public.master_tiny_garnish_profiles enable row level security;
alter table public.master_food_classifications enable row level security;

drop policy if exists "master food sources are readable" on public.master_food_sources;
create policy "master food sources are readable" on public.master_food_sources for select to anon, authenticated using (true);

drop policy if exists "master foods are readable" on public.master_foods;
create policy "master foods are readable" on public.master_foods for select to anon, authenticated using (true);

drop policy if exists "master food states are readable" on public.master_food_states;
create policy "master food states are readable" on public.master_food_states for select to anon, authenticated using (true);

drop policy if exists "master food profiles are readable" on public.master_food_profiles;
create policy "master food profiles are readable" on public.master_food_profiles for select to anon, authenticated using (true);

drop policy if exists "master food aliases are readable" on public.master_food_aliases;
create policy "master food aliases are readable" on public.master_food_aliases for select to anon, authenticated using (true);

drop policy if exists "master serving sizes are readable" on public.master_serving_sizes;
create policy "master serving sizes are readable" on public.master_serving_sizes for select to anon, authenticated using (true);

drop policy if exists "master recipe templates are readable" on public.master_recipe_templates;
create policy "master recipe templates are readable" on public.master_recipe_templates for select to anon, authenticated using (true);

drop policy if exists "master recipe template items are readable" on public.master_recipe_template_items;
create policy "master recipe template items are readable" on public.master_recipe_template_items for select to anon, authenticated using (true);

drop policy if exists "master branded foods are readable" on public.master_branded_foods;
create policy "master branded foods are readable" on public.master_branded_foods for select to anon, authenticated using (true);

drop policy if exists "master food source links are readable" on public.master_food_source_links;
create policy "master food source links are readable" on public.master_food_source_links for select to authenticated using (true);

drop policy if exists "master import batches are readable" on public.master_import_batches;
create policy "master import batches are readable" on public.master_import_batches for select to authenticated using (true);

drop policy if exists "master import failures are readable" on public.master_import_failures;
create policy "master import failures are readable" on public.master_import_failures for select to authenticated using (true);

drop policy if exists "master nutrition conflicts are readable" on public.master_nutrition_conflicts;
create policy "master nutrition conflicts are readable" on public.master_nutrition_conflicts for select to authenticated using (true);

drop policy if exists "master food classifications are readable" on public.master_food_classifications;
create policy "master food classifications are readable" on public.master_food_classifications for select to anon, authenticated using (true);

drop policy if exists "master tiny garnish profiles are readable" on public.master_tiny_garnish_profiles;
create policy "master tiny garnish profiles are readable" on public.master_tiny_garnish_profiles for select to anon, authenticated using (true);

drop policy if exists "master user corrections are owned by user" on public.master_user_food_corrections;
create policy "master user corrections are owned by user"
on public.master_user_food_corrections
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "master unresolved foods are owned by user" on public.master_unresolved_foods;
create policy "master unresolved foods are owned by user"
on public.master_unresolved_foods
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
