-- Resolved/master exercise view.
-- Server-side equivalent of workoutExerciseService.js's runtime dedupe: picks the
-- best-quality row per (normalized name, canonical equipment signature) group and
-- aggregates tags across duplicates, the same way the client does today. Keeping this
-- server-side means any future consumer (admin tooling, another client, direct SQL
-- reporting) gets deduped data without reimplementing the JS merge logic.
-- Run after master-exercises-schema.sql and the exercise import.

create or replace function public.normalize_exercise_key(value text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Mirrors EQUIPMENT_ALIASES in workoutPlannerEngine.js -- keep both in sync if either changes.
create or replace function public.canonical_equipment_tag(value text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(value, '')))
    when 'dumbbells' then 'dumbbell'
    when 'bands' then 'band'
    when 'resistance band' then 'band'
    when 'resistance bands' then 'band'
    when 'barbells' then 'barbell'
    when 'cables' then 'cable'
    when 'cable machine' then 'cable'
    when 'machines' then 'machine'
    when 'kettlebells' then 'kettlebell'
    when 'stationary bike' then 'bike'
    when 'exercise bike' then 'bike'
    when 'med ball' then 'medicine_ball'
    when 'medicine ball' then 'medicine_ball'
    when 'stability ball' then 'exercise_ball'
    when 'swiss ball' then 'exercise_ball'
    when 'exercise ball' then 'exercise_ball'
    when 'foam roller' then 'foam_roll'
    when 'foam roll' then 'foam_roll'
    when 'e-z curl bar' then 'ez_curl_bar'
    when 'ez curl bar' then 'ez_curl_bar'
    when 'ez bar' then 'ez_curl_bar'
    when 'body only' then 'none'
    when 'bodyweight' then 'none'
    when '' then 'none'
    else lower(trim(coalesce(value, '')))
  end;
$$;

create or replace function public.canonical_equipment_signature(equipment text[])
returns text language sql immutable as $$
  select coalesce(
    (select string_agg(distinct public.canonical_equipment_tag(item), ',' order by public.canonical_equipment_tag(item))
     from unnest(coalesce(equipment, '{}'::text[])) as item),
    'none'
  );
$$;

create or replace function public.exercise_row_quality_score(
  source_key text, confidence numeric, instructions text[], primary_muscles text[], image_paths text[]
) returns numeric language sql immutable as $$
  select
    (case source_key
      when 'free_exercise_db' then 8
      when 'exercemus' then 8
      when 'kaggle_fitness_exercises' then 7
      when 'kaggle_megagym' then 6
      when 'kaggle_gym_exercises_dataset' then 6
      else 4
    end)
    + coalesce(confidence, 0) * 4
    + least(coalesce(array_length(instructions, 1), 0), 5) * 0.4
    + least(coalesce(array_length(primary_muscles, 1), 0), 3) * 0.3
    + (case when coalesce(array_length(image_paths, 1), 0) > 0 then 0.5 else 0 end);
$$;

create or replace view public.master_exercises_resolved_view
with (security_invoker = true) as
with scored as (
  select
    e.*,
    public.normalize_exercise_key(e.name) as name_key,
    public.canonical_equipment_signature(e.equipment) as equipment_signature,
    public.exercise_row_quality_score(e.source_key, e.confidence, e.instructions, e.primary_muscles, e.image_paths) as quality_score
  from public.master_exercises e
  where e.active = true
),
-- One row per group, chosen directly via DISTINCT ON instead of array_agg(...)[1] --
-- avoids the text-vs-text[] type error entirely since we're just picking a whole row,
-- not trying to index into an aggregated array of arrays.
winners as (
  select distinct on (name_key, equipment_signature)
    name_key,
    equipment_signature,
    id, name, category, mechanic, force,
    default_sets, default_reps, duration_seconds, intensity, confidence,
    instructions, quality_score,
    (coalesce(array_length(instructions, 1), 0) = 0) as instructions_generated
  from scored
  order by
    name_key, equipment_signature,
    (coalesce(array_length(instructions, 1), 0) > 0) desc,  -- real instructions beat a higher score with none
    quality_score desc
),
-- Plain group counts/flags -- deliberately no lateral unnest here, so count(*) reflects
-- actual source rows rather than the cross-product a multi-unnest join would produce.
group_stats as (
  select
    name_key,
    equipment_signature,
    count(*) as duplicate_row_count,
    array_agg(distinct source_key) as contributing_sources,
    bool_or(coalesce(array_length(equipment, 1), 0) = 0) as had_missing_equipment_row,
    bool_or(coalesce(array_length(instructions, 1), 0) = 0) as had_missing_instructions_row
  from scored
  group by name_key, equipment_signature
),
-- Tag unions across the whole duplicate group. Each unnest is joined and aggregated
-- independently (separate subqueries) rather than combined in one FROM clause, so they
-- don't cross-multiply against each other.
tag_union as (
  select
    s.name_key,
    s.equipment_signature,
    array_remove(array_agg(distinct eq_item), null) as all_equipment_tags,
    array_remove(array_agg(distinct level_item), null) as all_levels,
    array_remove(array_agg(distinct muscle_item), null) as all_primary_muscles,
    array_remove(array_agg(distinct secondary_item), null) as all_secondary_muscles,
    array_remove(array_agg(distinct unsafe_item), null) as all_unsafe_for
  from scored s
  left join lateral unnest(coalesce(s.equipment, '{}'::text[])) as eq_item on true
  left join lateral unnest(coalesce(s.level, '{}'::text[])) as level_item on true
  left join lateral unnest(coalesce(s.primary_muscles, '{}'::text[])) as muscle_item on true
  left join lateral unnest(coalesce(s.secondary_muscles, '{}'::text[])) as secondary_item on true
  left join lateral unnest(coalesce(s.unsafe_for, '{}'::text[])) as unsafe_item on true
  group by s.name_key, s.equipment_signature
)
select
  w.id,
  w.name,
  w.name_key as search_key,
  w.equipment_signature,
  w.category,
  w.mechanic,
  w.force,
  coalesce(nullif(t.all_equipment_tags, '{}'), array['none']) as equipment,
  coalesce(nullif(t.all_levels, '{}'), array['beginner', 'intermediate']) as level,
  t.all_primary_muscles as primary_muscles,
  t.all_secondary_muscles as secondary_muscles,
  t.all_unsafe_for as unsafe_for,
  w.instructions,
  w.instructions_generated,
  w.default_sets,
  w.default_reps,
  w.duration_seconds,
  w.intensity,
  w.confidence,
  w.quality_score,
  gs.duplicate_row_count,
  gs.contributing_sources,
  gs.had_missing_equipment_row,
  gs.had_missing_instructions_row
from winners w
join group_stats gs using (name_key, equipment_signature)
join tag_union t using (name_key, equipment_signature);

grant select on table public.master_exercises to anon, authenticated;
grant select on public.master_exercises_resolved_view to anon, authenticated;
