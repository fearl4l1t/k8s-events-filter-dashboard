# AGENTS.md - instructions for AI coding agents and IDEs

**Project:** Kubernetes Events Explorer
**Repository:** `k8s-events-filter-dashboard`
**License:** Apache-2.0
**Product mode:** Live, read-only Kubernetes Event observation through a server component

Read this file, `docs/SPEC.md` and `BUILD_SPEC.md` before editing code. Where they disagree, the order is: the user's latest explicit instruction, `docs/SPEC.md`, this file, `BUILD_SPEC.md`, then existing implementation.

---

## 1. Non-negotiable rules

1. **Read-only.** The server performs only `get`, `list` and `watch` on Events. It never creates, updates, patches or deletes any Kubernetes resource, including behind a flag.
2. **No credentials in the browser.** Kubeconfig contents, tokens, key material and CA data never leave the server. Never return, log, export or place them in a URL.
3. **Live data only.** Every Event shown came from a cluster the server observed. No fixtures, generated records, seeded scenarios or random data appear in the product.
4. **Say what is covered.** Every data-bearing screen shows the cluster name, the source (`local` or `in-cluster`) and the observation start time. Never describe the view as complete, permanent or an audit history.
5. **No diagnosis.** Never state or imply that an Event proves why a workload failed. Use "recorded", "reported" and "observed".
6. **Missing values read `Not supplied`. Invalid values read `Invalid value`.** Never substitute the current time or any other value.
7. **First-observed and last-observed times are separate fields.** Invalid last-observed times are excluded from bounded time ranges and time buckets, and the UI says so.
8. **One series is one record.** Never expand `series.count` or `count` into multiple rows.
9. **`rawEvent` is immutable.** Normalization, filtering, sorting, aggregation and rendering never mutate it. The API returns the source record, not a normalized schema.
10. **Every visible result comes from one query.** Table rows, result counts, overview metrics, analytics, chart selections and exports call the same server-side query function with the same filters.
11. **Authorization is enforced on the server.** Hidden UI controls are not a security boundary. Every endpoint, including export and SSE, applies the caller's scope before reading records.
12. **Bounded memory.** The server caps records per cluster. At the cap the oldest records are evicted and the eviction is visible in the UI and in the API response.
13. **No browser persistence.** No `localStorage`, `sessionStorage`, `IndexedDB` or cookies for application data. A session cookie is permitted only for team-mode login.
14. **No third-party runtime origins.** The UI loads only from its own origin. No CDN, remote font, analytics script or external data request.
15. **No upstream Kubernetes code.** The `kubectl events` proposal is out of scope for this repository.
16. **SPDX headers.** Every new TypeScript, JavaScript, YAML and shell file starts with the file-appropriate form of `SPDX-License-Identifier: Apache-2.0` and `Copyright 2026 Lalit Krishna and contributors`.
17. **No emoji** in source, documentation, tests or UI copy.
18. **Dependencies are pinned exactly.** No `^` or `~` in `package.json`. Commit `pnpm-lock.yaml`. A new dependency requires approval and a `CHANGELOG.md` entry.

## 2. Source and scope control

- `docs/SPEC.md` holds the approved product behavior. `BUILD_SPEC.md` holds toolchain, tests, CI and publishing.
- Do not reintroduce fixtures, a simulator, scenario scripts or random data in product code.
- Do not add a database, server-side history, alerts, notifications, metrics scraping or log viewing.
- Do not change the retention note wording in `docs/SPEC.md` section 8.4.
- Do not add a dependency, change the stack, add persistence, add write access, or change the deployment target without recording the conflict and asking.

## 3. Repository layout

```text
k8s-events-filter-dashboard/
├── AGENTS.md
├── BUILD_SPEC.md
├── README.md
├── CHANGELOG.md
├── LICENSE
├── package.json                 pnpm workspace root
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.js
├── scripts/
│   ├── benchmark.ts
│   ├── check-bundle-size.mjs
│   ├── kind/                    cluster creation script
│   └── seed-events.ts           creates real Events through the API for tests
├── docs/
│   ├── PRD.md
│   ├── SPEC.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── ACCESSIBILITY.md
│   └── OPERATIONS.md
└── packages/
    ├── domain/                  pure TypeScript; no React, Recharts, Node, server or UI imports
    ├── server/                  connection, ingestion, store, query, API, auth, health
    └── web/                     React client
```

The domain package is the single implementation of normalization, filtering, sorting, pagination, aggregation and export formatting. The server calls it; the web client does not reimplement it.

## 4. Data contract

```ts
export type NormalisedEvent = {
  id: string;                 // `${clusterId}/${uid}`, or a deterministic derived ID
  clusterId: string;          // kubeconfig context name, or `in-cluster`
  clusterName: string;
  source: 'local' | 'in-cluster';
  apiVersion: 'events.k8s.io/v1' | 'v1';
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
  timestampSource: { first: TimestampSource; last: TimestampSource };
  timestampValid: boolean;
  validationIssues: string[];
  rawEvent: unknown;          // untouched source record
};
```

Field mapping for `events.k8s.io/v1`: object reference from `regarding`, message from `note`, reporter from `reportingController`, first observed from `eventTime`, last observed from `series.lastObservedTime`, count from `series.count`.
Field mapping for core `v1`: object reference from `involvedObject`, message from `message`, reporter from reporting fields then `source.component`, first observed from `eventTime` then `firstTimestamp`, last observed from `lastTimestamp`, count from `count`.

Rules:

- A higher-priority timestamp field that is present but invalid produces `null` and an invalid flag. It is never replaced by a lower-priority field or by the clock.
- `metadata.creationTimestamp` is a marked fallback, not an occurrence time.
- IDs are reproducible. A missing UID yields `${clusterId}/${namespace}/${kind}/${name}/${index}` plus a validation issue.
- A malformed record must not break other records. Preserve its raw source for inspection.

## 5. Query semantics

`packages/domain/src/filters.ts`, `sort.ts`, `paginate.ts` and `aggregate.ts` are the only implementations of these rules.

- Namespace, type and reason are exact matches; multiple values within a category are OR. Different categories are AND.
- Resource kind is exact against `object.kind`; resource name is a case-insensitive substring of `object.name`; the reporter is an exact match.
- Keyword search is a trimmed, case-insensitive substring over reason, message, object name, Event namespace and reporter.
- Time bounds use the effective last-observed time and are inclusive. A record with a missing or invalid last-observed time is excluded whenever a bound is set.
- Relative ranges (`15m`, `1h`, `6h`, `24h`) are anchored to the server's `serverTime` at request time and never to the record or browser clock.
- Default sort is newest last-observed first. Missing values sort last in either direction. String comparison is locale-independent; ties keep store order, then `id`.
- Pagination defaults to 50 records and is capped at 200 per request.

## 6. Server responsibilities

- Configuration is validated at startup; an unusable combination exits non-zero with the reason.
- Each cluster has one list-and-watch loop per watched namespace (`EVENTS_WATCH_NAMESPACES`), or one cluster-wide loop when unset. Each loop tracks its own `resourceVersion`, re-lists on `410 Gone` and backs off with jitter. Per-namespace and per-cluster failures never stop other loops; partial coverage reports `degraded`.
- One in-memory store per cluster keyed by logical Event ID, with snapshots handed to the query service; filters run over a snapshot, never over a mutating map.
- Cluster status is `connecting`, `live`, `degraded`, `auth-failed` or `unreachable`.
- `partial` is true when any covered cluster is not `live`; the UI must present that as incomplete coverage.
- Every error returns `{ "error": { "code": "...", "message": "..." } }` with a stable code and no stack trace or credential.
- Logs are structured JSON to stdout with credential redaction. Record messages are never logged at `info`.

## 7. Verification

Work through the phases in `BUILD_SPEC.md` section 13 in order and pass each gate before starting the next. Do not claim a check passed unless it was run and observed.

- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, `pnpm check:bundle` are the local gate.
- `pnpm verify` runs them in sequence.
- Integration and browser tests require a kind cluster; if kind, Docker or a cluster is unavailable, report that the gate was not executed rather than implying success.
- Never weaken an assertion or skip a check to make a gate appear green.

## 8. Wording

Use "recorded", "reported", "observed". Do not use "complete", "full history", "audit", "permanent", "root cause", "caused by", "explains", "proves", "diagnosis" or "incident report" in UI copy, documentation or tests.

## 9. When to stop and ask

Stop before changing product scope, adding a runtime dependency, changing the stack, introducing persistence or network access, changing the exported source shape, changing Event identity semantics, adding write access, or altering the deployment target. State the conflict and the least invasive option.
