-- Master Nutrition verification.
-- Run in Supabase SQL Editor after:
-- 1. master-nutrition-schema.sql
-- 2. master-food-classifications-seed.sql
-- 3. imports/master_nutrition_sample_load.sql
-- 4. imports/master_recipe_templates_load.sql

select 'master_food_sources' as table_name, count(*) as rows from public.master_food_sources
union all select 'master_foods', count(*) from public.master_foods
union all select 'master_food_states', count(*) from public.master_food_states
union all select 'master_food_profiles', count(*) from public.master_food_profiles
union all select 'master_food_aliases', count(*) from public.master_food_aliases
union all select 'master_serving_sizes', count(*) from public.master_serving_sizes
union all select 'master_branded_foods', count(*) from public.master_branded_foods
union all select 'master_recipe_templates', count(*) from public.master_recipe_templates
union all select 'master_recipe_template_items', count(*) from public.master_recipe_template_items
union all select 'master_food_classifications', count(*) from public.master_food_classifications
order by table_name;

select
  fs.state_key,
  fs.state_name,
  f.canonical_name
from public.master_food_states fs
join public.master_foods f on f.id = fs.food_id
left join public.master_food_profiles p on p.food_state_id = fs.id and p.selected = true
where p.id is null
order by f.canonical_name, fs.state_key;

select
  f.canonical_name,
  fs.state_name,
  p.calories_per_100g,
  p.protein_per_100g,
  p.carbs_per_100g,
  p.fat_per_100g
from public.master_food_profiles p
join public.master_foods f on f.id = p.food_id
join public.master_food_states fs on fs.id = p.food_state_id
where p.selected = true
  and p.calories_per_100g = 0
  and p.protein_per_100g = 0
  and p.carbs_per_100g = 0
  and p.fat_per_100g = 0
order by f.canonical_name;

with inputs(search_key) as (
  values
    ('dal'),
    ('dal rice'),
    ('chicken curry'),
    ('shrimp curry'),
    ('prawn curry'),
    ('lime'),
    ('green chili'),
    ('chole'),
    ('pasta'),
    ('bhindi sabzi'),
    ('white rice')
)
select
  i.search_key as query,
  coalesce(
    exact.canonical_name,
    alias_match.canonical_name,
    recipe.canonical_name,
    classification.rules->>'canonical',
    i.search_key
  ) as resolved_name,
  case
    when exact.food_id is not null then 'exact_master_food'
    when alias_match.food_id is not null then 'alias_master_food'
    when recipe.id is not null then 'recipe_template'
    else classification.food_type
  end as source,
  classification.food_type,
  coalesce(exact.state_name, alias_match.state_name) as food_state,
  coalesce(exact.calories_per_100g, alias_match.calories_per_100g) as calories_per_100g,
  recipe.default_serving_grams as recipe_default_serving_grams
from inputs i
left join public.master_food_resolution_view exact
  on exact.search_key = i.search_key
left join public.master_food_aliases a
  on a.search_key = i.search_key
left join public.master_food_resolution_view alias_match
  on alias_match.food_id = a.food_id
 and (a.food_state_id is null or alias_match.food_state_id = a.food_state_id)
left join public.master_food_classifications classification
  on classification.search_key = i.search_key
left join public.master_recipe_templates recipe
  on recipe.search_key = i.search_key
  or recipe.search_key = classification.rules->>'canonical'
order by i.search_key;
