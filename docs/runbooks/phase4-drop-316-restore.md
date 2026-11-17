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

## Restore

Run as the database owner role against `verdify`, from a pod that mounts the archive and reaches `verdify-db`:

1. Roles first: apply `roles.sql`. It carries CREATE ROLE, attributes and memberships and no passwords; the logins
   stay without a password unless a credential is sealed again, which nothing needs.
2. Tables: `pg_restore -d verdify --schema-only tables.dump`, then `pg_restore -d verdify --data-only tables.dump`
   (add `-O -x` only if an owner or grantee no longer exists). Twin hypertables: recreate them from the dump, run
   `create_hypertable` as in their original migrations, then `\copy ... FROM` the CSV files.
3. Views: apply `views.sql`. Functions: apply `functions.sql`, then re-apply the owner and ACL that each function's
   comment line records.
4. Grants of the 13 roles: apply [`phase4-drop-316-grants.sql`](phase4-drop-316-grants.sql), the grants export taken
   at 2026-11-17T03:28:31Z from ledger 314 (83 GRANT statements; SHA-256
   `460c5c3df0426a2e9b4a7769cba2c251e9a7fd839ede803765e8247a4b014fc6`). It restores the roles' grants on the objects
   316 kept as well as on the restored ones.
5. Do not re-grant EXECUTE on `fn_record_equipment_direct_state_snapshot(...)` to
   `verdify_experiment_equipment_source_collector` on its own: the ingestor's login attestation checks an exact set of
   functions, so that grant goes back only together with an ingestor and credential hook change that lists it again.
6. Record the restore as a hand restore on the release's tracking issue, or ship it as a new numbered migration.
