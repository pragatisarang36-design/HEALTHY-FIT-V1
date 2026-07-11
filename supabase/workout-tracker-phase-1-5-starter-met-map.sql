-- Workout Tracker Phase 1.5: starter MET mappings.
--
-- Review-only data seed. Do not run until Phase 0 is already applied:
-- - public.master_exercises exists as the canonical table.
-- - public.exercise_met_map exists.
-- - public.master_activity_mets is loaded from the Adult Compendium import.
--
-- Scope:
-- - Data only. No CREATE/ALTER/DROP statements.
-- - Adds app-facing workout-type exercise rows only when needed.
-- - Links common workout types and low/moderate/high intensity variants to
--   existing Adult Compendium MET rows.

begin;

with exercise_seed (
  workout_type,
  display_name,
  category,
  level,
  equipment,
  primary_muscles,
  goals
) as (
  values
    ('walking', 'Walking', 'cardio', array['beginner', 'intermediate'], array['none'], '{}'::text[], array['weight_loss', 'general_fitness']),
    ('running', 'Running', 'cardio', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['weight_loss', 'endurance']),
    ('cycling', 'Cycling', 'cardio', array['beginner', 'intermediate', 'advanced'], array['bike'], array['quadriceps', 'glutes', 'hamstrings'], array['weight_loss', 'endurance']),
    ('gym', 'Gym / Weights', 'strength', array['beginner', 'intermediate', 'advanced'], array['barbell', 'dumbbell', 'machine'], '{}'::text[], array['muscle_gain', 'strength']),
    ('yoga', 'Yoga', 'mobility', array['beginner', 'intermediate'], array['none'], '{}'::text[], array['flexibility', 'general_fitness']),
    ('skipping', 'Skipping', 'cardio', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['weight_loss', 'endurance']),
    ('dancing', 'Dancing', 'cardio', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['weight_loss', 'general_fitness']),
    ('football', 'Football', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['endurance', 'general_fitness']),
    ('cricket', 'Cricket', 'sport', array['beginner', 'intermediate'], array['none'], '{}'::text[], array['general_fitness']),
    ('basketball', 'Basketball', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['endurance', 'general_fitness']),
    ('swimming', 'Swimming', 'cardio', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['weight_loss', 'endurance']),
    ('hiking', 'Hiking', 'cardio', array['beginner', 'intermediate', 'advanced'], array['none'], array['glutes', 'hamstrings', 'quadriceps'], array['weight_loss', 'endurance']),
    ('pilates', 'Pilates', 'mobility', array['beginner', 'intermediate'], array['none'], array['core'], array['flexibility', 'general_fitness']),
    ('boxing', 'Boxing', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['weight_loss', 'endurance']),
    ('martial_arts', 'Martial Arts', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['general_fitness', 'endurance']),
    ('tennis', 'Tennis', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['general_fitness', 'endurance']),
    ('badminton', 'Badminton', 'sport', array['beginner', 'intermediate', 'advanced'], array['none'], '{}'::text[], array['general_fitness', 'endurance'])
)
insert into public.master_exercises (
  name,
  search_key,
  name_key,
  aliases,
  category,
  subcategory,
  level,
  equipment,
  equipment_signature,
  primary_muscles,
  secondary_muscles,
  mechanic,
  force,
  instructions,
  image_paths,
  unsafe_for,
  goals,
  default_sets,
  default_reps,
  duration_seconds,
  intensity,
  source_key,
  source_url,
  confidence,
  quality_score,
  source_row_ids,
  contributing_sources,
  duplicate_row_count,
  had_missing_equipment_row,
  had_missing_instructions_row,
  active
)
select
  display_name,
  public.normalize_exercise_key(workout_type),
  public.normalize_exercise_key(workout_type),
  '{}'::text[],
  category,
  'workout_tracker_app_type',
  level,
  equipment,
  public.canonical_equipment_signature(equipment),
  primary_muscles,
  '{}'::text[],
  null::text,
  null::text,
  '{}'::text[],
  '{}'::text[],
  '{}'::text[],
  goals,
  null::integer,
  null::text,
  0,
  null::text,
  'healthyfit_workout_tracker_seed',
  null::text,
  0.72,
  5,
  '{}'::uuid[],
  array['healthyfit_workout_tracker_seed'],
  1,
  false,
  false,
  true
from exercise_seed
on conflict (name_key, equipment_signature) do update set
  active = true,
  updated_at = now();

with mapping_seed (
  workout_type,
  equipment,
  intensity_variant,
  activity_search_key,
  match_confidence
) as (
  values
    ('walking', array['none'], 'low', 'walking 2 0 to 2 4 mph level slow pace firm surface', 0.82),
    ('walking', array['none'], 'moderate', 'walking 2 8 to 3 4 mph level moderate pace firm surface', 0.86),
    ('walking', array['none'], 'high', 'walking 3 5 to 3 9 mph level brisk firm surface walking for exercise', 0.86),
    ('running', array['none'], 'low', 'running 5 0 to 5 2 mph 12 min mile', 0.84),
    ('running', array['none'], 'moderate', 'running 6 6 3 mph 10 min mile', 0.86),
    ('running', array['none'], 'high', 'running 7 5 mph 8 min mile', 0.86),
    ('cycling', array['bike'], 'low', 'bicycling self selected easy pace', 0.84),
    ('cycling', array['bike'], 'moderate', 'bicycling self selected moderate pace', 0.86),
    ('cycling', array['bike'], 'high', 'bicycling self selected vigorous pace', 0.86),
    ('gym', array['barbell', 'dumbbell', 'machine'], 'low', 'resistance weight training multiple exercises 8 15 reps at varied resistance', 0.78),
    ('gym', array['barbell', 'dumbbell', 'machine'], 'moderate', 'resistance training circuit reciprocol supersets peripheral hear action training', 0.76),
    ('gym', array['barbell', 'dumbbell', 'machine'], 'high', 'resistance weight lifting free weight nautilus or universal type power lifting or body building vigorous effort taylor code 210', 0.78),
    ('yoga', array['none'], 'low', 'yoga hatha', 0.78),
    ('yoga', array['none'], 'moderate', 'yoga general', 0.78),
    ('yoga', array['none'], 'high', 'yoga hatha high intensity', 0.72),
    ('skipping', array['none'], 'low', 'rope jumping slow pace 100 skips min 2 foot skip rhythm bounce', 0.84),
    ('skipping', array['none'], 'moderate', 'rope jumping moderate pace general 100 to 120 skips min 2 foot skip plain bounce', 0.86),
    ('skipping', array['none'], 'high', 'rope jumping fast pace 120 160 skips min', 0.86),
    ('dancing', array['none'], 'low', 'ballroom slow examples waltz foxtrot slow dancing samba tango rumba 19th century dance mambo cha cha', 0.74),
    ('dancing', array['none'], 'moderate', 'folk dancing moderate effort', 0.78),
    ('dancing', array['none'], 'high', 'nightclub or folk dancing vigorous effort e g nightclub disco folk line dancing irish step dancing polka contra', 0.78),
    ('football', array['none'], 'low', 'football touch flag light effort', 0.72),
    ('football', array['none'], 'moderate', 'football touch flag general taylor code 510', 0.74),
    ('football', array['none'], 'high', 'football competitive', 0.78),
    ('cricket', array['none'], 'low', 'cricket batting bowling fielding', 0.72),
    ('cricket', array['none'], 'moderate', 'cricket batting bowling fielding', 0.74),
    ('cricket', array['none'], 'high', 'cricket batting bowling fielding', 0.70),
    ('basketball', array['none'], 'low', 'basketball shooting baskets', 0.78),
    ('basketball', array['none'], 'moderate', 'basketball non game general taylor code 480', 0.80),
    ('basketball', array['none'], 'high', 'basketball game taylor code 490', 0.84),
    ('swimming', array['none'], 'low', 'swimming backstroke recreational', 0.74),
    ('swimming', array['none'], 'moderate', 'swimming crawl slow speed 30 45 yards minute moderate effort', 0.80),
    ('swimming', array['none'], 'high', 'swimming laps freestyle fast vigorous effort', 0.84),
    ('hiking', array['none'], 'low', 'hiking slowly or ambling through fields and hillsides no load', 0.78),
    ('hiking', array['none'], 'moderate', 'hiking or walking at a normal pace through fields and hillsides no load', 0.80),
    ('hiking', array['none'], 'high', 'hiking cross country taylor code 040', 0.78),
    ('pilates', array['none'], 'low', 'pilates traditional mat', 0.78),
    ('pilates', array['none'], 'moderate', 'pilates general', 0.82),
    ('pilates', array['none'], 'high', 'pound combination of pilates and body movements with drumming', 0.66),
    ('boxing', array['none'], 'low', 'boxing punching bag 60 b min', 0.78),
    ('boxing', array['none'], 'moderate', 'boxing punching bag 120 b min', 0.82),
    ('boxing', array['none'], 'high', 'boxing punching bag 180 b min', 0.82),
    ('martial_arts', array['none'], 'low', 'martial arts different types slower pace novice performers practice', 0.78),
    ('martial_arts', array['none'], 'moderate', 'martial arts different types moderate pace e g judo jujitsu karate kick boxing tae kwon do tai bo muay thai boxing', 0.78),
    ('martial_arts', array['none'], 'high', 'martial arts different types moderate pace e g judo jujitsu karate kick boxing tae kwon do tai bo muay thai boxing', 0.70),
    ('tennis', array['none'], 'low', 'tennis hitting balls non game play moderate effort', 0.76),
    ('tennis', array['none'], 'moderate', 'tennis general moderate effort', 0.82),
    ('tennis', array['none'], 'high', 'tennis singles taylor code 420', 0.84),
    ('badminton', array['none'], 'low', 'badminton social singles and doubles general', 0.80),
    ('badminton', array['none'], 'moderate', 'badminton competitive taylor code 450', 0.78),
    ('badminton', array['none'], 'high', 'badminton competitive match play', 0.82)
),
resolved_seed as (
  select
    e.id as exercise_id,
    a.id as activity_met_id,
    m.intensity_variant,
    m.match_confidence
  from mapping_seed m
  join public.master_exercises e
    on e.active = true
   and e.name_key = public.normalize_exercise_key(m.workout_type)
   and e.equipment_signature = public.canonical_equipment_signature(m.equipment)
  join public.master_activity_mets a
    on a.active = true
   and a.source_key = 'adult_compendium_2024'
   and a.search_key = m.activity_search_key
)
insert into public.exercise_met_map (
  exercise_id,
  activity_met_id,
  intensity_variant,
  match_confidence,
  match_method,
  active
)
select
  exercise_id,
  activity_met_id,
  intensity_variant,
  match_confidence,
  'starter_seed_v1',
  true
from resolved_seed
on conflict (exercise_id, activity_met_id, intensity_variant) do update set
  match_confidence = excluded.match_confidence,
  match_method = excluded.match_method,
  active = true,
  updated_at = now();

commit;

-- Optional verification after running:
--
-- 1. Confirm all seed activity rows existed in master_activity_mets before insert.
--    This should return zero rows.
-- with mapping_seed (workout_type, equipment, intensity_variant, activity_search_key, match_confidence) as (
--   values
--     ('walking', array['none'], 'low', 'walking 2 0 to 2 4 mph level slow pace firm surface', 0.82),
--     ('walking', array['none'], 'moderate', 'walking 2 8 to 3 4 mph level moderate pace firm surface', 0.86),
--     ('walking', array['none'], 'high', 'walking 3 5 to 3 9 mph level brisk firm surface walking for exercise', 0.86),
--     ('running', array['none'], 'low', 'running 5 0 to 5 2 mph 12 min mile', 0.84),
--     ('running', array['none'], 'moderate', 'running 6 6 3 mph 10 min mile', 0.86),
--     ('running', array['none'], 'high', 'running 7 5 mph 8 min mile', 0.86),
--     ('cycling', array['bike'], 'low', 'bicycling self selected easy pace', 0.84),
--     ('cycling', array['bike'], 'moderate', 'bicycling self selected moderate pace', 0.86),
--     ('cycling', array['bike'], 'high', 'bicycling self selected vigorous pace', 0.86),
--     ('gym', array['barbell', 'dumbbell', 'machine'], 'low', 'resistance weight training multiple exercises 8 15 reps at varied resistance', 0.78),
--     ('gym', array['barbell', 'dumbbell', 'machine'], 'moderate', 'resistance training circuit reciprocol supersets peripheral hear action training', 0.76),
--     ('gym', array['barbell', 'dumbbell', 'machine'], 'high', 'resistance weight lifting free weight nautilus or universal type power lifting or body building vigorous effort taylor code 210', 0.78),
--     ('yoga', array['none'], 'low', 'yoga hatha', 0.78),
--     ('yoga', array['none'], 'moderate', 'yoga general', 0.78),
--     ('yoga', array['none'], 'high', 'yoga hatha high intensity', 0.72),
--     ('skipping', array['none'], 'low', 'rope jumping slow pace 100 skips min 2 foot skip rhythm bounce', 0.84),
--     ('skipping', array['none'], 'moderate', 'rope jumping moderate pace general 100 to 120 skips min 2 foot skip plain bounce', 0.86),
--     ('skipping', array['none'], 'high', 'rope jumping fast pace 120 160 skips min', 0.86),
--     ('dancing', array['none'], 'low', 'ballroom slow examples waltz foxtrot slow dancing samba tango rumba 19th century dance mambo cha cha', 0.74),
--     ('dancing', array['none'], 'moderate', 'folk dancing moderate effort', 0.78),
--     ('dancing', array['none'], 'high', 'nightclub or folk dancing vigorous effort e g nightclub disco folk line dancing irish step dancing polka contra', 0.78),
--     ('football', array['none'], 'low', 'football touch flag light effort', 0.72),
--     ('football', array['none'], 'moderate', 'football touch flag general taylor code 510', 0.74),
--     ('football', array['none'], 'high', 'football competitive', 0.78),
--     ('cricket', array['none'], 'low', 'cricket batting bowling fielding', 0.72),
--     ('cricket', array['none'], 'moderate', 'cricket batting bowling fielding', 0.74),
--     ('cricket', array['none'], 'high', 'cricket batting bowling fielding', 0.70),
--     ('basketball', array['none'], 'low', 'basketball shooting baskets', 0.78),
--     ('basketball', array['none'], 'moderate', 'basketball non game general taylor code 480', 0.80),
--     ('basketball', array['none'], 'high', 'basketball game taylor code 490', 0.84),
--     ('swimming', array['none'], 'low', 'swimming backstroke recreational', 0.74),
--     ('swimming', array['none'], 'moderate', 'swimming crawl slow speed 30 45 yards minute moderate effort', 0.80),
--     ('swimming', array['none'], 'high', 'swimming laps freestyle fast vigorous effort', 0.84),
--     ('hiking', array['none'], 'low', 'hiking slowly or ambling through fields and hillsides no load', 0.78),
--     ('hiking', array['none'], 'moderate', 'hiking or walking at a normal pace through fields and hillsides no load', 0.80),
--     ('hiking', array['none'], 'high', 'hiking cross country taylor code 040', 0.78),
--     ('pilates', array['none'], 'low', 'pilates traditional mat', 0.78),
--     ('pilates', array['none'], 'moderate', 'pilates general', 0.82),
--     ('pilates', array['none'], 'high', 'pound combination of pilates and body movements with drumming', 0.66),
--     ('boxing', array['none'], 'low', 'boxing punching bag 60 b min', 0.78),
--     ('boxing', array['none'], 'moderate', 'boxing punching bag 120 b min', 0.82),
--     ('boxing', array['none'], 'high', 'boxing punching bag 180 b min', 0.82),
--     ('martial_arts', array['none'], 'low', 'martial arts different types slower pace novice performers practice', 0.78),
--     ('martial_arts', array['none'], 'moderate', 'martial arts different types moderate pace e g judo jujitsu karate kick boxing tae kwon do tai bo muay thai boxing', 0.78),
--     ('martial_arts', array['none'], 'high', 'martial arts different types moderate pace e g judo jujitsu karate kick boxing tae kwon do tai bo muay thai boxing', 0.70),
--     ('tennis', array['none'], 'low', 'tennis hitting balls non game play moderate effort', 0.76),
--     ('tennis', array['none'], 'moderate', 'tennis general moderate effort', 0.82),
--     ('tennis', array['none'], 'high', 'tennis singles taylor code 420', 0.84),
--     ('badminton', array['none'], 'low', 'badminton social singles and doubles general', 0.80),
--     ('badminton', array['none'], 'moderate', 'badminton competitive taylor code 450', 0.78),
--     ('badminton', array['none'], 'high', 'badminton competitive match play', 0.82)
-- )
-- select m.*
-- from mapping_seed m
-- left join public.master_activity_mets a
--   on a.active = true
--  and a.source_key = 'adult_compendium_2024'
--  and a.search_key = m.activity_search_key
-- where a.id is null;
--
-- 2. Review seeded mappings and MET values.
-- select
--   e.name as workout,
--   m.intensity_variant,
--   a.met_value,
--   a.activity_code,
--   a.description,
--   m.match_confidence,
--   m.match_method
-- from public.exercise_met_map m
-- join public.master_exercises e on e.id = m.exercise_id
-- join public.master_activity_mets a on a.id = m.activity_met_id
-- where m.match_method = 'starter_seed_v1'
-- order by e.name, case m.intensity_variant when 'low' then 1 when 'moderate' then 2 when 'high' then 3 else 4 end;
--
-- 3. Confirm app workout types now have at least one active mapping.
--    This intentionally excludes other_sport, which should remain unresolved until
--    the user chooses or enters a more specific activity.
-- with app_workouts(workout_type) as (
--   values
--     ('walking'), ('running'), ('cycling'), ('gym'), ('yoga'), ('skipping'),
--     ('dancing'), ('football'), ('cricket'), ('basketball'), ('swimming'),
--     ('hiking'), ('pilates'), ('boxing'), ('martial_arts'), ('tennis'), ('badminton')
-- )
-- select workout_type
-- from app_workouts w
-- where not exists (
--   select 1
--   from public.master_exercises e
--   join public.exercise_met_map m on m.exercise_id = e.id and m.active = true
--   where e.active = true
--     and e.name_key = public.normalize_exercise_key(w.workout_type)
-- );
