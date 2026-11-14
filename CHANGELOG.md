# Changelog

All notable changes to the Kubernetes Events Filter Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-14

### Added
- Initial implementation of the Kubernetes Events Filter Dashboard.
- Domain layer supporting normalization for both `events.k8s.io/v1` and `core/v1` Kubernetes Events.
- Deterministic simulation engine with 5 scenarios: `normal-rollout`, `image-pull-failure`, `scheduling-pressure`, `container-health`, and `node-condition`.
- Filter, search, stable sort, 50-row pagination, aggregation, and CSV/JSON export engines.
- Reactive UI featuring Overview, Event Explorer with slide-over detail panel, and Analytics with interactive Recharts visualizations.
- Comprehensive unit test suite with strict coverage enforcement and Playwright acceptance test suite covering TC-01 through TC-10.
- Benchmarking and bundle-size enforcement gates.
