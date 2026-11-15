# Architecture

The product is a read-only observation of Kubernetes `Event` objects. It has
three runtime pieces and no durable storage.

```
browser ──HTTP──▶ server ──list/watch──▶ Kubernetes API
                   │
                   ├─ per-cluster bounded store (memory only)
                   └─ single query service (rows, counts, summary, export)
```

## Packages

| Package | Responsibility |
|---|---|
| `packages/domain` | Pure TypeScript: normalization, timestamps, filters, sort, pagination, aggregation, CSV/JSON row formatting. No React, Node or network imports. |
| `packages/server` | Configuration, Kubernetes connector, ingest loops, bounded cluster stores, query service, HTTP API, SSE, export, optional OIDC team mode. |
| `packages/web` | React client: shared query state, Overview, Explorer, detail panel, Analytics, observation banner. |

## Read path

1. `ClusterManager` creates one `ClusterStore` and one `Ingestor` per configured
   context. A failing context backs off independently and never stops another.
2. An ingestor runs one list-and-watch loop per namespace named in
   `EVENTS_WATCH_NAMESPACES`, or a single cluster-wide loop when it is unset. It
   lists that scope's `/api/v1/events`, normalizes once at the boundary, and
   then watches from the returned `resourceVersion`. A `410` re-lists and
   replaces only that scope's records; an expired or closed watch reconnects
   with capped exponential backoff. The cluster is `live` only when every scope
   is streaming and `degraded` when one scope fails while another is live.
3. `ClusterStore` keeps the latest immutable snapshot per logical Event ID
   (`<clusterId>/<uid>`). A newer series report replaces the record instead of
   adding a row. At the per-cluster cap, the oldest records are evicted and the
   eviction count is visible in the UI.
4. `QueryService` reads the store snapshots, applies the shared filters, sorting
   and aggregation, and returns rows, totals, the summary and export records.

Only `GET` requests are issued to the Kubernetes API: `list` and `watch`. There
is no write verb anywhere in product code.

## One query path

`/api/events`, `/api/summary` and `/api/export` all parse the same query string
with `parseEventQuery` and read the same store snapshots. The browser never
re-implements a predicate: it sends query parameters and renders the response.
`/api/stream` carries signals (`update`, `summary-tick`) and the client re-queries
the page and summary, so a displayed count always comes from the query path.

## Time

- Event timestamps are parsed to UTC ISO strings; display uses the browser
  timezone with the zone name shown.
- Relative ranges are anchored to the server's `serverTime` from the same
  response, never to the browser clock.
- Records whose effective last-observed timestamp is missing or invalid are
  excluded from bounded ranges and time buckets. The response reports how many
  were excluded so the UI can say so.
- Missing values render `Not supplied`; malformed supplied values render
  `Invalid value`. Neither is replaced with the current time.

## Memory and retention

- Each cluster store is capped (default 100,000 records) and evicts the oldest
  records, counting every eviction.
- Nothing is persisted: no database, no browser storage, no cookies except the
  optional encrypted session cookie in team mode.
- Kubernetes retains Events for about one hour, so the dashboard is an
  observation window, not a history.

## Team mode

`EVENTS_AUTH_MODE=oidc` adds authorization-code login with PKCE, an encrypted
AES-256-GCM session cookie, ID-token verification against the issuer's JWKS, and
YAML RBAC grants. Every route, including export and SSE, applies the resulting
scope before reading a store. A request whose selected namespaces fall entirely
outside a grant is refused rather than silently widened to an empty filter.
