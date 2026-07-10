insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "meal photos are readable by owner" on storage.objects;

create policy "meal photos are readable by owner"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "meal photos are insertable by owner" on storage.objects;

create policy "meal photos are insertable by owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "meal photos are deletable by owner" on storage.objects;

create policy "meal photos are deletable by owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'meal-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);
