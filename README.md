# TapFlow

React, TypeScript, Vite, and plain CSS implementation of all four TapFlow screens: Welcome, Overview, Room Details, and Alerts. Development is local; no backend, Supabase, anomaly detection engine, or hardware connection is configured.

## Run locally

Node.js 22.22 or newer and npm are required. Dependencies are already installed in this workspace.

```powershell
cd "C:\Users\connie_france\Downloads\THESIS TAPFLOW"
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Keep the terminal running; press Ctrl+C to stop. On a fresh checkout, run `npm.cmd install` first. `npm.cmd` works in Windows PowerShell even when the execution policy blocks `npm.ps1`; other shells can use `npm`.

## Routes

| URL | Screen |
| --- | --- |
| `/` | Welcome Screen |
| `/welcome` | Redirects to `/` |
| `/overview` | Overview dashboard matching Figma node `30:2` |
| `/rooms` | Room Details, initially showing Room 1 |
| `/rooms/room-1`, `/rooms/room-2`, `/rooms/room-3` | Details for the selected room |
| `/alerts` | Alerts summary and history; no records and monitoring inactive by default |
| Any other path | Page not found with a link home |

“Open Dashboard” navigates to `/overview` using React Router. Direct navigation, refresh, and browser history work with Vite. Future static hosting must rewrite application paths to `index.html`.

## Project structure

```text
src/
  app/                 Application routes and page titles
  assets/figma/        Original downloaded Figma images and SVGs
  components/          Shared Welcome assets, dashboard components, and Room Details panels
  features/dashboard/  Typed demo data, reducer, provider, and update hooks
  features/rooms/      Room history types, empty demo records, and alert selection
  features/alerts/     Frontend alert record contract, counts, formatting, and active projections
  pages/               Welcome, Overview, room details, alerts, and not-found screens
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

Browser tests build the app and use installed Microsoft Edge in headless mode. They cover the 1440 × 900 Overview, Room Details, and Alerts layouts, all three room routes, sidebar navigation, original assets, empty states, inactive monitoring, responsive table scrolling, runtime errors, keyboard use, refresh, browser history, and unknown routes. Desktop/mobile screenshots are saved in the ignored `test-results/` folder. If Edge is unavailable, install it or configure the browser channel in `playwright.config.ts`. Unit tests exercise partial telemetry updates, room-specific alerts, historical data, record counts, monitoring status, optional measurements, and PHT dates/times.

## Room Details

Open `/rooms/room-1`, `/rooms/room-2`, or `/rooms/room-3`. The selector updates the URL and selected room's identity and measurements; `/rooms` initially selects Room 1. Invalid room URLs show a recovery message with working room links.

The page follows Figma frame `36:289`: five metric cards plus **Water flow**, **Water usage history**, **Recent activity**, and **Related alerts**. Original SVG icons and the logo are bundled locally. Its 232 px sidebar, header, and styles are applied through a Room Details variant of the dashboard shell; the existing Overview keeps its own measurements and styling.

The header visibly labels values **Demo data** and states **No live data**. Connectivity is **unknown**. The metrics reuse the shared room state; they do not represent measured historical records. Each room starts with empty flow readings, usage history, and activity. The chart displays the original empty state instead of inventing a zero-flow series. Related Alerts includes only alerts explicitly assigned to the selected room.

History types and initial records are in `src/features/rooms/room-details-model.ts`. Reusable panels accept readings, daily totals, and activities as props. No historical records are generated automatically from the current demo values.

## Alerts and future record integration

Open **http://127.0.0.1:5173/alerts** after starting the development server. The page follows Figma frame `36:529`, using the existing 232 px sidebar and shared header. It includes Active and Resolved count cards, an alert log, the original severity key, and a status indicator.

The initial state is **Demo data**, **No live data**, **Monitoring not yet active**, and **No alert records yet**. Both counts are zero because there are zero recorded events. These counts do not certify the absence of hardware anomalies. The Figma empty state's simulated health claim has deliberately been replaced with accurate inactive-monitoring text.

`AlertRecord` in `src/features/alerts/alert-model.ts` is a frontend contract, not a Supabase table definition:

| Field | Meaning |
| --- | --- |
| `id` | Opaque alert identifier |
| `target` | `{ kind: 'room', roomId }` or `{ kind: 'main-inlet' }` |
| `deviceId` | Optional opaque device identifier |
| `detectionRule` | Display name or identifier supplied by the detection source |
| `severity` | `info`, `warning`, `critical`, or `emergency` |
| `timestamp` | Event timestamp; displayed in PHT |
| `status` | `active` or `resolved`, supplied by the event source |
| `message` | Optional event description |
| `measuredValue`, `threshold`, `unit` | Optional values for display; no comparisons or detection logic run in the UI |

A future adapter must inspect the actual database schema and map it to this contract. Inside `DashboardProvider`, use `useDashboardActions().replaceAlertRecords(mappedRecords)`. This replaces the shared history and projects **only active records** into the existing Overview and room-related alert summaries. Resolved records remain visible in history without inflating active counts. The earlier `replaceAlerts()` action remains available for legacy active-summary data and does not create historical events.

Monitoring state is separate: replacing records, including receiving an empty list, never activates it. A future integration should call `setMonitoringStatus('active')` only after the actual detection subsystem is confirmed operational. There is no user-facing monitoring toggle, anomaly simulator, manual resolution feature, database client, or subscription installed.

History is newest first, retains all four severity levels, and shows optional zero measurements correctly. Synthetic alert records exist only in automated test fixtures; the application does not seed or generate anomaly events.

## Demo values and future updates

The three room cards start with **Idle, RFID Inactive, Valve Closed, Light Off, 0.00 L/min**, and **0 L** used today. Main Water Inlet starts with no flow and zero volume. The initial **10:30 AM PHT** timestamp matches the Figma demo; subsequent state updates use their actual update time.

`createDemoDashboard()` in `src/features/dashboard/dashboard-model.ts` owns the initial values. `DashboardProvider` keeps one shared state above the routes, so navigation does not reset it. All room variants render through the same `RoomCard` component.

A future data adapter inside the provider can use `useDashboardActions()`:

```tsx
const { updateRoom, updateInlet, replaceAlertRecords } = useDashboardActions();
updateRoom('room-1', { status: 'active', rfidSession: 'active', currentFlow: 2.75 });
updateInlet({ currentFlow: 2.75, totalVolumeToday: 12.5 });
replaceAlertRecords([]);
```

Partial updates retain the other readings and device fields. The Overview, selected room, inlet values, alert list, badges, and timestamp render from this shared state. Updates only affect local display data; no device commands, network adapters, timers, or simulations are installed. State returns to the initial demo when the page is refreshed.

## Design reference

Sources: [WELCOME SCREEN, node 36:124](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-124), [OVERVIEW, node 30:2](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=30-2), [ROOM DETAILS, node 36:289](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-289), and [ALERTS, node 36:529](https://www.figma.com/design/dM7D6VZnEhc1Ir2s4T1DEM/THESIS-DASHBOARD?node-id=36-529). See [DESIGN.md](./DESIGN.md) for asset provenance and styling measurements.

The Welcome, Overview, and Room Details designs and original Figma document are preserved. No environment variables, credentials, database tables, database clients, detection algorithms, or firmware changes are required for this frontend.

Framework references: [Vite](https://vite.dev/guide/) and [React Router](https://reactrouter.com/start/declarative/installation).
