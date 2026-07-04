-- Master strength standards schema.
-- Derived from OpenPowerlifting bulk data. This stores compact percentiles,
-- not raw competition rows.

grant usage on schema public to anon, authenticated;

create table if not exists public.master_strength_standards (
  id uuid primary key default gen_random_uuid(),
  lift text not null,
  sex text not null,
  equipment text not null,
  bodyweight_bucket_kg numeric not null,
  age_class text not null default 'all',
  p50_kg numeric not null,
  p75_kg numeric not null,
  p90_kg numeric not null,
  sample_size integer not null,
  source_key text not null default 'openpowerlifting',
  source_url text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_strength_standards_lift_check check (lift in ('squat', 'bench', 'deadlift', 'total')),
  constraint master_strength_standards_sample_positive check (sample_size > 0),
  constraint master_strength_standards_percentile_order check (p50_kg <= p75_kg and p75_kg <= p90_kg)
);

create unique index if not exists master_strength_standards_unique_idx
on public.master_strength_standards (
  lift,
  sex,
  equipment,
  bodyweight_bucket_kg,
  age_class,
  source_key
);

create index if not exists master_strength_standards_lookup_idx
on public.master_strength_standards (lift, sex, equipment, age_class, bodyweight_bucket_kg);

grant select on table public.master_strength_standards to anon, authenticated;
revoke insert, update, delete on table public.master_strength_standards from anon, authenticated;

alter table public.master_strength_standards enable row level security;

drop policy if exists "master strength standards are readable" on public.master_strength_standards;
create policy "master strength standards are readable"
on public.master_strength_standards for select to anon, authenticated using (true);
