-- ENROLLMENT TEMPLATE: copy to enroll_r1_dashboard_staff.sql (gitignored), then
-- replace <APPROVED_AUTH_USER_UUID> with an approved existing auth.users.id.
-- Run manually as postgres after reviewed resolve_tapflow_incident.sql setup.
-- No real account ID or credential belongs in this example. Tests render it with
-- synthetic fixture data inside isolated PostgreSQL; they never contact Supabase.
-- This authorizes R1 resolution across rooms. It does not change the alert SELECT
-- policy, detector, episode ledger, or alert rows. The Auth FK requires the user.
begin;
insert into tapflow_private.r1_staff (user_id, enabled)
values ('<APPROVED_AUTH_USER_UUID>'::uuid, true)
on conflict (user_id) do update set enabled = excluded.enabled
returning user_id, enabled;
commit;

-- To revoke later, run separately as postgres:
-- update tapflow_private.r1_staff set enabled = false
-- where user_id = '<APPROVED_AUTH_USER_UUID>'::uuid;
