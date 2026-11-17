# Restore the objects migration 316 dropped

Migration 316 (host release 4, #1735) dropped the retired experiment platform, the digital twin and the shadow
planner objects. Nothing that runs reads them, so a restore is needed only to recover their data, not for service.
The ledgered migration runner cannot run 316 backwards; this procedure restores the objects by hand from the archive
written before the drop.

## The archive

- Location: the directory `archive/phase4-drops-316-20261117-a2` on the `verdify-db-dumps` volume (the volume the
  nightly backup pair uses; see [`db-backup-pair-restore.md`](db-backup-pair-restore.md)).
- Written and verified on 2026-11-17 at 03:28Z from ledger 314, inside one read-only snapshot: 48 tables (3 of them
  hypertables) with the inventory row counts, 11 views, 113 functions and 13 roles.
- `MANIFEST.sha256` has SHA-256 `6f662f7ca704f3767db9f448b8b4c92650cf1950f433f876127ceb1db010b596`.
- The directory `archive/phase4-drops-316-20261117` next to it is an incomplete first attempt without a manifest. It is
  not part of the archive; do not restore from it.
- Two-year NAS and offsite custody is tracked in jvallery/storage-infra#1935. The nightly backup pair of the drop
  night is the second copy.

What the directory holds:

- `tables.dump`: `pg_dump -Fc` of the 48 tables (schema, data, owners and grants).
- `hypertable-<table>.csv.gz`: the chunk data of the 3 twin hypertables (all three held 0 rows).
- `views.sql`: schema-only dump of the 11 views.
- `functions.sql`: `pg_get_functiondef` of the 113 functions, each followed by its owner and ACL as a comment line.
- `roles.sql`: the 13 roles from `pg_dumpall --roles-only`, with attributes and memberships and no passwords.
- `counts.tsv`: `count(*)` per table in the snapshot; `expected-counts.tsv`: the inventory counts it was checked
  against; the lists it worked from (`tables.txt`, `hypertables.txt`, `views.txt`, `functions.txt`, `roles.txt`).
- `MANIFEST.sha256`: the SHA-256 of every other file, written last.

## Verify before restoring

From a pod that mounts the `verdify-db-dumps` volume read-only, in the archive directory:

```bash
sha256sum MANIFEST.sha256      # must equal 6f662f7c...b010b596 above
sha256sum -c MANIFEST.sha256   # every file OK
```

Compare `counts.tsv` with `expected-counts.tsv`; they must be equal.

## Restore into a scratch database (the normal case)

A data recovery needs only a scratch database, never `verdify`. Use the pattern of
[`db-backup-pair-restore.md`](db-backup-pair-restore.md): a one-shot pod with the `verdify-db-dumps` volume mounted
read-only, a socket-only PostgreSQL with TimescaleDB in an `emptyDir`, and no production credential. In that scratch
database, as its superuser, in this order:

1. Roles: apply `roles.sql` (CREATE ROLE, attributes and memberships; no passwords).
2. Table definitions without their constraints and triggers:
   `pg_restore -d scratch --section=pre-data tables.dump`. Then run `create_hypertable` on the three twin
   hypertables as their original migrations do.
3. Views: apply `views.sql`.
4. Functions: run `SET check_function_bodies = off;` in the same session, then apply `functions.sql`. Its functions
   are in name order and some SQL functions call ones later in the list, so with body checks on the first statement
   fails. Re-apply the owner and ACL that each function's comment line records only if the recovery needs them.
5. Data: `pg_restore -d scratch --section=data tables.dump`. The foreign keys do not exist yet, so the load order
   does not matter. The twin hypertables' chunk data is in gzip files:
   `\copy <table> FROM PROGRAM 'gzip -dc hypertable-<table>.csv.gz' WITH (FORMAT csv, HEADER)` (all three held 0
   rows).
6. Constraints, indexes and triggers: `pg_restore -d scratch --section=post-data tables.dump`. This runs after the
   data and after the functions the 62 triggers call.
7. Compare `count(*)` per table with `counts.tsv`; read or export what is needed, then delete the pod.

Grants are not needed in a scratch database. If a recovery needs them, apply only the statements of
[`phase4-drop-316-grants.sql`](phase4-drop-316-grants.sql) that name a restored object (the export taken at
2026-11-17T03:28:31Z from ledger 314; 83 GRANT statements; SHA-256
`460c5c3df0426a2e9b4a7769cba2c251e9a7fd839ede803765e8247a4b014fc6`).

## Restoring into `verdify`

Not by hand. The runtime logins attest a digest of every grant in their scope, sealed by the latest migration:
`USAGE` on schema `public` for the restored roles (grants file lines 2-7), the grants on kept tables (lines 12-17)
and the ingestor login's grants on three restored relations and four restored functions all change the API,
ingestor and MCP digests. After a hand restore every new API, operator-API and MCP connection fails attestation, and
the ingestor, the only device writer, exits at its next start.

Restoring into `verdify` therefore goes only through a new numbered migration: restore with `pg_restore -x` (no
grants) in the section order above, add back only the grants the purpose needs, and re-seal the api, ingestor and
MCP receipts in its successor block at the values `scripts/qualify-migration-successor.py` measures. Never re-grant
EXECUTE on `fn_record_equipment_direct_state_snapshot(...)` to `verdify_experiment_equipment_source_collector` on its
own: the ingestor's attestation checks an exact set of functions, so that grant goes back only with an ingestor and
credential hook change that lists it again.

Record any restore on the release's tracking issue.
