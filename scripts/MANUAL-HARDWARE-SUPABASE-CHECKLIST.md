# Manual hardware and Supabase checklist

Browser tests do not prove Supabase Realtime delivery or ESP32 detection. Run this only in the intended project, with an authorized account. Do not resolve, edit, or delete historical research rows, including alert IDs 1 and 3.

## Before a live test

1. Run the read-only statements in `scripts/r1-alert-sync-review.sql`.
2. Confirm `tapflow_r1_alerts` is in the `supabase_realtime` publication for INSERT, UPDATE, and DELETE.
3. Confirm the signed-in account can SELECT both ACTIVE and RESOLVED rows.
4. Record the active indexes and triggers from `scripts/proposed-independent-incidents.sql`.
5. Choose a room that the account can already read. If every room already has an ACTIVE `R1_MISSING_FLOW_SIGNAL` row, use a staging copy. Do not resolve a real incident to make room.

## Realtime delivery

1. Open the dashboard Alerts page and leave it visible.
2. Insert one approved, tagged test row with the table's own id default. Commit it.
3. Without reloading, confirm that row appears once, the bell count increases by one, and the development log shows an INSERT followed by a refresh.
4. A change that appears only on the 15-second poll proves the fallback, not Realtime.
5. Update only that tagged row to RESOLVED. Without reloading, confirm it remains in history and leaves the bell.
6. Remove only that tagged test row if retention rules allow it.

## Independent rooms

1. Leave one ACTIVE incident for Room 1.
2. Produce the same anomaly condition in Room 2.
3. Confirm Room 2 gets its own incident while Room 1 stays ACTIVE.
4. If the insert fails on a unique index, stop. The index definition from the review decides the approved change. Do not drop an index during the hardware test.

## Staff resolution

Do not use Mark as Resolved until `resolve_tapflow_incident` from `scripts/proposed-resolve-tapflow-incident.sql` has been reviewed and deployed. Until then the Alerts page must say that resolution is not available.

After deployment:

1. Resolve one approved test incident from the dashboard.
2. Confirm the database sets `resolved_at` and `resolved_by`, and that a second click does not resolve it again.
3. Confirm an account without access receives an authorization error and the row stays ACTIVE.
4. Confirm monitoring continues. A new incident for that room and code should appear only after the condition clears and then returns.

## Hardware

1. Confirm each ESP32 report changes the room's last-report time.
2. Confirm a recent zero-pulse sample displays as `0 pulses`, and a gap in the chart is marked missing rather than drawn as zero.
3. Confirm a report older than two minutes is Stale or Unknown, not ON or OFF.
4. Confirm calibrated liters appear only for the Main inlet.
