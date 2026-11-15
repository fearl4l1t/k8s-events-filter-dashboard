# Changelog

All notable changes to the Kubernetes Events Explorer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Changed

- Product scope changed from a browser-only dashboard over synthetic fixtures to a read-only server that observes live Kubernetes Events. No screen may present simulated data.
- Repository converted to a pnpm workspace with `packages/domain`, `packages/server` and `packages/web`; `package-lock.json` replaced by `pnpm-lock.yaml`.
- Domain events now carry `clusterId`, `clusterName` and `source`, and IDs are `${clusterId}/${uid}` (or a deterministic derived ID when the UID is absent).
- Relative time ranges are anchored to an explicit server `anchorTime`; the fallback to the event's own timestamp is removed.
- Time-bucket labels use UTC starts, include seconds for sub-minute buckets, and are unique within a result.
- Sort comparison is locale-independent code-unit ordering with store-order and ID tie-breaks.
- Export helpers accept any iterable so the server can supply a cursor over a snapshot.
- `AGENTS.md`, `BUILD_SPEC.md` and `docs/SPEC.md` rewritten for the live read-only product, including the retained retention wording.

### Fixed

- Accessibility defects found by the WCAG 2.2 AA review in `docs/ACCESSIBILITY.md`: a missing `h1` and skipped heading levels, no skip link, `aria-label` on unnamed `div` containers, `aria-label` values that overrode visible labels, and contrast ratios below 4.5:1 for muted text, secondary text on hovered rows, danger text and selected rows.
- The browser page title named the retired product; it now reads "Kubernetes Events Explorer".

### Removed

- Simulator, scripted scenarios, in-memory seed store, fixture JSON files and the simulated-data banner.
- Fixture generation and validation scripts, simulator and store unit tests, and the simulator-driven Playwright suite.
- CircleCI configuration and the GitHub Pages deployment workflow.
- The 500 KiB static-site bundle budget, replaced by a 300 KiB initial-JavaScript budget for the server-hosted UI.

### Added

- Namespace-scoped ingestion: `EVENTS_WATCH_NAMESPACES` runs one list-and-watch loop per namespace, so the chart's namespaced `Role` is sufficient. A partial failure reports `degraded` with the failing namespace's error instead of hiding healthy namespaces.
- `packages/server`: validated configuration, kubeconfig and in-cluster connectors, list-and-watch ingestor with `410` re-list and capped backoff, bounded per-cluster store with visible eviction, single query service, HTTP API, SSE signals, streaming CSV/JSON export and optional OIDC team mode.
- `packages/web`: typed API client, shared query state, observation banner, cluster selector, server-paged Explorer, server-summary Overview and Analytics, detail panel fetched by ID, and the loading, empty, no-results and error states.
- Kubernetes access uses Node built-ins (`node:https` with CA, client certificate and bearer token, plus an exec credential provider) instead of a Kubernetes client library.
- `yaml@2.9.1` for kubeconfig and RBAC parsing; `tsx` runs the TypeScript server on Node 24.
- `@playwright/test` and `jsdom` for the browser gate and DOM-based hook tests.
- `scripts/kind/create.sh`, `scripts/kind/delete.sh` and `scripts/seed-events.ts`, which creates real Events through the Kubernetes API in the disposable kind cluster.
- `tests/integration` read path against a seeded kind cluster, `tests/e2e` Playwright acceptance suite, `tests/e2e/team` OIDC team-mode suite with `playwright.team.config.ts`, and their CI steps.
- `packages/server/Dockerfile` (multi-stage, non-root, read-only root filesystem), the Helm chart in `deploy/helm/k8s-events-explorer` with a read-only `Role`/`RoleBinding` per watched namespace and an optional `Ingress`, `publish-image.yml` with provenance and SBOM, and a Keycloak compose file for team-mode development.
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/OPERATIONS.md` and the WCAG 2.2 AA review in `docs/ACCESSIBILITY.md`.

### Recorded gates

Verification on 14 November 2026, Node 24.21.0, pnpm 12.9.0:

- `pnpm lint`: pass, zero warnings.
- `pnpm typecheck`: pass for the root scripts, tests and all three packages.
- `pnpm test:coverage`: domain 96.31% lines / 91.68% branches (floor 95/90); server 91.18% lines / 82.78% branches (floor 85/80); web 66.28% lines / 50% branches (floor 60/50). 56 domain, 176 server and 39 web tests pass.
- `pnpm build`: pass.
- `pnpm check:bundle`: 173.22 KiB gzip for the initial JavaScript graph against the 300 KiB limit.
- `pnpm bench`: 100,000 deterministic records, p95 2.25 ms namespace/type filter, 17.80 ms keyword search, 27.83 ms bounded time range, 6.89 ms summary, against the 250 ms target.
- Server smoke test with an unreachable cluster: `/healthz` 200, `/readyz` `{"ready":false}`, `/api/clusters` reports `unreachable` with `partial: true`, and the built UI is served at `/`.

Verification on 15 November 2026 against a disposable kind cluster:

- `pnpm test:integration`: 7 of 7 pass against seeded kind.
- `pnpm test:e2e`: 16 pass, 1 skipped, covering E2E-01 to E2E-14 plus two document-structure checks from the accessibility review. E2E-11 runs a second server whose kubeconfig points at a closed port and checks the `unreachable` status and partial-coverage notice. The skipped case needs an invalid timestamp that the Kubernetes API refuses to store; normalization and exclusion are covered by unit tests.
- `pnpm test:e2e:team`: 3 of 3 pass, covering anonymous rejection, per-team cluster and namespace scope, and `403` on cross-scope export and streaming.
- The container image builds and runs in kind with only the chart-generated namespaced `Role`: `/readyz` reports the cluster `live`, the API returns only the watched namespace, and `kubectl auth can-i` confirms `get`/`list`/`watch` on `events` in that namespace with no create, delete, secret or cluster-wide read access.

Security review on 15 November 2026:

- Recorded in `docs/SECURITY.md`. Every API route, including export and SSE, shares one authorization path; the read-only Kubernetes client, logger redaction, export limits, CSV formula neutralization, response headers and namespaced `Role` were re-checked. No third-party penetration test or dependency scan has been run.

Accessibility review on 15 November 2026:

- WCAG 2.2 AA review recorded in `docs/ACCESSIBILITY.md`. Source review, computed contrast for every theme pair, and the keyboard (E2E-10), external-origin (E2E-13) and reduced-motion (E2E-14) browser checks. Twelve findings were fixed; the lowest text contrast after the fixes is 4.54:1. No automated accessibility scanner runs because the pinned dependency list has none.

### Known gaps

- The `docs/PRD.md` companion document referenced by the specification was never supplied, so its decisions D1 to D7 are not transcribed.
- Browser rendering latency has not been measured; the benchmark covers domain operations only.

## [0.1.0] - 2026-11-14

### Added

- Browser-only dashboard over synthetic Kubernetes Event fixtures with a deterministic simulator, five scenarios, filtering, inspection, analytics and CSV/JSON export.
