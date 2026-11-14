# Welcome Screen reference

Source: **THESIS DASHBOARD → Page 1 → WELCOME SCREEN**, node `36:124`, inspected through Figma MCP. All Figma access was read-only. The 1440 × 900 screenshot is the visual reference; it is not used as an implementation asset.

## Original assets

| Local asset | Figma layer | Source dimensions / purpose |
| --- | --- | --- |
| `src/assets/figma/water-background.png` | `36:126`, image | 1672 × 941; original water photograph |
| `src/assets/figma/tapflow-logo.png` | `36:133`, TapFlow | 224 × 224; original logo image fill |
| `src/assets/figma/grid-mask.svg` | `36:129`, Mask | 810 × 567; original radial mask for the subtle decoration |
| `src/assets/figma/arrow-right.svg` | `36:144`, SVG | 16 × 16; original button icon |

These assets were downloaded directly from the design-context asset URLs. Temporary Figma URLs are not used at runtime. SVG contents and intrinsic dimensions are preserved.

## Desktop measurements

- Frame: 1440 × 900 px; background `#041A30`.
- Content: 840 px wide, starts at x=300, y=178.77; vertical gap 17 px.
- Logo: 116 × 116 px, border `#91D5EA`, 7 px cyan halo, dark soft shadow. The original image is inset 2.59% and occupies 94.83% of its circular container.
- Copy group: 12.195 px top padding, 124 px title slot, 11 px gap, 38 px subtitle slot.
- Title: Inter variable, weight 740, 55 px, line height 59.4 px, letter spacing −2.31 px, `#F3FBFF`, dark text shadow.
- Subtitle: Inter variable, weight 620, 30 px, line height 37.2 px, letter spacing −0.72 px, white, dark text shadow.
- Button: x=631, y=522.965, 178 × 46 px, 8 px radius, 1 px `#A2EBFC` border, `#82DFF0` fill, `#082B42` text/icon. Label is Inter 14 px at weight 740, line height 21 px; icon gap 10 px.
- Background: centered photograph with cover cropping; five-stop navy overlay, with the original masked decoration above it.

The subtitle's **“Sysem”** spelling is preserved exactly from the source. Correcting it would be a content change.

## Responsive behavior

At the reference desktop size, spacing and styling follow the Figma measurements. Smaller screens retain the same image, centered visual hierarchy, colors, and action. The text scales and wraps, the logo becomes 96 px on narrow screens, and the page can scroll on short displays. The background remains centered and uses cover cropping rather than stretching the photograph.

Hover, active, keyboard focus, reduced-motion handling, semantic headings, and an accessible navigation link are added without changing the default visual design.

## Overview dashboard

Source: **OVERVIEW**, node `30:2`, on Page 1 of the same Figma file. Implementation is based on its design context, the room-card design context (`30:96`), metadata, and the 1440 × 900 screenshot. All Figma access remains read-only.

The original sidebar logo from layer `30:12` is saved as `src/assets/figma/overview/sidebar-logo.png` (42 × 42 source, displayed at 38 × 38). It is separate from the larger Welcome logo asset. The icons are the actual text symbols in the design: `▦`, `▥`, `♧`, and `♢`.

At 1440 × 900:

- Sidebar: 222 px wide, `#092743`; original logo and TapFlow brand at x=24, y=26. Navigation begins at x=13, y=110 with 44 px items and 8 px gaps. The active item has a cyan left border, muted blue outline, and `#184565` fill.
- Top bar: 68 px high, white, `#DBE7EF` bottom border, timestamp aligned to the right.
- Main background: `#F2F7FB`; content starts at x=254, y=105 with 32 px side padding.
- Page heading: Inter weight 750, 40/46 px; subtitle 16/23.2 px, `#486176`, with a 12 px gap.
- Room cards: x=254, 645, 1036; y=255.99; each 372 × 252 px, 19 px gaps, 15 px corner radius, white fill, 1 px `#DBE7EF` border.
- Room titles: Inter weight 700, 18/26.1 px. Current flow: weight 740, 31/35.65 px. Device values: weight 670, 15/21.75 px. Device labels: 12/17.4 px.
- Idle badges: `#F0F5F8`, `#DCE7EE` border, `#456177` text/dot. No-alert badge: `#E8F8F1`, `#C8EBDE` border, `#11654C` text/dot.
- View Details links: 116 × 32 px, 7 px radius, `#E9F6FD` fill, `#CFE6F2` border, `#00618D` text at 13 px / weight 660.
- Main Water Inlet: x=254, y=523.99, 1154 × 133 px. Three columns follow the Figma proportions: 45%, 27.5%, 27.5% of the inner width.

Dashboard variables and styling are scoped to the dashboard shell; the Welcome Screen's source, styles, shared logo/background components, and global tokens are preserved. Smaller viewports stack the cards and move the sidebar navigation above the content.

Room Details and Alerts now follow their separate frames, documented below. All statuses and measurements come from a typed shared state; future updates reuse the same cards and routes.

## Room Details

Source: **ROOM DETAILS**, node `36:289`, with the Water Flow panel inspected separately at `36:411`. The source frame measures 1440 × 901 px; implementation checks use a 1440 × 900 browser viewport. All Figma operations were read-only.

The existing dashboard shell has a `room-details` variant. The original dashboard CSS, Welcome and Overview page files, room-card styles, global CSS, and shared tokens remain unchanged. Route-specific styles are scoped to the variant or use the `rd-` prefix.

At the desktop reference size:

- Sidebar: 232 px wide, `#0B2742`, 42 px logo at x=22/y=26, 200 × 44 px navigation items starting at x=16/y=117, and the original prototype footer.
- Top bar: 69 px, with Utility monitoring, a preview badge, and No live data status. The badge reads **Demo data** to make the nature of the values explicit.
- Main: x=264, y=103; 1144 px inner width; 34 px top padding and 32 px side padding.
- Heading: Inter weight 750, 40/44.4 px, −1.6 px letter spacing. Description: 15/22.5 px.
- Room selector: 249 × 45 px, white rounded container with a pale-blue selected link. It retains Room 1, Room 2, and Room 3 and URL navigation.
- Metrics: five 86 px-high cards beginning at y=258.89, separated by 12 px. Column proportions are 1:1:1.03:1.03:1. Labels are 12 px / weight 550; values are 21 px / weight 740.
- Panel grid: 15 px gaps, 1.12:0.88 columns. Water Flow starts at x=264/y=360.89 with width 632.24 px; Water Usage History starts at x=911.24. The first row is 247.5 px high. Recent Activity and Related Alerts start at y=623.39.
- Panels: white, 14 px corner radius, 1 px `#D9E6EE` border, subtle shadow. Panel headings use Inter 19/28.5 px, weight 700, −0.25 px letter spacing.
- Background: `#F2F7FA`; secondary text: `#4C6579`. The flow chart retains its empty axes and uses no invented readings.

Original downloaded assets are in `src/assets/figma/room-details/`:

| Asset(s) | Source layer(s) | Intrinsic / display dimensions |
| --- | --- | --- |
| `sidebar-logo.png` | `36:294` | 224 × 224 source, 42 × 42 display |
| `overview.svg`, `rooms.svg`, `alerts.svg` | `36:300`, `36:307`, `36:311` | 20 × 20 |
| `prototype.svg` | `36:316` | 16 × 16 |
| `utility.svg`, `clock.svg` | `36:325`, `36:333` | 20 × 20, 16 × 16 |
| `water-drop.svg`, `usage.svg`, `rfid.svg`, `valve.svg`, `light.svg` | `36:364`, `36:374`, `36:384`, `36:394`, `36:403` | 17 × 17 |
| `chart-empty.svg` | `36:430` | 20 × 20 |
| `activity.svg`, `arrow-right.svg`, `related-alerts.svg`, `info.svg` | `36:459`, `36:472`, `36:476`, `36:484` | 16 × 16 |

SVG files retain their original paths, colors, and intrinsic dimensions. Temporary Figma URLs are not runtime sources. The existing Back to Overview link is retained beside the explanatory footnote.

All three rooms use the same components and shared current-state model. Historical arrays start empty per room; activity and alert empty states match the design. Related alerts are filtered by the selected room ID. On narrow screens the navigation moves above the content, metrics wrap, and panels form a single column. Supabase and hardware integrations are not configured.

## Alerts

Source: **ALERTS**, node `36:529`, with the log inspected separately at `36:604`. The source frame is 1440 × 901.5 px; desktop browser verification uses 1440 × 900. The hierarchy, design context, screenshot, and asset geometry were inspected before implementation. All Figma access was read-only.

Alerts reuses the existing 232 px detail shell, header, logo, badge component, and exact matching SVGs. The shared shell accepts an Alerts variant to use its original navigation and footer assets. Page-specific CSS uses Alerts classes; the original shared CSS and Welcome, Overview, and Room Details page styles are unchanged.

Desktop measurements:

- Sidebar: 232 px, `#0B2742`; header: 69 px, white, `#D9E6EE` bottom border.
- Main content: x=264, y=103, 1144 px wide, with 17 px vertical gaps.
- Heading: Inter weight 750, 40/44.4 px, −1.6 px tracking. Subtitle: 15/22.5 px. The overall status uses the existing neutral pill at the right.
- Summary: two 563.5 × 96 px cards at x=264 and x=844.5, y=208.89. Their icon tiles are 39 px. Count values use Inter 29/33.35 px, weight 740, −0.7 px tracking.
- Alert log: x=264, y=321.89, 1144 × 412 px; 14 px radius; 1 px `#D9E6EE` border; white fill and subtle shadow.
- Log heading: 19/28.5 px, weight 700, −0.25 px tracking. Subtitle: 13/19.5 px.
- Table header: 40 px high, `#EDF5FA`, 12/18 px, weight 670. Column proportions are 15%, 18%, 29%, 22%, and 16% for Severity, Affected room, Rule or anomaly, Detected (PHT), and Status.
- Empty log area: 223 px high; original 26 px shield in a 54 px tile. Heading: 21/31.5 px, weight 690; description: 14/21 px.
- Footer: record count at left; severity key at right. Severity pills preserve the original blue, amber, and pink palettes and 11 px / weight 650 labels.

Truthful copy intentionally replaces the source's simulated health claim: **Demo data**, **Monitoring not yet active**, and **No alert records yet**. Zero counts mean zero recorded alerts; they make no claim about physical anomalies. Loading records does not change monitoring status. The original icon artwork remains unmodified.

Downloaded Alerts assets are in `src/assets/figma/alerts/`. `rooms.svg` (`36:547`), `alerts.svg` (`36:551`), and `active.svg` (`36:587`) are 20 px; `prototype.svg` (`36:556`) is 16 px; `resolved.svg` (`36:596`) is 20 px; `empty-shield.svg` (`36:625`) is 26 px. The logo and Overview, utility, clock, and info assets are byte-for-byte matches for existing Room Details assets and reuse those local files. No temporary asset URLs remain in application code.

On narrow screens, summary cards stack, the sidebar moves above the content, and the table scrolls inside a keyboard-focusable region. The empty state stays centered within the available width instead of scrolling out of view with the table columns.

The frontend record contract and separate monitoring status prepare the page for a later data adapter. No database schema, Supabase client, anomaly events, detection rules implementation, resolution algorithm, or firmware has been created.
