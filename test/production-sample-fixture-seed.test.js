import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, validateAttendanceFixtureDates } from '../scripts/production-sample-fixture-seed.mjs';
import { TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const databaseName = 'osaahdaylightschool';
const schoolId = 'sch_default_01';
const canonicalYear = { id: 'ay_2026_01', name: '2026/2027 Academic Year' };
const canonicalTerms = [
  { id: 'term_2026_01', name: 'First Term', academicYearId: canonicalYear.id, startsOn: '2026-09-01', endsOn: '2026-12-18' },
  { id: 'term_2026_02', name: 'Second Term', academicYearId: canonicalYear.id, startsOn: '2027-01-11', endsOn: '2027-04-09' },
  { id: 'term_2026_03', name: 'Third Term', academicYearId: canonicalYear.id, startsOn: '2027-05-03', endsOn: '2027-07-23' }
];

function database({ missingYear = false, existingFixtures = [], terms = canonicalTerms } = {}) {
  const calls = [];
  let writes = 0;
  return {
    calls,
    get writes() { return writes; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT DATABASE()')) return [{ databaseName }];
      if (sql.includes('information_schema.TABLES')) return [{ tableName: 'sample_data_fixtures' }];
      if (sql.includes('FROM schema_migrations')) return [{ version: 61, name: '061_durable_sample_data_fixtures.sql', checksum: 'verified' }];
      if (sql.includes('FROM academic_years')) {
        assert.match(sql, /WHERE id=\? AND school_id=\?/);
        assert.deepEqual(params, [canonicalYear.id, schoolId]);
        return missingYear ? [] : [canonicalYear];
      }
      if (sql.includes('FROM terms')) {
        assert.match(sql, /starts_on AS startsOn/);
        assert.match(sql, /ends_on AS endsOn/);
        const [yearId, requestedName] = params;
        assert.equal(yearId, canonicalYear.id);
        return terms.filter((term) => term.name.toLowerCase() === String(requestedName).toLowerCase()).slice(0, 1);
      }
      if (sql.includes('FROM sample_data_fixtures')) return existingFixtures;
      if (sql.includes('FROM classes')) {
        assert.deepEqual(params, [schoolId]);
        return [{ id: 'class_primary_6', name: 'Primary 6' }];
      }
      throw new Error(`Unexpected query in production fixture planner: ${sql}`);
    },
    async execute() {
      writes += 1;
      throw new Error('Fixture planning must not execute database writes.');
    }
  };
}

test('production fixture dry-run resolves the verified canonical year ID despite its longer display name', async () => {
  const db = database();
  const plan = await buildPlan(db, { schoolId });

  assert.equal(plan.databaseName, databaseName);
  assert.deepEqual(plan.year, canonicalYear);
  assert.deepEqual(plan.terms, canonicalTerms);
  assert.deepEqual(db.calls.filter(({ sql }) => sql.includes('FROM terms')).map(({ params }) => params[1]), canonicalTerms.map((term) => term.name));
  assert.equal(plan.rows.length, 6);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.sampleStudentId))], TEST_PARENT_STUDENT_IDS);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.academicYearId))], [canonicalYear.id]);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.schoolId))], [schoolId]);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.termId))], canonicalTerms.map((term) => term.id));
  assert.ok(plan.rows.every((row) => row.academicYearName === canonicalYear.name && row.fixtureType === 'attendance' && row.fixtureVersion === 1 && row.fixturePayload.label === 'SAMPLE DATA' && row.fixturePayload.provenance === 'TEST' && row.fixturePayload.fixtureVersion === 1 && row.fixturePayload.records.length === 3));
  assert.equal(new Set(plan.rows.map((row) => [row.schoolId, row.sampleStudentId, row.academicYearId, row.termId, row.classId, row.fixtureType, row.fixtureVersion].join('|'))).size, plan.rows.length);
  assert.equal(plan.newRows.length, 6);
  assert.equal(plan.existingFixtures.length, 0);
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.rows.every((row) => validateAttendanceFixtureDates(row.fixturePayload.records, canonicalTerms.find((term) => term.id === row.termId))));
  assert.equal(db.writes, 0);
});

test('First, Second, and Third Term fixtures use synthetic weekdays within each canonical range', async () => {
  const plan = await buildPlan(database(), { schoolId });
  const expected = [
    ['OSAAH/DEMO/001', 'term_2026_01', ['2026-09-14', '2026-09-16', '2026-09-18']],
    ['OSAAH/DEMO/002', 'term_2026_01', ['2026-09-21', '2026-09-23', '2026-09-25']],
    ['OSAAH/DEMO/001', 'term_2026_02', ['2027-01-18', '2027-01-20', '2027-01-22']],
    ['OSAAH/DEMO/002', 'term_2026_02', ['2027-01-25', '2027-01-27', '2027-01-29']],
    ['OSAAH/DEMO/001', 'term_2026_03', ['2027-05-10', '2027-05-12', '2027-05-14']],
    ['OSAAH/DEMO/002', 'term_2026_03', ['2027-05-17', '2027-05-19', '2027-05-21']]
  ];

  for (const [studentId, termId, dates] of expected) {
    const row = plan.rows.find((item) => item.sampleStudentId === studentId && item.termId === termId);
    assert.ok(row, `${studentId} should have a fixture for ${termId}`);
    assert.deepEqual(row.fixturePayload.records.map((record) => record.date), dates);
    assert.equal(validateAttendanceFixtureDates(row.fixturePayload.records, canonicalTerms.find((term) => term.id === termId)), true);
  }
});

test('term date validation accepts inclusive boundaries and rejects invalid or out-of-range dates', () => {
  const term = canonicalTerms[0];
  assert.equal(validateAttendanceFixtureDates([{ date: term.startsOn }, { date: term.endsOn }], term), true);
  for (const date of ['2026-08-31', '2026-12-19', '2026-02-30', 'not-a-date']) {
    assert.throws(() => validateAttendanceFixtureDates([{ date }], term), (error) => error.code === 'SAMPLE_FIXTURE_DATE_OUTSIDE_TERM');
  }
});

test('date planning fails closed before class lookup or writes when a term is too short', async () => {
  const terms = canonicalTerms.map((term) => term.id === 'term_2026_02' ? { ...term, endsOn: '2027-01-15' } : term);
  const db = database({ terms });

  await assert.rejects(() => buildPlan(db, { schoolId }), (error) => error.code === 'SAMPLE_FIXTURE_DATE_OUTSIDE_TERM');
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM classes')), false);
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM sample_data_fixtures')), false);
  assert.equal(db.writes, 0);
});

test('malformed canonical term boundaries fail closed before fixture classification or writes', async () => {
  const terms = canonicalTerms.map((term) => term.id === 'term_2026_02' ? { ...term, startsOn: '2027-02-30' } : term);
  const db = database({ terms });

  await assert.rejects(() => buildPlan(db, { schoolId }), (error) => error.code === 'SAMPLE_FIXTURE_TERM_DATES_INVALID');
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM classes')), false);
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM sample_data_fixtures')), false);
  assert.equal(db.writes, 0);
});

test('fixture planning is repeatable and idempotent without executing writes', async () => {
  const db = database();
  const first = await buildPlan(db, { schoolId });
  const second = await buildPlan(db, { schoolId });

  assert.deepEqual(second, first);
  assert.equal(db.writes, 0);
});

test('matching existing fixture rows are idempotent and produce zero planned inserts', async () => {
  const baseline = await buildPlan(database(), { schoolId });
  const db = database({ existingFixtures: baseline.rows });
  const plan = await buildPlan(db, { schoolId });

  assert.equal(plan.newRows.length, 0);
  assert.equal(plan.existingFixtures.length, 6);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(db.writes, 0);
});

test('conflicting existing fixture payloads fail closed without writes', async () => {
  const baseline = await buildPlan(database(), { schoolId });
  const conflict = { ...baseline.rows[0], fixturePayload: { label: 'unexpected' } };
  const db = database({ existingFixtures: [conflict] });

  await assert.rejects(() => buildPlan(db, { schoolId }), (error) => error.code === 'SAMPLE_FIXTURE_CONFLICT' && error.details.conflicts[0].reason === 'FIXTURE_PAYLOAD_MISMATCH');
  assert.equal(db.writes, 0);
});

test('missing canonical school-owned academic year fails closed before term/class planning', async () => {
  const db = database({ missingYear: true });

  await assert.rejects(() => buildPlan(db, { schoolId }), (error) => error.code === 'SAMPLE_FIXTURE_CONTEXT_MISSING');
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM terms')), false);
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM classes')), false);
  assert.equal(db.writes, 0);
});
