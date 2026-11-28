-- ONE-TIME SETUP TEMPLATE, for manual review/execution as postgres in SQL Editor.
-- Copy to resolve_tapflow_incident.local.sql and replace every
-- <APPROVED_AUTH_USER_UUID> with the approved existing viewer's auth.users.id.
-- Never commit a filled-in copy. Tests render this template with a synthetic UUID.
-- Review the installed catalog separately; no local export is needed by tests.
-- Run the entire reviewed transaction once, then enroll the approved account
-- using enroll_r1_dashboard_staff.example.sql and verify-r1-resolution.sql copies.
-- This does not alter the R1 detector, its triggers, thresholds, episode state,
-- indexes, existing row policies or table grants. Existing UPDATE triggers will
-- still run if added later; the reviewed baseline has no alert-table user triggers.
-- Keep public.tapflow_r1_after_flow_insert(), tapflow_r1_flow_insert_trigger,
-- tapflow_internal.r1_room_episode and tapflow_r1_authorized_viewer unchanged.
--
-- The proposed private allowlist starts empty and is managed by administrators.
-- It authorizes resolution of R1 incidents across all rooms, independently of a
-- caller's SELECT policies. The expected viewer policy covers all rooms and both
-- statuses for the approved account; preserve that policy rather than replacing it.
-- CREATE intentionally fails on conflicting staff tables/functions rather than
-- replacing an installed authorization model. After an error, run ROLLBACK and
-- inspect the conflict. Do not deploy r1_incident_lifecycle.sql for this feature:
-- the live database already has its own episode detector and private ledger.
begin;
-- Match the exporter's deparse context for trigger/policy fingerprints only.
-- Both public RPCs below independently pin their search_path to pg_catalog.
set local search_path = public, pg_catalog;

do $resolution_baseline$
begin
  if '<APPROVED_AUTH_USER_UUID>' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    raise exception 'Replace the approved Auth UUID placeholder in a local copy before setup'
      using errcode = '22023';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.tapflow_r1_after_flow_insert()')))
       is distinct from '201222cdca74a0ad581ce1bd6e78c855'
    or md5(pg_get_functiondef(to_regprocedure('public.tapflow_update_status_timestamp()')))
       is distinct from '0f92f88ef063eb2593e5e9a32b629e59' then
    raise exception 'R1 resolution baseline changed: installed detector/status function'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.flow_readings')
      and tgname = 'tapflow_r1_flow_insert_trigger' and tgenabled = 'O'
      and md5(pg_get_triggerdef(oid, true)) = 'ad626946c8c76d776c431018c1937179'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.room_status')
      and tgname = 'tapflow_status_timestamp_trigger' and tgenabled = 'O'
      and md5(pg_get_triggerdef(oid, true)) = 'f374adf6ddaaa7d33cc62e9ad8d68ac6'
  ) then
    raise exception 'R1 resolution baseline changed: installed trigger'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_class where oid = to_regclass('public.tapflow_r1_alerts')
      and relrowsecurity and not relforcerowsecurity
  ) or (
    select coalesce(jsonb_agg(to_jsonb(p) order by policyname), '[]'::jsonb)
    from pg_policies p where schemaname = 'public' and tablename = 'tapflow_r1_alerts'
  ) is distinct from $policy$[
    {"cmd":"SELECT","qual":"(auth.uid() = '<APPROVED_AUTH_USER_UUID>'::uuid)",
     "roles":["authenticated"],"tablename":"tapflow_r1_alerts","permissive":"PERMISSIVE",
     "policyname":"tapflow_r1_authorized_viewer","schemaname":"public","with_check":null}
  ]$policy$::jsonb then
    raise exception 'R1 resolution baseline changed: alert RLS or SELECT policy'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.tapflow_r1_alerts') and not tgisinternal
  ) or exists (
    select 1 from (values
      ('id', 'bigint'::regtype), ('room_id', 'integer'::regtype),
      ('code', 'text'::regtype), ('status', 'text'::regtype),
      ('detected_at', 'timestamptz'::regtype), ('resolved_at', 'timestamptz'::regtype),
      ('evidence', 'jsonb'::regtype)
    ) as expected(name, type)
    left join pg_attribute a on a.attrelid = to_regclass('public.tapflow_r1_alerts')
      and a.attname = expected.name and not a.attisdropped
    where a.atttypid is distinct from expected.type::oid
  ) or exists (
    select 1 from pg_attribute where attrelid = to_regclass('public.tapflow_r1_alerts')
      and not attisdropped and (
        (attname = 'resolved_by' and atttypid <> 'uuid'::regtype)
        or (attname = 'resolution_remark' and atttypid <> 'text'::regtype)
      )
  ) then
    raise exception 'R1 resolution baseline changed: alert columns or UPDATE triggers'
      using errcode = '55000';
  end if;
end
$resolution_baseline$;

alter table public.tapflow_r1_alerts
  add column if not exists resolved_by uuid,
  add column if not exists resolution_remark text;
-- No backfill, defaults, or FK: retain history and attribution if Auth users leave.

create schema if not exists tapflow_private;
-- New schemas have owner-only access by default. Preserve a preexisting schema's
-- grants for unrelated private infrastructure; protect this table independently.
create table tapflow_private.r1_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table tapflow_private.r1_staff enable row level security;
revoke all on tapflow_private.r1_staff from public, anon, authenticated, service_role;

create function public.tapflow_can_resolve_r1()
returns boolean language sql stable security definer set search_path = pg_catalog
as $function$
  select auth.uid() is not null and exists (
    select 1 from tapflow_private.r1_staff
    where user_id = auth.uid() and enabled
  );
$function$;
revoke all on function public.tapflow_can_resolve_r1()
  from public, anon, authenticated, service_role;
grant execute on function public.tapflow_can_resolve_r1() to authenticated;

create function public.resolve_tapflow_incident(
  p_incident_id text, p_remark text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  incident public.tapflow_r1_alerts%rowtype;
  actor uuid := auth.uid();
  remark text := nullif(btrim(p_remark), '');
begin
  -- Every call rechecks the server-managed authority, including revoked staff.
  -- Neither user metadata nor a role/actor supplied by the browser grants access.
  if actor is null or not public.tapflow_can_resolve_r1() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_incident_id is null or p_incident_id !~ '^[1-9][0-9]*$'
    or length(p_incident_id) > 19
    or (length(p_incident_id) = 19 and p_incident_id > '9223372036854775807') then
    raise exception 'Invalid incident ID' using errcode = '22023';
  end if;
  if length(remark) > 2000 then
    raise exception 'Resolution remark must be 2000 characters or fewer'
      using errcode = '22023';
  end if;

  select * into incident from public.tapflow_r1_alerts
  where id = p_incident_id::bigint and code = 'R1_MISSING_FLOW_SIGNAL'
  for update;
  if not found then
    raise exception 'R1 incident not found' using errcode = 'P0002';
  end if;
  if incident.status = 'ACTIVE' then
    update public.tapflow_r1_alerts
    set status = 'RESOLVED', resolved_at = clock_timestamp(),
        resolved_by = actor, resolution_remark = remark
    where id = incident.id
    returning * into incident;
  elsif incident.status <> 'RESOLVED' then
    raise exception 'Unsupported incident status' using errcode = '22023';
  end if;
  -- Repeat calls retain the first resolver, timestamp and remark. The second open
  -- incident, detector evidence, original detection time, and history stay intact.
  -- Whitelist public fields and stringify bigint before it reaches JavaScript.
  return jsonb_build_object(
    'id', incident.id::text, 'detected_at', incident.detected_at,
    'room_id', incident.room_id, 'code', incident.code, 'status', incident.status,
    'evidence', incident.evidence, 'resolved_at', incident.resolved_at,
    'last_detected_at', to_jsonb(incident) -> 'last_detected_at',
    'resolved_by', incident.resolved_by, 'resolution_remark', incident.resolution_remark
  );
end
$function$;
revoke all on function public.resolve_tapflow_incident(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_tapflow_incident(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- AFTER REVIEW: enroll only the approved existing viewer using a local copy of
-- supabase/drafts/enroll_r1_dashboard_staff.example.sql.
-- Revoke membership through the SQL Editor with enabled = false or DELETE.
-- Keep this schema outside Supabase's exposed schemas and never grant browser
-- users access to the allowlist. Existing alert SELECT/RLS must expose both ACTIVE
-- and RESOLVED rows to the authorized dashboard account so history can refresh.
