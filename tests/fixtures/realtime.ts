import type { BrowserContext, WebSocketRoute } from '@playwright/test';

interface ChangeBinding {
  id: number;
  event: string;
  schema: string;
  table: string;
  filter?: string;
}

interface MockChannel {
  socket: WebSocketRoute;
  topic: string;
  joinRef: string | null;
  ref: string | null;
  bindings: ChangeBinding[];
  arrayFrames: boolean;
}

function isAlertsChannel(channel: { bindings: ChangeBinding[] }) {
  return channel.bindings.some(({ table }) => table === 'tapflow_r1_alerts');
}

/** A local Phoenix server; it never forwards sockets or credentials to Supabase. */
export async function mockRealtime(context: BrowserContext, enabled = false) {
  const channels = new Map<string, MockChannel>();
  const pending = new Map<string, MockChannel>();
  const joins: { topic: string; bindings: ChangeBinding[] }[] = [];
  let leaves = 0;
  let acceptJoins = enabled;

  function send(channel: MockChannel, event: string, payload: unknown, ref: string | null = null) {
    channel.socket.send(JSON.stringify(channel.arrayFrames
      ? [channel.joinRef, ref, channel.topic, event, payload]
      : { join_ref: channel.joinRef, ref, topic: channel.topic, event, payload }));
  }

  function acknowledge(channel: MockChannel) {
    pending.delete(channel.topic);
    channels.set(channel.topic, channel);
    send(channel, 'phx_reply', { status: 'ok', response: { postgres_changes: channel.bindings } }, channel.ref);
  }

  await context.routeWebSocket('**/realtime/v1/websocket*', (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      const arrayFrames = Array.isArray(frame);
      const [joinRef, ref, topic, event, payload] = arrayFrames
        ? frame : [frame.join_ref, frame.ref, frame.topic, frame.event, frame.payload];
      if (event === 'phx_join') {
        const bindings = (payload.config.postgres_changes as Omit<ChangeBinding, 'id'>[])
          .map((binding, index) => ({ ...binding, id: index + 1 }));
        // Record only subscription filters; the join payload also contains the session token.
        joins.push({ topic, bindings });
        const channel = { socket, topic, joinRef, ref, bindings, arrayFrames };
        pending.set(topic, channel);
        if (acceptJoins) acknowledge(channel);
      } else if (event === 'phx_leave') {
        leaves++;
        pending.delete(topic);
        channels.delete(topic);
        send({ socket, topic, joinRef, ref, bindings: [], arrayFrames }, 'phx_reply', { status: 'ok', response: {} }, ref);
      } else if (event === 'heartbeat') {
        send({ socket, topic, joinRef, ref, bindings: [], arrayFrames }, 'phx_reply', { status: 'ok', response: {} }, ref);
      }
    });
    socket.onClose(() => {
      for (const [topic, channel] of channels) if (channel.socket === socket) channels.delete(topic);
      for (const [topic, channel] of pending) if (channel.socket === socket) pending.delete(topic);
    });
  });

  return {
    get joins() { return joins.filter((entry) => !isAlertsChannel(entry)); },
    get alertJoins() { return joins.filter(isAlertsChannel); },
    get leaves() { return leaves; },
    get activeCount() { return [...channels.values()].filter((entry) => !isAlertsChannel(entry)).length; },
    get activeAlertCount() { return [...channels.values()].filter(isAlertsChannel).length; },
    set acceptJoins(value: boolean) { acceptJoins = value; },
    resume() {
      acceptJoins = true;
      for (const channel of pending.values()) acknowledge(channel);
    },
    change(table: 'flow_readings' | 'room_status' | 'tapflow_r1_alerts', event: 'INSERT' | 'UPDATE' | 'DELETE', record: Record<string, unknown>) {
      for (const channel of channels.values()) {
        const ids = channel.bindings.filter((binding) => binding.table === table && (binding.event === event || binding.event === '*')).map((binding) => binding.id);
        if (!ids.length) continue;
        send(channel, 'postgres_changes', { ids, data: {
          schema: 'public', table, type: event, commit_timestamp: new Date().toISOString(),
          columns: [], record, old_record: {}, errors: null,
        } });
      }
    },
    channelError(message: string) {
      for (const channel of channels.values()) {
        if (!isAlertsChannel(channel)) send(channel, 'phx_error', message);
      }
    },
    alertSystemStatus(status: 'ok' | 'error', message: string) {
      for (const channel of channels.values()) {
        if (isAlertsChannel(channel)) send(channel, 'system', {
          extension: 'postgres_changes', status, message, channel: channel.topic,
        });
      }
    },
    async disconnect() {
      const sockets = new Set([...channels.values()].map((channel) => channel.socket));
      channels.clear();
      await Promise.all([...sockets].map((socket) => socket.close({ code: 1012, reason: 'Test reconnect' })));
    },
  };
}

export type MockRealtime = Awaited<ReturnType<typeof mockRealtime>>;
