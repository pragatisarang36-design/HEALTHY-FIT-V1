-- Seed or repair a completed profile for the Playwright authenticated workout test.
-- Safe to run more than once.
--
-- Usage:
--   psql "$db" -v test_user_email="you@example.com" -v ON_ERROR_STOP=1 -f ".\supabase\seed-test-profile.sql"

insert into public.profiles (
  user_id,
  full_name,
  age,
  gender,
  height,
  weight,
  target_weight,
  fitness_goal,
  diet_preference,
  food_allergies,
  food_dislikes,
  water_goal_litres,
  is_profile_complete
)
select
  u.id,
  'Pragati',
  28,
  'female',
  170,
  50,
  40,
  'weight_loss',
  'non_vegetarian',
  '{}'::text[],
  '{}'::text[],
  2.5,
  true
from auth.users u
where lower(u.email) = lower(:'test_user_email')
on conflict (user_id) do update
set
  full_name = excluded.full_name,
  age = excluded.age,
  gender = excluded.gender,
  height = excluded.height,
  weight = excluded.weight,
  target_weight = excluded.target_weight,
  fitness_goal = excluded.fitness_goal,
  diet_preference = excluded.diet_preference,
  food_allergies = excluded.food_allergies,
  food_dislikes = excluded.food_dislikes,
  water_goal_litres = excluded.water_goal_litres,
  is_profile_complete = excluded.is_profile_complete;

select
  p.user_id,
  p.full_name,
  p.age,
  p.gender,
  p.height,
  p.weight,
  p.target_weight,
  p.fitness_goal,
  p.diet_preference,
  p.food_allergies,
  p.food_dislikes,
  p.water_goal_litres,
  p.is_profile_complete
from public.profiles p
join auth.users u on u.id = p.user_id
where lower(u.email) = lower(:'test_user_email');
