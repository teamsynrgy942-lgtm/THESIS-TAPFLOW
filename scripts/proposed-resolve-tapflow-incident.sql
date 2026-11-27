-- Review only. This file returns the proposed function as text. It does not
-- create the function, change RLS, grant table UPDATE, or modify alert rows.
--
-- Deploy only after confirming:
-- * public.tapflow_r1_alerts.evidence is jsonb
-- * status values are ACTIVE and RESOLVED
-- * id can be compared as text
-- * authenticated dashboard users are the intended staff
-- * the function owner is a role allowed to update the table
--
-- The function records auth.uid() and clock_timestamp() on the server.
-- It ignores any staff id or timestamp supplied by the browser.
-- It updates one ACTIVE row and rejects a second resolution.
-- Optional app_metadata.tapflow_role tightens access when that claim exists.
-- A missing claim does not lock out the current dashboard accounts, because
-- this project has no deployed staff-role claim.

select $proposal$
create or replace function public.resolve_tapflow_incident(
  p_alert_id text,
  p_remarks text default null
) returns public.tapflow_r1_alerts
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := auth.uid();
  staff_role text := auth.jwt() -> 'app_metadata' ->> 'tapflow_role';
  result public.tapflow_r1_alerts;
  note text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if staff_role is not null and staff_role not in ('staff', 'admin') then
    raise exception 'Not authorized to resolve incidents' using errcode = '42501';
  end if;
  if p_alert_id is null or btrim(p_alert_id) = '' or char_length(coalesce(note, '')) > 500 then
    raise exception 'Invalid resolution request' using errcode = '22023';
  end if;

  update public.tapflow_r1_alerts
  set status = 'RESOLVED',
      resolved_at = clock_timestamp(),
      evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
        'resolution_note', note,
        'resolved_by', actor::text
      )
  where id::text = btrim(p_alert_id)
    and status = 'ACTIVE'
  returning * into result;

  if not found then
    raise exception 'Incident is not an active record' using errcode = 'P0002';
  end if;

  raise log 'tapflow_resolve alert_id=% actor=%', result.id, actor;
  return result;
end;
$function$;

revoke all on function public.resolve_tapflow_incident(text, text) from public, anon;
grant execute on function public.resolve_tapflow_incident(text, text) to authenticated;
$proposal$ as proposed_function_requires_approval;
