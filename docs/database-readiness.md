# Database Configuration and TiDB Readiness

This procedure validates configuration first and connects only when an operator explicitly approves an isolated test target. It does not run migrations, repair records, or write database data.

## Runtime configuration

For the intended TiDB runtime, configure these values in the server-side environment:

- `OSAAH_DATABASE_ADAPTER=tidb` — explicitly selects the application TiDB adapter.
- `DATABASE_URL` — a `mysql://` URL containing the TiDB endpoint, database, username, and password. The database must be `osaahdaylightschool` for the readiness command.
- `TIDB_CA_CERT` — optional PEM CA certificate when the service CA is not in the Node.js system trust store. The adapter always requires TLS 1.2 or later and certificate verification; do not disable verification.

The adapter also supports component variables. For TiDB, precedence is `HOST`, then `TIDB_HOST`, then the URL host; `DATABASE`, then `TIDB_DATABASE`, then the URL database; and `PORT`, then `TIDB_PORT`, then the URL port, defaulting to 3306. Credentials use `TIDB_USER` and `TIDB_PASSWORD` before URL credentials. The diagnostic reports the selected sources without printing values.

When all five split connection fields (host, port, database, user, and password) are configured, that complete split configuration takes precedence and `DATABASE_URL` is ignored. This allows an obsolete URL to remain during a transition without affecting the active TiDB connection. If the split configuration is incomplete, `DATABASE_URL` remains active and is checked against any supplied overrides.

`OSAAH_POSTGRES_URL` and `POSTGRES_URL` select the supported PostgreSQL adapter when no explicit TiDB selector overrides the choice. If a PostgreSQL runtime URL and a MySQL `DATABASE_URL` are both present without an explicit adapter, PostgreSQL currently takes precedence; the diagnostic reports this. Remove stale variables and explicitly select TiDB for the intended deployment. Explicit TiDB selection rejects PostgreSQL runtime URLs.

## Configuration-only diagnostic

```powershell
npm run database:readiness
```

This command validates configuration with the selected adapter and does not open a database connection. A `CONNECTION_UNVERIFIED` result means configuration and TLS policy passed validation; it does not mean the server is reachable. It reports differing override sources without printing their values and exits non-zero for unresolved conflicts, missing settings, or invalid configuration.

## Isolated TiDB verification

First have the deployment operator verify in the provider console that the configured endpoint is a disposable test cluster or database isolated from production. Confirm its project/cluster identity, account permissions, endpoint, network policy, and database name. The approval environment variable below is an operator attestation; it cannot independently prove infrastructure isolation.

Set the approval only in the isolated test process after those checks:

```powershell
$env:OSAAH_DATABASE_ADAPTER = 'tidb'
$env:OSAAH_TIDB_TARGET_ISOLATION_APPROVAL = 'ISOLATED_TEST_TARGET_CONFIRMED'
npm run database:tidb:verify
```

The process refuses production runtime markers, missing isolation attestation, non-explicit TiDB selection, differing connection-source overrides, a configuration resolving to another database name, a non-TiDB server identity, or missing required schema. It first performs a read-only identity query for `VERSION()` and `DATABASE()`, verifies the current session's negotiated TLS version and cipher through `SHOW SESSION STATUS`, then checks `information_schema.COLUMNS` and `information_schema.STATISTICS`. The TiDB adapter requires TLS 1.2 or later and strict certificate verification; the report distinguishes that client policy from the live session's negotiated TLS values. Unsupported TLS status reporting is `UNVERIFIED`, and plaintext or below-minimum sessions fail. Declared foreign-key relationships are checked with `information_schema.KEY_COLUMN_USAGE` and `SHOW CREATE TABLE` where TiDB version metadata supports a reliable result. It never reads account, parent, student, session, or business rows, and it never calls the adapter write API.

Index expectations are derived from the authentication and relationship contracts in schema migrations 001, 003, 026, 031, 032, 052, 054, and 078. Foreign-key expectations are limited to relationships explicitly declared by the repository schema and known deployed contract; the verifier does not invent a `user_roles.role_id` or `student_profiles.student_master_id` foreign key. Missing required indexes or declared relationships fail the schema check. Metadata query errors return `SCHEMA_CHECK_UNVERIFIED`, never a pass. The verifier's schema map is not a record-level integrity check and does not establish that a particular parent or student exists.

TiDB foreign-key semantics are version-sensitive. This project does not currently pin a minimum TiDB version. The verifier leaves foreign-key status `UNVERIFIED` when it cannot parse a TiDB version or the server is older than 6.6.0. On versions from 6.6.0 through 8.4.x the feature is experimental; from 8.5.0 it is generally available. It also checks `SHOW CREATE TABLE` for TiDB's invalid-foreign-key marker because constraints created before 6.6.0 can remain invalid after an upgrade. See [TiDB foreign-key compatibility](https://docs.pingcap.com/tidb/stable/foreign-key/) and [TiDB index metadata](https://docs.pingcap.com/tidb/stable/information-schema-statistics/).

The schema report checks authentication and session persistence (`auth_sessions`, `parent_auth_rate_limits`), role and relationship tables, student profile/master relationships, enrollment/class context, and the attendance, results, fees, announcements, messages, academic calendar, assignments, and history dependencies used by the Parent Dashboard. Homework and student documents are not reported as ready features; their Parent components remain marked unavailable in the application.

The required `parent_auth_rate_limits` table is currently defined in the untracked `schema/082_parent_sms_auth.sql` alongside dormant SMS challenge tables. The active phone-only login needs rate-limit storage; the `parent_auth_challenges` table is used only by the unmounted SMS challenge service. The generic TiDB migration runner discovers every numbered `.sql` file in `schema/`, and it rejects any content or filename change when that version is already recorded in `schema_migrations`. This workspace has no configured database or isolation approval, so the current migration ledger could not be checked and `082` was left unchanged.

Do not run `migration:apply` or ship this draft as-is. First have the authorized operator inspect the current migration ledger using the approved read-only workflow. If version 82 is absent, review a replacement rate-limit-only version-82 migration and retain the SMS challenge DDL outside the auto-discovered migration directory. If version 82 is recorded, preserve its exact filename and checksum; resolve any missing rate-limit object with a separately reviewed forward-only migration. Reconcile the Supabase migration history independently before changing its timestamped migration. The current readiness report requires only `parent_auth_rate_limits`, never `parent_auth_challenges`.

Expected sanitized outcomes include:

- `CONNECTION_UNVERIFIED` from configuration-only validation: settings are valid; no connection was attempted.
- `READY_FOR_AUTHENTICATION_TESTS`: the approved isolated target identified as TiDB, selected the expected database, and passed the read-only required-column checks.
- `REFUSED`, `CONFIGURATION_INVALID`, `CONNECTION_FAILED`, `IDENTITY_FAILED`, or `SCHEMA_CHECK_FAILED`: no readiness claim; inspect the status code and correct the environment or schema through the approved operator workflow.

## Record-level verification and authentication tests

After the schema check passes, separately inspect the approved sample parent, canonical school, school-scoped Parent role, active link, profile, and master record using a read-only query reviewed for the isolated target. Do not run `scripts/repair-parent-portal-sample.mjs`, apply migrations, or modify a relationship until the master record and permanent student/admission identifiers have been confirmed by the school and the data change has explicit approval.

Run synthetic regression tests with:

```powershell
node --test test/database-readiness.test.js test/database-runtime-selection.test.js test/tidb-database-adapter.test.js test/postgres-database-adapter.test.js test/parent-phone-login.test.js test/parent-dashboard.test.js test/serverless-auth-session.test.js test/combined-role-auth-session-isolation.test.js test/test-parent-portal-audit.test.js test/parent-auth-database-diagnostics.test.js test/parent-sms-auth.test.js
```

Those tests use local fixtures; they do not authenticate a real parent or prove live dashboard access. Parent sign-in requires a one-time SMS code: the phone request alone never creates a session, and only successful challenge verification may establish the Parent session. SMS delivery and live identity eligibility still require an authorized, separately approved browser session test after the isolated schema is confirmed. That review should cover dashboard data, session restore, logout, and denial after relationship revocation. Validate each of the six real staff roles separately.

### Opt-in TiDB auth integration test

`test/tidb-auth.integration.test.js` is a live, opt-in integration test; it is skipped by default. Run it only on a dedicated disposable TiDB test database after the deployment operator has approved both the database target and authentication-test writes. It verifies readiness before login, the six staff role-to-dashboard routes, durable session restore, logout revocation, OTP-authenticated Parent login, exact approved Parent child scope, and rejection of a same-school but unlinked student.

The test requires these process variables from a secure local secret store: `OSAAH_TIDB_AUTH_INTEGRATION_APPROVAL=DEDICATED_DISPOSABLE_AUTH_DATABASE_APPROVED`, the existing TiDB isolation approval, `OSAAH_DATABASE_ADAPTER=tidb`, the TiDB connection settings, `OSAAH_SESSION_SECRET`, `OSAAH_TIDB_TEST_STAFF_CREDENTIALS_JSON` (role-keyed credentials for six pre-provisioned disposable staff accounts), `OSAAH_TIDB_TEST_PARENT_PHONE`, `OSAAH_TIDB_TEST_PARENT_OTP_CODE` (the received six-digit code), `OSAAH_TIDB_TEST_PARENT_PERMANENT_STUDENT_IDS` (school-confirmed linked disposable test students), and `OSAAH_TIDB_TEST_UNLINKED_PERMANENT_STUDENT_ID` (a school-confirmed same-school student not linked to that test Parent). No account, role, student, master, enrollment, or parent-link records are created or changed by the test. Actual authentication writes a durable session and Parent rate-limit bucket; logout revokes the sessions, while the rate-limit bucket remains in the disposable database. The operator must confirm that this is acceptable for the disposable target before setting the additional approval variable.

After securely loading those values into the process environment, run only:

```powershell
node --test test/tidb-auth.integration.test.js
```

Never run this integration test against production. Do not use the unresolved Kofi Mensah sample relationship; use dedicated, school-approved test accounts and student relationships. Since `schema/082_parent_sms_auth.sql` bundles the active rate-limit table with dormant SMS challenge tables and must not be included or applied under the phone-only requirement, prepare and review a separate rate-limit-only schema migration before enabling this test. The current worktree intentionally leaves that migration unresolved.

## Approval boundary and production readiness

This readiness command is read-only. Migration execution, sample-account repair, creation of student master records, production environment changes, and deployment each require separate explicit approval. Local tests and this isolated schema check do not establish production readiness. Production readiness requires a successful sanitized health response, real authorized Parent Dashboard verification, and validation of all six real staff roles in the intended environment.
