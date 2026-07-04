-- Master exercise database schema.
-- Additive table for dataset-backed workout planning. Run before
-- supabase/imports/master_exercises_load.sql.

grant usage on schema public to anon, authenticated;

create extension if not exists pg_trgm;

create table if not exists public.master_exercises (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null,
  search_key text not null,
  category text,
  level text[] not null default '{}',
  equipment text[] not null default '{}',
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  mechanic text,
  force text,
  instructions text[] not null default '{}',
  image_paths text[] not null default '{}',
  unsafe_for text[] not null default '{}',
  goals text[] not null default '{}',
  default_sets integer,
  default_reps text,
  duration_seconds integer not null default 0,
  intensity text,
  source_key text not null default 'free_exercise_db',
  source_url text,
  confidence numeric not null default 0.75,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_exercises_confidence_bounds check (confidence >= 0 and confidence <= 1),
  constraint master_exercises_duration_nonnegative check (duration_seconds >= 0)
);

create unique index if not exists master_exercises_source_external_idx
on public.master_exercises (source_key, external_id)
where external_id is not null;

create unique index if not exists master_exercises_source_search_idx
on public.master_exercises (source_key, search_key);

create index if not exists master_exercises_search_key_idx
on public.master_exercises (search_key);

create index if not exists master_exercises_name_trgm_idx
on public.master_exercises using gin (name gin_trgm_ops);

create index if not exists master_exercises_category_idx
on public.master_exercises (category);

create index if not exists master_exercises_equipment_idx
on public.master_exercises using gin (equipment);

create index if not exists master_exercises_primary_muscles_idx
on public.master_exercises using gin (primary_muscles);

create index if not exists master_exercises_level_idx
on public.master_exercises using gin (level);

grant select on table public.master_exercises to anon, authenticated;
revoke insert, update, delete on table public.master_exercises from anon, authenticated;

alter table public.master_exercises enable row level security;

drop policy if exists "master exercises are readable" on public.master_exercises;
create policy "master exercises are readable"
on public.master_exercises for select to anon, authenticated using (true);
