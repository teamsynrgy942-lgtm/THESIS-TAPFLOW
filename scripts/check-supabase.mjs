import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const env = loadEnv('development', projectRoot, [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
]);
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

function redact(value) {
  let message = String(value);
  for (const secret of [supabaseUrl, supabasePublishableKey]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message;
}

async function checkConnection() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  // Accept public keys only; never send a secret key or an upload token.
  let isPublicKey = supabasePublishableKey.startsWith('sb_publishable_');
  if (!isPublicKey) {
    try {
      const payload = JSON.parse(
        Buffer.from(supabasePublishableKey.split('.')[1], 'base64url').toString(),
      );
      isPublicKey = payload.role === 'anon';
    } catch {
      isPublicKey = false;
    }
  }
  if (!isPublicKey) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key.',
    );
  }

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase
    .schema('public')
    .from('flow_readings')
    .select('id, device_id, pulses, sample_ms, flow_lpm, received_at')
    .eq('device_id', 'main')
    .order('received_at', { ascending: false })
    .limit(5)
    .abortSignal(AbortSignal.timeout(20_000));

  if (error) throw error;

  console.log(`Query succeeded. Visible Main ESP32 readings: ${data.length}.`);
  if (data.length === 0) {
    console.log(
      'No rows are visible. There may be no matching readings, or database permissions / RLS SELECT policies may be restricting access.',
    );
  } else {
    console.log(redact(JSON.stringify(data, null, 2)));
  }
}

checkConnection().catch((error) => {
  console.error('Supabase connectivity test failed.');
  console.error(`Code: ${redact(error.code || 'UNKNOWN_ERROR')}`);
  console.error(`Message: ${redact(error.message || 'Unknown error')}`);
  process.exitCode = 1;
});
