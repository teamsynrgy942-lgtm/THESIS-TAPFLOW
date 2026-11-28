-- Review against the installed RPC before applying. This extends an existing
-- staff resolution setup and expects the p_incident_id / p_remark contract.
begin;
set local search_path = pg_catalog;

do $r2_resolution$
declare
  definition text;
  r1_filter constant text := $match$where id = p_incident_id::bigint and code = 'R1_MISSING_FLOW_SIGNAL'$match$;
  r2_filter constant text := $match$where id = p_incident_id::bigint and code in ('R1_MISSING_FLOW_SIGNAL', 'R2_UNAUTHORIZED_WATER_FLOW')$match$;
  r1_error constant text := $match$raise exception 'R1 incident not found' using errcode = 'P0002';$match$;
  incident_error constant text := $match$raise exception 'Incident not found' using errcode = 'P0002';$match$;
begin
  select pg_get_functiondef(oid) into definition
  from pg_proc
  where oid = to_regprocedure('public.resolve_tapflow_incident(text,text)')
    and proargnames = array['p_incident_id', 'p_remark']
    and prorettype = 'jsonb'::regtype and prosecdef;

  if definition is null then
    raise exception 'Expected existing staff resolution RPC with arguments p_incident_id and p_remark'
      using errcode = '55000';
  end if;
  if cardinality(string_to_array(definition, r1_filter)) <> 2
    or cardinality(string_to_array(definition, r1_error)) <> 2 then
    raise exception 'Installed resolution RPC differs from the reviewed R1 predicate or error. Review its definition before applying R2 support.'
      using errcode = '55000';
  end if;

  -- Reuse the installed function definition so its staff checks, row lock,
  -- audit fields, ownership and grants remain in effect.
  execute replace(replace(definition, r1_filter, r2_filter), r1_error, incident_error);
end
$r2_resolution$;

notify pgrst, 'reload schema';
commit;
