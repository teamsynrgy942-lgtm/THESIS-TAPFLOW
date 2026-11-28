-- READ ONLY: run in the intended project's SQL Editor and export the single JSON cell.
-- This does not execute any returned function/trigger definition or change any object.
-- It reads catalog metadata only: no alert evidence, sensor rows, auth.users,
-- staff membership rows, passwords, session tokens, or JWT claims are selected.
-- Function definitions are needed to preserve the installed thresholds and isolation.
-- Inspect custom function source before sharing if your project hardcodes credentials.
-- MD5 values fingerprint exact definitions for a migration drift guard; they are not
-- signatures or evidence that a detector is correct. Use the live definitions as baseline.
with
input_tables(schema_name, table_name) as (
  values ('public', 'flow_readings'), ('public', 'room_status'),
         ('public', 'tapflow_r1_alerts')
),
application_functions as (
  select p.*, n.nspname as schema_name
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\_%' escape '\'
),
r1_function_oids as (
  select oid
  from application_functions
  where proname ~* '(^|_)r1(_|$)'
     or prosrc ilike '%tapflow_r1_alerts%'
),
staff_function_oids as (
  select oid
  from application_functions
  where schema_name not in ('auth', 'storage', 'extensions', 'realtime', 'vault')
    and proname ~* '(staff|admin|authoriz|permission|(^|_)roles?(_|$)|can_.*(resolve|manage)|is_.*(operator|manager))'
),
staff_tables as (
  select n.nspname as schema_name, c.relname as table_name
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage',
                         'extensions', 'realtime', 'vault')
    and n.nspname not like 'pg\_%' escape '\'
    and c.relname ~* '(staff|admin|(^|_)(user_)?roles?(_|$)|permission|membership|profiles?)'
),
selected_tables as (
  select * from input_tables
  union
  select * from staff_tables
),
selected_relations as (
  select c.*, n.nspname as schema_name
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  join selected_tables as s on s.schema_name = n.nspname and s.table_name = c.relname
),
selected_triggers as (
  select t.*, r.schema_name, r.relname as table_name
  from pg_trigger as t
  join selected_relations as r on r.oid = t.tgrelid
  where not t.tgisinternal
),
selected_function_oids as (
  select oid from r1_function_oids
  union
  select oid from staff_function_oids
  union
  select tgfoid from selected_triggers
),
function_definitions as (
  select p.oid,
         p.schema_name,
         p.proname as function_name,
         p.oid::regprocedure::text as identity,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         pg_get_functiondef(p.oid) as definition,
         pg_get_userbyid(p.proowner) as owner,
         p.prosecdef as security_definer,
         p.proconfig as function_settings,
         exists (select 1 from r1_function_oids r where r.oid = p.oid) as r1_candidate,
         exists (select 1 from staff_function_oids s where s.oid = p.oid) as staff_candidate
  from application_functions as p
  join selected_function_oids as s on s.oid = p.oid
)
select jsonb_build_object(
  'format_version', 1,
  'exported_at', statement_timestamp(),
  'server_version_num', current_setting('server_version_num'),
  'scope', 'Catalog metadata only; staff candidates are discovered by name, not confirmed authorization.',
  'requested_inputs', (
    select jsonb_agg(jsonb_build_object(
      'schema', i.schema_name, 'table', i.table_name,
      'exists', to_regclass(format('%I.%I', i.schema_name, i.table_name)) is not null
    ) order by i.schema_name, i.table_name)
    from input_tables as i
  ),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', f.schema_name, 'name', f.function_name,
      'identity', f.identity, 'identity_arguments', f.identity_arguments,
      'definition', f.definition, 'definition_md5', md5(f.definition),
      'owner', f.owner, 'security_definer', f.security_definer,
      'settings', f.function_settings, 'r1_candidate', f.r1_candidate,
      'staff_candidate', f.staff_candidate,
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          'privilege', a.privilege_type, 'grantable', a.is_grantable
        ) order by a.grantee, a.privilege_type)
        from pg_proc as p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
        where p.oid = f.oid
      ), '[]'::jsonb)
    ) order by f.schema_name, f.identity)
    from function_definitions as f
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'table', t.table_name, 'name', t.tgname,
      'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true),
      'definition_md5', md5(pg_get_triggerdef(t.oid, true)),
      'function_identity', t.tgfoid::regprocedure::text,
      'function_definition', pg_get_functiondef(t.tgfoid),
      'function_definition_md5', md5(pg_get_functiondef(t.tgfoid))
    ) order by t.schema_name, t.table_name, t.tgname)
    from selected_triggers as t
  ), '[]'::jsonb),
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', r.schema_name, 'table', r.relname,
      'owner', pg_get_userbyid(r.relowner),
      'staff_candidate', exists (
        select 1 from staff_tables as s
        where s.schema_name = r.schema_name and s.table_name = r.relname
      ),
      'rls_enabled', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
      'replica_identity', r.relreplident,
      'columns', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.ordinal_position)
        from information_schema.columns as c
        where c.table_schema = r.schema_name and c.table_name = r.relname
      ), '[]'::jsonb),
      'constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', c.conname, 'type', c.contype,
          'definition', pg_get_constraintdef(c.oid, true),
          'validated', c.convalidated, 'deferrable', c.condeferrable,
          'initially_deferred', c.condeferred
        ) order by c.conname)
        from pg_constraint as c where c.conrelid = r.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        select jsonb_agg(to_jsonb(i) order by i.indexname)
        from pg_indexes as i where i.schemaname = r.schema_name and i.tablename = r.relname
      ), '[]'::jsonb),
      'policies', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.policyname)
        from pg_policies as p where p.schemaname = r.schema_name and p.tablename = r.relname
      ), '[]'::jsonb),
      'table_grants', coalesce((
        select jsonb_agg(to_jsonb(g) order by g.grantee, g.privilege_type)
        from information_schema.table_privileges as g
        where g.table_schema = r.schema_name and g.table_name = r.relname
      ), '[]'::jsonb),
      'column_grants', coalesce((
        select jsonb_agg(to_jsonb(g) order by g.grantee, g.column_name, g.privilege_type)
        from information_schema.column_privileges as g
        where g.table_schema = r.schema_name and g.table_name = r.relname
      ), '[]'::jsonb),
      'schema_grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          'privilege', a.privilege_type, 'grantable', a.is_grantable
        ) order by a.grantee, a.privilege_type)
        from pg_namespace as n
        cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) as a
        where n.oid = r.relnamespace
      ), '[]'::jsonb)
    ) order by r.schema_name, r.relname)
    from selected_relations as r
  ), '[]'::jsonb),
  'realtime_publication', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', p.pubname, 'all_tables', p.puballtables,
      'insert', p.pubinsert, 'update', p.pubupdate,
      'delete', p.pubdelete, 'truncate', p.pubtruncate,
      'tables', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.schemaname, t.tablename)
        from pg_publication_tables as t
        where t.pubname = p.pubname
          and (t.schemaname, t.tablename) in (
            select i.schema_name, i.table_name from input_tables as i
          )
      ), '[]'::jsonb)
    ) order by p.pubname)
    from pg_publication as p where p.pubname = 'supabase_realtime'
  ), '[]'::jsonb)
) as r1_lifecycle_baseline;
