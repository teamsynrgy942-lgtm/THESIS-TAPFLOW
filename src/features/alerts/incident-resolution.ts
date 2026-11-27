import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export const RESOLVE_RPC = 'resolve_tapflow_incident';
export type ResolutionCapability = 'unknown' | 'ready' | 'unavailable';

export class IncidentResolutionError extends Error {
  constructor(message: string, readonly unavailable = false) {
    super(message);
  }
}

/** Read-only OpenAPI check. It does not call the resolve function. */
export async function probeResolveIncident(signal: AbortSignal): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const response = await fetch(new URL('/rest/v1/', import.meta.env.VITE_SUPABASE_URL), {
    signal,
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!response.ok) return false;
  const spec = await response.json() as { paths?: Record<string, unknown> };
  return Object.keys(spec.paths ?? {}).some((path) => path.includes(`/${RESOLVE_RPC}`));
}

export function useResolveCapability(): ResolutionCapability {
  const [capability, setCapability] = useState<ResolutionCapability>('unknown');
  useEffect(() => {
    const controller = new AbortController();
    probeResolveIncident(controller.signal).then((ready) => {
      if (!controller.signal.aborted) setCapability(ready ? 'ready' : 'unavailable');
    }).catch(() => {
      if (!controller.signal.aborted) setCapability('unavailable');
    });
    return () => controller.abort();
  }, []);
  return capability;
}

/** Sends only the incident id and optional remarks. Identity and time come from the database function. */
export async function resolveTapflowIncident(alertId: string, remarks: string, signal?: AbortSignal): Promise<void> {
  const trimmed = remarks.trim();
  if (trimmed.length > 500) throw new IncidentResolutionError('Remarks must be 500 characters or fewer.');
  const { error } = await supabase.rpc(RESOLVE_RPC, {
    p_alert_id: alertId,
    p_remarks: trimmed || null,
  }).abortSignal(signal ?? AbortSignal.timeout(15_000));
  if (!error) return;
  const code = 'code' in error && error.code ? String(error.code) : '';
  if (code === 'PGRST202') throw new IncidentResolutionError('Staff resolution is not deployed on this project.', true);
  if (code === '42501' || code === 'PGRST301' || /permission|not authorized|authentication/i.test(error.message)) {
    throw new IncidentResolutionError('This account is not authorized to resolve the incident.');
  }
  throw new IncidentResolutionError('The incident could not be resolved. It may already be resolved or no longer active.');
}
