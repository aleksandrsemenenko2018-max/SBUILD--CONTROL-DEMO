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

## Work-report quality checklists

`quality_report_link.sql` uses the existing `report_id` column. A worker can link a checklist to their own report, and a project manager can link a checklist to visible reports for their project. Linked checklists inherit the report zone. Project managers and the report author can read linked checklists. Final approval requires all linked checklists to be approved and preserves the resulting evidence. General project checklists remain available.

For isolated assertions, run `tests/sql/quality-report-link-fixture.sql`, `supabase/staged/quality_report_link.sql` and `tests/sql/quality-report-link.sql` in that order after the work assignment fixture and migration.

## Work-instruction acknowledgement

`work_instruction_acknowledgement.sql` follows `work_assignments.sql`. Managers enter the job-specific technology instructions when assigning work. The assigned worker reads and acknowledges them before starting. PostgreSQL enforces the start condition and stores the actor and timestamp in an append-only acknowledgement. Previously issued assignments without instructions are grandfathered.

For isolated assertions, run `tests/sql/work-instruction-fixture.sql`, `supabase/staged/work_instruction_acknowledgement.sql` and `tests/sql/work-instruction.sql` in that order after the work assignment fixture and migration.

## Hidden-work photo requirements

`photo_requirements_control.sql` enables owners and project foremen to configure the existing default photo-rule row until the report is finally approved. The change locks the report, is audited, and keeps the existing server-side photo approval checks. Rule changes are made through the scoped RPC. A recheck can be required when hidden-work evidence is required.

For isolated assertions, run `tests/sql/photo-requirements-fixture.sql`, `supabase/staged/photo_requirements_control.sql` and `tests/sql/photo-requirements.sql` in that order after the work assignment fixture and migration.

## Project finance ledger

`project_finance_ledger.sql` depends on the project and profile tables plus the existing private project-access helper. This staged schema gives active owners an append-only UAH ledger. Owners can record agreed customer charges, actual payments and advances, refunds, and transport expenses. A reversal records a reason and cancels one original entry without erasing it. Retry of an identical operation uses its original ID.

Customer balance is recorded charges plus refunds minus payments and advances. A negative balance is customer credit. Approved work stays in existing project finance analytics until an agreed charge is entered. This ledger does not infer invoices, due dates, taxes, rates, or customer-facing receipt eligibility. Transport entries stay separate from the existing expense-based margin and the customer report.

Verify the schema in a disposable database with `tests/sql/work-assignments-fixture.sql`, `supabase/staged/project_finance_ledger.sql`, and `tests/sql/project-finance-ledger.sql` in that order. The existing isolated SQL CI runs these files. Browser scenarios stub every Supabase request, including the ledger RPC. When the staged schema is unavailable, the app shows the ledger as unavailable and disables recording.

## Work-photo upload and access

`work_photo_evidence.sql` restricts the existing private work-photo bucket to the author of the report and authorized project managers. It allows JPG, PNG and WebP objects to be registered only after verifying an existing owned Storage object, matching project/report path, size and declared MIME type. Repeat registration of the same evidence returns the existing ID. Supabase Storage's configured 15 MiB limit and MIME allowlist still apply to upload. Visual content scanning is outside this workflow.

For isolated assertions, run `tests/sql/work-photo-evidence-fixture.sql`, `supabase/staged/work_photo_evidence.sql` and `tests/sql/work-photo-evidence.sql` in that order after the photo-requirements fixture and migration.

The owner's charts use the ledger history view for the selected project and calendar date range, up to twelve monthly buckets. They compare recorded customer charges with gross payments and advances, split customer cash movements by type, and show transport separately. Reversed entries are excluded according to their current status. The lifetime balance remains separate from period flows.

## Verified attendance and weekly payout ledger

`attendance_weekly_payroll.sql` uses `sbuild_attendance_daily` as the application ledger. Project owners and assigned foremen can record attendance for active members on past or current Kyiv dates. Workers browse their own history. The older `sbuild_attendance` table remains available for historical administration.

Weekly payroll summaries show only the selected worker’s own amounts outside the owner role. The owner records a completed payment for a closed Monday-to-Sunday period based on finalized reports with complete rates. The server computes and stores the paid amount and records the actor. Duplicate writes return the existing outcome. Work approved later appears as an unpaid difference. The screen records an external payment and does not initiate one. The module leaves disbursement, advances, and separate adjustment payments to a later workflow.

Run `tests/sql/attendance-payroll-fixture.sql`, `supabase/staged/attendance_weekly_payroll.sql` and `tests/sql/attendance-payroll.sql` in that order after the existing production-workflow and photo-requirements fixtures.
## Тижневі знімки звітів замовнику

`client_report_snapshots.sql` використовує чинну схему об’єктів, зон і звітів
про виконані роботи, а також перевірку активного директора
`sbuild_private.is_owner()`. Перевіряйте його через `tests/sql/run-isolated.sh`
у порожньому тестовому PostgreSQL.

Виклик `sbuild_capture_client_report_week()` створює по одному незмінному
знімку за попередній завершений ISO-тиждень для кожного активного об’єкта.
Звичайний запуск використовує календар Києва. Службова роль може також
указати `p_week_start` (понеділок завершеного тижня), `p_project_id`
або `p_time_zone => 'UTC'` для тесту чи історичного знімка. Повторний
виклик повертає кількість нових знімків і зберігає вже зафіксовані дані.
Пізні затвердження враховуються в ручному звіті, але не переписують
раніше збережений знімок.

Знімок доступний лише активному директору. Він містить затверджені
обсяги за зонами, клієнтську вартість робіт і кількість рядків без ціни.
У ньому немає працівників, внутрішніх ставок, закупівельних цін,
маржинальності, чернеток, фото, чеків або посилань на сховище. Вільний
текст опису потребує перевірки директором перед передаванням замовнику.
Автоматичний знімок не розсилається. Наявний ручний експорт залишається
доступним окремо.

`client_report_snapshot_schedule.sql` окремо реєструє завдання в
ізольованій базі з увімкненим Supabase Cron і налаштуванням UTC.
Реєстрацію виконує роль-власник функції. Завдання планується щопонеділка
о 06:00 UTC з повторними спробами о 07:00 і 08:00 UTC. У робочій базі ці
скрипти не застосовувалися.
## Owner daily summary

Apply `owner_daily_summary.sql` after work assignments and communications access policies in an isolated environment, then verify an active owner and an authenticated non-owner. The read-only RPC `sbuild_owner_daily_summary` returns counts per accessible project. The activity counts are a live snapshot. The date defaults to Europe/Kyiv and determines which unfinished assignments are due or overdue. Telegram distribution and scheduling are separate.

For an isolated PostgreSQL fixture run the three files in order with `psql -v ON_ERROR_STOP=1 -f tests/sql/owner-daily-summary-fixture.sql -f supabase/staged/owner_daily_summary.sql -f tests/sql/owner-daily-summary.sql`.
