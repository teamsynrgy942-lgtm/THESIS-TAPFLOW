-- Review only. Every executable statement in this file is a read or a SELECT that
-- returns SQL text. It does not create indexes, drop constraints, update alerts,
-- or change detection behavior.
--
-- Incident identity the dashboard expects: (room_id, anomaly code).
-- An ACTIVE incident for Room 1 must not block Room 2, and one code must not
-- block a different code in the same room.
--
-- Re-arm policy, for the detector that is not in this repository:
-- 1. While a (room_id, code) incident is ACTIVE, update that row's evidence,
--    occurrence count, and last-observed time. Do not insert another ACTIVE row.
-- 2. Staff resolution records acknowledgement. It is not proof the sensor recovered.
-- 3. After RESOLVED, open a new incident only after a later evaluation where the
--    same rule's condition is absent, and then present again. Do not reopen on the
--    next unchanged sample.
-- 4. Main flow is aggregate. Do not treat Main flow alone as proof that every
--    active room should show flow.
-- 5. Do not add numeric thresholds in this script. Keep the deployed rule's
--    existing confirmation logic.

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'tapflow_r1_alerts'
order by indexname;

select conname, pg_get_constraintdef(oid, true) as definition
from pg_constraint
where conrelid = to_regclass('public.tapflow_r1_alerts')
order by conname;

-- Returns proposed DDL as text. Apply it only after the queries above show a
-- uniqueness rule wider than one ACTIVE row per (room_id, code). Replace the
-- placeholder index name with the exact name from those results.
select $proposal$
-- Requires approval. Do not run until the index name is confirmed.
-- create unique index concurrently tapflow_r1_alerts_one_active_incident
--   on public.tapflow_r1_alerts (room_id, code)
--   where status = 'ACTIVE';
$proposal$ as proposed_sql_requires_approval;
