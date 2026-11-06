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
      if (sql.includes("TABLE_NAME='classes'")) return ['id', 'name', 'school_id'].map((columnName) => ({ columnName }));
      if (sql.includes('information_schema.COLUMNS')) return [
        'id', 'school_id', 'application_number', 'stage', 'applicant_data', 'created_at', 'updated_at'
      ].map((columnName) => ({ columnName }));
      if (sql.startsWith('SELECT id,name FROM classes')) return params[0] === 'sch_default_01' ? [{ id: 'class-basic-1', name: 'Basic 1', school_id: 'sch_default_01' }] : [];
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
  const service = createDurableAdmissionsService({ database, schoolId: 'sch_default_01', clock: () => '2026-11-04T12:00:00.000Z', idFactory: () => `generated-${++sequence}` });
  const actor = { id: 'proprietor-1', roleKey: 'PROPRIETOR', portal: 'school', schoolId: 'sch_default_01' };
  const input = { enquiryRequestId: '12345678-1234-4234-8234-123456789012', studentFirstName: 'Demo', studentSurname: 'Student', classAppliedFor: 'Basic 1', admissionType: 'FIRST_TIME' };

  const created = await service.createApplication(input, actor);
  const retried = await service.createApplication(input, actor);
  assert.equal(retried.applicationNumber, created.applicationNumber);
  assert.equal(database.rowsById.size, 1);
  assert.ok(database.calls.some((call) => call.sql === 'SELECT id,name FROM classes WHERE school_id=?'));
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const insert = database.calls.find((call) => call.type === 'execute');
  assert.doesNotMatch(insert.sql, /enquiry_request_id/);
  assert.equal(JSON.parse(insert.params[columnsFromInsert(insert.sql).indexOf('applicant_data')]).enquiryRequestId, input.enquiryRequestId);
  assert.equal(database.calls.some((call) => /enquiry_request_id/.test(call.sql)), false);
});

test('admission class lookup rejects a class catalog row from another school', async () => {
  const database = databaseWithoutEnquiryRequestColumn();
  const service = createDurableAdmissionsService({ database, schoolId: 'sch_default_01' });
  const actor = { id: 'other-school-user', roleKey: 'PROPRIETOR', portal: 'school', schoolId: 'sch_other_02' };
  await assert.rejects(
    service.createApplication({ studentFirstName: 'Synthetic', studentSurname: 'Applicant', classAppliedFor: 'Basic 1' }, actor),
    { message: 'Select a valid active school class.' }
  );
  const classLookup = database.calls.find((call) => call.sql === 'SELECT id,name FROM classes WHERE school_id=?');
  assert.deepEqual(classLookup.params, ['sch_other_02']);
  assert.equal(database.calls.some((call) => call.type === 'execute'), false, 'a foreign school class cannot create an application');
});

test('class lookup supports legacy class catalogs scoped through levels when classes.school_id is absent', async () => {
  const database = databaseWithoutEnquiryRequestColumn();
  database.query = async function(sql, params = []) {
    this.calls.push({ type: 'query', sql, params });
    if (sql.includes("TABLE_NAME='classes'")) return ['id', 'name', 'level_id', 'status'].map((columnName) => ({ columnName }));
    if (sql.includes('information_schema.COLUMNS')) return ['id', 'school_id', 'application_number', 'stage', 'applicant_data', 'created_at', 'updated_at'].map((columnName) => ({ columnName }));
    if (sql.startsWith('SELECT c.id,c.name FROM classes c')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
    if (sql.includes('WHERE id=? AND school_id=?')) return [this.rowsById.get(params[0])].filter(Boolean);
    if (sql.includes('WHERE school_id=? AND application_number=?')) return [...this.rowsById.values()].filter((row) => row.school_id === params[0] && row.application_number === params[1]);
    throw new Error(`Unexpected query: ${sql}`);
  };
  const service = createDurableAdmissionsService({ database, schoolId: 'school-osaah-daylight' });
  await service.createApplication({ studentFirstName: 'Demo', studentSurname: 'Student', classAppliedFor: 'Basic 1' }, { id: 'p1', roleKey: 'PROPRIETOR', portal: 'school', schoolId: 'school-osaah-daylight' });
  assert.ok(database.calls.some((call) => call.sql === "SELECT c.id,c.name FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? AND c.status='ACTIVE'"));
});

function columnsFromInsert(sql) {
  return /INSERT INTO admission_applications \(([^)]+)\)/.exec(sql)[1].split(',');
}
