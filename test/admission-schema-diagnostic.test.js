import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectAdmissionSchema } from '../src/admission-schema-diagnostic.js';

const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('admission schema diagnostic checks TiDB identity, required columns, indexes, and migration ledger without exposing database identity', async () => {
  const statements = [];
  const database = {
    dialect: 'tidb',
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
      if (sql.includes('information_schema.COLUMNS')) return [
        { tableName: 'admission_applications', columnName: 'student_id' },
        { tableName: 'student_enrollments', columnName: 'student_id' },
      ];
      if (sql.includes('information_schema.STATISTICS')) return [];
      if (sql.includes('information_schema.TABLES')) return [{ tableName: 'admission_applications' }, { tableName: 'schema_migrations' }];
      if (sql.includes('FROM schema_migrations')) return [];
      throw new Error(`Unexpected diagnostic query: ${sql}`);
    },
  };

  const report = await inspectAdmissionSchema(database);
  assert.equal(report.backend, 'TiDB');
  assert.equal(report.selectedDatabaseMatchesProduction, true);
  assert.equal(report.admissionApplicationsTablePresent, true);
  assert.equal(report.admissionColumns.enquiryRequestId, false);
  assert.equal(report.admissionColumns.studentId, true);
  assert.equal(report.enquiryRequestUniqueIndex, false);
  assert.equal(report.migration078Recorded, false);
  assert.equal(Object.hasOwn(report, 'databaseName'), false);
  assert.ok(statements.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(sql)));
  assert.deepEqual(statements.at(-1).params, [78]);
});

test('admission schema diagnostic refuses a non-TiDB database', async () => {
  await assert.rejects(inspectAdmissionSchema({ dialect: 'postgres', query() {} }), { code: 'TIDB_REQUIRED' });
});

test('production schema diagnostic is restricted to the school proprietor session', () => {
  assert.match(server, /pathname === '\/api\/admin\/admissions\/schema-diagnostic'[\s\S]*?user\.portal !== 'school' \|\| canonicalRoleKey\(user\.roleKey\) !== 'PROPRIETOR'[\s\S]*?inspectAdmissionSchema\(database\)/);
});
