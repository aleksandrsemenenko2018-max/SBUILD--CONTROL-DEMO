# Staged work assignments

`work_assignments.sql` is a transactional migration candidate for the existing S-BUILD Supabase schema. Apply it only to an isolated database that has the projects, profiles, project membership, zones, work reports and private project-access helpers. The migration does not backfill existing work reports. Use a native Supabase migration on a staging environment before production rollout.

The assignment workflow reuses existing report approvals. An active foreman manages tasks on assigned projects. An active owner manages tasks across projects. Workers and brigade leads see their own assignments on member projects. An assignee can start work and attach their submitted report from the same project and zone. A report returned in the existing review flow can be detached for rework. Final work status and photos continue to use the existing report workflow. The assignment audit trail is generated within the same transaction as each change.

## Isolated database assertions

With a disposable, empty local database named `sbuild_work_assignment_test`, use a PostgreSQL user allowed to create roles and tables. The fixture rejects a database that already contains an `auth` schema or S-BUILD projects.

```sh
psql -X -v ON_ERROR_STOP=1 -d sbuild_work_assignment_test \
  -f tests/sql/work-assignments-fixture.sql \
  -f supabase/staged/work_assignments.sql \
  -f tests/sql/work-assignments.sql
```

The fixture mimics the existing membership helpers and applies the actual migration. Assertions run as synthetic anonymous, worker and manager roles. They exercise cross-project isolation, scopes, assignment state changes, audit integrity and the relationship to existing reports. Browser tests in `tests/work-assignments.browser.test.cjs` mock all Supabase requests.

## Typed project zones

`zone_hierarchy.sql` adds floor → room → segment A–G to the existing zone table. Existing zone IDs and names are preserved. This extension uses the existing zone-access policies. Workers can browse their project hierarchy and owners or project foremen can create and rename typed zones. Moves, reclassification and deletion are outside this workflow because other records reference zone IDs.

To verify both migration candidates in one empty disposable database, append `-f supabase/staged/zone_hierarchy.sql -f tests/sql/zone-hierarchy.sql` to the preceding command.
