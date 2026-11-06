import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService, CORE_LEVELS } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';

const actor = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['marks.write', 'results.generate', 'results.read', 'results.publish']) };

test('sample workflow uses existing reserved-ID students in every configured core class', () => {
  const students = createStudentService();
  const samples = students.seedSampleStudents();
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults: results, now: () => '2026-09-17T00:00:00.000Z' });
  assert.deepEqual(workflow.classes(), CORE_LEVELS);
  assert.equal(samples.length, 2);
  for (const classId of CORE_LEVELS) {
    const roster = workflow.students(classId);
    assert.equal(roster.length, 2);
    assert.ok(roster.every((student) => student.isTestRecord && /^OSAAH\/DEMO\/(?:001|002)$/.test(student.permanentStudentId)));
    const result = workflow.generate({ classId, studentId: roster[0].id, academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' }, actor);
    assert.equal(result.isSample, true);
    assert.equal(result.sampleLabel, 'SAMPLE DATA');
    assert.equal(result.classId, classId);
    assert.ok(result.subjects.length > 0);
    assert.ok(result.subjects.every((subject) => subject.caScore + subject.examScore === subject.totalScore));
    assert.ok(result.subjects.every((subject) => subject.grade && subject.remark));
    assert.equal(Object.values(result.assessments).length, 5);
    assert.ok(Object.values(result.assessments).every(Boolean));
    assert.equal(result.attendance.timesPresent + result.attendance.timesAbsent <= result.attendance.totalSchoolDays, true);
    const repeat = workflow.generate({ classId, studentId: roster[0].id, academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' }, actor);
    assert.deepEqual(repeat.subjects.map((s) => [s.subjectId, s.caScore, s.examScore]), result.subjects.map((s) => [s.subjectId, s.caScore, s.examScore]));
  }
});

test('sample rankings never include real students and real rankings never include samples', () => {
  const students = createStudentService();
  const samples = students.seedSampleStudents();
  const real = students.createStudent({ firstName: 'Real', surname: 'Student', classId: 'Primary 1', admissionYearId: '2026' });
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults: results });
  const roster = workflow.students('Primary 1');
  workflow.generate({ classId: 'Primary 1', studentId: roster[0].id, academicYear: '2026/2027', term: 'First Term' }, actor);
  workflow.generate({ classId: 'Primary 1', studentId: roster[1].id, academicYear: '2026/2027', term: 'First Term' }, actor);
  const subject = subjects.list({ classId: 'Primary 1' }, actor)[0];
  results.saveScore({ studentId: real.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 45, examScore: 45 }, actor);
  const sampleResult = results.result({ studentId: roster[0].id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', sample: true }, actor);
  const realResult = results.result({ studentId: real.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(sampleResult.isSample, true);
  assert.equal(realResult.isSample, false);
  assert.ok(sampleResult.subjects.every((row) => row.subjectPosition));
  assert.equal(realResult.subjects[0].subjectPosition, '1st');
});

test('sample publication is explicitly classified and real sample reset cannot touch a real student', () => {
  const students = createStudentService();
  const sample = students.seedSampleStudents()[0];
  const real = students.createStudent({ firstName: 'Real', surname: 'Student', classId: 'Primary 1', admissionYearId: '2026' });
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults: results });
  workflow.generate({ classId: 'Primary 1', studentId: sample.id, academicYear: '2026/2027', term: 'First Term' }, actor);
  const publication = workflow.publish({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(publication.isSample, true);
  assert.equal(publication.sampleLabel, 'SAMPLE DATA');
  assert.throws(() => workflow.reset({ permanentStudentId: real.permanentStudentId, academicYear: '2026/2027', term: 'First Term' }, actor), /sample/);
  assert.equal(workflow.reset({ permanentStudentId: sample.permanentStudentId, academicYear: '2026/2027', term: 'First Term' }, actor).isSample, true);
});
