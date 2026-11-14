# BUILD_SPEC.md - build, tooling, CI and deployment

**Project:** Kubernetes Events Filter Dashboard  
**Repository:** https://github.com/lalit-contributes/k8s-events-filter-dashboard  
**Current Pages URL:** https://lalit-contributes.github.io/k8s-events-filter-dashboard/  
**License:** Apache-2.0  
**Output:** Static React + TypeScript SPA; synthetic Kubernetes Event fixtures only

Product behavior is defined by `docs/SPEC.md` and `AGENTS.md`. This file defines how to install, build, test, verify, package and deploy the project. The shipped app has no server, database, runtime environment secrets or external data calls.

---

## 1. Build targets

| Target | Command | Output / address | Purpose |
|---|---|---|---|
| Development | `npm run dev` | `http://127.0.0.1:5173/` | Local app; bound to loopback rather than all network interfaces. |
| Unit tests | `npm run test` | Terminal | Fast deterministic unit suite. |
| Coverage | `npm run test:coverage` | `coverage/` | Unit suite plus enforced coverage thresholds. |
| Browser acceptance | `npm run test:e2e` | `playwright-report/` and `test-results/` | Browser tests for TC-01 to TC-10 and supplemental checks. |
| Production build | `npm run build` | `dist/`, base `/` | Static output for a root-hosted site or local preview. |
| GitHub Pages build | `npm run build:pages` | `dist/`, base `/k8s-events-filter-dashboard/` | Static output for the project Pages subpath. |
| Preview | `npm run preview` | `http://127.0.0.1:4173/` | Serve a root-based production build locally. |
| Fixture validation | `npm run validate:fixtures` | Terminal | Validate all checked-in synthetic fixtures before commit/release. |
| Performance benchmark | `npm run bench` | `bench/results.json` | Measure the defined domain operations on 2,500 deterministic records. |
| Bundle gate | `npm run check:bundle` | Terminal | Enforce the gzip budget for the entry JavaScript graph. |
| Full local verification | `npm run verify` | Terminal | Run all mandatory checks in sequence. |

The production app is static. It may be hosted on GitHub Pages or another static host, but hosting must not introduce a runtime API, account system or external data dependency.

## 2. Supported toolchain and version policy

The original draft specified Node.js 20. That release line reached end of life in March 2026, so the build target is updated to **Node.js 24 LTS** as of 14 November 2026. Node.js release status is tracked at https://nodejs.org/en/about/previous-releases. Check the official Vite compatibility guide when changing the pinned Vite release: https://vite.dev/guide/.

| Tool/package | Required baseline or policy | Purpose |
|---|---|---|
| Node.js | 24 LTS; `.nvmrc` contains `24` | Tooling runtime. Do not use the EOL Node 20 line. |
| npm | The npm version bundled with the selected Node 24 release; record it in the README | Package install and lockfile. |
| React / React DOM | Use the current mutually compatible stable version, pinned exactly in `package.json` and `package-lock.json` | UI. React 19.3 was the current React documentation release on 14 November 2026; confirm the selected version at scaffold time: https://react.dev/versions. |
| TypeScript | 5.4 or later, pinned exactly | Strict static typing. |
| Vite | Current stable version compatible with the selected Node release; exact pin | Dev server and static bundler. |
| `@vitejs/plugin-react` | Stable release compatible with Vite; exact pin | React transform. |
| Vitest | Stable release compatible with Vite and Node; exact pin | Unit tests. |
| `@vitest/coverage-v8` | Same Vitest release line; exact pin | Coverage reporting. |
| Playwright | 1.45 or later, exact pin | Browser acceptance tests. |
| ESLint | 9 or later compatible release, exact pin | Linting. |
| `typescript-eslint` | Compatible release, exact pin | TypeScript lint rules. |
| Recharts | 2.x baseline from the original product spec, or a compatible pinned stable upgrade approved in the lockfile | Charts. Keep chart interaction and accessibility requirements. |
| Testing Library | 16 or later compatible release, exact pin | React component tests. |
| `jsdom` | Exact pin compatible with Vitest | Component-test DOM. |
| `tsx` | Exact pin | Execute TypeScript fixture/coverage scripts without another build step. |
| `@types/node`, `@types/react`, `@types/react-dom` | Exact pins compatible with installed packages | Type definitions. |
| ESLint support packages | `@eslint/js`, `globals`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-plugin-jsx-a11y`, pinned exactly | Flat config and React/accessibility lint checks. |
| `@testing-library/jest-dom` | Exact pin | Semantic DOM assertions where useful. |

The table describes the approved toolchain and minimums, not a promise that every version listed as a minimum is the version to install today. At scaffold time, select a mutually compatible stable set, install with exact-save behavior (no `^` or `~` in dependency ranges), and commit `package-lock.json`. Record the exact resolved versions in `package.json` and the lockfile. CI must use `npm ci`, never resolve newer dependencies during a build.

Do not use `npm create vite@latest` or broad `npm update` as a recurring maintenance step. The create command is allowed once for a genuinely empty repository. After initial scaffold, treat the lockfile as canonical and update dependencies intentionally, with tests.

### Approved direct dependencies

**Runtime:** `react`, `react-dom`, `recharts`.  
**Development/tooling:** Vite, `@vitejs/plugin-react`, TypeScript, Vitest, `@vitest/coverage-v8`, Playwright, Testing Library packages, `jsdom`, ESLint and its listed support packages, `tsx`, and Node/React type packages.

Do not add a date library, routing library, general state-management library, CSV library, API client, UI framework, analytics SDK, remote icon package or schema-validation package without approval. Use browser APIs and small tested helpers for the specified scope.

## 3. Initial scaffold (only when the app does not already exist)

First check `git status` and inspect the repository. Never re-scaffold or overwrite an existing application just to match the example tree.

For a genuinely empty repository, create a React + TypeScript Vite project once, then pin the compatible versions chosen in section 2, add the required files and commit the lockfile:

```bash
npm create vite@latest k8s-events-filter-dashboard -- --template react-ts
cd k8s-events-filter-dashboard
npm install --save-exact react react-dom recharts@2
npm install --save-dev --save-exact \
  vite @vitejs/plugin-react typescript vitest @vitest/coverage-v8 \
  @playwright/test @testing-library/react @testing-library/jest-dom jsdom \
  eslint @eslint/js typescript-eslint globals eslint-plugin-react-hooks \
  eslint-plugin-react-refresh eslint-plugin-jsx-a11y tsx @types/node \
  @types/react @types/react-dom
npx playwright install chromium
```

This is a one-time scaffold example, not the reproducible CI procedure. Confirm the installed versions are compatible with Node 24 and update the dependency ranges to exact versions if the command/tool wrote ranges. Do not re-run it over an existing project. On Linux CI, install the browser and its operating-system dependencies using `npx playwright install --with-deps chromium`.

After scaffold, create/adapt the repository layout described in `AGENTS.md`, ensure `LICENSE` contains the Apache License 2.0 text, and ensure `docs/SPEC.md` matches the approved product specification.

## 4. Required configuration

### 4.1 `vite.config.ts`

Use Vitest's config entry point because the config includes the `test` property. Do not import `defineConfig` from plain `vite` and then rely on a type that does not include Vitest configuration.

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    manifest: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: 'coverage',
      include: ['src/domain/**/*.ts', 'src/store/**/*.ts', 'src/ui/**/*.tsx'],
      exclude: ['**/*.d.ts', 'src/main.tsx'],
    },
  },
});
```

Keep the development/ordinary production base at `/`. `build:pages` supplies the repository subpath explicitly; do not key the Vite dev server off the generic `GITHUB_ACTIONS` variable. GitHub sets that variable for every workflow, including test runs, which can otherwise make the development server's asset base inconsistent with Playwright's root URL.

### 4.2 TypeScript

Enable at least these options in the TypeScript configuration used for the app and scripts:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

The project configuration must include `src`, `tests`, `scripts`, `vite.config.ts` and `playwright.config.ts`; use separate app/node configs if the Vite template has them. Include the relevant Node types for config/scripts. Do not disable strictness to suppress a real mismatch.

### 4.3 `.nvmrc`

```text
24
```

### 4.4 `.gitignore`

At minimum:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
bench/results.json
.env*
!.env.example
.DS_Store
```

No environment variables are required by the shipped app. Do not introduce secrets or runtime config files. If an `.env.example` exists, it must not suggest that secrets or API endpoints are needed for normal use.

### 4.5 ESLint

Use ESLint's flat config (`eslint.config.js`). Enforce at least:

- `@typescript-eslint/no-explicit-any`: error.
- `@typescript-eslint/no-non-null-assertion`: error.
- `no-console`: error in app code; scripts may use controlled console output.
- `src/domain/**` cannot import `react`, `react-dom`, `recharts`, or anything under `src/ui/`.
- Keep the configured React hooks, refresh and JSX accessibility rules enabled.
- Zero warnings in the required lint command.

### 4.6 `playwright.config.ts`

Configure Chromium, a local web server and a stable root URL. Bind the Vite server to `127.0.0.1`; wait for readiness before tests. Retain a trace on failure and screenshots on failure, but do not upload user data because the test data is synthetic. The web server must run the local development build at `/`, not a GitHub Pages subpath build.

### 4.7 License headers

Every new TypeScript/JavaScript source file, test and script begins with:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors
```

Use `/* ... */`, `<!-- ... -->` or the appropriate comment style for CSS/HTML/YAML where a header is added. Do not insert invalid comment syntax into JSON files.

## 5. Required npm scripts

Keep these names stable because agent instructions and CI use them:

| Script | Command | Behavior |
|---|---|---|
| `dev` | `vite --host 127.0.0.1` | Run local app on loopback. |
| `build` | `npm run typecheck && vite build` | Typecheck and root-based production build. |
| `build:pages` | `npm run typecheck && vite build --base=/k8s-events-filter-dashboard/` | Pages-subpath build. |
| `preview` | `vite preview --host 127.0.0.1` | Preview root-based `dist/`. |
| `typecheck` | `tsc --noEmit` | Type checking only. |
| `lint` | `eslint . --max-warnings=0` | Full lint gate. |
| `validate:fixtures` | `tsx scripts/validate-fixtures.ts` | Validate fixture JSON and scenario invariants. |
| `test` | `vitest run` | Unit tests. |
| `test:watch` | `vitest` | Interactive unit-test development. |
| `test:coverage` | `vitest run --coverage && tsx scripts/check-coverage.ts` | Generate coverage and enforce per-layer floors. |
| `test:e2e` | `playwright test` | Browser acceptance tests. |
| `bench` | `tsx scripts/benchmark.ts` | Benchmark domain operations and write JSON results. |
| `check:bundle` | `node scripts/check-bundle-size.mjs` | Enforce the entry JavaScript gzip budget. |
| `verify` | `npm run lint && npm run typecheck && npm run validate:fixtures && npm run test:coverage && npm run test:e2e && npm run build && npm run check:bundle` | Full local quality gate; stop at first failure. |

The final `verify` script should stop on the first failing command. The performance target is enforced on the named development machine; CI can collect a benchmark result in report-only mode because shared runners vary. Do not silently skip a check in `verify`.

## 6. Fixture validation and raw-data guarantees

`scripts/validate-fixtures.ts` must validate every JSON fixture and fail with a non-zero exit code and a useful file/record path when it finds an error. Avoid a validation dependency unless the user approves one.

Validate at least:

- Fixture root shape and required metadata/object structures.
- Supported API versions: `events.k8s.io/v1` and core `v1`.
- Unique, stable source UIDs/derived IDs within the relevant store, where available.
- Values used by the normalized fields and scenario scripts, including valid/missing/invalid occurrence-count classification.
- Required scenario names and deterministic step order.
- Timestamp strings, while allowing explicit test cases for missing/invalid timestamps and optional fields.
- Repeated-series steps are represented as one logical Event updated over time rather than duplicated records.
- Fixture data contains only synthetic example names/messages and no real cluster credentials or personal information.

Validation must not rewrite fixture content. A raw fixture should be diffable against its exported JSON representation. The normalizer is the only conversion boundary; all presentation calculations use normalized objects.

## 7. Quality gates and coverage

### 7.1 Required checks before merge or release

1. `npm run lint` passes with zero warnings.
2. `npm run typecheck` passes with zero errors.
3. `npm run validate:fixtures` passes.
4. `npm run test:coverage` passes and each layer's threshold is met.
5. `npm run test:e2e` passes for TC-01 to TC-10 and required supplemental browser checks.
6. `npm run build` succeeds.
7. `npm run check:bundle` passes.
8. `npm run verify` is green from a clean install where possible.

### 7.2 Coverage thresholds

`scripts/check-coverage.ts` reads the JSON coverage report and enforces the following thresholds by source layer. It exits non-zero when any layer falls below either threshold.

| Scope | Lines | Branches |
|---|---:|---:|
| `src/domain/**` | 95% | 90% |
| `src/store/**` | 85% | 80% |
| `src/ui/**` | 60% | 50% |

Keep the coverage report machine-readable (`coverage/coverage-final.json`). Missing coverage files or an empty source group must fail validation rather than pass silently. Tests themselves, fixtures and declarations are excluded from application-source thresholds.

### 7.3 Lint boundaries

The domain import restrictions are mandatory. The domain layer must not import React, React DOM, Recharts or UI modules. Avoid `any`, avoid non-null assertions, use named exports from domain modules and keep `no-console` violations out of application code.

## 8. Benchmark and responsiveness gate

- Benchmark dataset: exactly 2,500 deterministic normalized records built from the scenario fixtures and stable test seeds; do not use runtime random values.
- Operations: one namespace/type filter change, one keyword search and one bounded time-range change.
- Warm up each operation, run at least 10 measured samples and report the median, minimum and maximum. Write `bench/results.json` including dataset size, Node version, timestamp of the benchmark run, operation durations and whether the target passed. A benchmark timestamp is metadata only; it must never affect fixture Event timestamps.
- Target: each operation completes in **250 ms or less** on the named development machine. Record the machine/OS and the median in the README under `Performance` after the first passing measurement.
- A local `npm run bench` fails if the target is missed. CI may run `npm run bench -- --report-only` and upload the result as an artifact, but it must not silently discard the report. A performance regression on the development machine blocks a release.
- The benchmark measures the pure domain operation; browser acceptance checks separately verify that the interface visibly updates correctly. Do not describe a Node-only benchmark as a measured browser-render time.

## 9. Bundle-size gate

Vite's default chunk warning measures emitted chunk bytes, not gzip size. Do not claim it enforces a gzip limit.

- Set `build.manifest: true` so the build emits its manifest.
- `scripts/check-bundle-size.mjs` must read the manifest, find the application entry, follow its static JS imports without double-counting assets, gzip the bytes using Node's built-in `zlib`, and calculate the entry JS dependency graph size.
- Hard limit: **500 KiB gzip** for the initial JavaScript entry graph. The checker prints the measured size and fails if the graph exceeds the limit or the manifest/entry cannot be found.
- Do not add a bundler-analysis package solely for this check. If the budget is reached, inspect imports and use a justified code-splitting change only if it preserves the product workflow.

## 10. CI workflow

File: `.github/workflows/ci.yml`. Run on pushes to `main` and pull requests targeting `main`. The workflow is a correctness gate and does not deploy. Use least-privilege permissions and the checked-in lockfile.

The workflow must perform these steps in order:

1. Checkout source.
2. Setup Node from `.nvmrc` with npm caching.
3. `npm ci`.
4. `npm run lint`.
5. `npm run typecheck`.
6. `npm run validate:fixtures`.
7. `npm run test:coverage`.
8. Install Chromium and system dependencies with `npx playwright install --with-deps chromium`.
9. `npm run test:e2e`.
10. `npm run build` and `npm run check:bundle`.
11. Run the benchmark in report-only mode and upload coverage/test/benchmark reports as GitHub Actions artifacts when they exist.

Do not upload coverage to Codecov or another third-party service by default. This project does not need a Codecov token or any Actions secret. CI artifacts are sufficient for review and avoid an unnecessary external service dependency.

### Example CI workflow

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Validate fixtures
        run: npm run validate:fixtures

      - name: Unit tests and coverage
        run: npm run test:coverage

      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      - name: Browser acceptance tests
        run: npm run test:e2e

      - name: Production build
        run: npm run build

      - name: Bundle-size gate
        run: npm run check:bundle

      - name: Benchmark (report only on shared runner)
        run: npm run bench -- --report-only

      - name: Upload verification reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: verification-reports
          if-no-files-found: ignore
          path: |
            coverage/
            playwright-report/
            test-results/
            bench/results.json
```

Action major versions should be reviewed periodically against official GitHub documentation. Do not grant write permissions to the verification job.

## 11. GitHub Pages deployment

File: `.github/workflows/deploy.yml`. Deploy only after the `CI` workflow completes successfully on `main`, or after a manual dispatch explicitly run on `main`. A separate `push` deployment workflow that rebuilds independently can race ahead of failing CI; do not use that pattern.

Use the dedicated Pages artifact/deployment actions. Set the repository's Pages source to **GitHub Actions**. The workflow needs `pages: write` and `id-token: write` only in the deployment job; the CI workflow needs no write permissions.

### Example deployment workflow

```yaml
name: Deploy to GitHub Pages

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    if: >-
      (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'workflow_run' &&
       github.event.workflow_run.conclusion == 'success' &&
       github.event.workflow_run.head_branch == 'main')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout verified commit
        uses: actions/checkout@v6
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: npm ci

      - name: Build for Pages subpath
        run: npm run build:pages

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

This example intentionally keeps the deployment job behind the successful CI result. After deployment:

1. Confirm repository Pages source is GitHub Actions.
2. Confirm the site URL is `https://lalit-contributes.github.io/k8s-events-filter-dashboard/`.
3. Open the site and verify that all assets resolve under `/k8s-events-filter-dashboard/`.
4. Confirm the simulated-data label, all three sections, fixture loading and detail panel work in the deployed build.
5. Check browser developer tools for failed asset loads and any non-same-origin runtime request.

A blank page commonly indicates a mismatch between the Vite base path and the GitHub Pages repository path. The ordinary CI build stays at `/`; only `build:pages` uses the repository subpath.

## 12. Local verification procedure

Run from the repository root:

```bash
node --version
npm --version
npm ci
npm run verify
```

If a check fails, fix the cause and rerun that check plus the relevant dependent checks. Before requesting review, inspect `git diff --check`, `git status --short`, and the full diff. Make sure no generated `dist/`, `node_modules/`, coverage directory, test-results directory or benchmark-result file is accidentally committed unless explicitly intended.

For a local production preview:

```bash
npm run build
npm run preview
```

For a Pages-path preview, build with `npm run build:pages`, then serve `dist/` with a static preview server and open `/k8s-events-filter-dashboard/`. Do not use a root-based preview as evidence that the Pages subpath is correct.

## 13. README and project documentation

The README must explain:

- What the dashboard does and that all Events are simulated.
- The hard non-goal: no live cluster is contacted, no `kubeconfig` is read and no credentials are needed.
- Supported Node/npm versions and clean-clone setup commands.
- How to run dev server, unit tests, coverage, browser tests, fixture validation, benchmark and production build.
- The five scenarios and how to demonstrate filters, event details, chart interactions and export.
- Timestamp fallback semantics, the distinction between Event records and occurrences, and known limitations of Kubernetes Events.
- Performance results and the machine used to obtain them.
- How Pages is deployed and why the base path differs between local and Pages builds.
- License and contribution instructions.

Keep `docs/SPEC.md` aligned with the approved PDF specification. Do not treat the research candidate for `kubectl events` as an implemented feature or a guaranteed upstream pull request.

## 14. Assets and visual resources

- `public/favicon.svg` is the browser favicon and must be local.
- Optional `assets/logo-light.svg` and `assets/logo-dark.svg` can be used in the README only if they genuinely exist and are legible. Each must be under 50 KiB. If either is absent, remove the corresponding README `<picture>` block instead of leaving a broken image.
- Do not pull a logo, icon set, font, chart theme or screenshot from an external URL at runtime.
- App UI and README images, if present, must not imply the app contacted a live cluster.

## 15. Release and change management

- Use Semantic Versioning. The initial public release target is `v0.1.0` when all required acceptance criteria pass.
- `CHANGELOG.md` follows Keep a Changelog headings: Added, Changed, Fixed, Removed.
- The Pages site deploys from a successful `main` CI run, not from a version tag alone.
- Release only after the local benchmark meets the target, reports are reviewed, and the Pages path has been checked.
- A release tag does not by itself deploy the site unless the deployment workflow explicitly says so.

## 16. Build-done checklist

- [ ] Node 24 runtime documented in `.nvmrc` and README.
- [ ] Exact dependency versions are pinned; `package-lock.json` is committed.
- [ ] `vite.config.ts` imports `defineConfig` from `vitest/config` and has a correct test config.
- [ ] Normal build uses `/`; Pages build uses `/k8s-events-filter-dashboard/`.
- [ ] Strict TypeScript options are enabled.
- [ ] `.gitignore`, Apache-2.0 `LICENSE`, `AGENTS.md`, `BUILD_SPEC.md`, `docs/SPEC.md` and favicon exist.
- [ ] All named npm scripts execute successfully.
- [ ] Fixture validator checks all supplied fixtures and scenario rules.
- [ ] Domain/store/UI coverage thresholds pass.
- [ ] TC-01 through TC-10 and supplemental browser tests pass.
- [ ] Runtime network requests remain same-origin; no external telemetry or remote fixture loading exists.
- [ ] Deterministic 2,500-record benchmark is recorded; the local 250 ms target is met.
- [ ] Gzip bundle checker passes at 500 KiB for the initial JavaScript dependency graph.
- [ ] CI checks are green; deploy workflow waits for successful CI on `main`.
- [ ] GitHub Pages base path and live URL have been tested.
- [ ] README setup works on a clean clone; changelog contains the `v0.1.0` entry when releasing.

## 17. Reference links used for current toolchain decisions

The product behavior itself comes from the supplied Technical Specification PDF. These external references are used only for current tooling/lifecycle checks and should be rechecked when changing the toolchain:

- Node.js release status: https://nodejs.org/en/about/previous-releases
- Vite getting started / Node compatibility: https://vite.dev/guide/
- React versions: https://react.dev/versions
- Vitest coverage: https://vitest.dev/guide/coverage
- Vitest benchmarking: https://vitest.dev/guide/benchmarking
- GitHub Pages deployment guidance: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
