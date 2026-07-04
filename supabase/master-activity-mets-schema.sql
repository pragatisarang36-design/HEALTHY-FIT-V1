-- Master activity MET database schema.
-- Additive table for dataset-backed workout calorie estimates. Run before
-- supabase/imports/master_activity_mets_load.sql.

grant usage on schema public to anon, authenticated;

create extension if not exists pg_trgm;

create table if not exists public.master_activity_mets (
  id uuid primary key default gen_random_uuid(),
  major_heading text not null,
  activity_code text not null,
  met_value numeric not null,
  description text not null,
  search_key text not null,
  source_key text not null default 'adult_compendium_2024',
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_activity_mets_value_bounds check (met_value > 0 and met_value <= 25)
);

create unique index if not exists master_activity_mets_source_code_idx
on public.master_activity_mets (source_key, activity_code);

create index if not exists master_activity_mets_search_key_idx
on public.master_activity_mets (search_key);

create index if not exists master_activity_mets_description_trgm_idx
on public.master_activity_mets using gin (description gin_trgm_ops);

create index if not exists master_activity_mets_heading_idx
on public.master_activity_mets (major_heading);

grant select on table public.master_activity_mets to anon, authenticated;
revoke insert, update, delete on table public.master_activity_mets from anon, authenticated;

alter table public.master_activity_mets enable row level security;

drop policy if exists "master activity mets are readable" on public.master_activity_mets;
create policy "master activity mets are readable"
on public.master_activity_mets for select to anon, authenticated using (true);
