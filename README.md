# TapFlow

TapFlow uses React, TypeScript, Vite, and Recharts. Supabase email/password authentication protects the dashboard. Overview and Room Details read reported telemetry through the authenticated client. The Alerts screen presents the alert log and its empty state.

## Run locally

Node.js 22.22 or newer and npm are required. Dependencies are already installed in this workspace.

```powershell
cd "C:\Users\connie_france\Downloads\THESIS TAPFLOW"
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Keep the terminal running; press Ctrl+C to stop. On a fresh checkout, run `npm.cmd install` first. `npm.cmd` works in Windows PowerShell even when the execution policy blocks `npm.ps1`; other shells can use `npm`.

If startup reports `Error: Port 5173 is already in use`, check the URL above. If TapFlow is already running there, use that instance. To restart it, press Ctrl+C in its existing terminal, then run `npm.cmd run dev` once. The fixed port keeps browser sessions and development tests on the same origin. The Vite stack trace points to the port conflict; no edit to `node_modules` is needed.

## Routes

| URL | Screen |
| --- | --- |
| `/` | Welcome Screen with administrator-account login |
| `/welcome` | Redirects to `/` |
| `/overview` | Overview dashboard matching Figma node `30:2` |
| `/rooms` | Room Details, initially showing Room 1 |
| `/rooms/room-1`, `/rooms/room-2`, `/rooms/room-3` | Details for the selected room |
| `/alerts` | Anomaly alert history |
| Any other path | Page not found with a link home |

“Open Dashboard” is available on Welcome when signed in. Overview, Room Details, and Alerts require a session. Signed-out visitors return to Welcome; signing in opens the originally requested dashboard page, or `/overview` by default. Direct navigation, refresh, and browser history work with Vite. Future static hosting must rewrite application paths to `index.html`.

## Overview telemetry

Overview shows reporting, flow activity, RFID, valve and light commands, and a link to each room. The authenticated telemetry service verifies the current user before every refresh and reads `flow_readings` for the four devices and `room_status` for the three rooms.

The screen refreshes immediately on entry, on relevant Supabase Realtime events, and every **20 seconds** as a temporary polling fallback while mounted. Refreshes do not overlap; events received during a read queue one follow-up refresh. Leaving Overview or signing out removes its Realtime listener, stops polling, and aborts pending telemetry reads. Responses from a previous mount cannot update the screen.

`src/features/telemetry/telemetry-realtime.ts` shares one channel across mounted telemetry listeners. It subscribes to **INSERT** on `public.flow_readings` and **INSERT/UPDATE** on `public.room_status`, already included in the `supabase_realtime` publication. Overview refreshes for the four known devices and three known room IDs; Room Details refreshes only for its selected device/status. Events invalidate the existing authenticated read paths rather than supplying display values directly. Successful joins and reconnects refresh the current screen to cover missed events. Development console messages prefixed `[TapFlow Realtime]` report subscription status and sanitized errors; polling continues if Realtime is unavailable. The final listener's cleanup removes the channel, with effect replay and selection/range changes reusing it to avoid duplicate subscriptions. Authentication, RLS, firmware, schema, and calibration remain unchanged.

- Main reporting freshness uses `flow_readings.received_at`.
- Room reporting freshness uses `room_status.last_seen_at` when present, falling back to the flow receipt only when the heartbeat is missing. `updated_at` is never treated as a device heartbeat.
- RFID, valve, and light commands need a valid room heartbeat at most **2 minutes** old. A stale, missing, invalid, or future heartbeat makes the commands **Unknown**. Flow activity follows the latest flow sample independently. A recent positive pulse count means **Flow Detected**, a recent measured zero means **No Flow**, and missing, invalid, or old pulse counts mean **Unknown**.
- Reporting badges reflect device timestamps. **Recent report** means a valid receipt within two minutes. **Room status stale** identifies an expired heartbeat alongside recent flow readings. **No recent data** covers older or missing reports, and **Time unknown** covers invalid or future timestamps. Realtime connection status is a separate development console diagnostic.
- The Main inlet displays a recent valid `flow_lpm` value when available. **Water Used Today** reads all available Main samples received since the current Philippine midnight, using pagination and a fixed cutoff per refresh. It sums `flow_lpm × sample_ms / 60,000` once per usable reading ID. The total uses recorded rates and durations, including valid zero rates. Each sample belongs to its receipt date in PHT.
- The total displays **Incomplete total** when usable readings leave reporting gaps, some samples are invalid, or pagination stops on a read error. **Unavailable** means there are no usable readings to display for the current day. Realtime events, polling, and Philippine midnight trigger refreshes.
- The overview reports refresh failures with one short message. Transient failures retain the most recent readings subject to freshness checks. Auth or permission failures and successful empty responses clear the affected values.

Overview reads do not activate monitoring, classify anomalies, or create Alerts records. There are no database writes, schema/RLS/authentication-setting changes, Edge Function changes, or firmware changes.

## Login and logout

The existing `.env.local` supplies `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep it private and use only a publishable key (or legacy anon key) in the frontend. Accounts are created or invited by the project administrator; there is no public sign-up form.

1. Run `npm.cmd run dev` and open **http://127.0.0.1:5173**.
2. Enter the email and password of an existing Supabase Authentication user, then select **Sign In**.
3. Navigate between Overview, Room Details, and Alerts. Refresh a dashboard URL to verify session restoration.
4. Select **Logout** beneath the dashboard navigation links. You should return to Welcome. Refresh or open `/overview` directly to verify that login is required again.
5. While signed out, open `/rooms/room-2`, sign in, and verify that Room 2 opens. An incorrect password should show an error without opening the dashboard.

Supabase manages session persistence and token refresh. The auth provider subscribes to session changes, including logout in another tab. Logout uses the current session scope. Route guards control navigation; the existing database permissions and UID-restricted RLS policies remain responsible for authorizing data access.

The browser tests intercept Supabase Auth requests and use generated test credentials and sessions. They do not sign in to a real account or change the database. Run the steps above to verify your actual administrator-created account locally. API reference: [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

## Authenticated telemetry diagnostic (development only)

With `npm.cmd run dev` running, sign in and open **http://127.0.0.1:5173/dev/telemetry**. A direct visit while signed out returns to Welcome and then returns to the diagnostic after login. The route and diagnostic code are excluded from production builds; `npm.cmd run preview` shows Page not found at that path.

Each run calls `supabase.auth.getUser()` before any telemetry reads. It uses the existing browser session and shared client, with no anonymous fallback or separate credentials. Four independent SELECT queries read the latest five `flow_readings` for `main`, `room1`, `room2`, and `room3`, ordered by `received_at` descending. The selected columns are `id`, `device_id`, `pulses`, `sample_ms`, `flow_lpm`, and `received_at`.

A fifth SELECT reads `room_status` for room IDs 1–3, bounded to three rows. It selects the visible row fields to discover available timestamps without assuming a particular schema. The service returns only `room_id`, `rfid_active`, `valve_commanded_on`, `bulb_commanded_on`, and timestamp fields (names ending in `_at`, `_timestamp`, or `_time`, plus `last_seen`, `last_updated`, and `last_update`). Timestamp values retain ISO-style date strings or `null`; other fields are discarded. **Refresh readings** reruns verification and reads. The optional **Observe reporting timestamps every 20 seconds** checkbox repeats these read-only queries while the diagnostic is open. No writes, measurements, or subscriptions are created.

To verify actual heartbeat advancement, sign in to `/dev/telemetry` in development mode and enable that checkbox while the ESP32 sends its normal status reports. **Reporting timestamp checks** compares each room's previous and current `room_status.last_seen_at` separately from its latest flow receipt. Only an observed later heartbeat is labeled **Timestamp advanced between reads**; repeated values, backwards/future timestamps, empty results, and errors are distinguished. Main compares successive `flow_readings.received_at` values. Flow timestamps advancing while the room heartbeat remains unchanged verifies only the flow upload path. This observer does not certify physical connectivity or alter the status producer.

The automated tests simulate heartbeat advancement, interrupted reports, flow-only uploads, and resumption. They do not establish that live ESP32 status updates actually write `last_seen_at`; that requires observing an authenticated hardware session. If normal status reports leave the heartbeat unchanged, this read-only frontend keeps commands Unknown after two minutes and cannot repair the firmware or backend updater under the current restrictions.

The page reports each device and room independently:

- **Success with records:** displays the actual returned values, preserving `null`, `false`, and numeric zero. A `null` flow rate is not calibrated or replaced with zero.
- **Success with zero visible rows:** no matching rows were returned. Records may be absent or filtered by RLS; the response alone cannot distinguish those cases. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- **Permission denied:** shows the database code and a credential-redacted message, including error `42501`.
- **Missing/expired session:** verification failed, so no telemetry queries run. Sign out and sign in again.
- **Network/configuration/database error:** shows the category and available error code/message, independently of successful queries.

Tests use mocked responses; their successful results do not establish access to the live database. Use the signed-in page to verify real records and share only each device/room's count or displayed error, never passwords or tokens.

```powershell
npm.cmd run typecheck
npm.cmd run test:telemetry
npm.cmd run test:e2e
```

## Project structure

```text
src/
  app/                 Application routes and page titles
  assets/figma/        Original downloaded Figma images and SVGs
  components/          Shared Welcome assets, dashboard components, and Room Details panels
  features/dashboard/  Room metadata and shared alert records
  features/auth/       Session provider, protected routes, auth errors, and logout
  features/overview/   Latest telemetry state, reporting freshness, and refresh lifecycle
  features/telemetry/  Authenticated read-only service and shared Realtime subscriptions
  features/rooms/      Selected-room telemetry, pulse history, polling, and alert selection
  features/alerts/     Alert record contract, formatting, and active projections
  pages/               Welcome, Overview, room details, alerts, and not-found screens
  lib/                 Reusable Supabase client
  styles/              Shared design tokens and global styles
tests/                 Browser smoke tests
```

Inter is bundled locally through `@fontsource-variable/inter`. Assets and fonts require no Figma or external font connection at runtime.

## Check and build

```powershell
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run build
npm.cmd run preview
```

The production build is written to `dist/`. Preview serves it at **http://127.0.0.1:4173**.

```powershell
npm.cmd run test:e2e
```

Browser tests build the app and use Microsoft Edge in headless mode. They cover authentication, authenticated telemetry queries, reporting freshness, chart ranges and gaps, Realtime refresh and recovery, old demo links, responsive layouts, and empty states. The tests intercept Auth, telemetry, and Realtime traffic. Desktop and mobile screenshots are saved in `test-results/`. Unit tests cover the telemetry state, flow activity, heartbeat precedence, chart data, alert records, and Philippine Time formatting.

## Room Details

Open `/rooms/room-1`, `/rooms/room-2`, or `/rooms/room-3`. The selector updates the URL and selected room's identity and measurements; `/rooms` initially selects Room 1. Invalid room URLs show a recovery message with working room links.

Room Details keeps the TapFlow sidebar, logo, and blue panels. Four cards show water flow activity, RFID session, valve command, and light command. The water flow chart and its expandable sample history provide the measurement details. Related alerts shows active records for the selected room.

The header shows the last telemetry check. `RoomTelemetryProvider` uses the authenticated telemetry service and `src/lib/supabase.ts`. Each refresh verifies the current user before making independent read-only queries:

- The selected device's latest **60** `flow_readings`, ordered by `received_at` descending with null timestamps last. The latest pulse count determines current flow activity when recent. Sample history displays the recorded raw pulses, interval, and timestamp.
- The selected `room_status` snapshot, filtered by room ID and ordered by `last_seen_at` descending, limited to one row. `rfid_active`, `valve_commanded_on`, and `bulb_commanded_on` retain actual `true`, `false`, and `null` values. Missing/null states show **Unknown** after loading.
- Chart readings filtered by the selected time window, ordered by `received_at` and then `id` ascending. Pages request up to 1,000 records; the first page's exact count ensures that all matching rows are fetched even when the API applies a smaller row cap. A failed page produces an error instead of a silently incomplete chart.

The Recharts Water flow chart defaults to **Last 30 minutes**. The Time range selector offers **5 minutes**, **30 minutes**, **1 hour**, and **24 hours**, with each window ending at the current check time. The X-axis uses `received_at` timestamps in Philippine Time (`Asia/Manila`), including the date on the 24-hour view. The Y-axis shows **Pulses per sample**.

Only actual **15,000 ms** samples with valid timestamps and pulse counts are plotted; other intervals are explicitly noted and never rescaled. Zero pulses remain valid measurements. Points are chronological and spaced by timestamp. Consecutive samples are connected only when their timestamps advance by **45 seconds or less**. Gaps over 45 seconds start a new segment; isolated or equal-timestamp records remain disconnected points. No missing samples or zeros are inserted across a gap. Empty periods display **No measurements during this period**.

Hover, tap, or keyboard-focus a point to see its full PHT timestamp, raw pulse count, and measurement interval in milliseconds. Left/Right, Home/End, and Escape support keyboard inspection. **Recorded samples** shows up to 60 historical records independently of chart range.

Reads run immediately, on relevant Realtime events, and every **20 seconds** as a polling fallback, without overlapping requests. Selected-room flow inserts refresh the latest samples, history, and selected chart window; selected-room status inserts/updates refresh reported commands and heartbeat data. Selecting another room resets its display and aborts earlier requests, preventing a late response from showing the previous room's data. Leaving Room Details, signing out, or changing the authenticated user removes its subscription listener and tears down its polling state. Invalid room URLs do not fetch telemetry or subscribe.

Changing the chart range cancels the previous request and refreshes the selected window immediately. Transient chart-query failures preserve labeled last-known samples for the same range.

The four cards use the same freshness rules as Overview. Valve and light values describe controller commands. The chart and sample history retain actual older samples for inspection, including when current flow activity is **Unknown**.

Room Details implementation files:

| Files | Change |
| --- | --- |
| `src/features/telemetry/telemetry-service.ts` | Reuses shared authentication, error handling, and reads for a selected room's bounded history/status. |
| `src/features/telemetry/telemetry-types.ts` | Adds shared room identities and the selected-room report type. |
| `src/features/overview/overview-telemetry.ts` | Shares room identities, two-minute reporting windows, current-state gating, and last-known-record handling across both screens. |
| `src/features/telemetry/heartbeat-observation.ts` | Compares actual reporting timestamps independently for Main and each room. |
| `src/features/rooms/RoomTelemetryProvider.tsx` | Adds polling, selection reset, request cancellation, and context. |
| `src/features/rooms/room-telemetry.ts` | Adds history/cache state and valid timestamp-ordered pulse samples. |
| `src/app/App.tsx` | Wraps only Room Details routes in the selected-room provider. |
| `src/components/dashboard/DashboardLayout.tsx` | Selects the telemetry header for Room Details while retaining the Alerts header. |
| `src/components/room-details/RoomDetailsChrome.tsx`, `RoomDetailsChrome.css` | Displays the last telemetry check in the dashboard header. |
| `src/components/room-details/RoomMetricCards.tsx` | Displays flow activity and the three reported commands. |
| `src/components/room-details/RoomSelector.tsx` | Links to the selected room's telemetry. |
| `src/components/room-details/RoomHistoryPanels.tsx` | Displays the pulse chart, raw sample history, and related alerts. |
| `src/components/room-details/RoomPulseChart.tsx` | Adds range controls, session segments, PHT axes, and responsive pointer/touch/keyboard tooltips. |
| `src/pages/rooms/RoomDetailsPage.tsx`, `RoomDetailsPage.css` | Connects telemetry to the existing page and retains responsive card/panel styling. |
| `tests/fixtures/auth.ts` | Honors the selected-room filter in intercepted read responses. |
| `tests/room-details.spec.ts` | Verifies real-data rendering, unchanged shell geometry/assets, selection, and mobile layouts. |
| `tests/room-telemetry.spec.ts` | Covers authenticated bounded reads, pulse history, missing data, freshness, polling/errors/recovery, and cancellation. |
| `tests/room-pulse-chart.spec.ts` | Covers range boundaries, multi-day sessions, API pagination, interval handling, tooltips, range cancellation, and refresh. |
| `tests/device-reporting.spec.ts` | Covers stale commands, independent flow freshness, missing heartbeats, interrupted uploads, and resumed reporting on both screens. |
| `tests/unit/room-details-model.test.ts` | Covers latest/raw sample state, filtering, ordering, null/zero values, and cache handling. |
| `README.md` | Documents routes, behavior, limitations, and changed files. |

## R1 alerts

The Alerts log verifies the current shared Supabase session with Auth before reading `public.tapflow_r1_alerts`. It shows **Possible Flow Sensor Failure**, the exact `R1_MISSING_FLOW_SIGNAL` code, room, recorded evidence, and detection and resolution times in Philippine Time. Active alerts appear first and resolved alerts remain in the log. The history query has no status, code, date, room, or user filter, so another anomaly code stored in the same table remains visible. **No alert records yet** means the verified account received an empty result, which does not prove the table is empty.

`src/features/alerts/r1-alert-model.ts` maps backend rows to the existing `AlertRecord` view model. The R1 table does not supply a severity. The evidence detail shows recognized fields from the stored JSON, including counts, the Main threshold, sample timestamps, and the recorded note.

One R1 channel serves the signed-in dashboard. INSERT, UPDATE, and DELETE events trigger a fresh authenticated read. New active IDs produce a dismissible notification, and the initial history loads quietly. The app handles both channel status and Postgres subscription messages. Every successful subscription confirmation triggers a catch-up read, including a Postgres resubscription on an open socket without an intervening error. Reads also run every **15 seconds even when Realtime reports live**, on focus/visibility or network return, on dashboard navigation, and on successful rejoin. This reconciles events missed by an open socket and rechecks previously empty results. Reads remain serialized, discard snapshots invalidated by newer events, and stop on unmount/sign-out. Development-only diagnostics report subscription status/errors, event types, and refresh reasons without logging row payloads or credentials.

For hardware-free verification, use the [read-only synchronization SQL review](scripts/r1-alert-sync-review.sql) and the [controlled test-row and cleanup procedure](scripts/R1-ALERT-SYNC-VERIFICATION.md). These separate actual Supabase event delivery from polling recovery and protect historical IDs 1 and 3. Auth verification has a **15-second deadline**, and waiting ends immediately on unmount/sign-out. A timeout is a retryable read error that retains the last-known alerts and releases the refresh queue. Auth APIs do not accept this feed's AbortSignal, so their underlying requests may finish later; late results cannot resume the canceled alert read. Database SELECTs receive an AbortSignal and their own 15-second deadline.

Auth and SELECT failures show a useful message with the actual HTTP status/error code. The browser Console logs only the project hostname, verified Auth UID/role when available, and sanitized `code`, `message`, `details`, and `hint`; it never logs full Auth/session/response objects. Realtime failures receive the same error sanitization. Successful empty reads log a separate visibility warning rather than inventing a database error.

**Supabase review.** The local configuration points to `idaagpjpyrmgaqxsyixo.supabase.co`, confirmed as the project containing the incident's rows. A successful empty alert read means the session sees zero rows, which can happen when RLS filters out a record that appears in the SQL Editor. [scripts/r1-alerts-review.sql](./scripts/r1-alerts-review.sql) checks schema/table privileges, all row policies, publication membership, and existing IDs **1 and 3** with both statuses eligible. Its read-only authenticated check uses the dashboard user's verified Auth UUID and rolls back. The SQL Editor's privileged results alone do not establish browser access.

The exact conditional configuration SQL is provided separately in that file's final comment block and is **not executed by the application or a migration**. Only apply a missing schema USAGE/table SELECT grant after inspection. If rows are hidden by RLS, the proposed SELECT policy limits access to the approved Auth UUID, Room 1, and the R1 code, with both statuses eligible. A restrictive policy can still deny access and must be reviewed in the project's intended access model. RLS stays enabled; no public or unrestricted SELECT policy is proposed. Realtime requires table membership in `supabase_realtime`, INSERT and UPDATE publishing, and SELECT access to the rows under RLS. Publication changes cannot repair a zero-row history SELECT. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

In the Console of the existing signed-in development tab at `http://127.0.0.1:5173/alerts`, wait for loading to finish and run:

```js
await (await import('/scripts/check-r1-session.mjs')).checkR1Session()
```

The diagnostic uses the same client and session as the dashboard. It returns the project hostname, verified Auth UID, effective JWT role, Auth user role, token issuer hostname/expiry, actual HTTP status and sanitized error fields, and visible counts. Token claims are verified with `getClaims()` and their subject must match the session and server-verified `getUser()` result; the token itself is never returned. It also queries real IDs **1 and 3** without a status filter and checks whether each row parses and is rendered in the Alerts table. It never supplies alert data and does not return any password, token, API key, full session, or evidence JSON. The Auth UUID is an identifier, not a credential. `expectedRecords.allVisibleAndRendered` must be `true` to establish that both records are visible on screen. `visibleToSession: false` with HTTP 200 in the confirmed project requires comparing the SQL owner's result with the same user's RLS check. Failed Auth, failed SELECT, rejected parsing, and visible-but-unrendered records remain distinguishable.

To observe real Realtime delivery during an approved backend event, run `await (await import('/scripts/check-r1-session.mjs')).watchR1Realtime(30000)`. This temporary observer removes its subscription afterward and never inserts, updates, or deletes data. A joined channel without observed backend events does not establish delivery or publication membership.

**Hardware verification.** Sign in with the approved dashboard account and confirm both ID 3 (**Active**, November 23, 2026 at 6:16:26 PM PHT) and ID 1 (**Resolved**, November 23, 2026 at 4:42:12 PM PHT), using the diagnostic's timestamps/IDs as well as the table. During an approved hardware test, keep a dashboard screen open and confirm a new backend R1 event appears with an in-app notification. After the backend records resolution, confirm the same ID changes to **Resolved** and remains visible in Alerts. The browser regression tests use intercepted Supabase responses and WebSockets; they do not prove live access to IDs 1 and 3. No detection trigger, firmware, stored anomaly record, or database policy is changed by this frontend work.

## Design reference

Sources: [WELCOME SCREEN, node 36:124](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-124), [OVERVIEW, node 30:2](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=30-2), [ROOM DETAILS, node 36:289](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-289), and [ALERTS, node 36:529](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-529). See [DESIGN.md](./DESIGN.md) for asset provenance and styling measurements.

The original Figma document, Welcome branding, and dashboard screens are preserved. Authentication adds a form to Welcome and a discreet Logout option to the dashboard navigation. It uses the existing Supabase configuration without changing database tables, RLS policies, Edge Functions, or firmware.

Framework references: [Vite](https://vite.dev/guide/) and [React Router](https://reactrouter.com/start/declarative/installation).
