# Readiness probe disposition: verdify-platform workloads

Acceptance slice of jvallery/estate-platform#122 (STD-HA-06 readiness sub-measure: "a serving
workload has a readiness probe or a listed reason"). The pattern is jvallery/network-infra
`docs/state/probe-pdb-disposition.md`. Wording follows the probe-semantics rule that
jvallery/estate-platform#121 publishes under STD-HA-06: readiness gates Service endpoints, and a
justified omission names the container, why a probe gates nothing useful there, and its
compensating signal. "Upstream" alone is never the reason. The full list of 29 and where each row
lives is in jvallery/estate-platform `docs/state/probe-disposition.md`.

Live read 2026-11-17T05:28Z (kube context `vallery`). R = readiness, L = liveness.

| Namespace / workload / container | Replicas | Probes | Disposition (reason) | Compensating signal | Owner |
|---|---|---|---|---|---|
| `verdify-prod/verdify-ingestor` / `ingestor` | 1 | L (exec `ingestor-healthz.py`) | Listed reason. It is a pull-and-write loop (`python ingestor.py`) that reads the greenhouse sources and writes to `verdify-db` under the `verdify-ingestor-writer` Lease. It has no ports, and no Service selects `app.kubernetes.io/component: ingestor`, so readiness would gate no endpoint. Liveness rules belong to verdify-platform#1547; if that issue adds a readiness probe, it replaces this row in the same PR. | Liveness probe; `VerdifyIngestorRestarted`, `VerdifyIngestorRowsRejected`, `VerdifyWriterLeaseUnsafe`, `VerdifyWriterLeaseObservationUnknown`. | verdify-platform |
| `verdify-prod/verdify-lab` / `cache-refresh` (sidecar) | 2 | `lab-site`: R + L; `cache-refresh`: none | Listed reason, sidecar only. `lab-site` is probed and is what Service `verdify-lab` (component `lab-site`) routes to. `cache-refresh` runs `sync-lab-serving-cache.py`, a background refresher with no port. Pod readiness is the AND of all containers, so a sidecar readiness probe would pull a healthy `lab-site` pod out of the Service whenever the refresher failed. | `VerdifyLabSLOBurnRateFast`, `VerdifyLabSLOBurnRateSlow` (a stale cache shows in the lab journey SLO); `KubeContainerRestartLoop`. | verdify-platform |
