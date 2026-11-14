# AGENTS.md - instructions for AI coding agents and IDEs

**Project:** Kubernetes Events Filter Dashboard  
**Repository:** https://github.com/lalit-contributes/k8s-events-filter-dashboard  
**License:** Apache-2.0  
**Product mode:** Browser-only, synthetic Kubernetes Event data; no live-cluster connection

Read this file and `BUILD_SPEC.md` before editing code. The product requirements originate in the supplied **Kubernetes Events Filter Dashboard - Technical Specification v1.0** (proposed PRD dated 31 October 2026) and are expected to be maintained in `docs/SPEC.md` in the repository.

---

## 0. Source-of-truth and working rules

Apply this precedence order:

1. The user's latest explicit instruction.
2. The current approved `docs/SPEC.md`. It must faithfully preserve the approved product specification.
3. The supplied Technical Specification PDF, version 1.0, where `docs/SPEC.md` is missing or demonstrably incomplete.
4. `AGENTS.md` for agent behavior and product invariants.
5. `BUILD_SPEC.md` for toolchain, tests, CI and deployment.
6. Existing implementation details, only when they do not conflict with the above.

If `docs/SPEC.md` is missing, do not pretend it was read. Check whether the supplied PDF has been transcribed into the repository; identify that gap in your completion report and do not silently replace the approved requirements with guesses. If two sources disagree, follow the higher-priority source, record the discrepancy, and make the smallest compatible change. Do not silently change product scope to fit an implementation.

Before modifying an existing repository:

- Inspect the current tree, `git status`, recent relevant changes and the existing scripts/configuration.
- Preserve user changes, untracked files and unrelated work. Never run destructive commands such as `git reset --hard`, `git clean -fd`, or broad deletion commands to make the tree convenient.
- Do not scaffold over an existing project. Use the scaffold procedure in `BUILD_SPEC.md` only if the application genuinely does not exist.
- Make focused changes and review the final diff. Never claim a command or test passed unless you ran it and observed success.
- If a requirement cannot be met, report the exact blocker and what remains unverified.

## 1. Mission

Build a static, browser-based React and TypeScript single-page application for inspecting, filtering and following a **simulated** stream of Kubernetes `Event` records. It helps users narrow an event list, inspect a selected record and compare the same records through overview and analytics views.

The product studies event inspection and filtering. It is not a diagnostic engine. A Kubernetes Event is best-effort supplemental information with limited retention; the UI must not claim that an Event proves why a workload failed.

## 2. Non-negotiable product and safety invariants

1. **No live cluster access.** Never read `kubeconfig`, environment credentials, cluster contexts or local Kubernetes configuration. Never call a Kubernetes API server, use a Kubernetes client, request a real cluster connection, or imitate a successful live connection.
2. **No backend.** No server, database, authentication, user accounts, production-history service, alerts, notifications, metrics collector or log viewer.
3. **Synthetic data only.** App data comes from checked-in, versioned fixtures and deterministic simulator scripts. Every data-bearing screen must show a persistent and readable simulated-data label. Do not rely on a development-only flag to show it.
4. **No runtime telemetry or third-party network dependency.** No analytics SDK, tracking pixel, remote font, CDN script, external API call or external data request. The running app should work from its bundled assets and local state. Do not use `fetch`/XHR to retrieve fixture files from a remote location.
5. **One source of truth for visible results.** The table, visible result count, overview metrics, analytics, chart selections and exports must use the same normalized event store and shared filter/query semantics. Do not reimplement filtering separately inside components.
6. **Raw data is immutable.** `rawEvent` retains the source record shape and content. Normalization, filtering, selection, sorting, aggregation and rendering must never mutate it. If a simulated series update arrives, create a new immutable source snapshot and replace the normalized record with the same stable logical ID; do not mutate the prior snapshot.
7. **Do not invent source values.** Missing values render as `Not supplied`. Do not replace missing or invalid dates with the current system time. Keep first-observed and last-observed timestamps distinct. Invalid last-observed timestamps are excluded from bounded time filtering and time-bucket aggregation, and the UI must identify invalid/fallback timestamps honestly.
8. **One Event series remains one Event record.** Never turn `series.count` or core `count` into repeated table rows. Count and last-observed time are fields on the same logical record.
9. **Deterministic scenarios only.** Never generate random failures or use `Math.random()` for scenario content. Re-running a scenario with the same fixtures and controls must produce the same sequence.
10. **No unsupported root-cause language.** Do not call the app a root-cause detector or say an Event proves a failure's cause. Avoid that wording in UI copy, docs and demo material.
11. **No implicit persistence.** The app starts with its initial scenario when reloaded. Do not add `localStorage`, `sessionStorage`, IndexedDB, cookies or another persistence layer unless the product spec is explicitly amended and the README explains it.
12. **No upstream Kubernetes code in this repository.** The possible `kubectl events`/SIG CLI discussion is a separate research activity, not a task to implement the dashboard. Do not add changes to `kubectl`, Kubernetes API code or cluster integrations here.
13. **License headers.** Every new TypeScript/JavaScript source, script and test file must use the Apache-2.0 SPDX header in `BUILD_SPEC.md`. Use appropriate comment syntax for the file type.
14. **No emoji in source, documentation or UI copy** unless the user explicitly requests it.
15. **No feature creep.** Do not add features, columns, filters, pages, persistence or dependencies because they seem useful. If a feature requires a material product decision, record it and request approval rather than quietly expanding the product.

### Cross-source rule about missing occurrence counts

The existing draft of this file said `occurrenceCount` should default to `1` when a count is absent. The PDF specification says missing fields must display `Not supplied` and values must not be invented. Follow the PDF: preserve a missing or invalid source count as `null` and render `Not supplied`; do not infer `1` unless the approved `docs/SPEC.md` is explicitly amended to define that semantic default. A present, valid count remains a number.

## 3. Approved scope

### Included

- Overview with total Event records, Warning count, Normal count, namespace count, volume over time, reason breakdown and recent Warnings.
- Event explorer with keyword search, combined filters, visible applied-filter chips, stable sorting, 50-row pagination, result count and clear-all action.
- Event detail side panel with normalized fields, timestamp source/fallback indicators and untouched raw JSON.
- Analytics based on the same selected dataset, with event-volume buckets and breakdowns by type, reason and namespace. Chart selections must apply equivalent filters in the explorer.
- Five deterministic scenarios: `normal-rollout`, `image-pull-failure`, `scheduling-pressure`, `container-health`, and `node-condition`.
- Simulator controls: scenario selector, play, pause, event-rate control and confirmed reset.
- CSV and JSON export of the entire filtered result set, not only the visible page.
- Loading, populated, no-results, empty-dataset and invalid-record states.
- Unit tests, browser acceptance tests, fixture validation and a repeatable performance benchmark.

### Excluded

Real cluster connections; authentication; accounts; server-side storage; durable history; alerts; notifications; remote telemetry; log viewing; metrics scraping; automatic diagnostics; a Kubernetes API server; and an implementation of the candidate upstream `kubectl` enhancement.

## 4. Stack and dependency policy

Follow `BUILD_SPEC.md`. Use its approved React/TypeScript/Vite toolchain, Recharts for charts and the configured test/lint tools. Package versions must be pinned and recorded in `package-lock.json`.

- Do not introduce a dependency outside the explicitly approved list in `BUILD_SPEC.md` without recording why it is needed and obtaining the user's approval.
- Prefer small pure TypeScript functions and browser APIs over a new library.
- Do not add state-management, routing, date, CSV or schema-validation libraries when the defined behavior is straightforward to implement without them.
- Do not install a new dependency merely to avoid writing a small deterministic helper.
- Do not use a remote font or external asset. All assets required by the app must be bundled or checked in.

## 5. Required repository layout

Keep the existing repository intact and align it with this structure. Do not delete or rename an existing file without checking references first.

```text
k8s-events-filter-dashboard/
├── AGENTS.md
├── BUILD_SPEC.md
├── README.md
├── LICENSE
├── CHANGELOG.md
├── .nvmrc
├── .gitignore
├── package.json
├── package-lock.json
├── index.html
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── playwright.config.ts
├── docs/
│   └── SPEC.md
├── fixtures/
│   ├── normal-rollout.json
│   ├── image-pull-failure.json
│   ├── scheduling-pressure.json
│   ├── container-health.json
│   ├── node-condition.json
│   └── core-v1-compat.json
├── public/
│   └── favicon.svg
├── src/
│   ├── domain/
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   ├── normalise.ts
│   │   ├── timestamps.ts
│   │   ├── filters.ts
│   │   ├── sort.ts
│   │   ├── paginate.ts
│   │   ├── aggregate.ts
│   │   └── export.ts
│   ├── store/
│   │   ├── eventStore.ts
│   │   └── simulator.ts
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── Header.tsx
│   │   ├── SimulatedBanner.tsx
│   │   ├── Overview/
│   │   ├── Explorer/
│   │   ├── DetailPanel/
│   │   ├── Analytics/
│   │   └── states/
│   ├── styles/
│   └── main.tsx
├── tests/
│   ├── unit/
│   └── e2e/
├── scripts/
│   ├── validate-fixtures.ts
│   ├── check-coverage.ts
│   ├── benchmark.ts
│   └── check-bundle-size.mjs
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

The layout is a guide, not permission to rewrite an established tree wholesale. The domain layer must remain independent of React, UI components and Recharts.

## 6. Normalized data contract

Both supported Kubernetes Event shapes are input formats. Normalize them once at the boundary, then let the rest of the app operate on `NormalisedEvent`.

```ts
export type EventApiVersion = 'events.k8s.io/v1' | 'v1';

export type TimestampSource =
  | 'eventTime'
  | 'firstTimestamp'
  | 'series'
  | 'lastTimestamp'
  | 'creationTimestamp'
  | 'none';

export type NormalisedEvent = {
  id: string; // Stable logical ID, unique in the active store.
  apiVersion: EventApiVersion;
  uid: string | null;
  namespace: string | null;
  type: 'Normal' | 'Warning' | null;
  reason: string | null;
  message: string | null;
  action: string | null;
  object: {
    apiVersion: string | null;
    kind: string | null;
    name: string | null;
    namespace: string | null;
    uid: string | null;
  };
  reporter: string | null;
  firstObservedAt: string | null; // ISO 8601 UTC if valid; otherwise null.
  lastObservedAt: string | null;  // ISO 8601 UTC if valid; otherwise null.
  occurrenceCount: number | null;
  occurrenceCountStatus: 'valid' | 'missing' | 'invalid';
  createdAt: string | null;
  timestampSource: {
    first: TimestampSource;
    last: TimestampSource;
  };
  timestampValid: boolean; // True only when effective lastObservedAt is valid.
  rawEvent: unknown;       // Untouched source record; never mutate it.
};
```

### Field mapping

| Normalized field | `events.k8s.io/v1` | `core/v1` (`apiVersion: v1`) |
|---|---|---|
| Object reference | `regarding` | `involvedObject` |
| Message | `note` | `message` |
| Reporter | `reportingController` | reporting fields, then `source.component` where present |
| First observed | `eventTime` | `eventTime`, then `firstTimestamp` |
| Last observed | `series.lastObservedTime` when present | `lastTimestamp` when present |
| Occurrence count | `series.count` when present | `count` when present |
| Creation fallback | `metadata.creationTimestamp` | `metadata.creationTimestamp` |

Rules:

- Preserve the source object in `rawEvent` and do not rewrite `apiVersion` or rename fields inside it.
- Prefer the explicitly specified occurrence timestamp fields. Use `metadata.creationTimestamp` only as the documented fallback; record the chosen field in `timestampSource` so the detail panel can explain it.
- If a higher-priority timestamp field is absent, try the next documented candidate. If the selected candidate is present but invalid, flag it as invalid instead of silently replacing it with the system clock or hiding the invalid value behind a lower-priority candidate. Keep the raw input visible for inspection.
- `timestampValid` describes the effective **last-observed** timestamp used for time filters. Missing or invalid effective last-observed times are excluded from bounded time filtering and time-bucket aggregation. The unbounded/all-data explorer may still show the record, with the missing/invalid state identified.
- Keep timestamps as UTC ISO strings after successful parsing. Display local time with the timezone clearly shown.
- A timestamp sourced from `creationTimestamp` is marked as a fallback. Do not imply it is the actual occurrence time.
- Accept `occurrenceCount` only when the source field contains a valid positive integer. Set `occurrenceCountStatus` to `valid`, `missing` or `invalid`; keep `occurrenceCount` as `null` when missing/invalid. Display `Not supplied` for a missing count and `Invalid value` for a malformed count. The untouched raw record remains available.
- `namespace` comes from Event metadata. `object.namespace` is the referenced object's namespace. Do not substitute one for the other.
- Handle unknown or malformed optional values defensively. A bad individual record must not crash the entire dashboard. Preserve enough raw data to show an invalid-record state.
- IDs must be reproducible. Use a valid unique source UID when possible; otherwise derive a stable ID from fixture/scenario identity and a deterministic record index. Never create IDs with random values or current timestamps.

## 7. Query, filtering and sorting contract

All filtering and aggregation logic belongs in `src/domain/` and must be covered by unit tests. UI components call the shared query functions; they do not implement their own predicates.

| Filter | Matching rule |
|---|---|
| Namespace | Exact match against Event metadata namespace; multiple selected values use OR. |
| Type | Exact `Normal`/`Warning` match; multiple selected values use OR. Selecting both is equivalent to no type restriction. |
| Reason | Exact reason values; multiple selected values use OR. |
| Resource kind | Exact match against `object.kind`. |
| Resource name | Case-insensitive substring match against `object.name`. |
| Reporter | Exact match against the normalized reporter value; populate the control from the available reporter values. Chart-driven reporter filters use the same exact rule. |
| Time range | Use effective `lastObservedAt`; bounded ranges exclude records for which `timestampValid` is false. |
| Keyword | Case-insensitive substring search over reason, message, object name, Event namespace and reporter. Missing values are treated as empty strings for searching, never as fabricated display values. |

- Different filter categories combine with **AND**. Multiple selected values within one category combine with **OR**.
- A search term is trimmed; an empty term imposes no restriction. Matching is case-insensitive and must not depend on the viewer's locale.
- The initial and clear-all time range is **All available**. This is the implementation default so the initial unfiltered totals can be compared directly with the loaded dataset. Also provide relative presets (15 minutes, 1 hour, 6 hours, 24 hours) and a custom start/end range. Treat this list as an implementation default where the PDF does not prescribe exact preset values.
- Relative ranges are anchored to the simulator's deterministic scenario clock, not `Date.now()`. Unless a scenario manifest declares an explicit clock start, initialize it from the latest valid effective last-observed timestamp in the loaded fixture. Advance it only with valid scripted arrival timestamps and freeze it while paused. This keeps replay behavior reproducible without requiring an unstated metadata field in the raw Event fixtures.
- Custom ranges use UTC internally and display local timezone information. The start and end are inclusive. Invalid input is flagged and must not silently change to another range.
- On an active bounded time range, an event is included only when its valid effective last-observed time falls inside the range. A data record with an invalid timestamp may still appear in All available, but it is excluded from time buckets and bounded ranges.
- Default sort is newest effective last-observed timestamp first. Supported sortable fields: first observed, last observed, namespace, type, reason, object name and occurrence count.
- Keep ties stable using the record's original store order; use stable ID as a final deterministic tie-break only if original order is unavailable. Missing values sort last in either direction.
- Pagination is fixed at 50 rows. A filter change resets to page 1. Keep page indexes in range when records are added or removed. A sort change should reset to page 1 for predictable results.
- Clear all removes keyword search and filters, restores All available and newest-first sorting, and returns to page 1.
- Show applied filters as removable chips and make Clear filters visible without opening an advanced panel.

## 8. Event store and deterministic simulator

- The event store is the single in-memory source for fixtures and simulated arrivals. Overview, explorer, detail, charts and exports must derive from it.
- Ship the five fixed scenarios named in section 3. Keep scenario sequences versioned and deterministic. A scenario should contain enough routine records as well as its signature pattern to make search, filtering and analytics meaningful.
- Fixture seeds must cover several namespaces and resource kinds, Normal and Warning types, both Event API shapes, repeated series, absent optional fields, fallback timestamps and at least one invalid timestamp case. Do not make invalid fixtures silently look like valid source data.
- The target dataset for responsiveness testing is 1,500-2,500 records. The benchmark uses exactly 2,500 deterministic normalized records. Runtime fixture generation, if needed for volume, must be deterministic and visibly simulated; it must not synthesize random incidents.
- Play schedules the next scripted step. Pause prevents further appends/updates and leaves current filters, selected record and rows unchanged. Resume continues at the next script index rather than restarting.
- Speed affects only the delay between scripted arrivals, never event timestamps or sequence order. Default rate is 1x; the proposed selectable rates are 0.5x, 1x, 2x and 4x unless the approved product spec later says otherwise.
- A repeated-series update preserves the same logical ID and replaces the stored immutable snapshot with an updated normalized count and last-observed timestamp. Do not append a second row for the same logical series.
- Reset restores the scenario's initial fixture, removes generated arrivals and resets the simulator cursor. Require an accessible visible confirmation before destructive reset. Preserve active query filters unless `docs/SPEC.md` explicitly chooses to reset them; close the selected detail and set pagination to page 1.
- Scenario selection replaces the active scenario data with that scenario's initial fixture. Keep the scripted timeline deterministic and make the active scenario name and Paused/running status visible in the shared header.
- Define `MAX_IN_MEMORY_EVENTS` once in a named constant. Proposed default: `10_000` normalized records. Never exceed it. When the cap is reached, stop appending, visibly explain that the simulation has paused at the limit, and allow reset. Do not silently evict seed records or the selected record.
- Clean up scheduled timers when pausing, resetting, switching scenarios or unmounting. A paused simulator must not keep adding events in the background.

## 9. Screen and interaction requirements

### Shared shell

- Three main sections: Overview, Event explorer and Analytics.
- Simulator controls and active scenario are in the shared header on every section.
- A persistent simulated-data banner/label is visible on every screen that presents Event data, including the detail panel.
- Filter state is shared across the three sections. Switching sections must not silently clear, rewrite or reinterpret filters.
- Keep the interface focused on the event workflow and readable at high data density. Do not sacrifice labels, keyboard access or clear timestamp/count semantics for visual effects.

### Overview

- Show total Event records in range, Warning count, Normal count and namespaces represented.
- Show event volume in consistent time buckets, the most common reasons and recent Warnings that open the associated detail panel.
- All totals and breakdowns respond to the active global time range.
- If invalid timestamps are excluded from a chart, say so in an accessible chart description; don't imply that the chart accounts for records that cannot be placed in time buckets.

### Event explorer

- The primary toolbar contains keyword search, time range, namespace, type and a visible Clear filters action.
- Secondary filter controls include reason, resource kind, resource name and reporter.
- Show removable active-filter chips and a result count that updates after filter changes and scripted arrivals.
- Columns: timestamp, namespace, type, reason, object, occurrence count and message.
- Opening a record displays the detail panel without routing away from the explorer. Closing it preserves filters, scroll position and current table context.

### Detail panel

- Show Event type, reason, message, Event namespace, referenced object, reporter, first observed, last observed, occurrence count and timestamp source/fallback status.
- Missing fields display `Not supplied`; invalid timestamps are explicitly marked. Do not conflate an absent value with an invalid supplied value.
- Raw JSON is formatted for inspection and represents the untouched source snapshot. It must not be synthesized from normalized values.
- Provide keyboard-accessible close behavior. On close, return focus to the originating row if it is still available; otherwise return focus to the explorer's primary control.

### Analytics

- Show event volume by time bucket, Normal/Warning distribution, top reasons and namespace counts.
- Chart labels identify the active interval and whether the count represents Event objects or source-recorded occurrences. Do not label a count of series occurrences as a count of unique Event objects.
- Chart segments and reason entries are controls, not decorative pictures. They apply equivalent filters and take the user to the explorer. Non-color labels must identify the selected category.
- Supply an accessible text/table summary for chart data; do not make a chart the only way to access the numbers.

### Required states

- `loading`: explain that local sample fixtures are loading; do not show live-cluster connection language.
- `populated`: normal data view.
- `no results`: show the active filters and an obvious clear action.
- `empty dataset`: distinguish no records loaded from a valid query that matched no rows.
- `invalid record`: isolate the malformed record, explain what could not be normalized, and keep the rest of the application usable. Show raw source data when available.
- Simulator paused/running/cap-reached state must be visible and understandable without color alone.

## 10. Accessibility, responsive behavior and UI quality

- Use semantic landmarks, heading order, buttons, labeled form controls and a real table with column headers.
- All controls must work with keyboard alone. Focus must be visible. Never communicate Normal/Warning, selected state, invalid state or simulator state by color alone.
- Aim for WCAG 2.2 AA contrast and focus visibility. Do not rely on tiny helper text to communicate important data provenance.
- The detail panel and reset confirmation must support keyboard focus management and Escape where appropriate. Do not trap focus unless the panel/modal behaves as a proper dialog.
- Chart actions must have keyboard-operable alternatives and an equivalent text/table description.
- Announce material result-count changes politely without announcing every arriving row as an interruptive alert. Respect `prefers-reduced-motion`.
- Support a narrow layout without losing filters, event fields, source labels or access to the detail panel. Avoid horizontal overflow where practicable; a horizontally scrollable event table is acceptable if clearly usable.
- Do not load fonts, images, scripts or styles from external origins.

## 11. Exports

- Exports operate on the complete filtered result set, across every page, using the current sort order. Never export just the 50 visible rows.
- CSV uses the documented dashboard column set and correctly escapes commas, quotes and line breaks. Neutralize spreadsheet formula injection for values beginning with formula-triggering characters such as `=`, `+`, `-` or `@`; cover this with unit tests.
- JSON export preserves the original source record shapes (`rawEvent`) rather than exporting an invented normalized schema. It must include every filtered record and retain source API-version fields.
- Generate downloads locally with browser APIs. Revoke temporary object URLs after triggering the download. Do not send export content to a service.

## 12. Testing requirements

### Unit tests

Cover at least:

- Every field mapping for `events.k8s.io/v1` and `core/v1`.
- Missing, invalid and fallback timestamps; UTC normalization; timezone display helpers; no substitution with current time.
- Count mapping, `occurrenceCountStatus` for missing/invalid values, stable IDs and untouched raw fixture input.
- Every filter rule, AND across categories, OR within categories, both-types-selected behavior, bounded time ranges and invalid-timestamp exclusions.
- Every supported sort field, ascending/descending order, missing values, stable ties and sort determinism.
- Pagination, page reset on filters and page clamping after store changes.
- Aggregation buckets and labels; distinction between Event objects and occurrence counts; invalid-time exclusion.
- CSV escaping and formula injection handling; JSON raw shape; exports across all pages.
- Simulator repeatability, pause/resume cursor behavior, speed preserving timestamps, series update semantics, reset and cap behavior.
- Missing optional fields and malformed records do not crash unrelated events.

### Browser acceptance tests

The ten product acceptance tests from the product specification must pass:

| ID | Action | Expected result |
|---|---|---|
| TC-01 | Open with no filters | Totals match the loaded dataset; simulated-source label is visible. |
| TC-02 | Choose Warning and one namespace | Every row matches both filters; the result count matches. |
| TC-03 | Choose two reasons | Either reason matches and all other filters still apply. |
| TC-04 | Search for text found only in a message | Match succeeds regardless of case. |
| TC-05 | Set a custom range | Only records with valid effective last-observed timestamps in range appear. |
| TC-06 | Open a repeated series | Count and last-observed time are shown separately from first-observed time. |
| TC-07 | Pause then resume | No events arrive while paused; the same sequence continues after resume. |
| TC-08 | Reset after generated events | Generated records are removed and the initial fixture returns. |
| TC-09 | Export filtered results spanning pages | CSV and JSON contain all filtered records, not only the current page. |
| TC-10 | Load records with missing optional fields | The page stays usable and missing values say `Not supplied`. |

Add browser checks for all three sections, keyboard operation of filters and detail panel, reset confirmation, no-results/empty-dataset/invalid-record states, chart-to-explorer filtering, simulated label persistence, and absence of requests to external origins. Unit tests are not a substitute for browser acceptance tests.

## 13. Implementation sequence and gates

Work in this order unless the user explicitly changes it. Do not polish charts or add optional UI before the core data rules are correct.

1. **Foundation:** verify project tree, canonical spec, package/toolchain and license. Validate fixtures and implement both API-shape normalizers and timestamp rules. Gate: fixture validator and mapping/timestamp unit tests pass.
2. **Query core:** implement filter, stable sort, pagination and raw-source-safe exports. Gate: all domain unit tests pass.
3. **Explorer/detail:** deliver the table, controls, chips, all required states and detail side panel. Gate: browser tests for filtering and inspection pass.
4. **Simulator:** implement the five deterministic scenarios, pause/resume/rate/reset and cap behavior. Gate: repeatability and lifecycle tests pass.
5. **Overview/analytics:** derive metrics and accessible chart summaries from the same query result. Gate: table/count/chart calculations agree, with documented exclusions for invalid times.
6. **Hardening:** complete CSV/JSON export, responsive behavior, accessibility checks, benchmark, bundle-size check and no-external-network test. Gate: all TC-01 to TC-10 plus the additional checks pass.
7. **Release readiness:** README and changelog, clean-clone instructions, CI and Pages preview. Upstream discussion remains separate from implementation.

After each stage, run the tests relevant to that stage. Before finalizing, run the complete `npm run verify` command defined in `BUILD_SPEC.md` where feasible. If a required browser or build tool is unavailable, report it rather than claiming success.

## Current implementation progress and PRD review (14 November 2026)

The supplied `1793450417719_kubernetes-events-dashboard-spec.pdf` was compared with `docs/SPEC.md`, the application source, fixtures and acceptance tests. The implementation covers the specified browser-only workflow. The gap review below has been addressed in code, tests and the canonical repository spec. Current verification passed lint, typecheck, fixture validation, all 78 unit tests, all 25 browser tests, production and GitHub Pages builds, coverage floors and the 500 KiB initial-JavaScript gzip gate. The 2,500-record domain benchmark passed with medians of 0.051 ms for namespace/type filtering, 0.238 ms for keyword search and 0.688 ms for a bounded time filter. This benchmark measures domain operations rather than browser rendering; describe it as the domain benchmark and do not claim it measures end-to-end interaction latency.

Implementation status by stage:

1. **Foundation — complete.** Five scenario fixtures contain 1,505–1,507 seed records each; the separate core/v1 compatibility fixture contains 105 records. Fixture validation and both API-shape normalization suites pass.
2. **Query core — complete.** Shared filtering, sorting, pagination, aggregation and raw-source-safe export are implemented and tested. Clear all restores the default filters, newest-first sort and first page.
3. **Explorer and detail — complete.** All six namespaces are selectable. Search, filters, chips, table, detail panel, raw JSON, local-time provenance and keyboard focus handling are present. TC-02 now requires `payments` and checks every visible row.
4. **Simulator — complete.** All five scenarios, speed, pause/resume, reset confirmation and scripted steps are implemented. Repeated-series updates remain allowed at the record cap; new records stop at the cap. TC-07 verifies pause stability and continuation at the next step; TC-08 verifies that reset removes an arrival.
5. **Overview and analytics — complete.** Both volume charts support selecting a bucket and type. Accessible table actions provide the same filter path. Shared query semantics drive results and summaries.
6. **Hardening — complete for defined checks.** Custom date inputs are UTC independent of the browser timezone and normalize to UTC ISO bounds. Dialog focus is contained, loading local fixtures is visible while the simulator module loads, invalid and empty states are implemented, runtime-origin checks pass, and the 2,500-record domain benchmark is repeatable.
7. **Upstream exploration — separate and pending.** The SIG CLI field-selector proposal remains a discussion candidate. No upstream Kubernetes code belongs in this repository.

### Review findings and resolution

- The namespace selector no longer truncates the six shipped scenario namespaces; TC-02 fails if `payments` is missing.
- Clear all now resets sorting and pagination as well as filters.
- Zone-less `datetime-local` values are interpreted as UTC and stored as UTC ISO timestamps. Unit and browser checks verify the same result with a Los Angeles browser timezone.
- Overview and Analytics time-volume segments now apply an inclusive UTC bucket range plus Normal/Warning type. Keyboard-operable summary-table actions apply the equivalent query. Intermediate bucket ends are made exclusive by ending the preceding inclusive range one millisecond earlier.
- The record cap applies to new records; immutable updates to an existing series still work at capacity.
- Detail and reset dialogs contain keyboard focus while open and retain Escape/return-focus behavior.
- The app dynamically loads the bundled simulator module, displays the loading state during that load, and withholds simulator navigation/controls until initialization completes.
- `docs/SPEC.md` follows the PDF's explicit no-diagnosis boundary and records the source wording tension. The supplied PDF is left unchanged; its “records that explain an incident” phrase remains inconsistent with its own limitation.

The PRD's 250 ms responsiveness statement has a passing 2,500-record domain benchmark. A browser-rendering latency benchmark has not been measured; keep that limitation explicit if reporting the performance result.

## 14. Definition of done

- [x] Requirements FR-01 to FR-10 from `docs/SPEC.md` are implemented, including export FR-09.
- [x] Both supported Event API shapes are normalized and tested.
- [x] All filters, counts, charts and exports share the same query semantics.
- [x] The five simulator scenarios are deterministic; pause, resume, speed and reset are tested.
- [x] Simulated-data label appears on every data-bearing screen.
- [x] Missing data is not fabricated; timestamp/count behavior follows section 6.
- [x] TC-01 through TC-10 and additional browser checks pass.
- [x] Coverage floors in `BUILD_SPEC.md` pass.
- [x] Lint, typecheck, fixture validation, tests, production build and bundle-size check pass.
- [x] Runtime requests are restricted to the same-origin bundled application assets; no telemetry or external data calls exist.
- [x] Performance benchmark has recorded results for 2,500 deterministic records. The measured benchmark is domain-level; browser-rendering latency is not included.
- [ ] README steps work from a clean clone with the supported Node/npm versions.
- [x] License, `package-lock.json`, CI and deployment configurations are committed.

## 15. Explicit implementation defaults added where the PDF is silent

These defaults make the build executable; they are implementation conventions, not claims that the PDF specified these exact values. If the user or an approved product-spec revision changes them, update this file and `BUILD_SPEC.md` together.

- Initial and clear-all time filter: **All available**.
- Relative time presets: **15 minutes, 1 hour, 6 hours, 24 hours**, anchored to the simulator clock.
- Missing/invalid occurrence count: nullable with a separate status; missing displays `Not supplied`, malformed displays `Invalid value`, following the PDF's honesty rule rather than the earlier draft's implicit `1`.
- Simulator rate selector: **0.5x, 1x, 2x, 4x**, default **1x**.
- `MAX_IN_MEMORY_EVENTS`: **10,000**; pause visibly at the limit instead of dropping records silently.
- Development runtime: **Node 24 LTS**; exact installed package versions and lockfile are recorded in the repository.
- No Codecov or other third-party coverage upload is required. CI can retain test reports as GitHub Actions artifacts.
- Production bundle gate: at most **500 KiB gzipped for the initial JavaScript dependency graph**, measured by the local checker, not by Vite's default uncompressed chunk warning.

## 16. When to stop and ask

Do not make a unilateral decision that changes product scope, adds a runtime dependency, changes the stack, introduces persistence or network access, changes the exported source shape, changes Event identity/series semantics, or alters the deployment domain/repository path. State the conflict and proposed least-invasive option. For ordinary implementation details already defined above, proceed without asking.
