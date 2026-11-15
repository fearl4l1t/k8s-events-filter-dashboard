# BUILD_SPEC.md - build, toolchain, CI and publishing

**Project:** Kubernetes Events Explorer
**Repository:** `k8s-events-filter-dashboard`
**License:** Apache-2.0
**Output:** Read-only dashboard server plus its browser UI, one container image

Product behavior is defined by `docs/SPEC.md`. Repository rules are in `AGENTS.md`. This file defines how to install, build, test, verify, package and publish the project.

---

## 1. Toolchain

| Tool | Requirement | Purpose |
|---|---|---|
| Node.js | 24 LTS; `.nvmrc` contains `24` | Runtime and tooling |
| pnpm | 12.x, pinned in the root `packageManager` field | Workspace install and scripts |
| TypeScript | pinned exactly; `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax` | Type checking |
| Vite | pinned exactly | Web build and dev server |
| Vitest | pinned exactly, with `@vitest/coverage-v8` | Unit tests |
| Playwright | pinned exactly | Browser acceptance tests |
| ESLint | 9 flat config with `typescript-eslint` | Lint gate |

Dependency versions are exact, with no `^` or `~` ranges. `pnpm-lock.yaml` is committed and CI installs with `--frozen-lockfile`. Do not resolve newer versions during a build.

## 2. Workspace commands

| Script | Behavior |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Server in local mode plus the Vite dev server, which proxies `/api` |
| `pnpm build` | Typecheck, then build the web assets the server serves |
| `pnpm lint` | ESLint with zero warnings |
| `pnpm typecheck` | `tsc --noEmit` for the workspace scripts and every package |
| `pnpm test` | Unit tests for every package |
| `pnpm test:coverage` | Unit tests with the coverage floors in section 5 |
| `pnpm test:integration` | Server integration tests against kind |
| `pnpm test:e2e` | Playwright against a running server backed by kind |
| `pnpm bench` | Server query benchmark over 100,000 deterministic records |
| `pnpm check:bundle` | Initial JavaScript gzip budget |
| `pnpm verify` | Lint, typecheck, coverage, build, bundle gate; stops at the first failure |

`dev`, `test:integration` and `test:e2e` are added as the phases in section 13 land. A script must not be present as a placeholder that cannot run.

## 3. TypeScript and lint

- `tsconfig.base.json` holds the shared options; each package extends it.
- `packages/domain` may not import React, Recharts, Node built-ins, the server package or the web package. ESLint enforces this.
- `@typescript-eslint/no-explicit-any` and `no-non-null-assertion` are errors.
- `no-console` is an error in `packages/server/src` and `packages/web/src`; use the structured logger.
- Scripts and tests may write to the console.

## 4. Repository layout

```text
packages/domain/src/     types, constants, normalise, timestamps, filters, sort,
                         paginate, aggregate, export, index
packages/server/src/     main, config, clusters, ingest, store, query, api, auth,
                         health, logging
packages/web/src/        api, state, ui, styles, main
scripts/                 benchmark, bundle check, kind helpers, seed script
docs/                    PRD, SPEC, ARCHITECTURE, SECURITY, ACCESSIBILITY,
                         OPERATIONS
```

`packages/domain/src/index.ts` is the only public entry for the domain package.

## 5. Coverage floors

Vitest enforces these per package; a failing floor fails `pnpm test:coverage`.

| Scope | Lines | Branches |
|---|---:|---:|
| `packages/domain/src/**` | 95% | 90% |
| `packages/server/src/store/**`, `ingest/**`, `query/**`, `auth/**` | 85% | 80% |
| `packages/server/src/api/**`, `health/**`, `logging/**` | 70% | 60% |
| `packages/web/src/**` | 60% | 50% |

Tests may not be excluded from the report to make a floor pass. Missing reports fail the gate.

## 6. Test data

- Unit tests build plain TypeScript Event objects inline. No JSON fixture files.
- Integration and browser tests create real Events in a kind cluster through the Kubernetes API with `scripts/seed-events.ts`.
- Expected counts are computed from the cluster at test time, never hard-coded.
- No test may use a fake API server to stand in for Kubernetes.

## 7. Bundle budget

- The initial JavaScript graph for the web UI is at most **300 KiB gzipped**.
- `scripts/check-bundle-size.mjs` reads the Vite manifest, follows static imports without double counting, gzips with Node's `zlib` and fails if the graph is missing or over budget.
- The gate fails if any JSON file larger than 10 KB is emitted into the web bundle.

## 8. Benchmark

`pnpm bench` builds 100,000 deterministic Event-shaped records in code, normalizes them, and measures p50, p95 and max for namespace/type filtering, keyword search, a bounded time range and the summary.

- Target: p95 under 250 ms for those four operations.
- Export is measured for throughput, not against that target.
- Results are written to `bench/results.json` and the machine, OS, Node version and results are recorded in `docs/OPERATIONS.md`.
- The benchmark timestamp is metadata only; it never influences Event timestamps.
- A domain-level benchmark is not evidence of browser rendering latency. Do not present it as such.

## 9. Configuration

Configuration comes from environment variables and an optional `EVENTS_EXPLORER_CONFIG` file. `packages/server/src/config.ts` validates it at startup and fails with every problem listed.

| Variable | Default | Purpose |
|---|---|---|
| `EVENTS_MODE` | `local` | `local` or `in-cluster` |
| `EVENTS_KUBECONFIG` | `~/.kube/config` | Kubeconfig path (local mode) |
| `EVENTS_CONTEXTS` | current context | Comma-separated contexts to observe |
| `EVENTS_BIND_HOST` | `127.0.0.1` (`0.0.0.0` in-cluster) | Listen address |
| `EVENTS_PORT` | `8080` | HTTP port |
| `EVENTS_CACHE_MAX_PER_CLUSTER` | `100000` | Per-cluster record cap |
| `EVENTS_WATCH_NAMESPACES` | all namespaces | Comma-separated namespaces to list and watch; the chart grants one read-only Role per entry |
| `EVENTS_AUTH_MODE` | `none` | `none` or `oidc` |
| `EVENTS_OIDC_ISSUER` | none | OIDC issuer URL |
| `EVENTS_OIDC_CLIENT_ID` | none | OIDC client ID |
| `EVENTS_OIDC_CLIENT_SECRET` | none | Client secret; never logged |
| `EVENTS_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

`EVENTS_AUTH_MODE=none` with a non-loopback bind is rejected in local mode.

## 10. CI

`.github/workflows/ci.yml` runs on pushes and pull requests to `main` with `contents: read`.

1. Checkout and set up Node from `.nvmrc`, with pnpm caching.
2. `pnpm install --frozen-lockfile`.
3. `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`.
4. Create the kind cluster with `scripts/kind/create.sh`.
5. Start the Keycloak dev stack for team-mode tests.
6. `pnpm test:integration`, `pnpm test:e2e`.
7. `pnpm build`, `pnpm check:bundle`.
8. Upload coverage, Playwright and benchmark output as artifacts.

No third-party coverage upload service and no write permissions in the verification job.

## 11. Image publishing

`.github/workflows/publish-image.yml` runs on tags matching `v*`.

1. Build `packages/server/Dockerfile`, a multi-stage Node 24 build that also contains the built web assets.
2. Push `ghcr.io/<owner>/k8s-events-explorer:<tag>` with `GITHUB_TOKEN` and `packages: write`.
3. Generate build provenance attestations.

The final image runs as non-root with a read-only root filesystem, exposes 8080 and health-checks `/healthz`. No secrets belong in any layer. Deployment is manual and described in `docs/OPERATIONS.md`; no workflow deploys automatically.

## 12. Local verification

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm verify
```

If a required external tool is unavailable, for example kind or Docker for the integration gate, report which gate did not run. Do not describe an unrun check as passing.

## 13. Phased work plan and gates

Work in order. Do not start a phase before the previous gate passes. Record each gate result in `CHANGELOG.md`.

### P0 - Foundations

Delete the simulator, fixtures and store paths. Rewrite `AGENTS.md`, `docs/SPEC.md` and this file. Convert to a pnpm workspace. Move the domain package. Replace `package-lock.json` with `pnpm-lock.yaml`.

**Gate:** `pnpm lint`, `pnpm typecheck` and the domain unit tests pass; no file under `packages/` imports a fixture, simulator or scenario module.

### P1 - Local read path, one cluster

Configuration, kubeconfig connector, list-and-watch ingestor with backoff and 410 handling, cluster store with cap and eviction, query and summary services, `/api/clusters`, `/api/events`, `/api/events/:clusterId/:uid`, `/api/summary`, health and readiness, error responses, and the web client (Explorer, Overview, detail panel, observation banner) for one cluster. Kind scripts and integration tests.

**Gate:** E2E-01 to E2E-07 pass against kind; read-only RBAC verified; benchmark recorded.

### P2 - Export, summaries, live updates

Streaming export with the 1,000,000-record limit, SSE with resume and stream limits, Overview and Analytics driven by the summary endpoint, chart-to-Explorer filters.

**Gate:** table, chart, summary and export counts agree for the same query; export covers every page.

### P3 - In-cluster deployment

In-cluster connector and source label, Dockerfile, publish workflow, Helm chart with a read-only namespaced Role and Ingress, `docs/OPERATIONS.md`.

**Gate:** the image runs in kind with only the generated Role, the server reaches `live`, the read-only test passes.

### P4 - Multi-cluster and team mode

Multiple contexts, cluster selector, per-cluster status, partial-data labeling, OIDC authorization code flow with PKCE, RBAC grants, authorization on every route including export and SSE.

**Gate:** a user without access to cluster B cannot see its records through any endpoint.

### P5 - Hardening and release

WCAG 2.2 AA audit and fixes, security review, full benchmark, external-origin and reduced-motion checks, tag `v0.2.0`, publish the image, update README and CHANGELOG.

## 14. Build-done checklist

- [ ] Node 24 and pnpm are documented and enforced.
- [ ] Dependency versions are exact and the lockfile is committed.
- [ ] Strict TypeScript and lint boundaries pass.
- [ ] Coverage floors pass for every package.
- [ ] Unit, integration and browser tests pass in CI against kind.
- [ ] Bundle gate passes at 300 KiB and no oversized JSON is bundled.
- [ ] Benchmark meets the 250 ms p95 target and is recorded in `docs/OPERATIONS.md`.
- [ ] The image is published and its tag matches `CHANGELOG.md`.
- [ ] `docs/SECURITY.md` lists trust boundaries, credential handling and the authorization model.
