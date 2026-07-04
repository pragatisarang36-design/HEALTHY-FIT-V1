-- Additive profile preference columns used by Profile, Settings, meal planning,
-- and diet validation. Safe to run multiple times.

alter table public.profiles
  add column if not exists diet_preference text,
  add column if not exists food_allergies text[] not null default '{}',
  add column if not exists food_dislikes text[] not null default '{}',
  add column if not exists water_goal_litres numeric not null default 2.5,
  add column if not exists is_profile_complete boolean not null default false;

grant select, insert, update, delete on table public.profiles to authenticated;
