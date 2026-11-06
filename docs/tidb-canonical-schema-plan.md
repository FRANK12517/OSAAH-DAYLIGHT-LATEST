# TiDB canonical schema plan — evidence and reconciliation

> **Status: NOT CANONICAL.** This report is generated from source SQL strings and the merged migration inventory. Static extraction cannot prove dynamic queries, current column types, defaults, nullability, transaction behavior, or which historical definitions remain active. No DDL should be generated from this report.

## Scope and identifiers

- Repository revision reviewed: `e142db137ac3cfd1a60c6981774763df59612333` (working tree includes preserved uncommitted work).
- Historical SQL files: 82; runtime source files scanned: 157.
- Target database: `osaahdaylightschool`; single school: `sch_default_01`. No school, user, student, or other operational rows are proposed.
- Historical table-name inventory: 157; separate PostgreSQL baseline table-name set: 161; native TiDB platform metadata DDL tables: 5; combined names: 164; historically declared views: 8.
- Runtime SQL references extracted: 577 (static literal scan; dynamically assembled SQL can be missed).

- Evidence candidates (not canonical requirements): 1827 historical column/type pairs, 3461 parallel PostgreSQL column-definition occurrences, 140 runtime write-column pairs, 157 historical PK items, 103 historical unique items, 400 historical FK items, 175 historical secondary-index items. PostgreSQL constraint totals are separately recorded in the manifest; overlapping and superseded evidence is not deduplicated into a final schema.

## Classification

| Classification | Count | Meaning |
|---|---:|---|
| Runtime SQL confirmed | 72 | Static SQL literal references identify a query or write target. |
| Runtime reference, operation unresolved | 16 | Existing generated inventory links runtime files, but this scanner did not extract a SQL operation. |
| Historical, potentially obsolete or indirect | 75 | Found in migration evidence without an extracted runtime reference; not discarded. |

| PostgreSQL baseline only | 0 | Present in separate PostgreSQL baseline evidence without extracted runtime SQL or historical inventory mapping; not TiDB-confirmed. |

- Runtime SQL tables with no historical or parallel PostgreSQL column evidence: 1.
- Runtime write-column pairs with no historical or parallel PostgreSQL column evidence: 2.

## Table-by-table evidence matrix

The machine-readable manifest contains the full source-file list, operation counts, SQL statement locations, historical columns/types, key/index/FK evidence and migration provenance for each name. Historical type and constraint fields are candidates only; defaults and nullability are not promoted to canonical requirements.

| Table | Classification | Runtime files | SQL operations (FROM/JOIN/I/U/D) | Historical creates / alters | Provenance |
|---|---|---:|---:|---:|---|
| `academic_calendar_events` | RUNTIME_SQL_CONFIRMED | 4 | 4/0/1/2/1 | 1/0 | 058_academic_calendar.sql |
| `academic_calendar_term_configs` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 058_academic_calendar.sql |
| `academic_result_blocks` | RUNTIME_SQL_CONFIRMED | 3 | 6/0/1/4/0 | 1/4 | 064_academic_result_blocking.sql, 075_result_blocking_examination_scope.sql, 083_result_blocking_tidb_scope.sql |
| `academic_result_records` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 067_academic_result_lifecycle.sql |
| `academic_result_unblock_requests` | RUNTIME_SQL_CONFIRMED | 2 | 2/0/1/1/0 | 1/3 | 064_academic_result_blocking.sql, 075_result_blocking_examination_scope.sql |
| `academic_score_records` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 3 | 0/0/0/0/0 | 2/0 | 017_academic_results_migration.sql, 068_academic_score_records_foundation.sql |
| `academic_years` | RUNTIME_SQL_CONFIRMED | 21 | 18/12/0/0/0 | 1/0 | 001_foundation.sql |
| `admission_applications` | RUNTIME_SQL_CONFIRMED | 4 | 6/0/1/12/0 | 1/2 | 003_students_admissions.sql, 028_admission_student_master_fk.sql, 078_admissions_leadership_access.sql |
| `admission_documents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 015_admission_form_fee_engine.sql |
| `admission_fee_structures` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 015_admission_form_fee_engine.sql |
| `admission_form_applications` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 015_admission_form_fee_engine.sql |
| `admission_prospectuses` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 016_admission_prospectus.sql |
| `ai_audit_logs` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/1/0/0 | 1/0 | 018_ai_audit_logs.sql |
| `ai_human_controlled_actions` | RUNTIME_SQL_CONFIRMED | 1 | 4/0/1/1/0 | 1/0 | 022_ai_human_controlled_actions.sql |
| `announcement_reads` | RUNTIME_SQL_CONFIRMED | 1 | 1/1/1/1/0 | 1/0 | 076_durable_announcements.sql |
| `announcement_recipients` | RUNTIME_SQL_CONFIRMED | 1 | 1/1/1/0/0 | 1/0 | 076_durable_announcements.sql |
| `announcement_records` | RUNTIME_SQL_CONFIRMED | 1 | 2/0/1/1/0 | 1/0 | 076_durable_announcements.sql |
| `announcements` | RUNTIME_SQL_CONFIRMED | 13 | 1/0/0/0/0 | 1/0 | 010_communication.sql |
| `assets` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 16 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `assignment_files` | RUNTIME_SQL_CONFIRMED | 3 | 3/0/1/0/0 | 1/0 | 062_assignments.sql |
| `assignments` | RUNTIME_SQL_CONFIRMED | 25 | 3/0/1/1/0 | 1/0 | 062_assignments.sql |
| `attendance_audit_history` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/1/0/0 | 2/0 | 036_attendance_provenance_audit.sql, 049_production_schema_reconciliation.sql |
| `attendance_notification_settings` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 006_attendance.sql |
| `attendance_sync_conflicts` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 006_attendance.sql |
| `audit_logs` | RUNTIME_SQL_CONFIRMED | 3 | 1/0/2/0/0 | 1/0 | 001_foundation.sql |
| `auth_sessions` | RUNTIME_SQL_CONFIRMED | 9 | 2/0/0/6/0 | 2/0 | 052_durable_auth_sessions.sql, 053_forward_production_reconciliation.sql |
| `budget_items` | RUNTIME_SQL_CONFIRMED | 3 | 3/0/2/0/1 | 1/0 | 050_budget_management.sql |
| `budgets` | RUNTIME_SQL_CONFIRMED | 9 | 3/0/1/2/0 | 1/0 | 050_budget_management.sql |
| `calendar_events` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 010_communication.sql |
| `canonical_academic_scores` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 055_canonical_academic_scores.sql |
| `canonical_ges_assessments` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 056_canonical_ges_assessments.sql |
| `class_label_aliases` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 031_controlled_schema_upgrade.sql |
| `class_subjects` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/0/0/0 | 0/0 | none indexed |
| `classes` | RUNTIME_SQL_CONFIRMED | 44 | 18/8/0/0/0 | 1/4 | 001_foundation.sql, 031_controlled_schema_upgrade.sql, 038_canonical_class_database_fee_hub.sql |
| `communication_delivery_log` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 010_communication.sql |
| `communication_delivery_logs` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `communication_messages` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `communication_outbox` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `communication_providers` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `communication_templates` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `communication_trigger_settings` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 025_communication_engine.sql |
| `compliance_inspections` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `compliance_records` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `counselling_records` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `data_breaches` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `data_protection_officers` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `departments` | RUNTIME_SQL_CONFIRMED | 2 | 0/1/0/0/0 | 1/0 | 001_foundation.sql |
| `document_versions` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `examination_candidates` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `examination_marks` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `examination_subjects` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `examination_timetable` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `examinations` | RUNTIME_SQL_CONFIRMED | 14 | 1/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `external_exam_records` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `fee_collection_corrections` | RUNTIME_SQL_CONFIRMED | 1 | 0/0/1/0/0 | 2/0 | 030_fee_collection_corrections.sql, 049_production_schema_reconciliation.sql |
| `fee_collection_records` | RUNTIME_SQL_CONFIRMED | 3 | 4/0/1/1/0 | 2/6 | 029_fee_obligations_collections.sql, 037_collection_periods.sql, 047_fee_types_registry.sql, 049_production_schema_reconciliation.sql |
| `fee_invoice_items` | RUNTIME_SQL_CONFIRMED | 2 | 2/0/1/0/0 | 3/2 | 038_canonical_class_database_fee_hub.sql, 043_fee_invoices.sql, 049_production_schema_reconciliation.sql |
| `fee_invoices` | RUNTIME_SQL_CONFIRMED | 3 | 1/2/1/1/0 | 3/6 | 038_canonical_class_database_fee_hub.sql, 043_fee_invoices.sql, 049_production_schema_reconciliation.sql |
| `fee_obligations` | RUNTIME_SQL_CONFIRMED | 4 | 5/1/1/0/0 | 2/1 | 029_fee_obligations_collections.sql, 031_controlled_schema_upgrade.sql, 049_production_schema_reconciliation.sql, 057_fee_obligation_custom_type.sql |
| `fee_payments` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/0/0/0 | 1/0 | 038_canonical_class_database_fee_hub.sql |
| `fee_receipts` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 038_canonical_class_database_fee_hub.sql |
| `fee_structures` | RUNTIME_SQL_CONFIRMED | 3 | 1/0/0/0/0 | 1/5 | 008_fees_finance.sql, 047_fee_types_registry.sql, 049_production_schema_reconciliation.sql |
| `fee_structures_v2` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/0/0/0 | 1/0 | 040_fee_structures_v2.sql |
| `fee_types` | RUNTIME_SQL_CONFIRMED | 3 | 4/1/3/0/0 | 2/0 | 047_fee_types_registry.sql, 049_production_schema_reconciliation.sql |
| `financial_adjustments` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 008_fees_finance.sql |
| `financial_audit_history` | RUNTIME_SQL_CONFIRMED | 4 | 0/0/2/0/0 | 3/2 | 045_financial_audit_history.sql, 048_financial_rbac_audit_hardening.sql, 049_production_schema_reconciliation.sql, 053_forward_production_reconciliation.sql |
| `financial_audit_log` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 038_canonical_class_database_fee_hub.sql |
| `general_expenses` | RUNTIME_SQL_CONFIRMED | 4 | 2/0/0/0/0 | 1/0 | 051_income_expense_management.sql |
| `general_income` | RUNTIME_SQL_CONFIRMED | 4 | 2/0/0/0/0 | 1/0 | 051_income_expense_management.sql |
| `grading_systems` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 007_examinations_results.sql |
| `health_records` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `health_visits` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `hostel_allocations` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `hostel_spaces` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `houses` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 2 | 0/0/0/0/0 | 1/0 | 001_foundation.sql |
| `inventory_items` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `inventory_movements` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `invoices` | RUNTIME_SQL_CONFIRMED | 15 | 1/0/0/0/0 | 1/0 | 008_fees_finance.sql |
| `levels` | RUNTIME_SQL_CONFIRMED | 6 | 0/3/0/0/0 | 1/0 | 001_foundation.sql |
| `library_books` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `library_loans` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `managed_documents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `messages` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 11 | 0/0/0/0/0 | 1/0 | 010_communication.sql |
| `notification_preferences` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 010_communication.sql |
| `notifications` | RUNTIME_SQL_CONFIRMED | 5 | 1/0/0/0/0 | 1/0 | 010_communication.sql, 026_parent_notifications.sql |
| `official_documents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 014_reporting_documents.sql |
| `osaah_fresh_installations` | TIDB_NATIVE_PLATFORM_METADATA_DDL | 1 | 0/0/0/0/0 | 0/0 | none indexed |
| `parent_auth_challenges` | RUNTIME_SQL_CONFIRMED | 1 | 3/0/1/4/1 | 1/0 | 082_parent_sms_auth.sql |
| `parent_auth_rate_limits` | RUNTIME_SQL_CONFIRMED | 3 | 3/0/1/1/1 | 1/0 | 082_parent_sms_auth.sql |
| `parent_student_links` | RUNTIME_SQL_CONFIRMED | 11 | 8/5/1/0/0 | 1/4 | 003_students_admissions.sql, 026_parent_notifications.sql, 054_durable_score_entry_academic_contract.sql |
| `payment_gateway_configs` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 008_fees_finance.sql |
| `payments` | RUNTIME_SQL_CONFIRMED | 19 | 1/0/0/0/0 | 1/0 | 008_fees_finance.sql |
| `permissions` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 46 | 0/0/0/0/0 | 2/0 | 001_foundation.sql, 032_production_rbac_reconciliation.sql |
| `portal_users` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/0/0/0 | 0/0 | none indexed |
| `privacy_consents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `privacy_requests` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `procurement_requests` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `promotion_decisions` | RUNTIME_SQL_CONFIRMED | 3 | 1/1/1/0/0 | 1/8 | 007_examinations_results.sql, 074_durable_promotion_rollover.sql |
| `property_maintenance` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `report_exports` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 014_reporting_documents.sql |
| `result_signatures` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 017_academic_results_migration.sql |
| `retention_policies` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 013_compliance_privacy.sql |
| `role_permissions` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 2/0 | 001_foundation.sql, 032_production_rbac_reconciliation.sql |
| `roles` | RUNTIME_SQL_CONFIRMED | 30 | 3/19/0/0/0 | 2/0 | 001_foundation.sql, 031_controlled_schema_upgrade.sql, 032_production_rbac_reconciliation.sql |
| `sample_data_fixtures` | RUNTIME_SQL_CONFIRMED | 1 | 3/0/1/1/0 | 1/0 | 061_durable_sample_data_fixtures.sql |
| `schema_baselines` | RUNTIME_SQL_CONFIRMED | 1 | 1/0/1/0/0 | 0/0 | none indexed |
| `schema_migration_lock` | RUNTIME_SQL_CONFIRMED | 3 | 2/0/1/2/0 | 0/0 | none indexed |
| `schema_migration_runs` | RUNTIME_SQL_CONFIRMED | 1 | 2/0/1/2/0 | 0/0 | none indexed |
| `schema_migrations` | RUNTIME_SQL_CONFIRMED | 3 | 3/0/2/0/0 | 0/0 | none indexed |
| `school_property` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 012_resources.sql |
| `schools` | RUNTIME_SQL_CONFIRMED | 10 | 6/0/0/1/0 | 1/0 | 001_foundation.sql |
| `shep_activities` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 3 | 0/0/0/0/0 | 1/0 | 021_shep_activities.sql |
| `shep_activity_attachments` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 021_shep_activities.sql |
| `shep_activity_participants` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 021_shep_activities.sql |
| `shep_audit_history` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 021_shep_activities.sql |
| `shep_referrals` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 021_shep_activities.sql |
| `sidebar_categories` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 001_foundation.sql |
| `sidebar_modules` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 6 | 0/0/0/0/0 | 1/0 | 001_foundation.sql |
| `sms_campaign_recipients` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 077_durable_sms_messages.sql |
| `sms_campaigns` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 077_durable_sms_messages.sql |
| `sporting_activities` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 3 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `sporting_fixtures` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `sporting_participants` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `sporting_results` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `sporting_sports` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `sporting_teams` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 019_sporting_activities.sql |
| `staff` | RUNTIME_SQL_CONFIRMED | 40 | 15/7/2/2/0 | 1/0 | 001_foundation.sql |
| `staff_assignments` | RUNTIME_SQL_CONFIRMED | 2 | 1/1/2/0/1 | 1/0 | 009_staff_hr.sql |
| `staff_attendance` | RUNTIME_SQL_CONFIRMED | 3 | 4/0/1/1/0 | 1/24 | 006_attendance.sql, 034_attendance_academic_scope.sql, 035_staff_leave_attendance_reconciliation.sql, 036_attendance_provenance_audit.sql, 049_production_schema_reconciliation.sql |
| `staff_attendance_reconciliation_audit` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 2/0 | 035_staff_leave_attendance_reconciliation.sql, 049_production_schema_reconciliation.sql |
| `staff_documents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 009_staff_hr.sql |
| `staff_leave` | RUNTIME_SQL_CONFIRMED | 2 | 2/0/0/0/0 | 1/8 | 009_staff_hr.sql, 035_staff_leave_attendance_reconciliation.sql, 049_production_schema_reconciliation.sql |
| `staff_leave_balances` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 009_staff_hr.sql |
| `staff_profiles` | RUNTIME_SQL_CONFIRMED | 6 | 8/3/2/2/0 | 1/0 | 009_staff_hr.sql |
| `streams` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 001_foundation.sql |
| `student_attendance` | RUNTIME_SQL_CONFIRMED | 4 | 4/0/1/1/0 | 1/26 | 006_attendance.sql, 034_attendance_academic_scope.sql, 036_attendance_provenance_audit.sql, 049_production_schema_reconciliation.sql, 079_attendance_legacy_schema_compatibility.sql |
| `student_class_history` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED | 1 | 0/0/0/0/0 | 1/0 | 003_students_admissions.sql |
| `student_documents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 003_students_admissions.sql |
| `student_enrollments` | RUNTIME_SQL_CONFIRMED | 10 | 6/4/3/1/0 | 1/14 | 031_controlled_schema_upgrade.sql, 038_canonical_class_database_fee_hub.sql, 054_durable_score_entry_academic_contract.sql, 059_backward_compatible_enrollment_contract.sql, 078_admissions_leadership_access.sql, 080_restore_student_enrollment_is_current.sql |
| `student_family_contacts` | RUNTIME_SQL_CONFIRMED | 1 | 4/0/1/1/0 | 1/0 | 003_students_admissions.sql |
| `student_fee_accounts` | RUNTIME_SQL_CONFIRMED | 3 | 1/2/1/0/0 | 3/8 | 038_canonical_class_database_fee_hub.sql, 041_student_fee_accounts.sql, 049_production_schema_reconciliation.sql |
| `student_fee_charges` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 038_canonical_class_database_fee_hub.sql |
| `student_fee_discounts` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 038_canonical_class_database_fee_hub.sql |
| `student_fee_ledger` | RUNTIME_SQL_CONFIRMED | 2 | 1/0/2/0/0 | 2/0 | 042_student_fee_ledger.sql, 049_production_schema_reconciliation.sql |
| `student_fee_payments` | RUNTIME_SQL_CONFIRMED | 3 | 3/0/1/0/0 | 2/12 | 044_fee_payments_receipts.sql, 049_production_schema_reconciliation.sql |
| `student_fee_receipts` | RUNTIME_SQL_CONFIRMED | 4 | 1/2/1/0/0 | 3/7 | 044_fee_payments_receipts.sql, 049_production_schema_reconciliation.sql, 053_forward_production_reconciliation.sql |
| `student_health_records` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 003_students_admissions.sql |
| `student_id_sequences` | RUNTIME_SQL_CONFIRMED | 2 | 4/0/2/2/0 | 2/0 | 023_permanent_student_ids.sql, 027_student_id_sequences.sql |
| `student_profiles` | RUNTIME_SQL_CONFIRMED | 16 | 8/16/2/3/0 | 1/5 | 003_students_admissions.sql, 023_permanent_student_ids.sql, 054_durable_score_entry_academic_contract.sql |
| `student_transcript_versions` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 024_student_transcripts.sql |
| `student_transcripts` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 024_student_transcripts.sql |
| `students` | RUNTIME_SQL_CONFIRMED | 61 | 14/12/1/4/0 | 1/14 | 001_foundation.sql, 038_canonical_class_database_fee_hub.sql, 039_class_database_financial_identity.sql, 054_durable_score_entry_academic_contract.sql, 081_student_health_insurance_number.sql |
| `subject_class_assignments` | RUNTIME_SQL_CONFIRMED | 3 | 7/1/2/2/0 | 2/1 | 017_academic_results_migration.sql, 065_subject_assessment_components.sql, 066_subject_class_assignments_reconciliation.sql |
| `subject_register_history` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 020_subject_register.sql |
| `subject_register_teachers` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 020_subject_register.sql |
| `subject_registers` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 020_subject_register.sql |
| `subjects` | RUNTIME_SQL_CONFIRMED | 27 | 13/1/2/4/0 | 1/3 | 001_foundation.sql, 063_subject_classification.sql, 065_subject_assessment_components.sql, 073_subject_updated_at.sql |
| `system_settings` | RUNTIME_SQL_CONFIRMED | 1 | 4/0/2/1/0 | 1/0 | 001_foundation.sql |
| `terms` | RUNTIME_SQL_CONFIRMED | 32 | 17/4/1/0/0 | 1/0 | 001_foundation.sql, 060_terms_academic_year_name_unique.sql |
| `transport_routes` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `transport_vehicles` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |
| `user_roles` | RUNTIME_SQL_CONFIRMED | 15 | 7/14/4/0/1 | 1/0 | 001_foundation.sql, 031_controlled_schema_upgrade.sql |
| `users` | RUNTIME_SQL_CONFIRMED | 24 | 21/12/2/7/0 | 1/2 | 001_foundation.sql, 031_controlled_schema_upgrade.sql, 069_production_user_login_identifiers.sql |
| `welfare_incidents` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT | 0 | 0/0/0/0/0 | 1/0 | 011_operations.sql |

## Authentication and RBAC contracts

- Password login reads account identifiers, password hash, active status, school scope, role key/rank, and permissions through `users` → `user_roles` → `roles` → `role_permissions` → `permissions`.
- Durable sessions store a SHA-256 token hash, expiry, revocation timestamp, and last-used timestamp. Login/logout/password-change paths create, restore, revoke, or touch sessions. Raw session tokens are not persisted.
- Parent phone login uses transactional rate-limit rows with `SELECT ... FOR UPDATE`; it checks school and account state and joins parent links, profiles, and master students. Parent SMS challenge DDL stores a digest and attempt/expiry/consume/invalidation state.
- Runtime role keys found: PROPRIETOR, SCHOOL_ADMIN, HEADTEACHER, ASSISTANT_HEADTEACHER, ACCOUNTANT_BURSAR, TEACHER, and PARENT. The complete permission-to-role assignment contract still requires reconciliation.
- Critical unresolved mismatch: the original `user_roles` table has a composite key and no `id`, while current application writers insert `id`; migration 032 also inserts `id` without declaring it. The separate PostgreSQL baseline includes a nullable unique `id`, but that does not establish the current TiDB definition.

## Confirmed schema evidence conflicts

- `users`: the historical foundation lacks `full_name`, `phone`, and `role`; current writers insert all three, while migration 069 only adds `username` and `updated_at`. The PostgreSQL baseline has these fields, but TiDB compatibility and the deployed TiDB contract remain unverified.
- `parent_student_links`: original DDL is extended by migration 054; runtime depends on `link_status`. Review the complete current FK and nullability contract.
- `student_profiles.student_master_id` is used by parent authentication to reach `students.id`, but readiness explicitly does not require an FK. Decide and document the intended relationship before DDL.
- `portal_users` is read by proprietor authentication and exists in PostgreSQL baseline evidence, but has no numbered migration definition.
- Session timestamps are ISO strings at runtime and VARCHAR in migration 052, while the PostgreSQL baseline uses timezone-aware timestamps. TiDB temporal type and serialization behavior need an explicit compatibility decision.

## Reconciliation and compatibility blockers

- Multiple CREATE and ALTER statements are retained as migration provenance; this scanner does not apply them as a historical replay or infer their final effect.
- Historical inventory merges superseded definitions. The PostgreSQL baseline is a separate dialect and is supporting evidence only; it cannot be translated to TiDB without type, index, generated-column, constraint, and transaction review.
- `class_subjects` is referenced only by an optional legacy compatibility path and must not be treated as a required fresh-install table based on that path alone.
- Runtime SQL extraction sees quoted literal statements only. Parameterized queries are represented, but composed SQL fragments, stored procedures, adapter callbacks, and dynamically generated identifiers need manual review.
- This pass does not resolve identifier generation, uniqueness semantics across workflows, cascades, delete behavior, default semantics, or full read-column projection contracts.
- `schema/082_parent_sms_auth.sql` uses inline column `REFERENCES` declarations. TiDB parses but ignores inline `REFERENCES`; constraints must be table-level. The expected same-type/size/precision/length/charset/collation match and parent-index requirements also need to be satisfied. Thus migration 082 does not establish those FKs in TiDB as written. See [TiDB foreign-key constraints](https://docs.pingcap.com/tidb/stable/foreign-key/).
- `schema/083_result_blocking_tidb_scope.sql` adds a virtual generated `mock_examination_key` and indexes it in the unique scope key. TiDB documentation supports indexes on virtual or stored generated columns, but the exact migration was not integration-tested against the target TiDB version. See [generated columns](https://docs.pingcap.com/tidb/stable/generated-columns/).
- TiDB supports MySQL data types except spatial; fractional seconds precision for TIME/DATETIME/TIMESTAMP is 0–6. Actual per-column type, decimal precision, charset/collation, and target-version behavior remain unresolved. See [TiDB data types](https://docs.pingcap.com/tidb/stable/data-type-overview/).
- TiDB converts TIMESTAMP values between UTC and the current session time zone; DATETIME is not converted. Historical `auth_sessions` uses VARCHAR ISO timestamps, so a temporal-type change must preserve current application serialization and UTC semantics. See [TiDB date and time types](https://docs.pingcap.com/tidb/stable/data-type-date-and-time/) and [time-zone support](https://docs.pingcap.com/tidb/stable/configure-time-zone/).
- Authentication/RBAC table names and operations are included in the matrix; exact schema completeness remains unresolved until login/session/role flows are manually reconciled against every query and migration definition.

## Next review gate

Resolve every manifest entry with current source-code evidence, reconcile all historical changes table-by-table, document unsupported or intentionally retired objects, then approve exact TiDB column and constraint contracts. Keep the fresh initializer plan unresolved until that review and isolated TiDB integration validation pass.


## Phase 2B runtime contract reconciliation

> **Status: incomplete.** Findings separate observed runtime behavior from a canonical TiDB schema. No executable DDL is approved.

- Table dispositions: {"REQUIRED_CURRENT_RUNTIME":67,"REQUIRED_SUPPORTED_WORKFLOW":5,"LEGACY_COMPATIBILITY_ONLY":1,"OBSOLETE_WITH_EVIDENCE":0,"UNRESOLVED":91}.
- View dispositions: {"REQUIRED_CURRENT_RUNTIME":0,"REQUIRED_SUPPORTED_WORKFLOW":5,"LEGACY_COMPATIBILITY_ONLY":0,"OBSOLETE_WITH_EVIDENCE":0,"UNRESOLVED":3}.
- No object is marked obsolete solely because static SQL extraction found no literal query.
- No ORM/query-builder dependency was found; mysql2 and pg are the declared database clients.

### users

- Status: `PARTIALLY_RESOLVED_SCHEMA_UNRESOLVED`.
- runtime: {"id":"randomUUID() in durable staff/admission writers","schoolId":"single-school sch_default_01","fullName":"Required in staff provisioning; parent enrollment writes provided name or Parent fallback","phone":"Optional for staff; valid normalized Ghana phone required for parent identity and used as username","role":"Writers persist role for compatibility; authentication resolves authority through user_roles/roles and permissions","username":"Required by staff provisioning; parent writer uses normalized phone","email":"Required/validated for staff; optional for parents; duplicate checks differ by workflow","passwordHash":"Staff/admin credential writes use scrypt salt:hex format; admission-generated parent uses bcrypt cost 12; verifier accepts both scrypt and bcrypt; proprietor endpoint is bcrypt-only","status":"Writers use ACTIVE; login requires ACTIVE (legacy NULL status is treated as ACTIVE in some reset paths, but login defaults missing status to ACTIVE)","createdAt":"UTC ISO-8601 strings","updatedAt":"Staff writer sets it; parent enrollment omits it, so schema must permit omission via default or nullability"}
- uniqueness: {"username":"Historical unique scope is (school_id, username); runtime checks school scope","email":"No historical unique constraint established; staff duplicate check is global while parent duplicate check is school-scoped and login searches without school scope","status":"UNRESOLVED_POLICY_AND_EXISTING_DUPLICATE_STATE"}
- unresolved: ["TiDB type/length/collation/nullability/defaults","safe email uniqueness policy and duplicate data state","parent writer updated_at omission/default contract","whether to retain users.role as a compatibility field"]

### user_roles

- Status: `ID_COLUMN_AND_PAIR_SEMANTICS_RESOLVED_PRIMARY_KEY_UNRESOLVED`.
- evidence: ["schema/001_foundation.sql and current relational model use composite primary key (user_id, role_id), no id","src/admission-enrollment.js and src/durable-staff-provisioning.js insert a generated id","schema/032_production_rbac_reconciliation.sql inserts id but does not define it","PostgreSQL baseline contains nullable unique id plus composite primary key"]
- runtime: ["id is a required inserted column in staff and admission writers and migration 032; all use randomUUID() for new assignments","No current query reads user_roles.id","Duplicate user-role pairs are treated as conflicts; role changes delete scoped assignments then insert a new pair","No status, expiry, or school_id is written on the relationship; school scope is enforced through user and role joins"]
- proposedContract: Retain non-null unique UUID id to satisfy existing writes and preserve UNIQUE(user_id, role_id) to prevent duplicate assignments. Choosing id as PRIMARY KEY versus retaining the historical composite PRIMARY KEY is a physical-schema decision; either must preserve both constraints and cannot be settled from current query behavior alone.
- unresolved: ["Primary-key choice, UUID SQL type/length, timestamp nullability/default, and table-level FK actions"]

### RBAC relationship

- Status: `RELATIONAL_FLOW_ESTABLISHED_SCHEMA_UNRESOLVED`.
- relationship: users -> user_roles -> roles -> role_permissions -> permissions
- evidence: ["src/auth.js password and durable-session queries join all five tables","src/durable-staff-provisioning.js assigns roles through user_roles and roles","schema/001_foundation.sql declares composite mapping keys; schema/032 defines role_permissions composite key"]
- permissions: Database permission rows are loaded when available; auth.js falls back to hard-coded role permission sets when the permission result is empty. Parent permissions are added in application code.
- unresolved: ["RBAC seed/assignment completeness, school/global role scoping, FK enforcement, and whether empty database permissions should imply fallback grants"]

### portal_users

- Status: `CURRENT_ENDPOINT_DEPENDENCY_SEPARATE_AUTH_UNRESOLVED`.
- evidence: ["src/server.mjs exposes POST /api/auth/proprietor/login when database adapter exists","controller requires id, portal_name, email, password_hash, role, is_active; accepts only active PROPRIETOR and verifies bcrypt","PostgreSQL baseline adds school_id, phone, full_name, status, linked_user_id, created_at, updated_at and unique email"]
- behavior: Separate bcrypt login path; it returns metadata but does not establish the standard osaah_session cookie/session row. No portal_users writer/provisioning path was found.
- disposition: Required for a clean install while the endpoint is retained; a unified users/RBAC design would require an explicit backward-compatible application decision.
- unresolved: ["No numbered TiDB migration; which baseline-only fields are actually required; account creation/linkage/retirement policy"]

### staff_profiles

- Status: `CONTRACT_CONFLICT_UNRESOLVED`.
- staffNumber: Current durable writer copies the supplied staffId to staff.staff_number and staff_profiles.staff_number; duplicate checks are school-scoped; list/API output exposes staff.staff_number as staffId. It is an externally supplied employee/display identifier, not generated by this writer.
- relationship: Current writer gives users.id, staff.id, and staff_profiles.id the same UUID and joins profile to staff via user_id; it does not FK staff_profiles.staff_number to a staff row.
- historical: schema/009_staff_hr.sql instead defines staff_id and employee_id as separate unique identifiers plus HR profile fields; it has no staff_profiles.staff_number or user_id. PostgreSQL baseline mirrors that HR shape.
- unresolved: ["Current writer also inserts department, position, date_hired, and qualification with a shape not defined by schema/009 or PostgreSQL baseline","No authoritative decision whether staff_profiles remains a rich HR profile or is a parallel provisioning projection","Uniqueness and FK contract must not be guessed"]

### parent_student_links and student_profiles.student_master_id

- Status: `IDENTITY_PATH_ESTABLISHED_REFERENTIAL_CONTRACT_UNRESOLVED`.
- relationship: parent_student_links.parent_user_id -> users.id; parent_student_links.student_id -> student_profiles.id; student_profiles.student_master_id -> students.id; student_profiles.student_id carries the permanent Student ID compatibility bridge.
- keys: schema/003 uses composite primary key (parent_user_id, student_id), preventing duplicate pairs; relationship id is the pair, not a separate generated id.
- runtime: Enrollment writes relationship, relationship_type, ACTIVE, created_at, updated_at; parent auth and fee/student portal paths filter ACTIVE. No current link-status update/delete workflow or primary-guardian column/rule was found.
- unresolved: ["schema/054 adds nullable student_master_id and link_status but no TiDB table-level FKs","Soft archival/deactivation and multiple-guardian policy","Identifier type/length/charset equality and delete actions"]

### auth_sessions

- Status: `REPRESENTATION_DECISION_RESOLVED_SCHEMA_REMAINDER_UNRESOLVED`.
- decision: Keep VARCHAR(32) for created_at, expires_at, revoked_at, last_used_at; store canonical UTC ISO-8601 text exactly as JavaScript Date.toISOString() emits. Do not convert to DATETIME/TIMESTAMP in this phase.
- evidence: ["schema/052 and schema/053 declare VARCHAR(32) timestamps","src/auth.js uses a 30-minute TTL and serializes timestamps using toISOString()","Session restore parses expires_at with Date.parse and compares stored expires_at to the same canonical UTC string","Creation uses UUID id and stores SHA-256 token hash; token_hash is unique","Expiration is fixed at creation; restore updates last_used_at but does not extend expires_at; logout/password changes/account changes revoke rows. No durable expired-session deletion/cleanup job was found."]
- indexes: ["PRIMARY KEY(id)","UNIQUE(token_hash)","idx_auth_sessions_user_active(user_id, revoked_at, expires_at)","idx_auth_sessions_school(school_id)","idx_auth_sessions_expiry(expires_at, revoked_at)"]
- unresolved: ["Explicit UTC validation/driver string settings are not currently enforced","user_id and school_id inline REFERENCES in schema/052 are ignored by TiDB; decide table-level FKs after type reconciliation","Expired/revoked row retention and cleanup owner/retention period are not established"]

### historical foreign keys

- Status: `PARTIALLY_AUDITED_TARGET_VERSION_UNRESOLVED`.
- findings: ["The 82 numbered migration files contain 402 REFERENCES token occurrences and 35 FOREIGN KEY token occurrences; these static token counts include historical definitions and are not the count of current enforceable constraints.","Most foundation-era declarations use inline REFERENCES; TiDB parses but ignores these. The explicit table-level constraints in later migrations are candidate enforcement only and still need target version, matching types/length/charset/collation/indexes and delete/update action review.","Migration 082 contains two inline REFERENCES declarations; neither establishes a TiDB foreign key as written."]
- targetVersion: Not observed in this read-only repository review; TiDB FK support begins at v6.6 and is generally available from v8.5.0.
- unresolved: ["Per-relationship full enforcement matrix and exact target version"]

### academic_result_blocks generated scope

- Status: `STRUCTURE_RESOLVED_VERSION_GATE_OPEN`.
- decision: Retain the unique scope index and the VIRTUAL VARCHAR(32) key derived from IFNULL(mock_examination, ''); do not remove the uniqueness protection.
- evidence: ["schema/064 defines original scope/index","schema/075 adds result_type/mock_examination and the examination-scoped unique index","schema/083 adds mock_examination_key as VIRTUAL and a unique index that normalizes NULL labels","TiDB stable docs support indexing virtual/stored generated columns; IFNULL is documented; the expression is deterministic."]
- unresolved: ["The actual target TiDB version is unknown; integration validation of the exact ALTER/CREATE INDEX IF NOT EXISTS statements and duplicate-scope precondition remains required."]

### Dynamic and indirect database dependencies

- orm: No ORM/query-builder dependency is declared; runtime database packages are mysql2 and pg.
- reviewedPatterns: ["Parameterized literal SQL in database.query/execute and transaction callbacks","Dynamic WHERE predicate fragments in src/existing-student-linking.js and src/parent-fee-obligations-repository.js","Allowlisted table/column identifiers in src/general-finance.js and src/durable-student-profile.js","Generic repository identifier validation in src/platform/repositories.js","Migration-parsed view definitions in src/platform/final-result-slip-reconciliation.js"]
- sidecarObjects: No CREATE PROCEDURE, CREATE TRIGGER, or CREATE EVENT statement was found in the numbered migrations or scanned application source.
- limitation: Dynamic call-site analysis remains incomplete for the 17 manifest entries with lexical runtime-file links but no extracted SQL, and for feature-gated or indirect service calls.

### All 164 table-name dispositions

| Table | Disposition | Evidence sample | Qualification / unresolved item |
|---|---|---|---|
| `academic_calendar_events` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/ai/tidb-readiness.js, src/staff-attendance-overview.js, src/student-attendance-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `academic_calendar_term_configs` | UNRESOLVED | 058_academic_calendar.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `academic_result_blocks` | REQUIRED_CURRENT_RUNTIME | src/durable-result-blocking.js, src/platform/academic-result-blocking-075-schema.js, src/platform/result-blocking-083-preflight.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `academic_result_records` | UNRESOLVED | src/durable-academic.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `academic_result_unblock_requests` | REQUIRED_CURRENT_RUNTIME | src/durable-result-blocking.js, src/platform/academic-result-blocking-075-schema.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `academic_score_records` | UNRESOLVED | src/ai/tidb-readiness.js, src/durable-academic.js, src/platform/academic-migration-guard.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `academic_years` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/academic-results.js, src/ai/tidb-readiness.js, src/attendance-register-service.js (+17 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `admission_applications` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/durable-admissions.js, src/existing-student-linking.js, src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `admission_documents` | UNRESOLVED | 015_admission_form_fee_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `admission_fee_structures` | UNRESOLVED | 015_admission_form_fee_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `admission_form_applications` | UNRESOLVED | 015_admission_form_fee_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `admission_prospectuses` | UNRESOLVED | 016_admission_prospectus.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `ai_audit_logs` | REQUIRED_CURRENT_RUNTIME | src/ai/durable-stores.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `ai_human_controlled_actions` | REQUIRED_CURRENT_RUNTIME | src/ai/durable-stores.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `announcement_reads` | REQUIRED_CURRENT_RUNTIME | src/durable-announcements.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `announcement_recipients` | REQUIRED_CURRENT_RUNTIME | src/durable-announcements.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `announcement_records` | REQUIRED_CURRENT_RUNTIME | src/durable-announcements.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `announcements` | REQUIRED_CURRENT_RUNTIME | src/ai/capabilities/core.capability.js, src/ai/operational-intelligence.js, src/ai/tidb-readiness.js, src/auth.js (+9 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `assets` | UNRESOLVED | src/academic-results.js, src/admission-prospectus-pdf.js, src/ai/operational-intelligence.js, src/ai/system-of-record-readiness.js (+12 more in manifest) | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `assignment_files` | REQUIRED_CURRENT_RUNTIME | src/ai/tidb-readiness.js, src/assignments.js, src/platform/assignment-migration-schema.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `assignments` | REQUIRED_CURRENT_RUNTIME | src/admission-prospectus.js, src/ai/admissions-workforce-intelligence.js, src/ai/operational-intelligence.js, src/ai/school-context.js (+21 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `attendance_audit_history` | REQUIRED_CURRENT_RUNTIME | src/attendance-repository.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `attendance_notification_settings` | UNRESOLVED | 006_attendance.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `attendance_sync_conflicts` | UNRESOLVED | 006_attendance.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `audit_logs` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/existing-student-linking.js, src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `auth_sessions` | REQUIRED_CURRENT_RUNTIME | src/ai/tidb-database-adapter.js, src/ai/tidb-readiness.js, src/auth.js, src/durable-administrator-credential-reset.js (+5 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `budget_items` | REQUIRED_CURRENT_RUNTIME | src/budgets.js, src/general-finance.js, src/platform/forward-finance-migration.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `budgets` | REQUIRED_CURRENT_RUNTIME | src/budgets.js, src/financial-authorization.js, src/general-finance.js, src/module-registry.js (+5 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `calendar_events` | UNRESOLVED | 010_communication.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `canonical_academic_scores` | UNRESOLVED | src/platform/result-slip-migration-preflight.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `canonical_ges_assessments` | UNRESOLVED | src/platform/result-slip-migration-preflight.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `class_label_aliases` | UNRESOLVED | 031_controlled_schema_upgrade.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `class_subjects` | LEGACY_COMPATIBILITY_ONLY | src/durable-academic.js optional fallback, schema/054 describes installations that retain the legacy mapping | Fresh-install requirement is not established. |
| `classes` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/academic-results.js, src/admission-enrollment.js, src/admission-prospectus.js (+40 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `communication_delivery_log` | UNRESOLVED | 010_communication.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_delivery_logs` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_messages` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_outbox` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_providers` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_templates` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `communication_trigger_settings` | UNRESOLVED | 025_communication_engine.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `compliance_inspections` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `compliance_records` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `counselling_records` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `data_breaches` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `data_protection_officers` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `departments` | REQUIRED_CURRENT_RUNTIME | src/ai/authorization-guard.js, src/durable-role-account-provisioning.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `document_versions` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `examination_candidates` | UNRESOLVED | 007_examinations_results.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `examination_marks` | REQUIRED_CURRENT_RUNTIME | src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `examination_subjects` | UNRESOLVED | 007_examinations_results.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `examination_timetable` | UNRESOLVED | 007_examinations_results.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `examinations` | REQUIRED_CURRENT_RUNTIME | src/academic-results.js, src/auth.js, src/durable-academic.js, src/examinations.js (+10 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `external_exam_records` | UNRESOLVED | 007_examinations_results.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `fee_collection_corrections` | REQUIRED_CURRENT_RUNTIME | src/fee-collections-repository.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_collection_records` | REQUIRED_CURRENT_RUNTIME | src/fee-collections-repository.js, src/platform/final-result-slip-reconciliation.js, src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_invoice_items` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/durable-fee-reader.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_invoices` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/durable-fee-reader.js, src/platform/final-result-slip-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_obligations` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/fee-collections-repository.js, src/fee-obligation-balances.js, src/parent-fee-obligations-repository.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_payments` | REQUIRED_CURRENT_RUNTIME | src/cashbook.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_receipts` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `fee_structures` | REQUIRED_CURRENT_RUNTIME | src/fee-collections-repository.js, src/platform/final-result-slip-reconciliation.js, src/server.mjs | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_structures_v2` | REQUIRED_CURRENT_RUNTIME | src/server.mjs | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `fee_types` | REQUIRED_CURRENT_RUNTIME | src/fee-collections-repository.js, src/fees.js, src/server.mjs | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `financial_adjustments` | UNRESOLVED | 008_fees_finance.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `financial_audit_history` | REQUIRED_CURRENT_RUNTIME | src/budgets.js, src/general-finance.js, src/platform/forward-finance-migration.js, src/platform/forward-production-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `financial_audit_log` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `general_expenses` | REQUIRED_CURRENT_RUNTIME | src/cashbook.js, src/general-finance.js, src/platform/forward-finance-migration.js, src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `general_income` | REQUIRED_CURRENT_RUNTIME | src/cashbook.js, src/general-finance.js, src/platform/forward-finance-migration.js, src/single-school-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `grading_systems` | UNRESOLVED | 007_examinations_results.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `health_records` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `health_visits` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `hostel_allocations` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `hostel_spaces` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `houses` | UNRESOLVED | src/module-registry.js, src/proprietor-sidebar-routes.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `inventory_items` | UNRESOLVED | 012_resources.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `inventory_movements` | UNRESOLVED | 012_resources.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `invoices` | REQUIRED_CURRENT_RUNTIME | src/admission-form.js, src/ai/financial-intelligence.js, src/ai/system-of-record-readiness.js, src/ai/tidb-readiness.js (+11 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `levels` | REQUIRED_CURRENT_RUNTIME | src/ai/contracts.js, src/durable-academic.js, src/durable-admissions.js, src/fee-collections-repository.js (+2 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `library_books` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `library_loans` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `managed_documents` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `messages` | UNRESOLVED | src/ai/tidb-readiness.js, src/auth.js, src/communication-engine.js, src/communication.js (+7 more in manifest) | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `notification_preferences` | UNRESOLVED | 010_communication.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `notifications` | REQUIRED_CURRENT_RUNTIME | src/communication.js, src/module-registry.js, src/proprietor-sidebar-routes.js, src/server.mjs (+1 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `official_documents` | UNRESOLVED | 014_reporting_documents.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `osaah_fresh_installations` | REQUIRED_SUPPORTED_WORKFLOW | src/platform/tidb-fresh-initializer.js | Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review. |
| `parent_auth_challenges` | REQUIRED_CURRENT_RUNTIME | src/parent-sms-auth.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `parent_auth_rate_limits` | REQUIRED_CURRENT_RUNTIME | src/ai/tidb-readiness.js, src/auth.js, src/parent-sms-auth.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `parent_student_links` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/tidb-readiness.js, src/auth.js, src/durable-announcements.js (+7 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `payment_gateway_configs` | UNRESOLVED | 008_fees_finance.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `payments` | REQUIRED_CURRENT_RUNTIME | src/admission-form.js, src/ai/financial-intelligence.js, src/ai/system-of-record-readiness.js, src/ai/tidb-readiness.js (+15 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `permissions` | UNRESOLVED | src/academic-results.js, src/admission-prospectus.js, src/ai/academic-attendance-intelligence.js, src/ai/administration.js (+42 more in manifest) | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `portal_users` | REQUIRED_CURRENT_RUNTIME | src/server.mjs wires POST /api/auth/proprietor/login when a database adapter exists, src/proprietor-authentication-controller.js selects id, portal_name, email, password_hash, role, is_active, PostgreSQL baselines define a separate portal_users table | No numbered TiDB migration defines it; the separate route does not create the normal osaah_session cookie; provision/identity linkage policy is unresolved. |
| `privacy_consents` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `privacy_requests` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `procurement_requests` | UNRESOLVED | 012_resources.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `promotion_decisions` | REQUIRED_CURRENT_RUNTIME | src/durable-promotion.js, src/examinations.js, src/parent-historical-records.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `property_maintenance` | UNRESOLVED | 012_resources.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `report_exports` | UNRESOLVED | 014_reporting_documents.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `result_signatures` | UNRESOLVED | 017_academic_results_migration.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `retention_policies` | UNRESOLVED | 013_compliance_privacy.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `role_permissions` | UNRESOLVED | src/auth.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `roles` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/admissions-workforce-intelligence.js, src/ai/capabilities/core.capability.js, src/ai/executive-intelligence.js (+26 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `sample_data_fixtures` | REQUIRED_CURRENT_RUNTIME | src/sample-fixture-repository.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `schema_baselines` | REQUIRED_SUPPORTED_WORKFLOW | src/ai/tidb-database-adapter.js | Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review. |
| `schema_migration_lock` | REQUIRED_SUPPORTED_WORKFLOW | src/ai/tidb-database-adapter.js, src/platform/forward-finance-migration.js, src/platform/forward-production-reconciliation.js | Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review. |
| `schema_migration_runs` | REQUIRED_SUPPORTED_WORKFLOW | src/ai/tidb-database-adapter.js | Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review. |
| `schema_migrations` | REQUIRED_SUPPORTED_WORKFLOW | src/admission-schema-diagnostic.js, src/ai/tidb-database-adapter.js, src/platform/assignment-migration-schema.js | Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review. |
| `school_property` | UNRESOLVED | 012_resources.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `schools` | REQUIRED_CURRENT_RUNTIME | src/ai/tidb-readiness.js, src/auth.js, src/durable-role-account-provisioning.js, src/durable-staff-provisioning.js (+6 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `shep_activities` | UNRESOLVED | src/auth.js, src/module-registry.js, src/shep-activities.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `shep_activity_attachments` | UNRESOLVED | 021_shep_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `shep_activity_participants` | UNRESOLVED | 021_shep_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `shep_audit_history` | UNRESOLVED | 021_shep_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `shep_referrals` | UNRESOLVED | 021_shep_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `sidebar_categories` | UNRESOLVED | src/sidebar-registry.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `sidebar_modules` | UNRESOLVED | src/ai/registry.js, src/ai/school-context.js, src/module-registry.js, src/server.mjs (+2 more in manifest) | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `sms_campaign_recipients` | UNRESOLVED | src/durable-sms.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `sms_campaigns` | UNRESOLVED | src/durable-sms.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `sporting_activities` | UNRESOLVED | src/auth.js, src/module-registry.js, src/sporting-activities.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `sporting_fixtures` | UNRESOLVED | 019_sporting_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `sporting_participants` | UNRESOLVED | 019_sporting_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `sporting_results` | UNRESOLVED | 019_sporting_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `sporting_sports` | UNRESOLVED | 019_sporting_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `sporting_teams` | UNRESOLVED | 019_sporting_activities.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `staff` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/admission-prospectus.js, src/ai/academic-attendance-intelligence.js, src/ai/admissions-workforce-intelligence.js (+36 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `staff_assignments` | REQUIRED_CURRENT_RUNTIME | src/auth.js, src/durable-staff-provisioning.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `staff_attendance` | REQUIRED_CURRENT_RUNTIME | src/attendance-repository.js, src/single-school-overview.js, src/staff-attendance-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `staff_attendance_reconciliation_audit` | UNRESOLVED | 035_staff_leave_attendance_reconciliation.sql, 049_production_schema_reconciliation.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `staff_documents` | UNRESOLVED | 009_staff_hr.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `staff_leave` | REQUIRED_CURRENT_RUNTIME | src/single-school-overview.js, src/staff-attendance-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `staff_leave_balances` | UNRESOLVED | 009_staff_hr.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `staff_profiles` | REQUIRED_CURRENT_RUNTIME | src/durable-role-account-provisioning.js, src/durable-staff-provisioning.js, src/role-provisioning-diagnostic.js, src/school-profile.js (+2 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `streams` | UNRESOLVED | 001_foundation.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_attendance` | REQUIRED_CURRENT_RUNTIME | src/ai/tidb-readiness.js, src/attendance-repository.js, src/single-school-overview.js, src/student-attendance-overview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_class_history` | UNRESOLVED | src/ai/tidb-readiness.js | Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths. |
| `student_documents` | UNRESOLVED | 003_students_admissions.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_enrollments` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/tidb-readiness.js, src/attendance-register-service.js, src/durable-academic.js (+6 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_family_contacts` | REQUIRED_CURRENT_RUNTIME | src/durable-student-profile.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_fee_accounts` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/durable-fee-reader.js, src/platform/final-result-slip-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_fee_charges` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_fee_discounts` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_fee_ledger` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/platform/final-result-slip-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_fee_payments` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/durable-fee-reader.js, src/platform/final-result-slip-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_fee_receipts` | REQUIRED_CURRENT_RUNTIME | src/durable-fee-payments.js, src/durable-fee-reader.js, src/platform/final-result-slip-reconciliation.js, src/platform/forward-production-reconciliation.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_health_records` | UNRESOLVED | 003_students_admissions.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_id_sequences` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/existing-student-linking.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_profiles` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/tidb-readiness.js, src/attendance-register-service.js, src/auth.js (+12 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `student_transcript_versions` | UNRESOLVED | 024_student_transcripts.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `student_transcripts` | UNRESOLVED | 024_student_transcripts.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `students` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/academic-results.js, src/admission-enrollment.js, src/admission-form.js (+57 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `subject_class_assignments` | REQUIRED_CURRENT_RUNTIME | src/assignments.js, src/durable-academic.js, src/platform/subject-assignment-preview.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `subject_register_history` | UNRESOLVED | 020_subject_register.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `subject_register_teachers` | UNRESOLVED | 020_subject_register.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `subject_registers` | UNRESOLVED | 020_subject_register.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `subjects` | REQUIRED_CURRENT_RUNTIME | src/academic-results.js, src/ai/academic-attendance-intelligence.js, src/ai/authorization-guard.js, src/ai/contracts.js (+23 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `system_settings` | REQUIRED_CURRENT_RUNTIME | src/school-settings.js | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `terms` | REQUIRED_CURRENT_RUNTIME | src/academic-calendar.js, src/academic-results.js, src/ai/school-context.js, src/ai/system-of-record-readiness.js (+28 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `transport_routes` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `transport_vehicles` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |
| `user_roles` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/tidb-readiness.js, src/auth.js, src/durable-administrator-credential-reset.js (+11 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `users` | REQUIRED_CURRENT_RUNTIME | src/admission-enrollment.js, src/ai/school-knowledge-intelligence.js, src/ai/tidb-readiness.js, src/auth.js (+20 more in manifest) | SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed. |
| `welfare_incidents` | UNRESOLVED | 011_operations.sql | Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence. |

### All eight view dispositions

| View | Disposition | Migration evidence | Runtime finding |
|---|---|---|---|
| `vw_class_database` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | No direct runtime SELECT was found; historical definitions and schema tests exist. |
| `vw_completed_class_database` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql | No direct runtime SELECT was found; historical definitions and schema tests exist. |
| `vw_fee_arrears` | REQUIRED_SUPPORTED_WORKFLOW | 038_canonical_class_database_fee_hub.sql, 046_fee_hub_reporting_views.sql, 049_production_schema_reconciliation.sql | src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found. |
| `vw_fee_collection_summary` | REQUIRED_SUPPORTED_WORKFLOW | 038_canonical_class_database_fee_hub.sql, 049_production_schema_reconciliation.sql | src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found. |
| `vw_fee_overview` | REQUIRED_SUPPORTED_WORKFLOW | 038_canonical_class_database_fee_hub.sql, 046_fee_hub_reporting_views.sql, 049_production_schema_reconciliation.sql | src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found. |
| `vw_invoice_receipt_register` | REQUIRED_SUPPORTED_WORKFLOW | 046_fee_hub_reporting_views.sql, 049_production_schema_reconciliation.sql | src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found. |
| `vw_published_fee_structures` | UNRESOLVED | 038_canonical_class_database_fee_hub.sql, 049_production_schema_reconciliation.sql | No direct runtime SELECT was found; historical definitions and schema tests exist. |
| `vw_student_fee_balances` | REQUIRED_SUPPORTED_WORKFLOW | 038_canonical_class_database_fee_hub.sql, 046_fee_hub_reporting_views.sql, 049_production_schema_reconciliation.sql | src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found. |

### Historical view definitions and dependencies

The machine manifest stores each historical SELECT definition verbatim, source migration, extracted FROM/JOIN dependencies, and whether the definition is in conflict with another migration. Static definition presence does not prove the view is suitable for a clean install.
- vw_student_fee_balances aggregates active charges, discounts, and payments per account; historical alternatives use separate financial tables and differ in output shape.
- vw_fee_overview groups balances by school, academic year, and term; historical aliases and columns differ.
- vw_fee_arrears selects positive balances and inherits upstream balance-view drift.
- vw_invoice_receipt_register joins payments, invoices, and receipts; migration 046 uses p.amount while migration 049 uses p.amount_paid. The current reconciler rejects the earlier expression.
- vw_fee_collection_summary aggregates collections; historical sources and output columns differ.
- vw_published_fee_structures projects published structures; historical source columns and aliases differ.
- vw_class_database and vw_completed_class_database join enrollments with students and filter current/active or completed-status rows; neither has a confirmed current direct runtime consumer.

### Target TiDB version assessment

- The repository identifies TiDB but does not specify a server version. Readiness can query SELECT VERSION(), but no database connection was made for this task.
- Adapter contract: mysql2 pool; DATABASE_URL mysql:// or mysql2://, or host/user/password/database/port components; database osaahdaylightschool; default port 3306; TLSv1.2 minimum with certificate verification and optional TIDB_CA_CERT; pool size 10; connection timeout 15 seconds.
- Transactions use one checked-out connection with begin/commit/rollback. sql_mode, default charset/collation, and session time zone are not set by the adapter and must be specified by the deployment owner.
- If the canonical design requires enforced foreign keys, use TiDB v8.5.0 or later for general availability. Earlier foreign-key support from v6.6.0 was experimental.
- Generated indexed columns, JSON behavior, date/time session semantics, transactions, and referential actions still need verification against the actual target version.

### Phase 2E domain contract investigation status

| Domain | Status | Focus tables | Evidence modules | Open decisions |
|---|---|---|---|---|
| Authentication and RBAC | PARTIAL | users, user_roles, roles, role_permissions, permissions, auth_sessions | src/auth.js, src/durable-staff-provisioning.js, schema/001_foundation.sql, schema/032_production_rbac_reconciliation.sql, schema/052_durable_auth_sessions.sql | users uniqueness/nullability/defaults and cross-school identifier policy unresolved; user_roles primary-key/type choice and FK contract unresolved although id writes and pair uniqueness behavior are established; RBAC seeding/scope and empty-permission fallback authorization policy unresolved; TiDB FK/type/action contract unresolved |
| Proprietor and Administrator | PARTIAL | portal_users, users, roles, user_roles, auth_sessions | src/proprietor-authentication-controller.js, src/server.mjs, src/durable-staff-provisioning.js | portal_users lacks TiDB DDL/provisioner; separate proprietor login does not establish standard durable session; secure bootstrap policy must be implemented as an explicit operational workflow |
| Staff and Teachers | PARTIAL | staff, staff_profiles, users, user_roles, roles, subject_register_teachers | src/durable-staff-provisioning.js, src/staff-attendance-overview.js, src/server.mjs, schema/009_staff_hr.sql | staff_profiles writer/history shape conflict; staff_number is externally supplied and school-scoped in application checks; physical uniqueness/FK not established; teacher assignment contracts remain table-specific |
| Students and Parents | PARTIAL | students, student_profiles, parent_student_links, student_enrollments, admission_applications, users | src/admission-enrollment.js, src/parent-sms-auth.js, src/durable-student-profile.js, src/existing-student-linking.js, src/parent-historical-records.js | link archival/guardian policy unresolved; legacy student identity bridges remain; physical types, FKs and delete actions unresolved |
| School Configuration and Academics | PARTIAL | schools, system_settings, academic_years, terms, classes, streams, subjects, class_subjects, subject_class_assignments, student_enrollments | src/school-settings.js, src/academic-calendar.js, src/durable-academic.js, src/production-three-term-config.js, src/module-registry.js | historical schema drift across academic modules; scoped key and FK contracts need full per-table reconciliation; class_subjects is optional compatibility only |
| Attendance and Assessments | PARTIAL | student_attendance, staff_attendance, examinations, examination_marks, academic_score_records, grading_systems | src/attendance-repository.js, src/student-attendance-overview.js, src/staff-attendance-overview.js, src/durable-academic.js, src/academic-results.js | assessment/result stores have parallel historical shapes; score precision, uniqueness, version, and FK contracts require field-level reconciliation |
| Results and Report Cards | PARTIAL | examinations, examination_marks, academic_result_blocks, academic_result_records, academic_score_records, student_transcript_versions | src/durable-academic.js, src/academic-results.js, src/platform/final-result-slip-reconciliation.js, src/platform/result-blocking-083-preflight.js | legacy/current result sources coexist; view/result reconciliation inputs need canonical selection; generated uniqueness migration needs target-version validation |
| Financial Management | PARTIAL | fee_types, fee_structures, student_fee_accounts, student_fee_ledger, student_fee_payments, fee_invoices, student_fee_receipts, fee_obligations, fee_collection_records | src/durable-fee-payments.js, src/durable-fee-reader.js, src/parent-fee-obligations-repository.js, src/fee-collections-repository.js, src/platform/final-result-slip-reconciliation.js | conflicting historical fee view definitions; amount precision/minor-unit contracts and payment allocation constraints not fully reconciled; view dependencies need canonical base-table definitions |
| Reports, Notifications and Auditing | PARTIAL | audit_logs, announcements, announcement_records, notifications | src/ai/operational-intelligence.js, src/durable-announcements.js, src/platform/final-result-slip-reconciliation.js, src/single-school-overview.js | dynamic/reporting dependencies incompletely traced; historical class views lack current direct consumers; 92 historical tables lack sufficiently evidenced dispositions |

- Domain notes are in docs/tidb-domain-contracts/; completion matrix is docs/tidb-domain-contracts/completion-matrix.md.
- Fully resolved required table contracts: 0/71. Fully resolved required view contracts: 0/5. All nine domains remain partial.

### TiDB compatibility gates

- TiDB parses but ignores inline column `REFERENCES`; use table-level `FOREIGN KEY` constraints only after exact types, lengths, character sets, collations, supporting indexes, referential actions, and target version are reconciled. TiDB documents foreign keys from v6.6.0 and GA from v8.5.0. [Official FK documentation](https://docs.pingcap.com/tidb/stable/foreign-key/).
- Migration 083 uses a virtual generated column and an index. TiDB documents indexing generated columns and supports IFNULL; the target version and exact migration still require integration validation. [Generated-column documentation](https://docs.pingcap.com/tidb/stable/generated-columns/), [IFNULL documentation](https://docs.pingcap.com/tidb/stable/control-flow-functions/).
- The session representation decision retains `VARCHAR(32)` canonical UTC ISO strings; TiDB `TIMESTAMP` display depends on session time zone while `DATETIME` is not time-zone adjusted. [Date/time types](https://docs.pingcap.com/tidb/stable/data-type-date-and-time/), [time-zone support](https://docs.pingcap.com/tidb/stable/configure-time-zone/).

### Remaining completion blockers

- Resolve the `users` uniqueness/nullability/default contract and the stale admission writer comment against current behavior and existing data state.
- Resolve `user_roles.id` versus the composite key without breaking the current writer and migration 032 contract.
- Decide whether proprietor login remains a separate authentication path; if retained, supply a TiDB schema and provisioning contract for `portal_users`.
- Reconcile the rich HR `staff_profiles` contract with the newer provisioning writer fields and identifier relationships.
- Establish parent-link archival/guardian policy and intended TiDB-level relationship constraints.
- Specify session cleanup/retention; the inspected code revokes and expires sessions but has no durable expired-row cleanup job.
- Verify the target TiDB version and the complete FK/index/type/action matrix; no live target version was queried.
- Investigate the 17 source-linked names without extracted SQL and review the 75 migration-only names before retiring any object.
- Review the six fee reporting views against active supported workflows and disposition both historical class database views.
- Test the generated-column migration and the canonical schema against an isolated TiDB instance in a later authorized phase.

