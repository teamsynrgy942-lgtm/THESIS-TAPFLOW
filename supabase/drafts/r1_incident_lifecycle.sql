-- DRAFT ONLY. Do not deploy: the installed detector/trigger baseline is not available.
-- Export scripts/r1-lifecycle-baseline.sql first. Keep this guard until the reviewed
-- live detector replacement, trigger definition, exact baseline fingerprints, and
-- removal of its verified one-ACTIVE-per-room guard are included in this transaction.
-- This draft supplies infrastructure and server actions, NOT a detector replacement.
begin;
do $baseline_required$
begin
  raise exception 'R1 migration incomplete: installed detector/trigger baseline and adapter required';
end
$baseline_required$;

-- Validate these assumed types against the export before finalizing this draft.
-- Do not change the installed thresholds, freshness, authorization, isolation or
-- Main-flow predicate. Do not infer any of them from frontend telemetry defaults.
lock table public.flow_readings, public.room_status, public.tapflow_r1_alerts
  in access exclusive mode;

alter table public.tapflow_r1_alerts
  add column last_detected_at timestamptz,
  add column resolved_by uuid;
-- No UPDATE/backfill: existing UPDATE triggers could change historical timestamps.
-- Legacy Last detected stays unknown until a new qualifying observation arrives.
-- Original IDs, timestamps, status and evidence are unchanged by this draft.
-- No FK on resolved_by: deleting an Auth account must not erase incident attribution.

create schema tapflow_private;
revoke all on schema tapflow_private from public, anon, authenticated, service_role;

-- Proposed authorization source; reconcile with the approved live staff model.
-- Starts empty. Only a project administrator may provision/revoke approved users.
create table tapflow_private.r1_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table tapflow_private.r1_staff enable row level security;
revoke all on tapflow_private.r1_staff from public, anon, authenticated, service_role;

create table tapflow_private.r1_episodes (
  room_id integer primary key,
  incident_id bigint references public.tapflow_r1_alerts(id) on delete restrict,
  migration_floor timestamptz not null,
  last_fault_at timestamptz,
  recovered_at timestamptz
);
alter table tapflow_private.r1_episodes enable row level security;
revoke all on tapflow_private.r1_episodes from public, anon, authenticated, service_role;

-- Seed every known room conservatively. RESOLVED is not evidence of recovery.
-- Older open incidents are retained even when another incident is more recent.
insert into tapflow_private.r1_episodes
  (room_id, incident_id, migration_floor, last_fault_at)
with boundary as materialized (select clock_timestamp() as floor)
select rooms.room_id, latest.id, boundary.floor, latest.last_detected_at
from (
  select room_id from public.room_status
  union
  select room_id from public.tapflow_r1_alerts
  where code = 'R1_MISSING_FLOW_SIGNAL'
) rooms cross join boundary
left join lateral (
  select a.id, coalesce(a.last_detected_at, a.detected_at) as last_detected_at
  from public.tapflow_r1_alerts a
  where a.room_id = rooms.room_id and a.code = 'R1_MISSING_FLOW_SIGNAL'
  order by a.detected_at desc, a.id desc
  limit 1
) latest on true;

-- The live adapter must lock BEFORE evaluating its existing room predicates.
create function tapflow_private.r1_lock_room(p_room_id integer)
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
begin
  if p_room_id is null then raise exception 'A room is required'; end if;
  insert into tapflow_private.r1_episodes(room_id, migration_floor)
  values (p_room_id, '-infinity'::timestamptz)
  on conflict (room_id) do nothing;
  perform 1 from tapflow_private.r1_episodes where room_id = p_room_id for update;
end
$function$;
revoke all on function tapflow_private.r1_lock_room(integer) from public, anon, authenticated, service_role;

-- PRIVATE callback for the installed detector's UNCHANGED qualifying fault branch.
-- p_observed_at must be its validated fresh upload timestamp, not a cached sample.
-- Acquire room locks in ascending room_id order if one Main upload checks many rooms.
create function tapflow_private.r1_record_fault(
  p_room_id integer, p_observed_at timestamptz, p_evidence jsonb
) returns bigint
language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  episode tapflow_private.r1_episodes%rowtype;
  incident bigint;
begin
  if p_room_id is null or p_observed_at is null then
    raise exception 'A room and validated observation timestamp are required';
  end if;
  insert into tapflow_private.r1_episodes(room_id, migration_floor)
  values (p_room_id, '-infinity'::timestamptz)
  on conflict (room_id) do nothing;
  select * into strict episode from tapflow_private.r1_episodes
  where room_id = p_room_id for update;

  -- A delayed pre-migration/pre-recovery reading cannot start a later episode.
  if p_observed_at <= greatest(episode.migration_floor, episode.recovered_at) then
    return episode.incident_id;
  end if;
  if episode.incident_id is not null then
    update public.tapflow_r1_alerts
    set last_detected_at = greatest(last_detected_at, detected_at, p_observed_at)
    where id = episode.incident_id and room_id = p_room_id
      and code = 'R1_MISSING_FLOW_SIGNAL';
    if not found then
      raise exception 'Current R1 incident is missing; recovery must be reviewed';
    end if;
    incident := episode.incident_id;
  else
    insert into public.tapflow_r1_alerts
      (room_id, code, status, detected_at, last_detected_at, evidence, resolved_at, resolved_by)
    values (p_room_id, 'R1_MISSING_FLOW_SIGNAL', 'ACTIVE', p_observed_at,
            p_observed_at, p_evidence, null, null)
    returning id into incident;
  end if;
  update tapflow_private.r1_episodes
  set incident_id = incident, last_fault_at = greatest(last_fault_at, p_observed_at)
  where room_id = p_room_id;
  return incident;
end
$function$;
revoke all on function tapflow_private.r1_record_fault(integer, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

-- PRIVATE callback ONLY for a newly inserted room upload after the installed
-- predicate confirms fresh, valid positive pulses DURING authorized water use.
-- The missing live adapter must enforce all of those conditions. A boolean from
-- the browser, tap-out, missing sample, staff action or cached positive is insufficient.
create function tapflow_private.r1_record_recovery(
  p_room_id integer, p_observed_at timestamptz
) returns boolean
language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  episode tapflow_private.r1_episodes%rowtype;
begin
  if p_room_id is null or p_observed_at is null then
    raise exception 'A room and validated recovery timestamp are required';
  end if;
  insert into tapflow_private.r1_episodes(room_id, migration_floor)
  values (p_room_id, '-infinity'::timestamptz)
  on conflict (room_id) do nothing;
  select * into strict episode from tapflow_private.r1_episodes
  where room_id = p_room_id for update;
  if p_observed_at <= greatest(episode.migration_floor, episode.last_fault_at, episode.recovered_at) then
    return false;
  end if;
  update tapflow_private.r1_episodes
  set incident_id = null, recovered_at = p_observed_at
  where room_id = p_room_id;
  return true;
end
$function$;
revoke all on function tapflow_private.r1_record_recovery(integer, timestamptz)
  from public, anon, authenticated, service_role;

create function public.tapflow_can_resolve_r1()
returns boolean language sql stable security definer set search_path = pg_catalog
as $function$
  select auth.uid() is not null and exists (
    select 1 from tapflow_private.r1_staff
    where user_id = auth.uid() and enabled
  );
$function$;
revoke all on function public.tapflow_can_resolve_r1() from public, anon, authenticated, service_role;
grant execute on function public.tapflow_can_resolve_r1() to authenticated;

create function public.tapflow_resolve_r1_incident(p_incident_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  incident public.tapflow_r1_alerts%rowtype;
  actor uuid := auth.uid();
begin
  -- Rechecked on every request, including repeat clicks and revoked memberships.
  if actor is null or not public.tapflow_can_resolve_r1() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_incident_id is null or p_incident_id !~ '^[1-9][0-9]*$' then
    raise exception 'Invalid incident ID' using errcode = '22023';
  end if;
  select * into incident from public.tapflow_r1_alerts
  where id = p_incident_id::bigint and code = 'R1_MISSING_FLOW_SIGNAL'
  for update;
  if not found then
    raise exception 'R1 incident not found' using errcode = 'P0002';
  end if;
  if incident.status = 'ACTIVE' then
    update public.tapflow_r1_alerts
    set status = 'RESOLVED', resolved_at = clock_timestamp(), resolved_by = actor
    where id = incident.id
    returning * into incident;
  elsif incident.status <> 'RESOLVED' then
    raise exception 'Unsupported incident status' using errcode = '22023';
  end if;
  -- Repeat resolution returns original audit details. No episode state is touched.
  -- Stringify the bigint ID before JSON reaches JavaScript.
  return jsonb_build_object(
    'id', incident.id::text, 'detected_at', incident.detected_at,
    'room_id', incident.room_id, 'code', incident.code, 'status', incident.status,
    'evidence', incident.evidence, 'resolved_at', incident.resolved_at,
    'last_detected_at', incident.last_detected_at, 'resolved_by', incident.resolved_by
  );
end
$function$;
revoke all on function public.tapflow_resolve_r1_incident(text) from public, anon, authenticated, service_role;
grant execute on function public.tapflow_resolve_r1_incident(text) to authenticated;

-- REQUIRED BEFORE FINALIZING (installed definitions have not been supplied):
-- 1. Assert exact live function/trigger fingerprints from the baseline export.
-- 2. Replace ONLY the installed incident transition branches with the private
--    callbacks above. Keep thresholds, valid/fresh-data tests, authorized-use
--    predicate and room-isolation conditions byte-for-byte/semantically intact.
-- 3. Recovery callback is reachable ONLY from fresh valid positive NEW room data.
-- 4. Remove the EXACT reviewed status-based active-incident uniqueness guard;
--    keep unrelated indexes, constraints, grants, RLS and publication settings.
-- 5. Preserve installed trigger timing/conditions. Call r1_lock_room BEFORE
--    evaluating predicates; acquire all affected rooms in ascending ID order.
-- 6. Use the approved staff authorization source, or provision this empty private
--    allowlist with separately reviewed existing Auth user IDs.
commit;
