# Kubernetes Events Explorer

A read-only dashboard for inspecting and filtering Kubernetes `Event` objects observed from one or more clusters.

The server lists and watches Events, keeps a bounded in-memory view of what it observed, and answers every query from that view. The browser holds only query state. Nothing in this product writes to a cluster, and nothing is stored durably.

> **Coverage, not history.** Kubernetes keeps Events for about one hour. The dashboard shows only the Events it has observed since it started, and every data screen says so.

## Status

The read path, API, browser client, export, live updates, optional OIDC team mode, container image and Helm chart are implemented.

Verified in this repository: lint, typecheck, unit tests with coverage floors, production build, bundle budget, the 100,000-record domain benchmark, the integration suite and both browser suites against a disposable kind cluster, and a container image running in kind with only the chart's namespaced `Role`. The browser suite skips one invalid-timestamp case that the Kubernetes API refuses to store; unit tests cover that path.

## Deployment modes

- **Local mode:** the server reads a kubeconfig, observes the selected contexts and binds to `127.0.0.1` with no login.
- **In-cluster mode:** the server runs with a ServiceAccount, uses its token and CA, and lists and watches only the namespaces named in `EVENTS_WATCH_NAMESPACES` (the chart grants a namespaced read-only `Role` for each).
- **Team mode:** OIDC login with per-cluster and per-namespace grants, enabled by `EVENTS_AUTH_MODE=oidc`.

See `docs/SPEC.md` for product behavior, `docs/ARCHITECTURE.md` for the design, `docs/SECURITY.md` for the security model, `docs/ACCESSIBILITY.md` for the WCAG 2.2 AA review and `docs/OPERATIONS.md` for deployment.

## Requirements

- Node.js 24 LTS (`.nvmrc`)
- pnpm 12 (declared in `package.json`)
- Optional: Docker and kind for the integration and browser gates

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs the server with `tsx watch` and the Vite dev server, which proxies `/api`, `/auth`, `/healthz` and `/readyz` to `http://127.0.0.1:8080`. The server observes the current kubeconfig context unless `EVENTS_CONTEXTS` is set.

To run the built UI from the server instead:

```bash
pnpm build
EVENTS_CONTEXTS=kind-k8s-events node --import tsx packages/server/src/main.ts
```

## In-cluster install

```bash
helm upgrade --install events deploy/helm/k8s-events-explorer \
  --namespace events-explorer --create-namespace \
  --set image.tag=0.2.0 \
  --set watchNamespaces={events-explorer}
```

`watchNamespaces` defaults to the release namespace. No `ClusterRole` is created; see `docs/OPERATIONS.md` for OIDC team mode and cluster-wide setups.

## Packages

| Package | Contents |
|---|---|
| `packages/domain` | Normalization, timestamps, filters, sort, pagination, aggregation, CSV/JSON formatting. No React, Node or UI imports. |
| `packages/server` | Configuration, Kubernetes connector, ingest loops, bounded stores, query service, HTTP API, SSE, export, OIDC team mode |
| `packages/web` | React client, shared query state, screens, detail panel and styles |

## API

| Route | Purpose |
|---|---|
| `GET /api/clusters` | Observed clusters with status, source, observation start and record counts |
| `GET /api/events` | One page of normalized records for the shared query |
| `GET /api/events/:id` | One record with its untouched `rawEvent` |
| `GET /api/summary` | Overview metrics, breakdowns and time buckets for the same query |
| `GET /api/options` | Available namespaces, reasons, kinds and reporters |
| `GET /api/export?format=csv\|json` | Every filtered record, across all pages |
| `GET /api/stream` | Server-sent `update` and `summary-tick` signals |
| `GET /healthz`, `GET /readyz` | Liveness and readiness |

The table, counts, Overview, Analytics, chart selections and exports all read the same server-side query. Filtering is never re-implemented in the browser.

## Verification

```bash
pnpm verify            # lint, typecheck, coverage, build, bundle gate
pnpm test:integration  # needs kind, seeded with scripts/seed-events.ts
pnpm test:e2e          # needs kind and Playwright browsers
```

Integration and browser setup:

```bash
scripts/kind/create.sh
pnpm exec tsx scripts/seed-events.ts --clean
EVENTS_E2E_CONTEXT=kind-k8s-events pnpm test:integration
EVENTS_E2E_CONTEXT=kind-k8s-events pnpm test:e2e
scripts/kind/delete.sh
```

Current gate results are recorded in `CHANGELOG.md`.

## Benchmark

```bash
pnpm bench
```

Builds 100,000 deterministic Event records in code and measures filtering, search, bounded time ranges, sorting, the summary and CSV formatting. Results go to `bench/results.json` and are recorded in `docs/OPERATIONS.md`. This is a domain-level benchmark, not a browser rendering measurement.

## Documentation

- `docs/SPEC.md` - product specification and exact UI copy
- `docs/ARCHITECTURE.md` - read path, query path and memory model
- `docs/SECURITY.md` - read-only guarantees, credentials, authorization
- `docs/ACCESSIBILITY.md` - WCAG 2.2 AA review, fixes and known limitations
- `docs/OPERATIONS.md` - configuration, deployment and troubleshooting
- `BUILD_SPEC.md` - toolchain, coverage floors, CI, image publishing and phases
- `AGENTS.md` - repository rules for contributors and coding agents
- `CHANGELOG.md` - changes and recorded gates

## License

Apache-2.0. See `LICENSE`.
