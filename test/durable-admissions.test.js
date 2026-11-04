import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableAdmissionsService } from '../src/durable-admissions.js';

function databaseWithoutEnquiryRequestColumn() {
  const rowsById = new Map();
  const calls = [];
  return {
    rowsById,
    calls,
    async query(sql, params = []) {
      calls.push({ type: 'query', sql, params });
      if (sql.includes('information_schema.COLUMNS')) return [
        'id', 'school_id', 'application_number', 'stage', 'applicant_data', 'created_at', 'updated_at'
      ].map((columnName) => ({ columnName }));
      if (sql.startsWith('SELECT id,name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('WHERE id=? AND school_id=?')) return [rowsById.get(params[0])].filter(Boolean);
      if (sql.includes('WHERE school_id=? AND application_number=?')) return [...rowsById.values()].filter((row) => row.school_id === params[0] && row.application_number === params[1]);
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params = []) {
      calls.push({ type: 'execute', sql, params });
      const match = /INSERT INTO admission_applications \(([^)]+)\)/.exec(sql);
      assert.ok(match, `Unexpected execute: ${sql}`);
      const columns = match[1].split(',');
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      if (rowsById.has(row.id)) throw Object.assign(new Error('duplicate key'), { code: 'ER_DUP_ENTRY' });
      rowsById.set(row.id, row);
      return { affectedRows: 1 };
    },
  };
}

test('durable admission drafts persist and retry safely when production lacks enquiry_request_id', async () => {
  const database = databaseWithoutEnquiryRequestColumn();
  let sequence = 0;
  const service = createDurableAdmissionsService({ database, schoolId: 'school-osaah-daylight', clock: () => '2026-11-04T12:00:00.000Z', idFactory: () => `generated-${++sequence}` });
  const actor = { id: 'proprietor-1', roleKey: 'PROPRIETOR', portal: 'school', schoolId: 'school-osaah-daylight' };
  const input = { enquiryRequestId: '12345678-1234-4234-8234-123456789012', studentFirstName: 'Demo', studentSurname: 'Student', classAppliedFor: 'Basic 1', admissionType: 'FIRST_TIME' };

  const created = await service.createApplication(input, actor);
  const retried = await service.createApplication(input, actor);
  assert.equal(retried.applicationNumber, created.applicationNumber);
  assert.equal(database.rowsById.size, 1);
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const insert = database.calls.find((call) => call.type === 'execute');
  assert.doesNotMatch(insert.sql, /enquiry_request_id/);
  assert.equal(JSON.parse(insert.params[columnsFromInsert(insert.sql).indexOf('applicant_data')]).enquiryRequestId, input.enquiryRequestId);
  assert.equal(database.calls.some((call) => /enquiry_request_id/.test(call.sql)), false);
});

function columnsFromInsert(sql) {
  return /INSERT INTO admission_applications \(([^)]+)\)/.exec(sql)[1].split(',');
}
