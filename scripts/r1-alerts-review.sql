-- R1 configuration review. The statements outside comments are read-only.
-- Run in the project's SQL editor as an authorized reviewer.
-- First compare the SQL Editor's project with the dashboard's projectHost.
-- SQL Editor owner access is not evidence of access for the browser's user.

select c.relrowsecurity as rls_enabled,
       has_schema_privilege('authenticated', c.relnamespace, 'USAGE') as authenticated_schema_usage,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('anon', c.oid, 'SELECT') as anonymous_select_privilege
from pg_class as c
where c.oid = to_regclass('public.tapflow_r1_alerts');

select policyname, roles, cmd, permissive, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'tapflow_r1_alerts';

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public' and tablename = 'tapflow_r1_alerts';

select pubinsert, pubupdate, pubdelete, pubtruncate
from pg_publication
where pubname = 'supabase_realtime';

-- Privileged existence check. The result does not establish browser access.
-- Intentionally omit a status filter: both ACTIVE and RESOLVED must be visible.
select id, room_id, code, status, detected_at,
       detected_at at time zone 'Asia/Manila' as detected_at_pht,
       resolved_at
from public.tapflow_r1_alerts
where id in (1, 3) and room_id = 1 and code = 'R1_MISSING_FLOW_SIGNAL'
order by detected_at desc, id desc;

/*
Read-only access check using the same Auth UUID as the dashboard login.
Run this block separately after replacing EVERY UUID placeholder with the
dashboard's verified Auth UID. No password, API key, or JWT is required here.
If existing RLS uses custom JWT claims, reproduce the approved account's
relevant claim values in request.jwt.claims too; do not invent elevated claims.
Always roll back the transaction, including after a permission error.

begin read only;
set local role authenticated;
set local request.jwt.claim.sub = '<APPROVED_AUTH_USER_UUID>';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"<APPROVED_AUTH_USER_UUID>","role":"authenticated"}';

select current_user as effective_role,
       current_user = 'authenticated' as authenticated_role_matches,
       auth.role() as jwt_role,
       auth.jwt() ->> 'sub' as jwt_subject,
       auth.uid() as effective_uid,
       auth.uid() = '<APPROVED_AUTH_USER_UUID>'::uuid as dashboard_uid_matches,
       auth.jwt() ->> 'role' = 'authenticated' as jwt_role_matches,
       row_security_active('public.tapflow_r1_alerts') as rls_applies;

select id, room_id, code, status, detected_at,
       detected_at at time zone 'Asia/Manila' as detected_at_pht,
       resolved_at
from public.tapflow_r1_alerts
where id in (1, 3) and room_id = 1 and code = 'R1_MISSING_FLOW_SIGNAL'
order by detected_at desc, id desc;
rollback;
*/

/*
Proposed changes for separate approval. Apply only the missing pieces.
Keep RLS enabled. Compare the privileged and authenticated query results.
Confirm rls_enabled is true before applying any grant or SELECT policy below.
If authenticated SELECT is already true, grants alone will not make a hidden
row visible. Review existing permissive and restrictive SELECT/ALL policies.
A new permissive policy cannot override a restrictive policy that rejects the
row. Resolve a conflicting restrictive condition within the intended access
model; do not remove or broaden policies without reviewing their other users.

-- Only if authenticated_schema_usage is false:
grant usage on schema public to authenticated;

-- Only if authenticated_select is false:
grant select on table public.tapflow_r1_alerts to authenticated;

-- Only if the approved dashboard user lacks an applicable SELECT policy.
-- Replace the placeholder with that user's Supabase Auth UUID.
-- The policy grants access to Room 1 R1 records of either status.
-- If this policy name already exists, inspect it before proposing an ALTER;
-- do not blindly drop or replace an existing policy.
create policy "Approved dashboard user can read Room 1 R1 alerts"
on public.tapflow_r1_alerts
for select to authenticated
using (
  (select auth.uid()) = '<APPROVED_AUTH_USER_UUID>'::uuid
  and room_id = 1
  and code = 'R1_MISSING_FLOW_SIGNAL'
);

-- Only if the table is absent from the publication membership query:
-- This affects live delivery; it cannot fix a zero-row SELECT caused by RLS.
alter publication supabase_realtime add table public.tapflow_r1_alerts;

-- If pubinsert or pubupdate is false, confirm the intended publication-wide
-- effects before changing publish settings. This SELECT generates proposed SQL
-- that adds INSERT/UPDATE while retaining existing DELETE and TRUNCATE flags.
select format('alter publication %I set (publish = %L);', pubname,
              concat_ws(', ', 'insert', 'update',
                        case when pubdelete then 'delete' end,
                        case when pubtruncate then 'truncate' end))
from pg_publication
where pubname = 'supabase_realtime' and (not pubinsert or not pubupdate);
*/
