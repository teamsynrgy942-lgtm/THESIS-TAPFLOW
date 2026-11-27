-- R1 automatic-sync review. Every executable statement in this file is read-only.
-- Run in the intended Supabase project's SQL Editor as an authorized reviewer.
-- Compare its project with the signed-in browser's projectHost first.
-- Owner-visible rows do not prove SELECT access for the browser's Auth user.
-- No publication, policy, grant, trigger, sequence, or alert is changed here.

-- 1. Publication exists, publishes each relevant event, and includes this table.
select p.pubname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete,
       p.pubtruncate,
       exists (
         select 1 from pg_publication_tables as pt
         where pt.pubname = p.pubname
           and pt.schemaname = 'public' and pt.tablename = 'tapflow_r1_alerts'
       ) as includes_r1_alerts
from pg_publication as p
where p.pubname = 'supabase_realtime';

-- No row above means the publication itself is absent; investigate project setup.
-- JSON access keeps this review compatible with versions without rowfilter/attnames.
select pt.pubname, pt.schemaname, pt.tablename,
       to_jsonb(pt) -> 'attnames' as published_columns,
       to_jsonb(pt) ->> 'rowfilter' as publication_row_filter
from pg_publication_tables as pt
where pt.pubname = 'supabase_realtime'
  and pt.schemaname = 'public' and pt.tablename = 'tapflow_r1_alerts';

-- 2. RLS, grants, identity and SELECT/ALL policies. Keep RLS enabled.
select c.oid::regclass as alert_table, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       case c.relreplident when 'd' then 'DEFAULT' when 'n' then 'NOTHING'
         when 'f' then 'FULL' when 'i' then 'INDEX' end as replica_identity,
       has_schema_privilege('authenticated', c.relnamespace, 'USAGE') as authenticated_schema_usage,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_table_select
from pg_class as c
where c.oid = to_regclass('public.tapflow_r1_alerts');

select policyname, roles, cmd, permissive, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'tapflow_r1_alerts'
order by policyname;

select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tapflow_r1_alerts'
order by grantee, privilege_type;

select grantee, column_name, privilege_type
from information_schema.role_column_grants
where table_schema = 'public' and table_name = 'tapflow_r1_alerts'
  and privilege_type = 'SELECT'
order by grantee, column_name;

-- 3. Preflight for isolated manual test data: required columns/defaults, identity,
--    foreign/check constraints, active-alert uniqueness, and trigger side effects.
select column_name, data_type, udt_name, is_nullable, column_default,
       is_identity, identity_generation, is_generated, generation_expression
from information_schema.columns
where table_schema = 'public' and table_name = 'tapflow_r1_alerts'
order by ordinal_position;

select conname, contype, pg_get_constraintdef(oid, true) as definition
from pg_constraint
where conrelid = to_regclass('public.tapflow_r1_alerts')
order by conname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'tapflow_r1_alerts'
order by indexname;

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) as trigger_definition,
       p.oid::regprocedure as trigger_function,
       pg_get_functiondef(p.oid) as trigger_function_definition
from pg_trigger as t
join pg_proc as p on p.oid = t.tgfoid
where t.tgrelid = to_regclass('public.tapflow_r1_alerts')
  and not t.tgisinternal
order by t.tgname;

-- Sequence identity only: do not call nextval(), setval(), or reset a sequence.
select pg_get_serial_sequence('public.tapflow_r1_alerts', 'id') as id_sequence;

-- 4. Existing evidence baseline, intentionally omitting evidence JSON.
select id::text, room_id, code, status, detected_at, resolved_at
from public.tapflow_r1_alerts
where id in (1, 3)
order by id;

-- Choose only a supported room (1, 2 or 3) visible under existing account RLS.
-- If all available rooms have ACTIVE R1 rows, use a staging clone; do not resolve
-- or delete a real alert to make room for a test.
select room_id, status, count(*) as records
from public.tapflow_r1_alerts
where code = 'R1_MISSING_FLOW_SIGNAL'
group by room_id, status
order by room_id, status;

-- 5. Generate conditional publication-only proposals for manual review.
-- These SELECTs RETURN SQL TEXT; they do not execute it.
select 'alter publication supabase_realtime add table public.tapflow_r1_alerts;'
       as proposed_sql_if_membership_missing
where to_regclass('public.tapflow_r1_alerts') is not null
  and exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'tapflow_r1_alerts'
  );

-- Changing event flags affects EVERY table in this publication. Review that scope.
-- Preserve any existing TRUNCATE setting while enabling INSERT/UPDATE/DELETE.
select format('alter publication %I set (publish = %L);', pubname,
              concat_ws(', ', 'insert', 'update', 'delete',
                        case when pubtruncate then 'truncate' end))
       as proposed_sql_if_event_flag_missing
from pg_publication
where pubname = 'supabase_realtime'
  and (not pubinsert or not pubupdate or not pubdelete);

/*
Optional, separate, read-only RLS check as the browser's verified Auth UUID.
Replace every UUID placeholder with the same existing approved user. If policy
expressions use other claims, reproduce only that account's actual approved claims.
Run separately and always ROLLBACK, including after a permission error.

begin read only;
set local role authenticated;
set local request.jwt.claim.sub = '<APPROVED_AUTH_USER_UUID>';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"<APPROVED_AUTH_USER_UUID>","role":"authenticated"}';

select current_user as effective_role, auth.uid() as effective_uid,
       auth.role() as effective_jwt_role,
       row_security_active('public.tapflow_r1_alerts') as rls_applies;

select id::text, room_id, code, status, detected_at, resolved_at
from public.tapflow_r1_alerts
where code = 'R1_MISSING_FLOW_SIGNAL'
order by detected_at desc, id desc;
rollback;

Rows must be SELECT-visible in both ACTIVE and RESOLVED states. A SELECT policy
limited to ACTIVE can hide resolution rather than deliver an UPDATE to that user.
Review the intended access model with the administrator; no policy replacement,
RLS disabling, or access expansion is proposed in this file.

The frontend uses database events only as invalidation hints, then performs its
authenticated SELECT. DELETE events can have reduced old-row data under RLS;
the frontend must not depend on that data. Do not set REPLICA IDENTITY FULL just
to obtain old evidence payloads. Check the existing primary/replica identity if
Postgres reports an UPDATE/DELETE publication error.
*/
