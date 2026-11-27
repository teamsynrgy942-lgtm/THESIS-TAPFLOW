import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL only: no Supabase connection or live data is used.
// This exercises authorization and row isolation, not live multi-session races
// or the installed R1 detector's behavior.
const reviewedSetup = await readFile(new URL('../../supabase/drafts/resolve_tapflow_incident.sql', import.meta.url), 'utf8');
const baselineGuard = /do \$resolution_baseline\$[\s\S]*?\$resolution_baseline\$;/i;
assert.equal(reviewedSetup.match(new RegExp(baselineGuard.source, 'gi'))?.length, 1);
// Generic edge cases below use a deliberately different synthetic catalog.
// Only this named guard is omitted in memory. The companion baseline suite runs
// the complete, unmodified SQL against the exact exported detector and policy.
const setup = reviewedSetup.replace(baselineGuard, '-- Guard omitted ONLY in this generic synthetic fixture.');
const staff = '11111111-1111-4111-8111-111111111111';
const otherStaff = '22222222-2222-4222-8222-222222222222';
const ordinary = '33333333-3333-4333-8333-333333333333';
const first = '9007199254740993';
const second = '9007199254740994';
let db;

async function rows() {
  return (await db.query('select id::text, to_jsonb(a) - \'id\' as row from public.tapflow_r1_alerts a order by id')).rows;
}

async function access() {
  return (await db.query(`
    select relrowsecurity,
      has_table_privilege('authenticated', oid, 'SELECT') as can_select,
      has_table_privilege('authenticated', oid, 'UPDATE') as can_update,
      (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
       where schemaname = 'public' and tablename = 'tapflow_r1_alerts') as policies
    from pg_class where oid = 'public.tapflow_r1_alerts'::regclass
  `)).rows;
}

async function asRole(role, actor, action) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor ?? '']);
  await db.exec(`set local role ${role}`);
  try { return await action(); }
  finally { await db.exec('reset role'); }
}

async function reject(action, code) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(action, (error) => error.code === code); }
  finally { await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure'); }
}

async function resolve(id, remark = null) {
  return (await db.query('select public.resolve_tapflow_incident($1, $2) as incident', [id, remark])).rows[0].incident;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${staff}'), ('${otherStaff}'), ('${ordinary}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    -- Existing private infrastructure may legitimately use this schema. Installing
    -- staff resolution must preserve its grants while protecting the new table.
    create schema tapflow_private;
    grant usage on schema tapflow_private to service_role;
    create table tapflow_private.unrelated_infrastructure(id integer);
    grant select on tapflow_private.unrelated_infrastructure to service_role;
    create table public.tapflow_r1_alerts (
      id bigint primary key, detected_at timestamptz not null,
      room_id integer not null, code text not null,
      status text not null check(status in ('ACTIVE', 'RESOLVED')),
      evidence jsonb not null, resolved_at timestamptz,
      private_confidential text default 'not-public'
    );
    insert into public.tapflow_r1_alerts values
      (${first}, '2026-11-27T01:00:00Z', 1, 'R1_MISSING_FLOW_SIGNAL', 'ACTIVE', '{"original":1}', null),
      (${second}, '2026-11-27T02:00:00Z', 1, 'R1_MISSING_FLOW_SIGNAL', 'ACTIVE', '{"original":2}', null),
      (3, '2026-11-27T00:00:00Z', 2, 'R1_MISSING_FLOW_SIGNAL', 'RESOLVED', '{"history":true}', '2026-11-27T00:01:00Z'),
      (4, '2026-11-27T00:00:00Z', 2, 'OTHER_RULE', 'ACTIVE', '{}', null);
    alter table public.tapflow_r1_alerts enable row level security;
    create policy fixture_read on public.tapflow_r1_alerts for select to authenticated
      using(auth.uid() is not null);
    grant select on public.tapflow_r1_alerts to authenticated;
    create table public.flow_readings(id integer primary key);
    create function public.fixture_detector() returns trigger language plpgsql as $$
      begin return new; end;
    $$;
    create trigger fixture_detector after insert on public.flow_readings
      for each row execute function public.fixture_detector();
  `);
  const originalRows = await rows();
  const originalAccess = await access();
  const schemaAccess = await db.query(`
    select has_schema_privilege('service_role', 'tapflow_private', 'USAGE') as schema_usage,
      has_table_privilege('service_role', 'tapflow_private.unrelated_infrastructure', 'SELECT') as can_read
  `);
  const detector = await db.query("select pg_get_functiondef('public.fixture_detector()'::regprocedure) as definition");
  const triggers = await db.query("select pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by oid");
  await db.exec(setup);
  assert.deepEqual((await rows()).map(({ id, row }) => {
    const { resolved_by, resolution_remark, ...original } = row;
    assert.equal(resolved_by, null);
    assert.equal(resolution_remark, null);
    return { id, row: original };
  }), originalRows, 'Installation must not update/backfill history.');
  assert.deepEqual(await access(), originalAccess, 'Installation must preserve alert RLS and table privileges.');
  assert.deepEqual(await db.query(`
    select has_schema_privilege('service_role', 'tapflow_private', 'USAGE') as schema_usage,
      has_table_privilege('service_role', 'tapflow_private.unrelated_infrastructure', 'SELECT') as can_read
  `), schemaAccess, 'Installation must preserve grants for unrelated private infrastructure.');
  assert.deepEqual(await db.query("select pg_get_functiondef('public.fixture_detector()'::regprocedure) as definition"), detector);
  assert.deepEqual(await db.query("select pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by oid"), triggers);
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });

test('resolves exactly one of two active same-room incidents, retaining remark and history', async () => {
  const before = await rows();
  await db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid)', [staff]);
  const result = await asRole('authenticated', staff, () => resolve(first, '  Sensor checked.  '));
  assert.equal(result.id, first);
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.resolved_by, staff);
  assert.equal(result.resolution_remark, 'Sensor checked.');
  assert.ok(result.resolved_at);
  assert.equal(result.last_detected_at, null, 'Detector timestamp column is not required.');
  assert.equal('private_confidential' in result, false, 'RPC exposes only whitelisted fields.');
  const after = await rows();
  assert.equal(after.length, before.length, 'History remains present.');
  assert.deepEqual(await asRole('authenticated', staff, rows), after,
    'The authenticated resolver can still read resolved history and the remaining active alerts through RLS.');
  assert.deepEqual(after.filter(({ id }) => id !== first), before.filter(({ id }) => id !== first));
  const changed = after.find(({ id }) => id === first).row;
  const original = before.find(({ id }) => id === first).row;
  assert.deepEqual(changed.evidence, original.evidence);
  assert.equal(changed.detected_at, original.detected_at);
  assert.equal(after.find(({ id }) => id === second).row.status, 'ACTIVE');
  assert.equal(after.filter(({ row }) => row.code === 'R1_MISSING_FLOW_SIGNAL' && row.status === 'ACTIVE').length, 1);
});

test('repeat resolution preserves original timestamp, resolver and remark', async () => {
  await db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid), ($2::uuid)', [staff, otherStaff]);
  const original = await asRole('authenticated', staff, () => resolve(first, 'First remark'));
  const repeated = await asRole('authenticated', otherStaff, () => resolve(first, 'Replacement remark'));
  assert.deepEqual(repeated, original);
});

test('optional blank remark is stored as null', async () => {
  await db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid)', [staff]);
  const result = await asRole('authenticated', staff, () => resolve(first, '   '));
  assert.equal(result.resolution_remark, null);
});

test('authority is server-managed and revoked or absent membership cannot resolve', async () => {
  const before = await rows();
  await asRole('authenticated', ordinary, async () => {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ user_metadata: { role: 'staff', admin: true } })]);
    assert.equal((await db.query('select public.tapflow_can_resolve_r1() as allowed')).rows[0].allowed, false);
    await reject(() => resolve(first), '42501');
    await reject(() => db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid)', [ordinary]), '42501');
  });
  await db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid)', [staff]);
  await asRole('authenticated', staff, async () => {
    assert.equal((await db.query('select public.tapflow_can_resolve_r1() as allowed')).rows[0].allowed, true);
  });
  await db.query('update tapflow_private.r1_staff set enabled = false where user_id = $1::uuid', [staff]);
  for (const actor of [staff, null]) {
    await asRole('authenticated', actor, async () => {
      assert.equal((await db.query('select public.tapflow_can_resolve_r1() as allowed')).rows[0].allowed, false);
      await reject(() => resolve(first), '42501');
    });
  }
  assert.deepEqual(await rows(), before);
});

test('private membership and action execute privileges exclude anonymous and service roles', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const privileges = (await db.query(`
      select has_schema_privilege($1, 'tapflow_private', 'USAGE') as schema_usage,
        has_table_privilege($1, 'tapflow_private.r1_staff', 'SELECT,INSERT,UPDATE,DELETE') as staff_access,
        has_function_privilege($1, 'public.resolve_tapflow_incident(text,text)', 'EXECUTE') as can_resolve
    `, [role])).rows[0];
    assert.deepEqual(privileges, { schema_usage: role === 'service_role', staff_access: false, can_resolve: role === 'authenticated' });
    if (role !== 'authenticated') await asRole(role, staff, () => reject(() => resolve(first), '42501'));
  }
});

test('invalid IDs, other rules, absent IDs and overlong remarks cannot mutate incidents', async () => {
  const before = await rows();
  await db.query('insert into tapflow_private.r1_staff(user_id) values ($1::uuid)', [staff]);
  await asRole('authenticated', staff, async () => {
    for (const id of [null, '', '0', '-1', '01', '1.2', '1;delete', '9223372036854775808', '999999999999999999999999']) {
      await reject(() => resolve(id), '22023');
    }
    for (const id of ['4', '9223372036854775807']) await reject(() => resolve(id), 'P0002');
    await reject(() => resolve(first, 'x'.repeat(2001)), '22023');
  });
  assert.deepEqual(await rows(), before);
});
