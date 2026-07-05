alter table if exists public.water_logs
add column if not exists date date;

update public.water_logs
set date = (created_at at time zone 'Asia/Kolkata')::date
where date is null
  and created_at is not null;

alter table if exists public.water_logs
alter column date set default current_date;

create index if not exists water_logs_user_date_idx
on public.water_logs (user_id, date);

notify pgrst, 'reload schema';
