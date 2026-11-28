-- READ-ONLY TEMPLATE: copy to verify-r1-resolution.local.sql and replace every
-- <APPROVED_AUTH_USER_UUID> with the approved existing viewer's auth.users.id.
-- Never commit a filled-in copy. Tests render it with a synthetic test UUID.
-- Run after the reviewed setup and separate staff enrollment, as
-- postgres in the intended Supabase project's SQL Editor. No enrollment,
-- resolution, detector call, trigger/policy change or episode mutation occurs.
-- Expected metadata/capability checks below are TRUE. A FALSE result requires
-- inspection, not a replacement detector or a new SELECT policy.
-- Review installed metadata separately before deployment; no export or account
-- identifier from a live project is required to run the repository tests.
--
-- Run this before and after the browser resolution. Record the returned IDs,
-- status counts, timestamps, evidence and audit details. In /alerts, sign in as
-- this same account, reload after enrollment, and resolve one approved ACTIVE ID.
-- Expect that ID to become RESOLVED with this UUID and the chosen remark, while
-- retaining detection time/evidence and staying in history after a page reload.
-- Other ACTIVE IDs stay ACTIVE; counts change by exactly one if no unrelated
-- detector or staff event occurs. Do not create synthetic rows in the live DB.
-- Installed recovery can start a later episode independently of staff resolution;
-- this script does not inspect or alter tapflow_internal.r1_room_episode.
-- If any statement fails, run ROLLBACK before continuing.

begin read only;
-- Match the baseline export's visibility when deparsing catalog definitions.
set local search_path = public, pg_catalog;

select
  to_regprocedure('public.tapflow_can_resolve_r1()') is not null
    as capability_signature_exists,
  coalesce((select p.pronargs = 0 and p.prorettype = 'boolean'::regtype
    from pg_proc p where p.oid = to_regprocedure('public.tapflow_can_resolve_r1()')), false)
    as capability_arguments_and_return_match,
  to_regprocedure('public.resolve_tapflow_incident(text,text)') is not null
    as resolution_signature_exists,
  coalesce((select p.proargnames = array['p_incident_id', 'p_remark']::text[]
      and p.pronargs = 2 and p.prorettype = 'jsonb'::regtype
    from pg_proc p where p.oid = to_regprocedure('public.resolve_tapflow_incident(text,text)')), false)
    as resolution_argument_names_and_return_match;

select
  coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.tapflow_can_resolve_r1()'), 'EXECUTE'), false)
    as authenticated_can_check_capability,
  coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.resolve_tapflow_incident(text,text)'), 'EXECUTE'), false)
    as authenticated_can_call_resolution,
  coalesce(not has_function_privilege('anon',
    to_regprocedure('public.resolve_tapflow_incident(text,text)'), 'EXECUTE'), false)
    as anonymous_resolution_is_blocked,
  coalesce(not has_function_privilege('service_role',
    to_regprocedure('public.resolve_tapflow_incident(text,text)'), 'EXECUTE'), false)
    as service_role_resolution_is_blocked;

select
  coalesce((select md5(pg_get_functiondef(p.oid)) = '201222cdca74a0ad581ce1bd6e78c855'
    from pg_proc p where p.oid = to_regprocedure('public.tapflow_r1_after_flow_insert()')), false)
    as installed_detector_function_preserved,
  coalesce((select md5(pg_get_triggerdef(t.oid, true)) = 'ad626946c8c76d776c431018c1937179'
      and t.tgenabled = 'O'
      and t.tgfoid = to_regprocedure('public.tapflow_r1_after_flow_insert()')
    from pg_trigger t
    where t.tgrelid = to_regclass('public.flow_readings')
      and t.tgname = 'tapflow_r1_flow_insert_trigger' and not t.tgisinternal), false)
    as installed_detector_trigger_preserved_and_enabled,
  not exists (select 1 from pg_trigger t
    where t.tgrelid = to_regclass('public.tapflow_r1_alerts') and not t.tgisinternal)
    as no_alert_user_triggers_preserved;

select
  coalesce((select c.relrowsecurity and not c.relforcerowsecurity
    from pg_class c where c.oid = to_regclass('public.tapflow_r1_alerts')), false)
    as alert_rls_settings_preserved,
  (select count(*) = 1 from pg_policies
    where schemaname = 'public' and tablename = 'tapflow_r1_alerts')
    as original_alert_policy_count_preserved,
  coalesce((select p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.qual = '(auth.uid() = ''<APPROVED_AUTH_USER_UUID>''::uuid)'
      and p.with_check is null
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'tapflow_r1_alerts'
      and p.policyname = 'tapflow_r1_authorized_viewer'), false)
    as original_authorized_viewer_policy_preserved;

-- Simulate the already-authorized account for read/capability checks only.
-- SQL Editor's default postgres role has no browser Auth identity by itself.
set local role authenticated;
set local request.jwt.claim.sub = '<APPROVED_AUTH_USER_UUID>';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"<APPROVED_AUTH_USER_UUID>","role":"authenticated"}';

select
  current_user = 'authenticated' as authenticated_role_matches,
  auth.uid() = '<APPROVED_AUTH_USER_UUID>'::uuid as dashboard_uuid_matches,
  row_security_active('public.tapflow_r1_alerts') as alert_rls_applies,
  public.tapflow_can_resolve_r1() as enrolled_staff_can_resolve;

-- No status filter: resolved rows must remain eligible under the same policy.
select count(*) as visible_r1_history_count,
       count(*) filter (where status = 'ACTIVE') as active_count,
       count(*) filter (where status = 'RESOLVED') as resolved_count
from public.tapflow_r1_alerts
where code = 'R1_MISSING_FLOW_SIGNAL';

select a.id::text as id, a.room_id, a.code, a.status, a.detected_at,
       a.resolved_at, a.resolved_by, a.resolution_remark, a.evidence
from public.tapflow_r1_alerts a
where a.code = 'R1_MISSING_FLOW_SIGNAL'
order by a.detected_at desc, a.id desc;

rollback;
