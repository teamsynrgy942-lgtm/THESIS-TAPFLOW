const DAY_MS = 24 * 60 * 60 * 1000;
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const MAX_RECEIPT_JITTER_MS = 5_000;

export interface MainConsumptionReading {
  id: string | number;
  device_id: string;
  flow_lpm: number | null;
  sample_ms: number | null;
  received_at: string | null;
}

export interface MainConsumptionTotal {
  liters: number | null;
  incomplete: boolean;
}

export function getPhilippineDay(now: number): { start: number; end: number } {
  // Philippine Time is UTC+08:00 year round, independent of the browser's timezone.
  const start = Math.floor((now + PHT_OFFSET_MS) / DAY_MS) * DAY_MS - PHT_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

interface Measurement {
  timestamp: number;
  duration: number;
  liters: number;
}

function receiptTolerance(duration: number): number {
  return Math.min(MAX_RECEIPT_JITTER_MS, duration / 2);
}

export function calculateMainConsumption(readings: readonly MainConsumptionReading[], now: number): MainConsumptionTotal {
  const { start, end } = getPhilippineDay(now);
  const measurements = new Map<string, Measurement>();
  const invalid = new Set<string>();
  let unidentified = false;

  for (const reading of readings) {
    if (reading.device_id !== 'main') continue;
    const timestamp = Date.parse(reading.received_at ?? '');
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp >= end || timestamp > now) continue;

    const { id, flow_lpm: rate, sample_ms: duration } = reading;
    if (!(typeof id === 'string' ? id.trim() : Number.isFinite(id))) {
      unidentified = true;
      continue;
    }
    const key = String(id);
    if (measurements.has(key)) continue;

    if (rate === null || !Number.isFinite(rate) || rate < 0 || duration === null || !Number.isFinite(duration) || duration <= 0) {
      invalid.add(key);
      continue;
    }

    const liters = rate * (duration / MINUTE_MS);
    if (!Number.isFinite(liters)) {
      invalid.add(key);
      continue;
    }

    invalid.delete(key);
    measurements.set(key, { timestamp, duration, liters });
  }

  if (!measurements.size) return { liters: null, incomplete: false };

  const ordered = [...measurements.values()].sort((left, right) => left.timestamp - right.timestamp);
  let liters = 0;
  let incomplete = unidentified || invalid.size > 0;
  let lastReceipt = start;
  for (const measurement of ordered) {
    // The receipt assigns the sample to a day. The interval length indicates
    // whether coverage is missing between that day's measurements.
    const sampleStart = measurement.timestamp - measurement.duration;
    if (sampleStart - lastReceipt > receiptTolerance(measurement.duration)) incomplete = true;
    liters += measurement.liters;
    lastReceipt = measurement.timestamp;
  }

  const { duration } = ordered[ordered.length - 1];
  // Allow one sampling interval before declaring a reporting gap at the tail.
  if (now - lastReceipt > duration + receiptTolerance(duration)) incomplete = true;

  return { liters, incomplete };
}
