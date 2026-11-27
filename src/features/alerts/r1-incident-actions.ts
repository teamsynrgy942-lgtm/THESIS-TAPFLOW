import { supabase } from '../../lib/supabase';
import { describeSupabaseError } from '../../lib/supabase-error';
import type { AlertRecord } from './alert-model';
import { parseR1Alert, parseR1AlertId } from './r1-alert-model';

/** UI capability only. The resolve RPC independently checks current staff membership. */
export async function canResolveR1(signal: AbortSignal): Promise<boolean> {
  try {
    const { data, error } = await supabase.schema('public').rpc('tapflow_can_resolve_r1')
      .retry(false).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    return !signal.aborted && !error && data === true;
  } catch {
    return false;
  }
}

export async function resolveR1Incident(id: string, remark: string | null, signal: AbortSignal): Promise<AlertRecord> {
  if (!parseR1AlertId(id)) throw new Error('The incident ID is invalid.');
  const trimmedRemark = remark?.trim() || null;
  if (trimmedRemark && trimmedRemark.length > 2000) throw new Error('The remark must be 2,000 characters or fewer.');
  const { data, error } = await supabase.schema('public').rpc('resolve_tapflow_incident', {
    p_incident_id: id,
    p_remark: trimmedRemark,
  }).retry(false).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  signal.throwIfAborted();
  if (error) {
    const { message } = describeSupabaseError(error, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]);
    throw new Error(message ? `Could not resolve this incident: ${message}` : 'Could not resolve this incident. Please try again.');
  }
  const record = parseR1Alert(data);
  if (!record || record.id !== id || record.status !== 'resolved' || !record.resolvedAt || !record.resolvedBy) {
    throw new Error('Supabase did not confirm a recorded resolution. Refresh the alert log and try again.');
  }
  return record;
}
