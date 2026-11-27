import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { safeMessage } from './telemetry-service';
import { deviceIds, roomIds } from './telemetry-types';
import type { TelemetryRoom } from './telemetry-types';

interface TelemetryListener {
  refresh: () => void;
  room?: TelemetryRoom;
}

const listeners = new Set<TelemetryListener>();
const channelNamespace = Math.random().toString(36).slice(2);
let channel: RealtimeChannel | undefined;
let channelSequence = 0;

function logStatus(status: string, error?: unknown) {
  if (!import.meta.env.DEV) return;
  if (error || ['CHANNEL_ERROR', 'TIMED_OUT', 'REMOVE_ERROR', 'START_ERROR'].includes(status)) {
    // Log sanitized messages only; channel objects and error causes may contain tokens.
    const message = error instanceof Error ? safeMessage(error.message) : 'Realtime unavailable; 20-second polling remains active.';
    console.error(`[TapFlow Realtime] ${status}`, message);
  } else {
    console.debug(`[TapFlow Realtime] ${status}`);
  }
}

function removeChannel(previous: RealtimeChannel) {
  void supabase.removeChannel(previous).then((status) => {
    if (status !== 'ok') {
      logStatus('REMOVE_ERROR', new Error(`Channel removal returned ${status}.`));
      previous.teardown();
    }
  }).catch((error: unknown) => {
    logStatus('REMOVE_ERROR', error);
    previous.teardown();
  });
}

function startChannel() {
  if (channel) return;
  // Avoid collisions with retired channels and previous modules during Vite hot reloads.
  const current = supabase.channel(`tapflow-telemetry-${channelNamespace}-${++channelSequence}`);
  channel = current;
  try {
    current
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'flow_readings' }, (payload) => {
        if (channel !== current || !deviceIds.some((id) => id === payload.new.device_id)) return;
        for (const listener of listeners) {
          if (!listener.room || listener.room.deviceId === payload.new.device_id) listener.refresh();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_status' }, (payload) => {
        refreshRoom(payload.new.room_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_status' }, (payload) => {
        refreshRoom(payload.new.room_id);
      })
      .subscribe((status, error) => {
        logStatus(status, error);
        if (channel !== current || status !== 'SUBSCRIBED') return;
        // Catch changes between the initial read and join, and changes missed on reconnect.
        for (const listener of listeners) listener.refresh();
      });
  } catch (error) {
    logStatus('START_ERROR', error);
    channel = undefined;
    removeChannel(current);
  }

  function refreshRoom(roomId: unknown) {
    if (channel !== current || !roomIds.some((id) => id === roomId)) return;
    for (const listener of listeners) {
      if (!listener.room || listener.room.statusId === roomId) listener.refresh();
    }
  }
}

/** Invalidate authenticated reads; event payloads never replace verified telemetry. */
export function subscribeToTelemetry(refresh: () => void, room?: TelemetryRoom): () => void {
  const listener = { refresh, room };
  listeners.add(listener);
  startChannel();

  return () => {
    listeners.delete(listener);
    // Reuse the channel during StrictMode effect replay, room changes, and chart range changes.
    // Callbacks are detached immediately, even while the server processes the eventual leave.
    queueMicrotask(() => {
      if (listeners.size || !channel) return;
      const previous = channel;
      channel = undefined;
      removeChannel(previous);
    });
  };
}
