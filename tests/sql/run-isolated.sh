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
  supabase/staged/zone_hierarchy.sql tests/sql/zone-hierarchy.sql \
  tests/sql/quality-report-link-fixture.sql supabase/staged/quality_report_link.sql tests/sql/quality-report-link.sql \
  tests/sql/work-instruction-fixture.sql supabase/staged/work_instruction_acknowledgement.sql tests/sql/work-instruction.sql \
  tests/sql/photo-requirements-fixture.sql supabase/staged/photo_requirements_control.sql tests/sql/photo-requirements.sql \
  tests/sql/work-photo-evidence-fixture.sql supabase/staged/work_photo_evidence.sql tests/sql/work-photo-evidence.sql \
  tests/sql/attendance-payroll-fixture.sql supabase/staged/attendance_weekly_payroll.sql tests/sql/attendance-payroll.sql
run_suite sbuild_communications_test tests/sql/communications-setup.sql \
  supabase/migrations/20261127230500_scope_project_communications.sql \
  supabase/migrations/20261127230501_protect_telegram_contact_tokens.sql tests/sql/communications-assertions.sql \
  supabase/migrations/20261127231500_reconcile_telegram_delivery.sql tests/sql/telegram-delivery.sql
run_suite sbuild_project_finance_test tests/sql/work-assignments-fixture.sql \
  supabase/staged/project_finance_ledger.sql tests/sql/project-finance-ledger.sql
run_suite sbuild_client_report_snapshot_test tests/sql/work-assignments-fixture.sql \
  tests/sql/client-report-snapshot-fixture.sql supabase/staged/client_report_snapshots.sql \
  tests/sql/client-report-snapshot.sql \
  supabase/staged/client_report_charges.sql tests/sql/client-report-charges.sql

run_suite sbuild_owner_daily_summary_test tests/sql/owner-daily-summary-fixture.sql   supabase/staged/owner_daily_summary.sql tests/sql/owner-daily-summary.sql
