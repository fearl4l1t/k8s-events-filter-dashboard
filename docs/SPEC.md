# Kubernetes Events Filter Dashboard — Product Specification

**Version:** 1.0 (proposed PRD; subject to mentor review)  
**Original specification date:** 31 October 2026  
**Project type:** College software project; simulated environment  
**Primary output:** Interactive Kubernetes Events dashboard prototype  
**Upstream target:** `kubernetes/kubernetes`, subject to SIG CLI review  
**Data source:** Synthetic fixtures only; every data-bearing screen must identify the data as simulated

> **Non-negotiable boundary:** This project simulates a stream of Kubernetes-shaped `Event` records in the browser. It never connects to a live Kubernetes cluster, reads `kubeconfig`, or claims that simulated records came from a live environment.

This document translates the supplied *Kubernetes Events Filter Dashboard — Technical Specification v1.0* into the repository's canonical product requirements. Requirements below describe intended product behavior; they do not imply the features have already been implemented. The upstream command discussion is exploratory and separate from the dashboard implementation.

## Contents

1. [Context and problem](#1-context-and-problem)
2. [Kubernetes baseline and evidence](#2-kubernetes-baseline-and-evidence)
3. [Product definition](#3-product-definition)
4. [Product map and navigation](#4-product-map-and-navigation)
5. [Screen requirements](#5-screen-requirements)
6. [Interaction model](#6-interaction-model)
7. [Event data model](#7-event-data-model)
8. [Simulation model](#8-simulation-model)
9. [System architecture](#9-system-architecture)
10. [Functional and quality requirements](#10-functional-and-quality-requirements)
11. [Verification and acceptance](#11-verification-and-acceptance)
12. [Upstream boundary](#12-upstream-boundary)
13. [Delivery plan and risks](#13-delivery-plan-and-risks)
14. [References](#14-references)
15. [Implementation clarifications where v1.0 is silent](#15-implementation-clarifications-where-v10-is-silent)

---

## 1. Context and problem

Kubernetes emits Events as components report changes or actions: a Pod being scheduled, an image pull failing, a container restarting, a node condition being reported, or a controller creating a resource. An Event typically includes a type (`Normal` or `Warning`), a reason, a human-readable message, a reference to the affected object, and timestamps. Field names differ between `events.k8s.io/v1` and `core/v1`.

In a flat list, routine scheduling and image-pull messages can obscure a relevant Warning. Users must scan rows, compare times, identify repeated reasons, and connect records to affected resources manually. Repeated observations may be represented as one Event series with an occurrence count and last-observed time rather than as multiple independent records.

The project addresses two related tasks:

- **Inspection:** find an Event associated with a namespace or workload, inspect the full record, and compare its timing with related Events.
- **Analysis:** understand whether the sample contains a burst of Warnings, repeated reasons, or Events concentrated in a namespace.

The explorer is the central workflow. Users can combine namespace, type, reason, resource and time filters; open a record in a detail panel without leaving the list; and view overview and analytics derived from the same underlying dataset. A scripted simulator appends Events over time so these interactions can be demonstrated without a cluster.

**Project question:** Can users identify and inspect Events relevant to a namespace, resource, reason or time window more directly than by reading an unfiltered list?

This project studies Event inspection and filtering. It does not diagnose root causes and must not claim that an Event alone proves why a workload failed. Kubernetes Events are best-effort supplemental information with limited retention; the sample time range must never be presented as a complete or permanent audit history.

Source interpretation: the supplied proposed PRD v1.0 uses the phrase “records that explain an incident” in its problem statement, then explicitly rules out diagnosis and claims that an Event proves a failure's cause. This canonical specification follows the explicit non-diagnostic constraint; the dashboard helps users inspect records relevant to an incident without asserting that they explain its cause.

## 2. Kubernetes baseline and evidence

The dashboard is a separate simulated interface. It is not a replacement for `kubectl` and does not implement Kubernetes API behavior.

The Kubernetes `kubectl events` command reference cited by the original PRD documents namespace selection, all-namespace listing, resource filtering with `--for`, Event-type filtering with `--types`, watching with `--watch`, output formats, and chunked list retrieval. The cited command reference did not list dedicated flags for a time window, reason, message search, label selector, or field selector.

| Capability | Existing command/API context in the PRD | Dashboard proposal |
|---|---|---|
| Namespace scope | Namespace or all namespaces | Namespace filter, including all namespaces |
| Resource scope | `--for` resource | Kind and object-name filters |
| Event type | `--types` | `Normal` / `Warning` multi-select |
| Time window | No dedicated time-window flag listed for `kubectl events` | Relative and custom time range |
| Reason/message | No dedicated reason or text-search flag listed for the command | Reason selection and full-text search |
| Watch | `--watch` for new Events | Pauseable local simulation |

Field selectors are an API capability. The cited Kubernetes documentation lists Event selectors including `involvedObject.name`, `involvedObject.namespace`, `reason` and `type`. The PRD distinguishes that API capability from flags exposed by the dedicated command.

KEP-1440 records historical design motivation around sorting, watch behavior, timelines and flexible Event output. The original PRD also references issue #29838 about ordering Events by last-seen time, which was closed and linked to a pull request. These are design-history references, not evidence that every historical request remains open or that a proposed improvement has been accepted.

## 3. Product definition

### Intended users

- **Students and Kubernetes learners** who need to understand Event fields, reasons, resource references and how filtering narrows a list.
- **Developers and DevOps practitioners** who need to focus on Warning Events, inspect the affected object and compare the order of related records.

### Product goals

1. Present a readable Event table with enough context to identify an affected object and its event sequence.
2. Allow namespace, type, reason, resource and time filters to be freely combined.
3. Show a selected Event in detail, including timestamps, occurrence count, source fields and raw JSON.
4. Demonstrate new Events arriving through a controllable simulator.
5. Summarize the same records in charts without changing the meaning of the source data.

### Included in the prototype

| Area | Expected behavior |
|---|---|
| Overview | Event counts, Warning count, recent activity and reason distribution |
| Event explorer | Searchable table, filters, sorting, pagination and export |
| Event detail panel | Selected record fields, object reference and raw JSON |
| Analytics | Event volume over time and breakdowns by type, reason and namespace |
| Simulation controls | Scenario selection, play, pause, reset and event-rate control |

### Out of scope

The prototype must not:

- Connect to a real cluster, read `kubeconfig`, inspect cluster credentials, or imitate a live connection.
- Perform authentication, mutate Kubernetes resources, or provide alerts or notifications.
- Retain production Event history or persist application state across reloads by default.
- Diagnose failures automatically or state that an Event proves why a workload failed.
- Implement a Kubernetes API server, log viewer, metrics collector, or replacement for `kubectl`.
- Add a backend, database, telemetry, remote data service, or user account system.
- Implement an upstream `kubectl` change inside this dashboard repository.

The simulated-data label is a product requirement in every screen that displays Event data, not a development-only indicator.

## 4. Product map and navigation

The app has three primary sections and one shared dataset.

| Section | Purpose |
|---|---|
| Overview | Counts, event volume and latest Warnings; selecting a Warning opens its detail panel. |
| Event explorer | Main working table with combined filters, keyword search, sorting, pagination and export. |
| Analytics | Time buckets and breakdowns computed from the active dataset and selection. |

The scenario selector, play/pause controls, speed control and reset action live in a shared application header, remain reachable from every section, and visibly communicate their state.

Event details open in a **side panel**, not a separate route. Closing the panel returns the user to the same explorer context, including active filters and table scroll position. Filter state is shared across the three sections; switching sections must not silently change the dataset or reinterpret active filters.

Counts, charts, table rows and exports must derive from the same underlying normalized collection and shared query semantics. This prevents one view from contradicting another.

## 5. Screen requirements

Requirements in this section are observable. A screen is not complete until its required behavior can be verified.

### 5.1 Overview

- Open this section at application start.
- Show summary metrics for total Event records in the selected time range, Warnings, Normals and represented namespaces.
- Show Event volume over consistent time buckets.
- Rank the most common reasons.
- Provide a recent-Warnings list that opens the selected record in the detail panel.
- Recompute every metric and chart according to the active global time range and shared query state; do not use static snapshot values.

### 5.2 Event explorer

- Provide a toolbar with keyword search, time-range selector, namespace selector, type selector and a visible clear-filters action.
- Provide additional filters for reason, resource kind, resource name and reporter.
- Display applied filters as removable chips.
- Update the result count after every query change, including changes caused by the simulator appending or updating records.
- Display a paginated table with columns for timestamp, namespace, type, reason, object, occurrence count and message.
- Support sorting by the columns defined in [Interaction model](#6-interaction-model).
- Use a fixed page size of 50 records.

### 5.3 Event detail panel

Show the selected record's:

- Event type and reason.
- Message.
- Event namespace.
- Affected-object reference.
- Reporter.
- First-observed time and last-observed time.
- Occurrence count.
- Raw JSON source record.

Missing fields display `Not supplied`; the UI must not invent values. The raw JSON section must retain fields the dashboard does not expose in its normalized display. If a displayed timestamp uses a documented fallback, identify it in the detail panel.

### 5.4 Analytics

Show:

- Event volume by time bucket.
- Warning and Normal distribution.
- Top reasons.
- Namespace counts.

Chart segments and reason selections are controls, not decorative pictures: selecting one applies the equivalent filter in the explorer. Selecting a Normal or Warning time-volume segment applies that type together with the bucket's exact inclusive UTC time range. Every chart action has a keyboard-operable equivalent in its summary table. Labels state the selected time interval and whether counts refer to Event objects or recorded occurrences. A series with 50 occurrences is still one Event record.

### 5.5 Required interface states

The application must handle:

- `loading`
- `populated`
- `no results`
- `empty dataset`
- `invalid record`

A paused simulator is visibly labelled as paused. A no-results state shows the active filters and provides a clear action. Missing values display `Not supplied`. Invalid timestamps are flagged and excluded from time-based aggregation; they must never be silently replaced with the current time.

## 6. Interaction model

Filtering must behave identically in the explorer, overview, analytics and exports. Chart selections and direct filter changes operate on the same underlying Event collection.

### 6.1 Filters and matching rules

| Filter | Control | Match rule |
|---|---|---|
| Namespace | Single- or multi-select | Exact match against Event metadata namespace |
| Type | Multi-select for `Normal` / `Warning` | Exact match; selecting both is equivalent to no type restriction |
| Reason | Multi-select with text entry | Exact reason values; reason-value selection is separate from keyword search |
| Resource kind | Dropdown | Exact match against the referenced object's kind |
| Resource name | Text field | Case-insensitive substring of the referenced object's name |
| Reporter | Dropdown or text field | Match against normalized reporting controller, component or source component |
| Time range | Presets and custom range | Effective last-observed time falls within the range |
| Keyword search | Search field | Case-insensitive substring across reason, message, object name, namespace and reporter |

### 6.2 Combination logic

Different filter categories combine with **AND**. Multiple values within one category combine with **OR**.

Example:

`Namespace = payments AND Type = Warning AND (Reason = BackOff OR Reason = Failed) AND last observed within the last hour`

The same query semantics must drive the table rows, result count, charts, summary metrics and both export formats.

Custom date/time fields are explicitly entered as UTC, regardless of the browser's timezone. Store their bounds as UTC ISO timestamps and compare them as UTC instants. The timestamp values shown elsewhere in the interface remain localized with a visible timezone.

### 6.3 Sorting

- Default order: newest effective last-observed time first.
- Sortable fields: first-observed time, last-observed time, namespace, type, reason, object name and occurrence count.
- Sorting must be stable for ties so pagination remains deterministic. Retain original relative order for tied records; use the stable record ID as a deterministic fallback only if original order is unavailable.
- Missing values sort last in either direction.
- Missing or fallback timestamps must not be made to look more precise than the source supports; fallback provenance is shown in the detail panel.

### 6.4 Pagination and clearing filters

- Use a fixed page size of 50.
- Any filter change returns pagination to page one.
- Keep the current page within valid bounds when records are appended or removed.
- A sort change returns to page one for predictability.
- Clear all removes search and every filter, restores the default time range and newest-first sorting, and returns to page one.

### 6.5 Export

- CSV and JSON exports include the entire filtered result set across all pages, not just the visible page.
- JSON preserves the original source record shape so a reviewer can compare exports with fixtures.
- CSV uses the dashboard's documented column set.
- Export must use the shared query result, not a separate UI-specific filtering implementation.

## 7. Event data model

The primary fixture format is `events.k8s.io/v1`; a smaller compatibility fixture set uses core `v1` (`apiVersion: v1`). Normalize fields required for filtering and display while retaining the untouched source record.

### 7.1 API field mapping

| Normalized field | `events.k8s.io/v1` | `core/v1` (`apiVersion: v1`) |
|---|---|---|
| Object reference | `regarding` | `involvedObject` |
| Message | `note` | `message` |
| Reporter | `reportingController` | Reporting fields or `source.component` |
| First observed | `eventTime` | `eventTime`, fallback to `firstTimestamp` |
| Last observed | `series.lastObservedTime` when a series is present | `lastTimestamp` when present |
| Occurrences | `series.count` when present | `count` when present |

### 7.2 Normalized record contract

The normalized record contains the following fields. Implementation-only validation metadata (`timestampSource`, `timestampValid`, and `occurrenceCountStatus`) records provenance and validity required by the UI and tests.

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
  id: string;
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
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  occurrenceCount: number | null;
  occurrenceCountStatus: 'valid' | 'missing' | 'invalid';
  createdAt: string | null;
  timestampSource: {
    first: TimestampSource;
    last: TimestampSource;
  };
  timestampValid: boolean;
  rawEvent: unknown;
};
```

### 7.3 Timestamp handling

- Keep first-observed time and effective last-observed time separate.
- For `events.k8s.io/v1`, `eventTime` supplies first observation; when present, `series.lastObservedTime` and `series.count` supply the latest observation and occurrence count.
- For core `v1`, use the corresponding `eventTime`, `firstTimestamp`, `lastTimestamp` and `count` fields according to the mapping above.
- `metadata.creationTimestamp` is a fallback, not the preferred occurrence time. Record which source was used and mark a fallback in the detail panel.
- Store valid timestamps as UTC ISO 8601 strings and display local time with the timezone shown.
- Never substitute the current time for a missing or invalid timestamp.
- If a higher-priority timestamp field is present but invalid, flag it as invalid instead of silently replacing it with the system clock or concealing it behind a lower-priority candidate.
- Missing or invalid effective last-observed timestamps remain inspectable in an unbounded/all-data view, but are excluded from bounded time filtering and time-bucket aggregation.

### 7.4 Counts, IDs and source-record integrity

- A repeated Event series remains one logical Event record. Keep occurrence count and last-observed time as separate fields.
- Preserve the source object in `rawEvent`. Normalization, filtering, sorting, aggregation and display must not mutate it.
- Accept an occurrence count only when the source provides a valid positive integer. Keep a missing or invalid source count as `null`; display `Not supplied` for missing counts and `Invalid value` for malformed counts. Do not infer `1` for a missing count.
- A simulated series update replaces the normalized snapshot while retaining the same logical ID; do not mutate the earlier raw snapshot.
- IDs must be stable and reproducible. Use a valid source UID when possible; otherwise derive a stable ID from fixture/scenario identity and a deterministic record index. Do not use randomness or current timestamps to create IDs.
- Keep Event metadata namespace separate from the referenced object's namespace. Never substitute one for the other.
- Handle missing/malformed optional fields defensively so one invalid record does not crash the page. Preserve raw data for inspection.

### 7.5 Data-honesty boundary

Kubernetes Events are best-effort supplemental data with limited retention. The dashboard's time range applies only to its synthetic sample dataset and never implies a complete or permanent audit history.

## 8. Simulation model

### 8.1 Scenario catalog

The scenarios are scripted, not random, so reviewers can reproduce the same state.

| Scenario ID | Sequence / visible pattern | Demonstration purpose |
|---|---|---|
| `normal-rollout` | `Scheduled`, `Pulling`, `Pulled`, `Created`, `Started`, `SuccessfulCreate` | Normal flow across a Deployment, ReplicaSet and Pods |
| `image-pull-failure` | `Failed`, `ErrImagePull`, `ImagePullBackOff`, `BackOff` | Warnings repeated against a workload and container |
| `scheduling-pressure` | `FailedScheduling`, followed later by `Scheduled` | Time ordering and a change in a Pod's scheduling state |
| `container-health` | `Unhealthy`, `BackOff`, `Killing`, `Started` | Repeated observations and occurrence counts |
| `node-condition` | `NodeNotReady` or a node pressure warning, followed by recovery | Cluster-scoped records and filtering by object kind |

### 8.2 Playback controls

- The scenario selector loads the scenario's initial records and is visible in the shared header.
- Play schedules the next scripted step; pause halts new arrivals/updates while leaving current filters and rows untouched.
- Resume continues from the next script position instead of restarting.
- The event-rate control changes only the delay between simulated arrivals. It must never change Event timestamps or sequence order.
- Reset restores the selected scenario's initial fixture, removes generated records, resets the scenario cursor, and requires visible confirmation because it discards simulated state.
- Keep the active scenario name and paused/running status visible.
- Clean up scheduled timers when pausing, resetting, switching scenarios or unmounting. A paused simulator must not continue updating in the background.

### 8.3 Dataset composition and cap

- The initial dataset contains roughly **1,500–2,500 records** across several namespaces and resource kinds. This is a test-fixture size, not a claim about typical clusters.
- Stable IDs and seeded timestamps make expected results deterministic.
- Generated records enter the same in-memory collection as fixtures. All counts, charts and filtered results update from that store.
- Repeated Event series remain one record with an occurrence count and latest-observed time; do not display 50 occurrences as 50 distinct Events.
- Define the maximum in-memory record count as a single named constant. At the cap, stop appending and visibly explain that simulation has stopped; do not silently evict seed records or the selected record.

## 9. System architecture

The prototype runs entirely in the browser. No database or application server is needed because the dataset is synthetic and the simulator changes only local application state.

| Layer | Responsibility |
|---|---|
| Fixture repository | Versioned JSON fixtures with Normal and Warning Events, multiple namespaces, supported API versions and scenario steps/seeds |
| Normalization layer | Maps version-specific field names into the common record shape and preserves raw input |
| Event store | Holds loaded fixtures and simulated arrivals; provides stable IDs and is the single source for all views |
| Filter/query layer | Applies category filters, keyword search, time range and sorting in a defined order |
| Simulation engine | Schedules scripted scenario records and exposes start, pause, speed and reset actions |
| Presentation layer | Renders overview, table, selected record, charts, required states and exports |

### Data flow

Fixtures pass through the normalizer into the event store. All reads (table rows, summary counts, chart buckets and exports) use the shared query/filter layer and a view-model step. The simulator appends scripted arrivals or updates a logical series in that same store, allowing all views to update consistently.

### Implementation stack

Use a browser-based single-page application with React and TypeScript. JSON fixture files hold Event data. The approved build specification selects the charting and test libraries. Normalization and query logic must be independent of visual components so behavior can be tested directly against fixtures.

### Explicit absences

There is no server-side storage, backend, database, account system, telemetry or live Kubernetes API access. Reloading returns to the initial scenario unless persistence is separately approved, documented and implemented as a product-scope change.

## 10. Functional and quality requirements

### 10.1 Functional requirements

Priorities use **MUST** for the review demonstration and **SHOULD** for the submitted prototype, matching the original PRD.

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Load a versioned set of sample Kubernetes Event records at application start. | MUST |
| FR-02 | Display a paginated Event table with timestamp, namespace, type, reason, object, occurrence count and message. | MUST |
| FR-03 | Filter by namespace, type, reason, resource kind, resource name, reporter and time range. | MUST |
| FR-04 | Search reason, message, namespace, resource name and reporter case-insensitively. | MUST |
| FR-05 | Open a selected Event in a detail panel and show the raw JSON record. | MUST |
| FR-06 | Sort by supported table columns and keep sort order stable for ties. | MUST |
| FR-07 | Run, pause, change speed and reset a selected scenario. | MUST |
| FR-08 | Update summary metrics and analytics from the current dataset and time window. | MUST |
| FR-09 | Export the complete filtered result set in CSV and JSON formats. | SHOULD |
| FR-10 | Show active-filter chips and provide a one-action reset. | MUST |

### 10.2 Quality requirements

| Area | Requirement |
|---|---|
| Clarity | Every screen visibly identifies the data source as simulated. |
| Correctness | Filter results, counts, charts and exports use the same normalized dataset and follow the documented filter logic. |
| Responsiveness | At 1,500–2,500 records, common filter changes complete within 250 ms on the project test machine. |
| Accessibility | Controls have visible labels and keyboard focus, contrast is sufficient, and status is conveyed with text as well as color. |
| Resilience | Missing optional fields do not break the table or detail panel; invalid timestamps are flagged and excluded from time-based aggregation. |
| Privacy | No cluster credentials, personal data or external telemetry are collected. |

The 250 ms target is measured on the same development machine used for the project. It is a target until a benchmark has been run and recorded; do not describe it as measured before evidence exists.

## 11. Verification and acceptance

The project is evaluated on whether a user can complete inspection tasks and whether displayed results agree with the source data.

### 11.1 Core acceptance tests

| Test | Action | Expected result |
|---|---|---|
| TC-01 | Open the application with no filters. | Overview totals match the loaded dataset and the simulated-source label is visible. |
| TC-02 | Select Warning and one namespace. | Every row matches both conditions; the result count matches the rows. |
| TC-03 | Select two reasons in one filter. | Rows match either reason while all other filter categories still apply. |
| TC-04 | Search for text found only in an Event message. | The matching record appears regardless of letter case. |
| TC-05 | Set a custom time range. | Only records whose effective last-observed times fall within the range appear. |
| TC-06 | Open a record with a repeated series. | Occurrence count and latest-observed time are shown separately from first-observed time. |
| TC-07 | Pause and resume the simulator. | No records are appended while paused; the sequence continues after resume. |
| TC-08 | Reset a scenario after generated Events arrive. | Generated records are removed and the initial fixture is restored. |
| TC-09 | Export with active filters and multiple pages. | CSV and JSON include all filtered records, not only the visible page. |
| TC-10 | Load records with missing optional fields. | The page remains usable and missing fields are labelled accurately. |

### 11.2 Acceptance conditions

- **Filtering:** every filter combination follows the AND/OR rules. Table, counts, charts and exports use the same result set.
- **Simulation:** every scenario starts, pauses and resets reproducibly.
- **Inspection:** a selected row opens a detail panel showing normalized fields and original raw JSON.
- **Data accuracy:** timestamp fallbacks and occurrence counts follow the documented mapping; simulated data is never described as live.

### 11.3 Demonstration sequence

1. Start with **Normal rollout**.
2. Switch to **Image pull failure**.
3. Filter Warning Events in the `payments` namespace.
4. Search for the affected Pod.
5. Open its `BackOff` record.
6. Inspect occurrence count and raw JSON.
7. View the Warning distribution and export the filtered result.
8. Demonstrate the simulator speed control during the same run.

### 11.4 Unit-test expectations

Unit tests must cover both API-shape normalizers, timestamp selection and fallback cases, filter rules, AND/OR combinations, stable sorting, pagination reset, aggregation, and export behavior. Simulator tests must cover fixed sequence order, play/pause/resume, repeated-series identity and count updates, reset, and timer cleanup. Browser acceptance tests should automate TC-01 through TC-10.

## 12. Upstream boundary

The academic deliverable is the simulated dashboard. Dashboard screens, charts, simulator, fixtures and visual interactions remain in this repository. The dashboard itself is not a Kubernetes control-plane feature and is not to be submitted as a feature of `kubectl`.

### Candidate for maintainer discussion

The original PRD proposes evaluating whether `kubectl events` should expose a field-selector option that passes supported Event field selectors to the API request, with validation and tests for supported fields. This is a discussion candidate, not an accepted enhancement or a guaranteed pull request. The exact flag design and API-version behavior require SIG CLI review before any upstream code is written.

### Questions before any possible PR

1. Does the current command implementation support the same Event API versions as the field-selector documentation, and how are selector names handled across versions?
2. Should selector support be added to `kubectl events`, or should users continue using the generic `kubectl get events` path?
3. Would client-side time-range filtering after listing be useful, given that Event timestamps are not a general server-side selector?
4. What tests and documentation would SIG CLI expect?

### Contribution sequence

Prototype the workflow and gather evidence; bring the evidence to SIG CLI; agree on one focused code change; then contribute tests, documentation and a pull request if maintainers support it. Keep the dashboard deliverable independent if the upstream idea is rejected or deferred.

## 13. Delivery plan and risks

### 13.1 Stages and exit conditions

| Stage | Work | Exit condition |
|---|---|---|
| 1. Data foundation | Fixtures, normalization for both Event API shapes and timestamp handling | Fixture set loads and mapping tests pass |
| 2. Explorer | Event table, search, filters, sorting, pagination and detail panel | Core filtering and inspection tests pass |
| 3. Simulator | Repeatable scenarios, play, pause, speed and reset | Scenario sequences run consistently |
| 4. Overview and analytics | Summary metrics, volume chart, reason and namespace breakdowns | Charts agree with filtered-data calculations |
| 5. Export and finish | CSV/JSON export, empty states, accessibility checks and responsive layout | Acceptance tests pass and demonstration is repeatable |
| 6. Upstream exploration | Review current command source and discuss the candidate with SIG CLI | One contribution question is agreed or formally deferred |

### 13.2 Risks and responses

| Risk | Effect | Response |
|---|---|---|
| Event API field differences | Records may render incorrectly or lose context. | Preserve raw fixtures, test both API shapes and centralize normalization. |
| Timestamp ambiguity | Sorting and time filters may imply false precision. | Document timestamp priority and label fallbacks. |
| Repeated Event series | Counts may be mistaken for separate records. | Represent occurrence count and last-observed time as separate fields. |
| Simulated data mistaken for live data | Reviewers may read sample activity as cluster output. | Use a persistent simulated-data label and show the active scenario. |
| Upstream scope rejected | Dashboard may not lead to the hoped-for Kubernetes PR. | Keep the academic deliverable independent; seek SIG CLI feedback before coding upstream. |
| Dataset grows during simulation | Filter and chart updates may slow down. | Cap the in-memory dataset and test at the stated volume. |

### Expected outcome

A reviewer can load a Kubernetes-shaped Event dataset, reproduce a failure scenario, filter the records, inspect an Event in detail and read a summary of the same data. Separately, the upstream exploration identifies whether a small `kubectl events` change is worth proposing to SIG CLI.

## 14. References

The original PRD states that the Kubernetes-specific claims below were checked against the official command reference, API reference, field-selector documentation and KEP-1440 on 31 October 2026. References provide context for Kubernetes behavior; dashboard screens, scenario scripts, filter combinations, performance targets and acceptance tests are proposed project requirements, not existing Kubernetes features.

1. Kubernetes documentation, [`kubectl events`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/) — command synopsis and options, including `--for`, `--types`, `--watch`, namespace selection and chunked list retrieval.
2. Kubernetes Enhancements, KEP-1440, **“kubectl events”** — motivation and history for the dedicated command, including prior requests around watch behavior, sorting, custom columns and time-window views.
3. Kubernetes documentation, [Field Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/field-selectors/) — supported Event field selectors, including object-reference fields, reason and type.
4. Kubernetes API reference, [Event, `events.k8s.io/v1`](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/) — `eventTime`, `regarding`, `note`, `reportingController`, `EventSeries.count` and `EventSeries.lastObservedTime`; Events' best-effort and limited-retention nature.
5. Kubernetes API reference, Event, `core/v1` — `involvedObject`, `message`, `eventTime`, `firstTimestamp`, `lastTimestamp` and `count`.
6. Kubernetes issue [#29838](https://github.com/kubernetes/kubernetes/issues/29838), **“kubectl get events doesn't sort events by last seen time”** — historical context; opened 1 August 2016, closed and linked to PR #99557.

**Review status:** Proposed PRD v1.0. Product scope is defined for mentor review. The upstream contribution candidate remains subject to discussion with SIG CLI.

## 15. Implementation clarifications where v1.0 is silent

The original PRD intentionally leaves some low-level defaults unspecified. The current repository instructions (`AGENTS.md`) define the following defaults so implementation and tests behave deterministically. They are implementation conventions, not claims about Kubernetes behavior.

- **Default time selection:** use **All available** initially and after Clear all so initial totals can be compared directly with the loaded dataset.
- **Relative time presets:** provide 15 minutes, 1 hour, 6 hours and 24 hours, plus a custom range. Start/end are inclusive; custom ranges are evaluated internally in UTC and displayed with local timezone information.
- **Deterministic simulator clock:** anchor relative ranges to the scenario clock, not `Date.now()`. Initialize the clock from the latest valid effective last-observed timestamp in the loaded fixture unless a scenario manifest defines a start time. Advance it only with valid scripted arrival timestamps and freeze it while paused.
- **Reporter filter implementation:** match against the normalized reporter value. Populate dropdown choices from available values; where a text field is used, apply the same defined matching semantics consistently.
- **Playback speed choices:** default to 1x; provide 0.5x, 1x, 2x and 4x unless a later approved product decision changes them. Speed changes arrival delays only.
- **In-memory cap:** define `MAX_IN_MEMORY_EVENTS` once; proposed default is 10,000 normalized records. At the cap, pause visibly rather than evicting seed records or the selected record.
- **Missing count semantics:** preserve a missing or invalid occurrence count as `null` and communicate its status. Do not infer a count of 1 when the source value is absent.
- **Reset behavior:** restore the scenario fixture and remove generated records, reset the simulator cursor, close the selected detail and return pagination to page one. Preserve active query filters unless the product specification is explicitly amended to choose otherwise.
- **Stable ties:** preserve original store order for equal sort keys, with stable ID as a deterministic fallback when original order is unavailable.
- **No implicit persistence:** reload starts from the initial scenario. Any future persistence would require an explicit scope change and README documentation.

If an implementation detail not covered here affects product behavior materially, do not silently invent a rule. Record the ambiguity and resolve it through an explicit product-specification update.
