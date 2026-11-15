# Security

## Read-only by construction

- The server only issues `GET` requests to the Kubernetes API (`list`, `watch`).
- The Helm chart ships one namespaced `Role` with `get`, `list` and `watch` on
  `events` and nothing else per watched namespace; it never creates a
  `ClusterRole`. `EVENTS_WATCH_NAMESPACES` must list those namespaces so the
  server's list and watch requests stay inside the granted scope.
- No code path creates, patches, replaces or deletes cluster objects. The only
  writer in this repository is `scripts/seed-events.ts`, which is test tooling
  and talks to the disposable kind cluster through `kubectl`.

## Credentials

- The kubeconfig is read on the server only. It is never sent to the browser and
  never included in an API response.
- `insecure-skip-tls-verify` is rejected at startup: TLS verification can never
  be disabled.
- Bearer tokens, client keys, certificates and cookies are redacted by the
  structured logger. Token values are never logged, including on failure.
- Exec credential plugins run on the server, with a 20-second timeout, and the
  returned token is cached only until shortly before its expiry.
- OIDC client secrets and the session secret come from environment variables or
  a Kubernetes Secret. No secret belongs in an image layer or the repository.

## Authorization (team mode)

- `EVENTS_AUTH_MODE=none` is only accepted on a loopback bind.
- Team mode requires `EVENTS_PUBLIC_URL`, `EVENTS_SESSION_SECRET` (at least 32
  random bytes, base64) and `EVENTS_RBAC_FILE`; startup fails if any is missing.
- The login flow is authorization code + PKCE with a signed state and nonce.
  ID tokens are verified with the issuer's JWKS (RS256/ES256), issuer, audience
  and expiry.
- Sessions are AES-256-GCM encrypted cookies, `HttpOnly`, `SameSite=Lax`, and
  `Secure` when the public URL is HTTPS.
- Every read route — `/api/events`, `/api/events/:id`, `/api/summary`,
  `/api/options`, `/api/export`, `/api/stream` — applies the caller's scope.
  Selecting only namespaces a caller may not read returns `403` instead of
  widening the query to everything.
- Grant file shape:

```yaml
roleGrants:
  viewer:
    - clusterId: kind-events
      namespaces: ["payments"]
  admin:
    - clusterId: "*"
      namespaces: ["*"]
userRoles:
  alice: [viewer]
groupRoles:
  sre: [admin]
```

## Browser

- The client talks only to its own origin. No analytics, telemetry, remote font,
  CDN or external API is used.
- The response sets `Content-Security-Policy` with `default-src 'self'`,
  `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin` and
  `X-Frame-Options: DENY`.
- No Event content is written to `localStorage`, `sessionStorage`, IndexedDB or
  cookies.

## Export

- CSV fields are escaped and values that begin with `=`, `+`, `-`, `@`, tab or
  carriage return are neutralized so a spreadsheet cannot execute them.
- JSON export contains the untouched source record (`rawEvent`), not a normalized
  schema.
- Exports are generated on the server from one query snapshot and are limited to
  1,000,000 records.

## Image and deployment

- Multi-stage build; the runtime image runs as a non-root user with a read-only
  root filesystem, drops all capabilities and uses the `RuntimeDefault` seccomp
  profile.
- Health endpoints are `/healthz` (process liveness) and `/readyz` (at least one
  live cluster).
- The publish workflow pushes to GHCR with provenance and an SBOM; it never
  deploys.

## Review record

Review on 15 November 2026, against `packages/server` and `packages/web`, before
the `v0.2.0` tag. Method: source review of the HTTP layer, the Kubernetes client,
the logger, the export path and the Helm chart, plus the automated checks that
already run in CI (unit tests, the kind integration suite, E2E-12 authorization
in team mode, E2E-13 external origins, the read-only `kubectl auth can-i`
checks and the image smoke test with the chart-generated `Role`).

What was confirmed:

- `handleApi` derives the caller's scope before every route, so `/api/clusters`,
  `/api/events`, `/api/events/:id`, `/api/options`, `/api/summary`, `/api/export`
  and `/api/stream` share one authorization path. A single record is also
  checked against the caller's namespace grant, not just the cluster grant.
- Non-`GET` requests to `/api` are rejected with `405`.
- The Kubernetes client issues only `list` and `watch` requests, refuses
  `insecure-skip-tls-verify`, and sends the token only as a request header.
- `packages/server/src/logging.ts` redacts any key matching token, authorization,
  password, secret, client key, certificate, API key or cookie, redacts PEM
  blocks and bearer tokens inside message strings, and caps recursion depth.
- Export streams from one query snapshot, refuses more than 1,000,000 records
  with `413`, and escapes and neutralizes spreadsheet formulas.
- Response headers set `content-security-policy` with `default-src 'self'` and
  `frame-ancestors 'none'`, plus `x-content-type-options: nosniff`.
- The chart renders one namespaced `Role` per watched namespace and no
  `ClusterRole`.

Residual risks, unchanged by this review: a session cookie is a bearer
credential for the lifetime of the encrypted payload, so team mode depends on
the reverse proxy's TLS; the server trusts the kubeconfig and exec credential
plugins on the host; and no third-party penetration test or dependency scan
has been performed.

## Reporting a problem

Open an issue without live credentials, tokens or cluster dumps. Redact any
Event content that identifies your organization.
