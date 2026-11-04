import { TIDB_PRODUCTION_DATABASE } from './ai/tidb-constants.js';

const rows = (value) => Array.isArray(value) ? value : [];
const field = (row, camel, upper) => row?.[camel] ?? row?.[upper];

/** Read-only, secret-free check of the TiDB contract used by admissions. */
export async function inspectAdmissionSchema(database) {
  if (database?.dialect !== 'tidb' || typeof database.query !== 'function') {
    throw Object.assign(new Error('The configured database is not TiDB.'), { code: 'TIDB_REQUIRED' });
  }

  const identityRows = rows(await database.query('SELECT DATABASE() AS databaseName'));
  const databaseName = String(field(identityRows[0], 'databaseName', 'DATABASE_NAME') ?? '');
  const columnRows = rows(await database.query(
    "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='admission_applications' AND COLUMN_NAME IN ('enquiry_request_id','permanent_student_id','student_id')) OR (TABLE_NAME='student_enrollments' AND COLUMN_NAME IN ('student_id','school_id','class_id','academic_year_id','term_id','is_current')) OR (TABLE_NAME='classes' AND COLUMN_NAME IN ('id','name','school_id','level_id','status')))"
  ));
  const indexRows = rows(await database.query(
    "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admission_applications' AND INDEX_NAME='uq_admission_applications_enquiry_request' ORDER BY SEQ_IN_INDEX"
  ));
  const tableRows = rows(await database.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('admission_applications','schema_migrations','classes','levels')"
  ));

  const columns = new Set(columnRows.map((row) => `${String(field(row, 'tableName', 'TABLE_NAME')).toLowerCase()}.${String(field(row, 'columnName', 'COLUMN_NAME')).toLowerCase()}`));
  const tables = new Set(tableRows.map((row) => String(field(row, 'tableName', 'TABLE_NAME')).toLowerCase()));
  const migrationRows = tables.has('schema_migrations')
    ? rows(await database.query('SELECT version FROM schema_migrations WHERE version IN (?,?,?)', [31, 38, 78]))
    : [];
  const indexColumns = indexRows.map((row) => ({ column: String(field(row, 'columnName', 'COLUMN_NAME')).toLowerCase(), nonUnique: Number(field(row, 'nonUnique', 'NON_UNIQUE')) }));

  return {
    backend: 'TiDB',
    selectedDatabaseMatchesProduction: databaseName === TIDB_PRODUCTION_DATABASE,
    admissionApplicationsTablePresent: tables.has('admission_applications') || columns.has('admission_applications.student_id'),
    admissionColumns: {
      enquiryRequestId: columns.has('admission_applications.enquiry_request_id'),
      permanentStudentId: columns.has('admission_applications.permanent_student_id'),
      studentId: columns.has('admission_applications.student_id')
    },
    enrollmentColumns: Object.fromEntries(['student_id', 'school_id', 'class_id', 'academic_year_id', 'term_id', 'is_current'].map((name) => [name, columns.has(`student_enrollments.${name}`)])),
    classTablePresent: tables.has('classes'),
    levelTablePresent: tables.has('levels'),
    classColumns: Object.fromEntries(['id', 'name', 'school_id', 'level_id', 'status'].map((name) => [name, columns.has(`classes.${name}`)])),
    migration031Recorded: migrationRows.some((row) => Number(field(row, 'version', 'VERSION')) === 31),
    migration038Recorded: migrationRows.some((row) => Number(field(row, 'version', 'VERSION')) === 38),
    enquiryRequestUniqueIndex: indexColumns.length === 2 && indexColumns.every((item) => item.nonUnique === 0) && indexColumns[0].column === 'school_id' && indexColumns[1].column === 'enquiry_request_id',
    migration078Recorded: migrationRows.some((row) => Number(field(row, 'version', 'VERSION')) === 78)
  };
}
