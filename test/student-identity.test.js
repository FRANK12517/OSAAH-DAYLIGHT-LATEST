import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createAcademicResultsService } from '../src/academic-results.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'teacher-identity', roleKey: 'TEACHER', schoolId, assignedClassIds: ['Primary 1'], permissions: new Set(['marks.write', 'results.read']) };

test('Permanent Student ID remains the canonical tenant-scoped student identity', () => {
  const students = createStudentService({ schoolId });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 1', admissionYearId: '2026' });
  assert.ok(student.permanentStudentId);
  assert.equal(students.findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER', requestedSchoolId: schoolId }).id, student.id);
  assert.equal(students.findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER', requestedSchoolId: schoolId }).permanentStudentId, student.permanentStudentId);
  assert.equal(createStudentService({ schoolId: 'other-school' }).findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER', requestedSchoolId: 'other-school' }), null);
});

test('result slip and Score Entry use canonical identity labels and never literal Student fallback', () => {
  const resultView = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const scorePage = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  assert.match(resultView, /STUDENT NAME/);
  assert.match(resultView, /Permanent Student ID/);
  assert.doesNotMatch(resultView, /<b>Student<\/b>\$\{esc\(x\.studentName \|\| ['"]Student/);
  assert.match(scorePage, /OSAAH STUDENT INDEX/);
  assert.match(scorePage, /STUDENT NAME/);
  assert.match(scorePage, /SAVE STATUS/);
  assert.doesNotMatch(scorePage, /<th>Osaah Index<\/th><th>Student<\/th>/);
});

test('result generation resolves the selected permanent-ID record name without changing score architecture', () => {
  const students = createStudentService({ schoolId });
  const student = students.createStudent({ firstName: 'Kojo', middleName: 'Yaw', surname: 'Owusu', classId: 'Primary 1', admissionYearId: '2026' });
  const subjects = { get: (id) => ({ id, active: true, classIds: ['Primary 1'] }) };
  const results = createAcademicResultsService({ schoolId, students, subjects, classes: ['Primary 1'] });
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: 'Math', academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 45 }, actor);
  const generated = results.result({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, actor);
  assert.equal(generated.studentIndexNumber, student.permanentStudentId);
  assert.equal(generated.studentName, 'Kojo Yaw Owusu');
});

test('reserved sample IDs resolve to sample students and remain test records', () => {
  const students = createStudentService({ schoolId });
  const sample = students.seedSampleStudents()[0];
  assert.ok(sample);
  assert.match(sample.permanentStudentId, /^OSAAH\/DEMO\/(?:001|002)$/);
  assert.equal(students.findByPermanentStudentId(sample.permanentStudentId, { roleKey: 'HEADTEACHER', requestedSchoolId: schoolId }).isTestRecord, true);
});
