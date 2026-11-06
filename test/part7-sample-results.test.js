import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';

const SCHOOL_ID = 'school-osaah-daylight';
const YEAR = '2026/2027';
const TERMS = ['First Term', 'Second Term', 'Third Term'];
const SAMPLE_IDS = ['OSAAH/DEMO/001', 'OSAAH/DEMO/002'];
const actor = {
  id: 'part7-sample-qa',
  roleKey: 'HEADTEACHER',
  schoolId: SCHOOL_ID,
  permissions: new Set(['marks.write', 'results.generate', 'results.read', 'results.write', 'results.publish'])
};

function setup() {
  const students = createStudentService({ schoolId: SCHOOL_ID });
  const subjects = createSubjectService({ schoolId: SCHOOL_ID });
  const academicResults = createAcademicResultsService({ schoolId: SCHOOL_ID, students, subjects });
  const workflow = createSampleResultWorkflow({ schoolId: SCHOOL_ID, students, subjects, academicResults });
  const samples = students.seedSampleStudents();
  return { students, subjects, academicResults, workflow, samples };
}

function saveInput(result, student) {
  return {
    studentId: student.id,
    permanentStudentId: student.permanentStudentId,
    classId: result.classId,
    academicYear: result.academicYear,
    term: result.term,
    examination: 'TERMINAL',
    attendance: result.attendance,
    assessment: result.assessments
  };
}

test('canonical sample identities are unique and reject duplicate or unsupported demo IDs', () => {
  const { students, samples } = setup();
  assert.deepEqual(samples.map((student) => student.permanentStudentId), SAMPLE_IDS);
  assert.equal(new Set(samples.map((student) => student.permanentStudentId)).size, 2);
  assert.equal(students.listStudents().length, 0);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, 2);
  assert.throws(() => students.createStudent({ firstName: 'Duplicate', surname: 'Slash', permanentStudentId: 'OSAAH/DEMO/001', isTestRecord: true }), /already exists/);
  assert.throws(() => students.createStudent({ firstName: 'Other', surname: 'Demo', permanentStudentId: 'OSAAH/DEMO/003', isTestRecord: true }), /malformed|permanent/i);
});

test('legacy demo IDs reconcile in memory to the canonical ID without duplicating sample students', () => {
  const students = createStudentService({ schoolId: SCHOOL_ID });
  const legacy = students.createStudent({ firstName: 'Old', surname: 'Demo One', permanentStudentId: 'OSAAH-DEMO-001', isTestRecord: true });
  const seeded = students.seedSampleStudents();
  assert.equal(seeded[0].id, legacy.id);
  assert.equal(seeded[0].permanentStudentId, 'OSAAH/DEMO/001');
  assert.equal(seeded.length, 2);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, 2);
});

test('both canonical samples generate, save, reload, and publish independently for all 13 classes and 3 terms', () => {
  const { students, subjects, academicResults, workflow, samples } = setup();
  const publicationIds = new Map();
  let generatedCount = 0;
  for (const classId of CORE_LEVELS) {
    assert.ok(workflow.classes().includes(classId));
    assert.ok(subjects.list({ classId }, actor).some((subject) => subject.active), `subjects for ${classId}`);
    for (const term of TERMS) {
      for (const student of samples) {
        const generated = workflow.generate({ classId, studentId: student.id, academicYear: YEAR, term, examinationType: 'TERMINAL' }, actor);
        generatedCount += 1;
        assert.equal(generated.isSample, true);
        assert.equal(generated.permanentStudentId, student.permanentStudentId);
        assert.equal(generated.classId, classId);
        assert.equal(generated.term, term);
        assert.ok(generated.subjects.length > 0);
        assert.ok(generated.subjects.every((row) => row.caScore + row.examScore === row.totalScore));
        assert.ok(generated.subjects.every((row) => row.grade && row.remark));
        assert.equal(generated.subjects.every((row) => row.provenance === 'TEST'), true);

        const saved = academicResults.saveResult(saveInput(generated, student), actor);
        assert.equal(saved.status, 'SAVED');
        const reloaded = academicResults.result({ studentId: student.id, classId, academicYear: YEAR, term }, actor);
        assert.equal(reloaded.lifecycle.status, 'SAVED');
        assert.equal(reloaded.isSample, true);
        assert.equal(reloaded.studentIndexNumber, student.permanentStudentId);
        assert.equal(reloaded.classId, classId);
        assert.equal(reloaded.term, term);

        const beforePublish = academicResults.publicationFor({ classId, academicYear: YEAR, term, isSample: true, studentId: student.id });
        assert.equal(beforePublish, null);
        const published = workflow.publish({ permanentStudentId: student.permanentStudentId, classId, academicYear: YEAR, term }, actor);
        assert.equal(published.status, 'PUBLISHED');
        assert.equal(published.isSample, true);
        assert.equal(published.studentId, student.id);
        const publicationKey = `${student.permanentStudentId}:${classId}:${term}`;
        publicationIds.set(publicationKey, published.id);
        assert.deepEqual(academicResults.publicationFor({ classId, academicYear: YEAR, term, isSample: true, studentId: student.id }), published);

        const idempotent = workflow.publish({ permanentStudentId: student.permanentStudentId, classId, academicYear: YEAR, term }, actor);
        assert.equal(idempotent.id, published.id);
        assert.equal(academicResults.publicationFor({ classId, academicYear: YEAR, term, isSample: true, studentId: student.id }).id, published.id);
      }
      const first = samples[0];
      const second = samples[1];
      assert.equal(academicResults.publicationFor({ classId, academicYear: YEAR, term, isSample: true, studentId: first.id })?.studentId, first.id);
      assert.equal(academicResults.publicationFor({ classId, academicYear: YEAR, term, isSample: true, studentId: second.id })?.studentId, second.id);
    }
  }
  assert.equal(generatedCount, CORE_LEVELS.length * TERMS.length * SAMPLE_IDS.length);
  assert.equal(publicationIds.size, generatedCount);
  assert.equal(students.counts().students, 0);
});

test('sample publication cannot expose another term, Mock record, or official cohort', () => {
  const { students, subjects, academicResults, workflow, samples } = setup();
  const sample = samples[0];
  const other = samples[1];
  const generated = workflow.generate({ classId: 'JHS 1', studentId: sample.id, academicYear: YEAR, term: 'First Term' }, actor);
  academicResults.saveResult(saveInput(generated, sample), actor);
  workflow.publish({ permanentStudentId: sample.permanentStudentId, classId: 'JHS 1', academicYear: YEAR, term: 'First Term' }, actor);
  assert.equal(academicResults.publicationFor({ classId: 'JHS 1', academicYear: YEAR, term: 'Second Term', isSample: true, studentId: sample.id }), null);
  assert.equal(academicResults.publicationFor({ classId: 'JHS 1', academicYear: YEAR, term: 'First Term', isSample: true, studentId: other.id }), null);
  assert.equal(academicResults.publicationFor({ classId: 'JHS 1', academicYear: YEAR, term: 'First Term', examination: 'MOCK', mockLabel: '1st Mock', isSample: true, studentId: sample.id }), null);
  assert.equal(academicResults.publicationFor({ classId: 'JHS 1', academicYear: YEAR, term: 'First Term', isSample: false }), null);
  assert.equal(academicResults.broadsheet({ classId: 'JHS 1', academicYear: YEAR, term: 'First Term' }, actor, { mock: false }).every((row) => row.isSample), true);
  assert.equal(subjects.list({ classId: 'JHS 1' }, actor).length > 0, true);
  assert.equal(students.counts().students, 0);
});
