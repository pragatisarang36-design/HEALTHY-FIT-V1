-- Fix Supabase Security Advisor warning:
-- public.master_food_resolution_view should use invoker permissions, not owner permissions.

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

grant select on public.master_food_resolution_view to anon, authenticated;
