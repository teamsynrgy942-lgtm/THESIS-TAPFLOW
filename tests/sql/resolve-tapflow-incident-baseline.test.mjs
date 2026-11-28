import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Local PostgreSQL only. All accounts, rows, grants and schema state are synthetic.
// This fixture is not a live export or a full database restoration. The scripts
// are exercised with only their documented account placeholder substituted;
// the deployment baseline guard is not removed or changed in these tests.
const staff = '11111111-1111-4111-8111-111111111111';
async function renderScript(relativePath) {
  const template = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  assert.ok(template.includes('<APPROVED_AUTH_USER_UUID>'), `${relativePath} documents its account input.`);
  return template.replaceAll('<APPROVED_AUTH_USER_UUID>', staff);
}
const [setup, enrollment, verification] = await Promise.all([
  renderScript('../../supabase/drafts/resolve_tapflow_incident.sql'),
  renderScript('../../supabase/drafts/enroll_r1_dashboard_staff.example.sql'),
  renderScript('../../scripts/verify-r1-resolution.sql'),
]);
// PostgreSQL stores function body newlines verbatim. Normalize the legacy CRLF
// body representation so its checked fingerprint is independent of Git's
// checkout line-ending configuration on Windows and Linux.
const fixtureSql = (await readFile(new URL('../fixtures/sql/r1-resolution-baseline.sql', import.meta.url), 'utf8'))
  .replace(/\r?\n/g, '\r\n');
const first = '9007199254740993';
const second = '9007199254740994';

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function metadata(db) {
  return (await db.query(`
    select jsonb_build_object(
      'triggers', (select jsonb_agg(jsonb_build_object('name', tgname, 'enabled', tgenabled,
        'definition', pg_get_triggerdef(oid, true)) order by tgname) from pg_trigger where not tgisinternal),
      'functions', (select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('tapflow_r1_after_flow_insert', 'tapflow_update_status_timestamp')),
      'policies', (select jsonb_agg(to_jsonb(p) order by tablename, policyname) from pg_policies p where schemaname = 'public'),
      'grants', (select jsonb_agg(to_jsonb(g) order by table_name, grantee, privilege_type)
        from information_schema.table_privileges g where table_schema = 'public'),
      'rls', (select jsonb_agg(jsonb_build_object('name', relname, 'rls', relrowsecurity, 'forced', relforcerowsecurity) order by relname)
        from pg_class where oid in ('public.flow_readings'::regclass, 'public.room_status'::regclass, 'public.tapflow_r1_alerts'::regclass)),
      'constraints', (select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint
        where conrelid in ('public.flow_readings'::regclass, 'public.room_status'::regclass, 'public.tapflow_r1_alerts'::regclass)),
      'indexes', (select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname = 'public')
    ) as value
  `)).rows[0].value;
}

async function alerts(db) {
  return (await db.query('select id::text, to_jsonb(a) - \'id\' as row from public.tapflow_r1_alerts a order by a.id')).rows;
}

async function episodes(db) {
  return (await db.query(`select to_jsonb(e) - 'alert_id' || jsonb_build_object('alert_id', e.alert_id::text) as row
    from tapflow_internal.r1_room_episode e order by room_id`)).rows;
}

async function verify(db, activeCount, resolvedCount) {
  const results = await db.exec(verification);
  const checks = results.filter(({ rows }) => rows?.length === 1
    && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((value) => typeof value === 'boolean'));
  assert.equal(checks.length, 5, 'All five metadata/identity verification queries execute.');
  for (const { rows } of checks) for (const [name, value] of Object.entries(rows[0])) assert.equal(value, true, name);
  const counts = results.find(({ rows }) => rows?.[0]?.visible_r1_history_count != null).rows[0];
  assert.equal(Number(counts.visible_r1_history_count), 3);
  assert.equal(Number(counts.active_count), activeCount);
  assert.equal(Number(counts.resolved_count), resolvedCount);
  const visible = results.find(({ rows }) => rows?.[0]?.code === 'R1_MISSING_FLOW_SIGNAL').rows;
  assert.equal(visible.length, 3);
}

async function asStaff(db, action) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [staff]);
  await db.exec('set role authenticated');
  try { return await action(); }
  finally { await db.exec('reset role'); }
}

test('the resolution templates preserve the synthetic detector catalog, policy and episode state', async () => {
  const db = await fixture();
  try {
    const catalog = await metadata(db);
    const originalRows = await alerts(db);
    const originalEpisodes = await episodes(db);
    await db.exec(setup);
    assert.deepEqual(await metadata(db), catalog, 'Detector, triggers, SELECT policy, grants, indexes and constraints stay unchanged.');
    assert.deepEqual(await episodes(db), originalEpisodes, 'Installation never rearms an episode.');
    assert.deepEqual((await alerts(db)).map(({ id, row }) => {
      const { resolved_by, resolution_remark, ...original } = row;
      assert.equal(resolved_by, null);
      assert.equal(resolution_remark, null);
      return { id, row: original };
    }), originalRows, 'Installation does not backfill or rewrite alerts.');
    await asStaff(db, async () => {
      assert.equal((await db.query('select public.tapflow_can_resolve_r1() as allowed')).rows[0].allowed, false);
    });
    await db.exec(enrollment);
    await db.exec(enrollment);
    assert.deepEqual((await db.query('select user_id::text, enabled from tapflow_private.r1_staff')).rows,
      [{ user_id: staff, enabled: true }], 'The enrollment template is idempotent.');
    await verify(db, 2, 1);
    const resolution = await asStaff(db, async () => {
      assert.equal((await db.query('select public.tapflow_can_resolve_r1() as allowed')).rows[0].allowed, true);
      return (await db.query('select public.resolve_tapflow_incident($1, $2) as value', [first, 'Signal wire repaired.'])).rows[0].value;
    });
    assert.equal(resolution.id, first);
    assert.equal(resolution.status, 'RESOLVED');
    assert.equal(resolution.resolved_by, staff);
    assert.equal(resolution.resolution_remark, 'Signal wire repaired.');
    const visible = await asStaff(db, () => alerts(db));
    assert.equal(visible.length, 3, 'The existing viewer policy retains resolved history.');
    assert.equal(visible.find(({ id }) => id === first).row.status, 'RESOLVED');
    assert.equal(visible.find(({ id }) => id === second).row.status, 'ACTIVE');
    assert.deepEqual(visible.filter(({ id }) => id !== first).map(({ id, row }) => {
      const { resolved_by, resolution_remark, ...original } = row;
      return { id, row: original };
    }), originalRows.filter(({ id }) => id !== first));
    assert.deepEqual(await episodes(db), originalEpisodes, 'Staff resolution does not reset the installed episode latch.');
    assert.deepEqual(await metadata(db), catalog);
    await verify(db, 1, 2);
  } finally { await db.close(); }
});

test('the installed detector keeps a resolved episode latched through repeated faults until positive room recovery', async () => {
  const db = await fixture();
  try {
    await db.exec(setup);
    await db.exec(enrollment);
    await asStaff(db, () => db.query('select public.resolve_tapflow_incident($1, $2)', [first, null]));
    await db.exec('begin');
    const before = await alerts(db);
    // Fixture trigger/function with samples satisfying its freshness, spacing,
    // authorization and flow predicates.
    await db.exec(`
      insert into public.flow_readings(device_id, sample_ms, flow_lpm, r1_received_at) values
        ('main', 15000, 1, now() - interval '30 seconds'),
        ('main', 15000, 1, now() - interval '15 seconds');
      insert into public.flow_readings(device_id, sample_ms, pulses, valve_open, r1_received_at) values
        ('room1', 15000, 0, true, now() - interval '30 seconds'),
        ('room1', 15000, 0, true, now() - interval '15 seconds');
    `);
    assert.deepEqual(await alerts(db), before, 'Fault uploads do not reopen the resolved alert or add another incident.');
    assert.equal((await episodes(db))[0].row.alert_id, first);
    await db.exec(`
      insert into public.flow_readings(device_id, sample_ms, pulses, valve_open, r1_received_at) values
        ('room1', 15000, 5, true, now() - interval '14 seconds'),
        ('room1', 15000, 5, true, now() - interval '1 second');
    `);
    assert.equal((await episodes(db))[0].row.alert_id, null, 'Only the installed positive room-recovery path rearms the episode.');
    assert.deepEqual(await alerts(db), before, 'Positive recovery retains both the resolved history and separate active incident.');
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('the deployment preflight rejects detector, SELECT policy and alert-trigger drift before changing objects', async () => {
  const db = await fixture();
  try {
    const originalCatalog = await metadata(db);
    const originalRows = await alerts(db);
    const unfilledSetup = await readFile(new URL('../../supabase/drafts/resolve_tapflow_incident.sql', import.meta.url), 'utf8');
    await assert.rejects(() => db.exec(unfilledSetup), (error) => error.code === '22023',
      'The public template requires a deliberate account value before installing anything.');
    await db.exec('rollback');
    const changes = [
      `create or replace function public.tapflow_r1_after_flow_insert() returns trigger language plpgsql as $$ begin return new; end; $$;`,
      `alter policy tapflow_r1_authorized_viewer on public.tapflow_r1_alerts using (false);`,
      `create trigger unexpected_alert_update before update on public.tapflow_r1_alerts for each row execute function public.tapflow_update_status_timestamp();`,
    ];
    for (const change of changes) {
      await db.exec('begin');
      await db.exec(change);
      await assert.rejects(() => db.exec(setup), (error) => error.code === '55000'
        && error.message.startsWith('R1 resolution baseline changed:'));
      await db.exec('rollback');
      assert.deepEqual(await metadata(db), originalCatalog);
      assert.deepEqual(await alerts(db), originalRows);
      assert.equal((await db.query("select to_regclass('tapflow_private.r1_staff') as staff_table")).rows[0].staff_table, null);
      assert.equal((await db.query(`select count(*)::integer as count from information_schema.columns
        where table_schema = 'public' and table_name = 'tapflow_r1_alerts' and column_name in ('resolved_by', 'resolution_remark')`)).rows[0].count, 0);
    }
  } finally { await db.close(); }
});
