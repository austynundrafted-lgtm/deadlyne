-- Account-owned, portable ingest/export choices. No source/destination paths, job names,
-- photos, captions, rosters or FTP configuration are accepted in this table.
begin;
create table public.workflow_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ingest', 'export')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
  settings jsonb not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portable_settings check (
    jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 8192
    and settings ?& array['renameOn', 'renamePattern']
    and jsonb_typeof(settings->'renameOn') = 'boolean'
    and jsonb_typeof(settings->'renamePattern') = 'string'
    and char_length(btrim(settings->>'renamePattern')) between 1 and 240
    and (settings->>'renamePattern') !~ E'[/\\\\[:cntrl:]]'
    and case kind
      when 'ingest' then
        settings - array['folderPattern', 'renameOn', 'renamePattern', 'skipExisting', 'eject'] = '{}'::jsonb
        and settings ?& array['folderPattern', 'skipExisting', 'eject']
        and jsonb_typeof(settings->'folderPattern') = 'string'
        and char_length(btrim(settings->>'folderPattern')) between 1 and 240
        and (settings->>'folderPattern') !~ E'[/\\\\[:cntrl:]]'
        and jsonb_typeof(settings->'skipExisting') = 'boolean'
        and jsonb_typeof(settings->'eject') = 'boolean'
      when 'export' then
        settings - array['files', 'subfolderOn', 'longEdge', 'quality', 'renameOn', 'renamePattern', 'openWhenDone'] = '{}'::jsonb
        and settings ?& array['files', 'subfolderOn', 'longEdge', 'quality', 'openWhenDone']
        and settings->>'files' in ('jpeg', 'raw', 'both')
        and settings->'longEdge' in ('null'::jsonb, '1200'::jsonb, '2048'::jsonb, '3000'::jsonb, '4000'::jsonb)
        and settings->'quality' in ('78'::jsonb, '88'::jsonb, '95'::jsonb)
        and jsonb_typeof(settings->'subfolderOn') = 'boolean'
        and jsonb_typeof(settings->'openWhenDone') = 'boolean'
      else false
    end
  )
);

create unique index workflow_presets_owner_kind_name on public.workflow_presets(user_id, kind, lower(name));
alter table public.workflow_presets enable row level security;
revoke all on public.workflow_presets from public, anon, authenticated;
grant select, delete on public.workflow_presets to authenticated;
grant insert (user_id, kind, name, settings) on public.workflow_presets to authenticated;
grant update (name, settings) on public.workflow_presets to authenticated;
grant all on public.workflow_presets to service_role;

create policy "Owners read their presets" on public.workflow_presets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners create their presets" on public.workflow_presets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Owners update their presets" on public.workflow_presets for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners delete their presets" on public.workflow_presets for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Compare-and-set updates/deletes use this server-owned revision. An older device must refresh
-- instead of silently replacing an edit made on another device.
create function public.version_workflow_preset() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.version_workflow_preset() from public, anon, authenticated;
create trigger workflow_presets_version before update on public.workflow_presets
  for each row execute function public.version_workflow_preset();
commit;
