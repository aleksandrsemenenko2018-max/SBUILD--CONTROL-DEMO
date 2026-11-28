#!/usr/bin/env bash
set -euo pipefail

case "${PGHOST:-}" in
  127.0.0.1|localhost) ;;
  *) echo 'Set PGHOST to a disposable localhost PostgreSQL instance.' >&2; exit 1 ;;
esac
unset PGSERVICE PGSERVICEFILE PGDATABASE
run_suite() {
  local db="$1"
  shift
  createdb --maintenance-db=postgres "$db"
  local -a files=()
  for file in "$@"; do files+=(-f "$file"); done
  psql -X -v ON_ERROR_STOP=1 -d "$db" "${files[@]}"
}

run_suite sbuild_warehouse_test tests/sql/warehouse-fixture.sql \
  supabase/migrations/20261128003000_warehouse_operations.sql tests/sql/warehouse-operations.sql \
  supabase/migrations/20261128003100_plan_analysis_quota.sql tests/sql/plan-analysis.sql
run_suite sbuild_work_assignment_test tests/sql/work-assignments-fixture.sql \
  supabase/staged/work_assignments.sql tests/sql/work-assignments.sql \
  supabase/staged/zone_hierarchy.sql tests/sql/zone-hierarchy.sql
run_suite sbuild_communications_test tests/sql/communications-setup.sql \
  supabase/migrations/20261127230500_scope_project_communications.sql \
  supabase/migrations/20261127230501_protect_telegram_contact_tokens.sql tests/sql/communications-assertions.sql \
  supabase/migrations/20261127231500_reconcile_telegram_delivery.sql tests/sql/telegram-delivery.sql
