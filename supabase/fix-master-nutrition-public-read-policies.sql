-- Make master nutrition reference data public-readable.
-- Apply after supabase/master-nutrition-schema.sql.
--
-- Read-only reference tables are exposed to anon/authenticated clients.
-- User-specific/history/import tables remain protected by their existing RLS.

begin;

grant usage on schema public to anon, authenticated;

grant select on table public.master_food_sources to anon, authenticated;
grant select on table public.master_foods to anon, authenticated;
grant select on table public.master_food_states to anon, authenticated;
grant select on table public.master_food_profiles to anon, authenticated;
grant select on table public.master_food_aliases to anon, authenticated;
grant select on table public.master_serving_sizes to anon, authenticated;
grant select on table public.master_recipe_templates to anon, authenticated;
grant select on table public.master_recipe_template_items to anon, authenticated;
grant select on table public.master_branded_foods to anon, authenticated;
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
alter table public.master_tiny_garnish_profiles enable row level security;
alter table public.master_food_classifications enable row level security;

drop policy if exists "master food sources are readable" on public.master_food_sources;
create policy "master food sources are readable"
on public.master_food_sources for select to anon, authenticated using (true);

drop policy if exists "master foods are readable" on public.master_foods;
create policy "master foods are readable"
on public.master_foods for select to anon, authenticated using (true);

drop policy if exists "master food states are readable" on public.master_food_states;
create policy "master food states are readable"
on public.master_food_states for select to anon, authenticated using (true);

drop policy if exists "master food profiles are readable" on public.master_food_profiles;
create policy "master food profiles are readable"
on public.master_food_profiles for select to anon, authenticated using (true);

drop policy if exists "master food aliases are readable" on public.master_food_aliases;
create policy "master food aliases are readable"
on public.master_food_aliases for select to anon, authenticated using (true);

drop policy if exists "master serving sizes are readable" on public.master_serving_sizes;
create policy "master serving sizes are readable"
on public.master_serving_sizes for select to anon, authenticated using (true);

drop policy if exists "master recipe templates are readable" on public.master_recipe_templates;
create policy "master recipe templates are readable"
on public.master_recipe_templates for select to anon, authenticated using (true);

drop policy if exists "master recipe template items are readable" on public.master_recipe_template_items;
create policy "master recipe template items are readable"
on public.master_recipe_template_items for select to anon, authenticated using (true);

drop policy if exists "master branded foods are readable" on public.master_branded_foods;
create policy "master branded foods are readable"
on public.master_branded_foods for select to anon, authenticated using (true);

drop policy if exists "master food classifications are readable" on public.master_food_classifications;
create policy "master food classifications are readable"
on public.master_food_classifications for select to anon, authenticated using (true);

drop policy if exists "master tiny garnish profiles are readable" on public.master_tiny_garnish_profiles;
create policy "master tiny garnish profiles are readable"
on public.master_tiny_garnish_profiles for select to anon, authenticated using (true);

commit;
