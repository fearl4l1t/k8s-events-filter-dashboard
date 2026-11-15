# Operations

## Local mode

The server reads a kubeconfig, observes the selected contexts and serves both
the API and the built UI on loopback.

```bash
pnpm install --frozen-lockfile
pnpm build
EVENTS_CONTEXTS=kind-k8s-events node --import tsx packages/server/src/main.ts
# http://127.0.0.1:8080
```

For development, `pnpm dev` runs the server with `tsx watch` and the Vite dev
server, which proxies `/api`, `/auth`, `/healthz` and `/readyz` to
`http://127.0.0.1:8080`.

`EVENTS_AUTH_MODE=none` (the default) is only accepted when `EVENTS_BIND_HOST` is
a loopback address. Binding elsewhere without authentication is a startup error.

## In-cluster mode

```bash
helm upgrade --install events deploy/helm/k8s-events-explorer \
  --namespace events-explorer --create-namespace \
  --set image.tag=0.2.0 \
  --set cacheMaxPerCluster=100000 \
  --set watchNamespaces={events-explorer}
```

`watchNamespaces` defaults to the release namespace. Every entry gets its own
read-only `Role` and `RoleBinding`; the server lists and watches each namespace
separately, so a namespaced Role is enough and no `ClusterRole` is required.
Listing events across all namespaces is deliberately not supported by the chart,
because that would need cluster-wide read permission.

The chart creates:

- a `ServiceAccount` and one read-only `Role`/`RoleBinding` per watched
  namespace (`get`, `list`, `watch` on `events`),
- a `Deployment` running as non-root with a read-only root filesystem,
- a `Service`, an optional `Ingress`, and the RBAC config map for team mode.

The container listens on port 8080 and exposes `/healthz` and `/readyz`.

## Image

`ghcr.io/lalit-contributes/k8s-events-explorer` is the default
`image.repository`. Pushing a `v*` tag runs `.github/workflows/publish-image.yml`,
which builds `packages/server/Dockerfile` for `linux/amd64` and
`linux/arm64`, pushes a multi-platform manifest under the tag and `latest`, and
attaches provenance and SBOM attestations.

```bash
docker pull ghcr.io/lalit-contributes/k8s-events-explorer:v0.2.0
```

The package inherits the repository's visibility settings; make it public if pull
access must be anonymous. To use a private registry instead, set
`image.repository` and create a pull secret.

For team mode, create a Secret with `oidc-client-secret` and `session-secret` and
set:

```yaml
auth:
  mode: oidc
  publicUrl: https://events.example.com
  issuer: https://id.example.com/realms/platform
  clientId: k8s-events-explorer
  existingSecret: events-oidc
```

Register `https://events.example.com/auth/callback` as the redirect URI.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `EVENTS_MODE` | `local` | `local` or `in-cluster` |
| `EVENTS_KUBECONFIG` | `~/.kube/config` | Kubeconfig path |
| `EVENTS_CONTEXTS` | current context | Comma-separated contexts |
| `EVENTS_BIND_HOST` | `127.0.0.1` (`0.0.0.0` in-cluster) | Listen address |
| `EVENTS_PORT` | `8080` | HTTP port |
| `EVENTS_CACHE_MAX_PER_CLUSTER` | `100000` | Per-cluster record cap |
| `EVENTS_WATCH_NAMESPACES` | all namespaces | Comma-separated namespaces to list and watch; requires namespace-scoped read permission |
| `EVENTS_STATIC_DIR` | `packages/web/dist` | Built UI directory |
| `EVENTS_AUTH_MODE` | `none` | `none` or `oidc` |
| `EVENTS_PUBLIC_URL` | none | Required for OIDC; redirect base |
| `EVENTS_OIDC_ISSUER` / `EVENTS_OIDC_CLIENT_ID` / `EVENTS_OIDC_CLIENT_SECRET` | none | OIDC client |
| `EVENTS_RBAC_FILE` | none | Required for OIDC; grant file |
| `EVENTS_SESSION_SECRET` | none | Required for OIDC; base64, at least 32 bytes |
| `EVENTS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Health and status

- `/healthz` returns 200 once the process is serving.
- `/readyz` returns 200 when at least one cluster is `live`; `503` otherwise.
- `/api/clusters` reports each cluster's `status`, `observationStartedAt`,
  `recordCount`, `evictedCount` and last error.

Status values: `connecting`, `live`, `degraded` (one watched namespace is
reconnecting or unreadable while another is live), `unreachable` (the API could
not be reached) and `auth-failed` (401/403 and no watched namespace is readable). A non-live cluster marks responses `partial`, and the
UI says so instead of presenting totals as complete.

## Retention and memory

Each cluster keeps at most `EVENTS_CACHE_MAX_PER_CLUSTER` normalized records.
Above the cap, the oldest records are evicted and `evictedCount` grows; nothing
is written to disk. Kubernetes keeps Events for about one hour, so a dashboard
restart starts with a fresh observation window.

## Benchmark

`pnpm bench` builds 100,000 deterministic Event-shaped records in code and
measures domain operations. Results on the development machine
(darwin 27.0.0, Node v24.21.0):

| Operation | p50 | p95 | max |
|---|---:|---:|---:|
| namespace + type filter | 2.16 ms | 2.25 ms | 2.25 ms |
| keyword search | 14.89 ms | 17.80 ms | 17.80 ms |
| bounded time range | 27.20 ms | 27.83 ms | 27.83 ms |
| sort | 2.43 ms | 2.53 ms | 2.53 ms |
| summary | 6.32 ms | 6.89 ms | 6.89 ms |
| CSV export formatting | 5.58 ms | 7.17 ms | 7.17 ms |

The 250 ms target applies to the filter, search, time-range and summary
operations. This is a domain benchmark: it does not measure browser rendering or
network latency. Raw results are in `bench/results.json`.

## Integration and browser gates

Both suites need a disposable kind cluster seeded through the Kubernetes API.

```bash
scripts/kind/create.sh
pnpm exec tsx scripts/seed-events.ts --clean
EVENTS_E2E_CONTEXT=kind-k8s-events pnpm test:integration
EVENTS_E2E_CONTEXT=kind-k8s-events pnpm test:e2e
scripts/kind/delete.sh
```

Team mode adds a Keycloak realm and a second context:

```bash
pnpm test:e2e:team
```


`pnpm test:e2e` builds the UI and starts the server itself (see
`playwright.config.ts`); Playwright browsers must be installed with
`pnpm exec playwright install chromium`.

If kind, Docker or Playwright browsers are unavailable in an environment, those
gates do not run. They must be reported as not run, never as passing.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `tls_verification_disabled` at startup | The kubeconfig context sets `insecure-skip-tls-verify`; use a CA instead. |
| Status `auth-failed` | The credentials cannot list Events in the watched namespaces; check the Role. |
| Status `unreachable` | The API server URL, network path or certificate is wrong. |
| `503` from `/readyz` | No cluster has reached `live` yet, or all are backing off. |
| Empty Explorer, live cluster | The cluster reported no Events during this observation window. |
| `EVENTS_AUTH_MODE=none` rejected | The bind address is not loopback; enable OIDC or bind to `127.0.0.1`. |
