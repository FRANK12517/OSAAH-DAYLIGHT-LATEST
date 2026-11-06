import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleFixtureRepository } from '../src/sample-fixture-repository.js';
import { createConfiguredTestParent } from '../src/test-parent-fixture.js';

const schoolId = 'school-osaah-daylight';
const staff = { id: 'head-1', schoolId, portal: 'school', roleKey: 'HEADTEACHER', permissions: new Set(['sample.fixtures.read', 'sample.fixtures.write']) };
const parent = createConfiguredTestParent(schoolId);
const identity = { schoolId, sampleStudentId: 'OSAAH/DEMO/001', academicYearId: 'ay-2026-27', termId: 'term-1', classId: 'class-primary-6', fixtureType: 'attendance', fixtureVersion: 1 };
function database() {
  const rows = new Map();
  const key = (params) => params.join('|');
  return {
    dialect: 'tidb',
    rows,
    async execute(sql, params) {
      if (sql.startsWith('UPDATE sample_data_fixtures')) {
        const existing = [...rows.values()].find((row) => row.fixtureId === params[2]);
        if (existing) { existing.fixturePayload = params[0]; existing.updatedAt = params[1]; }
        return { affectedRows: existing ? 1 : 0 };
      }
      const id = params[0];
      const row = { fixtureId: id, schoolId: params[1], sampleStudentId: params[2], academicYearId: params[3], termId: params[4], classId: params[5], fixtureType: params[6], fixturePayload: params[7], fixtureVersion: params[8], createdAt: params[9], updatedAt: params[10] };
      const existing = rows.get(key(params.slice(1, 9)));
      rows.set(key(params.slice(1, 9)), existing ? { ...existing, fixturePayload: row.fixturePayload, updatedAt: row.updatedAt } : row);
      return { affectedRows: 1 };
    },
    async query(sql, params) {
      const values = [...rows.values()];
      if (sql.includes('LIMIT 1')) return values.filter((row) => [row.schoolId, row.sampleStudentId, row.academicYearId, row.termId, row.classId, row.fixtureType, row.fixtureVersion].every((value, index) => String(value) === String(params[index])));
      let result = values.filter((row) => row.schoolId === params[0]);
      const filters = [['sample_student_id', 'sampleStudentId'], ['academic_year_id', 'academicYearId'], ['term_id', 'termId'], ['class_id', 'classId'], ['fixture_type', 'fixtureType']];
      let parameterIndex = 1;
      for (const [sqlColumn, rowColumn] of filters) if (sql.includes(`${sqlColumn} IN (?,?)`)) { const aliases = params.slice(parameterIndex, parameterIndex + 2); result = result.filter((row) => aliases.includes(row[rowColumn])); parameterIndex += 2; } else if (sql.includes(`${sqlColumn}=?`)) result = result.filter((row) => row[rowColumn] === params[parameterIndex++]);
      return result;
    }
  };
}

test('fixture initialization is durable, deterministic, and idempotent across repository recreation', async () => {
  const db = database();
  const first = createSampleFixtureRepository({ adapter: db, now: () => '2026-10-01T00:00:00.000Z' });
  const created = await first.ensureFixture({ ...identity, fixturePayload: { label: 'SAMPLE DATA', present: 42 } }, staff);
  const repeated = await first.ensureFixture({ ...identity, fixturePayload: { label: 'SAMPLE DATA', present: 42 } }, staff);
  assert.equal(created.fixtureId, repeated.fixtureId);
  assert.equal(db.rows.size, 1);
  const recreated = createSampleFixtureRepository({ adapter: db, now: () => '2026-10-02T00:00:00.000Z' });
  const loaded = await recreated.getFixture(identity, staff);
  assert.deepEqual(loaded.fixturePayload, { label: 'SAMPLE DATA', present: 42 });
  assert.equal(loaded.sampleStudentId, 'OSAAH/DEMO/001');
});

test('student identity and academic context remain independently scoped', async () => {
  const db = database();
  const repository = createSampleFixtureRepository({ adapter: db });
  await repository.ensureFixture({ ...identity, fixturePayload: { student: 'one' } }, staff);
  await repository.ensureFixture({ ...identity, sampleStudentId: 'OSAAH/DEMO/002', termId: 'term-2', fixturePayload: { student: 'two' } }, staff);
  assert.equal((await repository.listFixtures({ sampleStudentId: 'OSAAH/DEMO/001' }, staff)).length, 1);
  assert.equal((await repository.getFixture({ ...identity, sampleStudentId: 'OSAAH/DEMO/002', termId: 'term-2' }, staff)).fixturePayload.student, 'two');
  assert.equal((await repository.getFixture({ ...identity, termId: 'term-2' }, staff)), null);
});

test('legacy fixture rows are read and updated in place under canonical sample IDs', async () => {
  const db = database();
  const repository = createSampleFixtureRepository({ adapter: db });
  const legacyRow = { fixtureId: 'legacy-fixture-id', schoolId, sampleStudentId: 'OSAAH-DEMO-001', academicYearId: identity.academicYearId, termId: identity.termId, classId: identity.classId, fixtureType: identity.fixtureType, fixturePayload: JSON.stringify({ legacy: true }), fixtureVersion: identity.fixtureVersion, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
  db.rows.set([legacyRow.schoolId, legacyRow.sampleStudentId, legacyRow.academicYearId, legacyRow.termId, legacyRow.classId, legacyRow.fixtureType, legacyRow.fixtureVersion].join('|'), legacyRow);
  const legacy = await repository.getFixture(identity, staff);
  const canonical = await repository.ensureFixture({ ...identity, fixturePayload: { updated: true } }, staff);
  assert.equal(legacy.fixtureId, canonical.fixtureId);
  assert.equal(canonical.sampleStudentId, 'OSAAH/DEMO/001');
  assert.deepEqual(canonical.fixturePayload, { updated: true });
  assert.equal(db.rows.size, 1);
});

test('controlled parent can read only the configured sample school and identities', async () => {
  const repository = createSampleFixtureRepository({ adapter: database() });
  await assert.rejects(() => repository.getFixture(identity, { ...parent, schoolId: 'other-school' }), (error) => error.code === 'SAMPLE_FIXTURE_FORBIDDEN');
  await assert.rejects(() => repository.getFixture({ ...identity, sampleStudentId: 'OSAAH/2026/0001' }, parent), /configured sample student/);
  await assert.rejects(() => repository.ensureFixture({ ...identity, fixturePayload: {} }, parent), (error) => error.code === 'SAMPLE_FIXTURE_WRITE_FORBIDDEN');
});

test('official identities and unsupported fixture types fail closed', async () => {
  const repository = createSampleFixtureRepository({ adapter: database() });
  await assert.rejects(() => repository.ensureFixture({ ...identity, sampleStudentId: 'OSAAH/2026/0001', fixturePayload: {} }, staff), /configured sample student/);
  await assert.rejects(() => repository.ensureFixture({ ...identity, fixtureType: 'official-payments', fixturePayload: {} }, staff), /Unsupported sample fixture type/);
});
