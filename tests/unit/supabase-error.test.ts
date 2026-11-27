import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSupabaseError } from '../../src/lib/supabase-error.ts';

test('preserves useful database error fields without copying response or session objects', () => {
  const source = {
    code: '42501',
    message: 'permission denied for table tapflow_r1_alerts',
    details: 'The authenticated role lacks SELECT.',
    hint: 'Review table privileges and RLS policies.',
    session: { access_token: 'must-never-be-logged' },
    cause: { request: 'must-never-be-logged' },
  };
  assert.deepEqual(describeSupabaseError(source), {
    code: source.code, message: source.message, details: source.details, hint: source.hint,
  });
});

test('handles Error instances, thrown strings, and missing or non-string fields', () => {
  assert.deepEqual(describeSupabaseError(new Error('Failed to fetch')), {
    code: null, message: 'Failed to fetch', details: null, hint: null,
  });
  assert.equal(describeSupabaseError('Connection timed out').message, 'Connection timed out');
  for (const error of [undefined, null, 42, true, { code: 403, message: {}, details: [], hint: false }]) {
    assert.deepEqual(describeSupabaseError(error), { code: null, message: null, details: null, hint: null });
  }
});

test('redacts known secrets in every allowed field without mutating the supplied list', () => {
  const redactions = ['project-key', 'project-key-long', 'https://private.example.test', ''];
  const original = [...redactions];
  const result = describeSupabaseError({
    code: 'project-key', message: 'project-key-long', details: 'https://private.example.test', hint: 'project-key twice project-key',
  }, redactions);
  assert.deepEqual(result, { code: '[redacted]', message: '[redacted]', details: '[redacted]', hint: '[redacted] twice [redacted]' });
  assert.deepEqual(redactions, original);
});

test('redacts JWTs, both Supabase key formats, and bearer values even when no known secrets are supplied', () => {
  const credentials = ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature', 'sb_publishable_synthetic-123', 'sb_secret_synthetic_456'];
  const result = describeSupabaseError({ message: `Rejected ${credentials.join(', ')}. Bearer opaque-credential; connection refused.` });
  assert.equal(result.message, 'Rejected [redacted], [redacted], [redacted]. Bearer [redacted]; connection refused.');
  assert.equal(describeSupabaseError({ message: 'bEaReR "opaque token with spaces"' }).message, 'Bearer [redacted]');
});

test('redacts labeled values including quoted whitespace, escaped quotes, JSON, and bearer authorization', () => {
  const inputs = [
    'access_token=opaque-access refresh_token=opaque-refresh',
    'apikey: opaque-key, api_key=another-key; password=opaque-password',
    'AUTHORIZATION: Bearer opaque-token',
    'password="several secret words, and punctuation"; keep this diagnostic',
    "refresh_token='several secret words'; keep this diagnostic",
    'password=`several secret words`; keep this diagnostic',
    '{"access_token":"secret words", "password":"escaped \\"quote\\" secret", "message":"diagnostic"}',
    'authorization="Bearer secret words"',
  ];
  for (const message of inputs) {
    const sanitized = describeSupabaseError({ message }).message!;
    assert.match(sanitized, /\[redacted\]/);
    assert.doesNotMatch(sanitized, /opaque|another-key|several|secret|quote/);
  }
  assert.equal(describeSupabaseError({ message: 'password="first line\nsecond line"; diagnostic' }).message, 'password=[redacted]; diagnostic');
});
