# Kubernetes Events Explorer - Product Specification

**Status:** Approved for v0.2.0
**Supersedes:** Technical Specification v1.0 (browser-only simulated dashboard)
**Companion:** `PRD.md` for product rationale and decisions D1 to D7

---

## 1. Purpose and non-goals

The product lets a developer inspect, filter and follow Kubernetes `Event` objects observed from one or more clusters. A read-only server keeps a bounded in-memory view of recent Events; the browser filters and compares that view.

The product is not a diagnostic engine. A Kubernetes Event is best-effort supplemental information with short retention. Nothing in the product may state or imply that an Event proves why a workload failed, and no view may be described as a complete, permanent or auditable history.

Out of scope: write access of any kind, durable storage, alerting, metrics scraping, log viewing, automatic diagnostics, simulated data, and the upstream `kubectl events` proposal.

## 2. Invariants

1. The server only performs `get`, `list` and `watch` on Events.
2. Kubeconfig contents, tokens and certificate data never reach the browser or a log line.
3. Every Event shown was observed from a cluster; the product contains no fixtures, generated records or random data.
4. Every data-bearing screen shows the cluster name, the source (`local` or `in-cluster`) and the observation start time.
5. The UI uses neutral wording: recorded, reported, observed.
6. Missing values read `Not supplied`; malformed supplied values read `Invalid value`. The clock is never substituted.
7. First-observed and last-observed times are separate fields; invalid last-observed times are excluded from bounded ranges and time buckets and the UI says so.
8. A series is one record; `series.count` and `count` are fields, never repeated rows.
9. `rawEvent` is immutable and is what JSON export returns.
10. Table rows, counts, metrics, analytics, chart selections and exports all derive from one server-side query function.
11. Authorization is enforced on the server, including export and SSE.
12. Memory is bounded per cluster; eviction is visible.
13. The browser stores no application data.

## 3. Data contract

`NormalisedEvent` is defined in `packages/domain/src/types.ts` and includes `clusterId`, `clusterName`, `source` and the untouched `rawEvent`.

| Normalized field | `events.k8s.io/v1` | core `v1` |
|---|---|---|
| Object reference | `regarding` | `involvedObject` |
| Message | `note` | `message` |
| Reporter | `reportingController` | reporting fields, then `source.component` |
| First observed | `eventTime` | `eventTime`, then `firstTimestamp` |
| Last observed | `series.lastObservedTime` | `lastTimestamp` |
| Occurrence count | `series.count` | `count` |
| Creation fallback | `metadata.creationTimestamp` | `metadata.creationTimestamp` |

Rules:

- `id` is `${clusterId}/${uid}`. Without a UID it is `${clusterId}/${namespace}/${kind}/${name}/${index}` and a validation issue is recorded.
- A present but invalid higher-priority timestamp yields `null` and an invalid flag; it is not replaced by a lower-priority field or by the current time.
- A count is accepted only as a positive integer. Missing and malformed counts are preserved as distinct states: `Not supplied` and `Invalid value`.
- Event namespace comes from Event metadata; `object.namespace` is the referenced object's namespace and is never substituted for it.
- A malformed record is isolated; other records remain usable and its raw source stays inspectable.

## 4. Observation model

- Each cluster has one list-and-watch loop per observed namespace, or one cluster-wide loop when `EVENTS_WATCH_NAMESPACES` is unset. Each loop tracks its own `resourceVersion`. `410 Gone` triggers a re-list that replaces only that scope's records, then the watch resumes.
- Connection loss reconnects with exponential backoff from 1 second to 60 seconds with 20% jitter; backoff resets after 60 seconds of healthy watching.
- `observationStartedAt` is set when the first successful list completes and is not reset by later re-lists.
- Cluster status is `connecting`, `live`, `degraded` (one watched namespace is reconnecting or unreadable while another is live, or a watched scope is between reconnects), `auth-failed` (HTTP 401 or 403 with no readable namespace) or `unreachable`.
- A response is `partial` when any covered cluster is not `live`.
- Records are capped per cluster (`EVENTS_CACHE_MAX_PER_CLUSTER`, default 100,000). At the cap the oldest last-observed records are evicted in batches of 1% of the cap and `evictedCount` is reported.
- A `MODIFIED` Event replaces the record with the same `id`; it does not add a row.
- Queries are unbounded in time by default; relative ranges are anchored to the server's `serverTime`.

## 5. Query semantics

| Filter | Rule |
|---|---|
| Namespace | Exact match on Event metadata namespace; OR within the category |
| Type | Exact `Normal`/`Warning`; OR within; both selected equals no restriction |
| Reason | Exact reason; OR within |
| Resource kind | Exact `object.kind` |
| Resource name | Case-insensitive substring of `object.name` |
| Reporter | Exact normalized reporter |
| Time range | Effective last-observed time; bounded ranges exclude records with invalid timestamps |
| Keyword | Trimmed, case-insensitive substring over reason, message, object name, Event namespace and reporter |

- Categories combine with AND.
- `from` and `to` are inclusive UTC instants and are mutually exclusive with `range`.
- Default sort is newest effective last-observed first; sortable fields are first observed, last observed, namespace, type, reason, object name and occurrence count. Missing values sort last. Ties keep store order, then `id`.
- Page size defaults to 50 and is capped at 200; a larger request is rejected with HTTP 400.
- Chart selections apply the equivalent filters in the Explorer, including inclusive bucket bounds.

## 6. Screens

**Header:** brand, section tabs, cluster selector, user menu in team mode, connection summary.

**Observation banner (all data screens):** per selected cluster, the source, observation start in local time with timezone, status, the retention note, and an eviction notice when `evictedCount > 0`.

**Overview:** total records in range, Warning count, Normal count, namespaces represented, volume over time, most common reasons, recent Warnings that open the detail panel, and `recordedOccurrences` as a separate field. Invalid-timestamp exclusions are stated.

**Explorer:** search, time range, namespace and type checkboxes, more filters (reason, kind, object name, reporter), applied-filter chips with removal, result count, CSV and JSON export, the event table (timestamp, cluster, namespace, type, reason, object, count, message) and pagination.

**Detail panel:** type, reason, message, action, namespace, cluster, referenced object, reporter, first observed, last observed with source label and validity, occurrence count with status, validation issues, and the raw JSON. It is a modal dialog that traps focus, closes on Escape and returns focus to the originating row.

**Analytics:** volume by time bucket, Normal/Warning split, top reasons and namespace distribution, each with a text summary table and per-row action buttons that apply the filter and open the Explorer.

## 7. Required states

- `loading`: local UI assets or the first query are loading. No live-cluster connection claim.
- `populated`: normal data view.
- `no results`: shows the active filters and a Clear action.
- `no events observed yet`: the observation started but no Events arrived.
- `cluster unreachable`, `auth failed`, `forbidden scope`: distinct, readable states that do not present totals as complete.
- `invalid record`: isolates the malformed record and keeps the page usable.
- `partial`: at least one covered cluster is not `live`.

## 8. Product copy

### 8.1 Source label

`Live: <clusterName> (<source>)`. One label per cluster.

### 8.2 Observation start

`Observing since <local time> (<timezone>)`, using `Intl.DateTimeFormat` in the browser's timezone with the timezone abbreviation.

### 8.3 Empty dataset

Title: `No Events observed yet`

Body: `This view has started observing the selected clusters but has not received any Events. Kubernetes keeps Events for about one hour, so quiet clusters can show few or no records.`

### 8.4 Retention note (exact text)

`Kubernetes keeps Events for about one hour. This view shows only Events observed by this dashboard since the time above. It is not a complete history.`

### 8.5 Words to avoid

Do not use "complete", "full history", "audit", "permanent", "root cause", "caused by", "explains", "proves", "diagnosis" or "incident report" in UI copy, documentation or tests.

## 9. Accessibility

- Semantic landmarks, heading order, labeled controls and a real table with headers.
- Every control is keyboard operable with a visible focus indicator.
- Status, type, selection and validity are never communicated by color alone.
- Chart data is available as a table; chart actions have keyboard-operable equivalents.
- Result-count changes after a filter change are announced politely; streaming updates are not.
- `prefers-reduced-motion` is respected.
- Narrow layouts keep filters, fields, source labels and detail access; only the table scrolls horizontally.

## 10. Exports

- CSV and JSON exports contain the complete filtered, sorted result, not the visible page.
- CSV escapes commas, quotes and line breaks and neutralizes values beginning with `=`, `+`, `-` or `@`.
- JSON preserves source record shapes from `rawEvent`.
- Exports stream from a store snapshot taken at request start, set `Content-Disposition`, and report the snapshot time in `X-Snapshot-At`.
- Requests above 1,000,000 records return HTTP 413.

## 11. Live updates

`GET /api/stream` returns `text/event-stream` for the current filters.

- `update` messages carry changed matching records so a client can show that something arrived; `summary-tick` messages carry only `serverTime` and a `partial` flag every 5 seconds.
- Counts are never taken from the stream. On any stream signal the client re-queries `/api/events` and `/api/summary` with its current query, so table rows, totals and charts always come from the one server-side query path.
- Each message has an `id`; only the last 1,000 messages per stream are retained. A resume older than that yields `resync` and the client re-queries.
- A scope change closes the stream with `forbidden`.
- Limits: 50 concurrent streams per user and 500 total; above that, HTTP 429.

## 12. Authorization

- Local mode has no login and binds to the loopback interface.
- Team mode uses OIDC authorization code flow with PKCE, a session cookie that is HTTP-only, encrypted and `SameSite=Lax`, and validates signature, `iss`, `aud`, `exp` and `nonce`.
- A configurable claim maps to roles; roles map to `{clusterId, namespaces}` grants in `EVENTS_RBAC_FILE`.
- A user with no grant sees nothing. A request for an unauthorized cluster returns 403 without revealing whether the cluster exists.
- Scope is applied before any filter in every read path, including counts, summary, export and SSE.

## 13. Acceptance criteria

| ID | Action | Expected result |
|---|---|---|
| E2E-01 | Open the app with one cluster | Banner shows cluster name, source and observation start; Overview totals equal the summary endpoint |
| E2E-02 | Select Warning and one namespace | Every row matches both; result count equals the exported row count |
| E2E-03 | Select two reasons | Either reason matches; other filters still apply |
| E2E-04 | Search mixed-case message text | The matching record appears |
| E2E-05 | Set a custom UTC range | Only valid last-observed records in range appear; an invalid-time record is excluded |
| E2E-06 | Open a repeated series | First observed, last observed with source, and count are separate fields |
| E2E-07 | Open a record with missing fields | Page stays usable; missing values read `Not supplied` |
| E2E-08 | Export CSV and JSON across pages | Row counts equal the result count; JSON matches the API `rawEvent` shape |
| E2E-09 | Click an Analytics chart segment | Explorer opens with the equivalent filter and matching count |
| E2E-10 | Keyboard-only filter, open detail, Escape | Focus returns to the row |
| E2E-11 | Open with an unreachable cluster | Status reads `unreachable`; partial notice visible; totals are not presented as complete |
| E2E-12 | Team mode user without a cluster grant | Cluster is not listed; API and export return 403 |
| E2E-13 | Observe all requests | No request to an external origin |
| E2E-14 | Reduced motion preference | No animated transitions run |

## 14. Implementation decisions

| # | Topic | Decision |
|---|---|---|
| O1 | Served UI | Server serves the built UI in production; Vite proxies `/api` in development |
| O2 | Test data | Tests create real Events in kind; unit tests build objects inline |
| O3 | Clock | Relative ranges anchor to `serverTime`; every response includes it |
| O4 | Deployment | `ghcr.io` container image; Helm chart in P3; no GitHub Pages |
| O5 | Cache | 100,000 records per cluster, configurable |
| O6 | Identity provider | Keycloak in docker-compose for development and CI; provider-neutral OIDC |
| O7 | Retention copy | Exactly section 8.4 |
| O8 | Backend | TypeScript on Node.js 24 LTS |
| O9 | Layout | pnpm workspaces: `packages/domain`, `packages/server`, `packages/web` |

## 15. Change from the v1.0 specification

The v1.0 specification described a browser-only dashboard over synthetic fixtures with a scripted simulator. That data path is removed: the product now requires a server that observes real clusters, and no screen may present synthetic data. The normalized field contract, filter semantics, sort rules, pagination size and export formatting carry over; the time anchor, cluster identity, bucket labels and ID scheme are revised as described above.

The v1.0 phrase "records that explain an incident" is withdrawn; it conflicts with the same document's limitation that Events do not establish cause.
