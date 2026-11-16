# Winter feasibility daily collector (#782): retired

Retired by #1634 on 2026-11-16. The campaign it served (#782) closed on
2026-11-06, and migration 309 dropped `public.weather_station`, a table the
frozen extractor reads, so every run from 2026-11-16 failed.

Removed from Git and the production render: CronJob
`verdify-winter-feasibility`, ConfigMap `verdify-winter-feasibility-runner`,
NetworkPolicies `verdify-winter-feasibility-db-only` and
`allow-db-from-winter-feasibility`, and the Sync hook Job
`verdify-winter-archive-init`. `verdify-prod-dark` syncs with prune off, so
those live objects are deleted by exact name after the sync.

Kept: PVC `verdify-winter-feasibility-archive` (10 GiB, Longhorn workspace
RWO, `deploy/k8s/overlays/prod/winter-feasibility-archive-pvc.yaml`, annotated
`Prune=false,Delete=false`). It holds the staged source snapshot
(`source/`), the registered instance and the immutable day files and
manifests (`winter-2026-27/`); the last day file is 2026-11-14. It stays until
the owner decides otherwise. The extractor source stays in
`research/planner-efficacy/winter_feasibility.py` until #1657 moves the
research package.

To read the archive, mount the claim read-only in a short-lived Pod in
`verdify-prod` (no database credential, no service-account token), copy what
is needed out, and delete the Pod. Do not write to the claim.

The collector's design and staging procedure are in this file's Git history.
