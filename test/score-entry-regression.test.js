import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { createStudentService, CORE_LEVELS } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { SCHOOL_CLASS_CATALOGUE } from '../public/class-catalogue.js';

const schoolId = 'sch_default_01';
const teacher = { id: 'score-teacher', roleKey: 'TEACHER', portal: 'school', schoolId, assignedClassIds: [...CORE_LEVELS], permissions: new Set(['academics.read', 'subjects.read', 'marks.write', 'results.read']) };

function eligibleStudent(students, classId, surname, context = {}) {
  return students.createStudent({ firstName: 'Ama', surname, classId, academicYearId: context.academicYear ?? '2026/2027', termId: context.term ?? 'First Term' });
}

function scoreFixture() {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const resultService = createAcademicResultsService({ schoolId, students, subjects });
  return { students, subjects, resultService };
}

test('canonical Score Entry class catalogue presents school labels and preserves canonical backend values', () => {
  assert.deepEqual(SCHOOL_CLASS_CATALOGUE.map(({ id }) => id), CORE_LEVELS);
  assert.deepEqual(SCHOOL_CLASS_CATALOGUE.map(({ label }) => label), ['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  assert.match(html, /<select name="classId" required>/);
  assert.doesNotMatch(html, /<select name="classId"[^>]*multiple/);
  assert.match(html, /Select Class/);
});

test('subject configuration filters by the selected class and honors configured level/class assignments', () => {
  const { subjects } = scoreFixture();
  const admin = { ...teacher, roleKey: 'HEADTEACHER', permissions: new Set(['*']) };
  const mappings = [
    ['Nursery subjects', ['Nursery 1', 'Nursery 2']],
    ['KG subjects', ['KG1', 'KG2']],
    ['Lower Primary subjects', ['Primary 1', 'Primary 2', 'Primary 3']],
    ['Upper Primary subjects', ['Primary 4', 'Primary 5', 'Primary 6']],
    ['JHS subjects', ['JHS 1', 'JHS 2', 'JHS 3']],
  ];
  const configured = mappings.map(([name, classIds]) => subjects.create({ name, classIds }, admin));
  const cases = [
    ['Nursery 1', 'Nursery subjects'], ['Nursery 2', 'Nursery subjects'], ['KG1', 'KG subjects'], ['KG2', 'KG subjects'],
    ['Primary 1', 'Lower Primary subjects'], ['Primary 2', 'Lower Primary subjects'], ['Primary 3', 'Lower Primary subjects'],
    ['Primary 4', 'Upper Primary subjects'], ['Primary 5', 'Upper Primary subjects'], ['Primary 6', 'Upper Primary subjects'],
    ['JHS 1', 'JHS subjects'], ['JHS 2', 'JHS subjects'], ['JHS 3', 'JHS subjects'],
  ];
  for (const [classId, expectedName] of cases) {
    const actual = subjects.list({ classId }, teacher).filter((item) => configured.some((entry) => entry.id === item.id));
    assert.deepEqual(actual.map((item) => item.name), [expectedName], `${classId} must use its configured level group`);
  }
  assert.throws(() => subjects.list({ classId: 'JHS 1' }, { ...teacher, schoolId: 'another-school' }), /Forbidden/);
});

test('score roster requires every academic selection and returns only the selected enrollment with canonical student ID and saved score', () => {
  const { students, subjects, resultService } = scoreFixture();
  const classId = 'Primary 1';
  const enrolled = eligibleStudent(students, classId, 'Enrolled');
  eligibleStudent(students, 'Primary 2', 'DifferentClass');
  eligibleStudent(students, classId, 'DifferentTerm', { term: 'Second Term' });
  eligibleStudent(students, classId, 'DifferentYear', { academicYear: '2025/2026' });
  const subject = subjects.list({ classId }, teacher)[0];
  for (const missing of ['academicYear', 'term', 'classId', 'subjectId']) {
    const filters = { academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id };
    delete filters[missing];
    const label = missing === 'academicYear' ? 'Academic year' : missing === 'classId' ? 'Class' : missing === 'subjectId' ? 'Subject' : 'Term';
    assert.throws(() => resultService.scoreEntryRoster(filters, teacher), new RegExp(`${label} is required`));
  }
  assert.throws(() => resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: 'not-for-class' }, teacher), /Subject is invalid for this class/);
  const initial = resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, teacher);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].studentId, enrolled.id);
  assert.equal(initial[0].permanentStudentId, enrolled.permanentStudentId);
  assert.equal(initial[0].saved, false);
  const saved = resultService.saveScore({ studentId: enrolled.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 43, examScore: 37 }, teacher);
  assert.equal(saved.totalScore, 80);
  assert.equal(resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, teacher)[0].totalScore, 80);
  assert.throws(() => resultService.saveScore({ studentId: enrolled.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, teacher), /between 0 and 50/);
  assert.throws(() => resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, { ...teacher, schoolId: 'another-school' }), /Forbidden/);
});

test('sample Score Entry mode loads the canonical DEMO-001 fixture separately from official students', () => {
  const { students, subjects, resultService } = scoreFixture();
  const classId = 'KG1';
  const subject = subjects.list({ classId }, teacher)[0];
  students.seedSampleStudents();
  const filters = { academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id };
  assert.equal(resultService.scoreEntryRoster({ ...filters, sampleMode: 'false' }, teacher).length, 0);
  const sampleRoster = resultService.scoreEntryRoster({ ...filters, sampleMode: 'true' }, teacher);
  assert.equal(sampleRoster.length, 1);
  assert.equal(sampleRoster[0].permanentStudentId, 'OSAAH/DEMO/001');
  assert.equal(sampleRoster[0].isTestRecord, true);
  eligibleStudent(students, classId, 'Real');
  const realRoster = resultService.scoreEntryRoster({ ...filters, sampleMode: 'true' }, teacher);
  assert.equal(realRoster.length, 1);
  assert.equal(realRoster[0].permanentStudentId, 'OSAAH/DEMO/001');
  assert.equal(realRoster[0].isTestRecord, true);
});

test('academic options and score-entry roster use the configured authenticated school instead of the legacy service default', async () => {
  const actor = { ...teacher, roleKey: 'PROPRIETOR', assignedClassIds: [], permissions: new Set(['*']) };
  const auth = { authenticateAsync: async (token) => token === 'osaah-school-user' ? actor : token === 'cross-school-user' ? { ...actor, schoolId: 'sch_other_02' } : null };
  const legacyService = createAcademicResultsService({ students: createStudentService({ schoolId }), subjects: createSubjectService({ schoolId }) });
  assert.throws(() => legacyService.options(actor), /Forbidden/, 'the old result-service default rejected the authenticated database school');
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  const app = createApp({ auth });
  if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
  else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  const server = http.createServer((incoming, outgoing) => {
    Promise.resolve(app(incoming, outgoing)).catch((error) => {
      outgoing.writeHead(error.message === 'Forbidden.' ? 403 : 500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const headers = { Authorization: 'Bearer osaah-school-user' };
    const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/academic/options`, { headers });
    assert.equal(optionsResponse.status, 200, 'the prior legacy-vs-authenticated school ID mismatch must not reject academic options');
    const options = await optionsResponse.json();
    assert.ok(options.classes.includes('Primary 1'));
    const subjectsResponse = await fetch(`http://127.0.0.1:${port}/api/subjects?academicYear=2026%2F2027&term=First%20Term&classId=Primary%201`, { headers });
    assert.equal(subjectsResponse.status, 200);
    const subjectsBody = await subjectsResponse.json();
    assert.ok(subjectsBody.subjects.length > 0);
    const subjectId = subjectsBody.subjects[0].id;
    const missingQuery = new URLSearchParams({ term: 'First Term', classId: 'Primary 1', subjectId });
    const invalidRoster = await fetch(`http://127.0.0.1:${port}/api/academic/score-entry/roster?${missingQuery}`, { headers });
    assert.equal(invalidRoster.status, 400);
    assert.equal((await invalidRoster.json()).error, 'Unable to load students. Please try again.');
    const crossTenant = await fetch(`http://127.0.0.1:${port}/api/academic/options`, { headers: { Authorization: 'Bearer cross-school-user' } });
    assert.equal(crossTenant.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('authenticated Score Entry API loads scoped students, saves CA/Exam, and reloads the saved result', async () => {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const student = eligibleStudent(students, 'JHS 1', 'Api');
  eligibleStudent(students, 'JHS 2', 'OutOfClass');
  const subject = subjects.list({ classId: 'JHS 1' }, teacher)[0];
  const resultService = createAcademicResultsService({ schoolId, students, subjects });
  const actor = { ...teacher, roleKey: 'PROPRIETOR', assignedClassIds: [], permissions: new Set(['*']) };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const app = createApp({ auth, students, subjects, academicResults: resultService });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer authorized' };
    const query = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', subjectId: subject.id });
    const loaded = await fetch(`${base}/api/academic/score-entry/roster?${query}`, { headers });
    assert.equal(loaded.status, 200);
    const roster = await loaded.json();
    assert.equal(roster.students.length, 1);
    assert.equal(roster.students[0].permanentStudentId, student.permanentStudentId);
    const savedResponse = await fetch(`${base}/api/academic/scores`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(query), studentId: student.id, caScore: 45, examScore: 35 }) });
    assert.equal(savedResponse.status, 201);
    const saved = await savedResponse.json();
    assert.equal(saved.totalScore, 80);
    assert.equal(saved.grade, 1);
    const reloadedResponse = await fetch(`${base}/api/academic/score-entry/roster?${query}`, { headers });
    assert.equal(reloadedResponse.status, 200);
    const reloaded = await reloadedResponse.json();
    assert.equal(reloaded.students[0].totalScore, 80);
    assert.equal(reloaded.students[0].saved, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('authenticated Sample Mode loads and saves only the existing DEMO-001 sample workflow record', async () => {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const subject = subjects.list({ classId: 'JHS 1' }, teacher)[0];
  const resultService = createAcademicResultsService({ schoolId, students, subjects });
  const actor = { ...teacher, roleKey: 'PROPRIETOR', assignedClassIds: [], permissions: new Set(['*']) };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const app = createApp({ auth, students, subjects, academicResults: resultService });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer authorized' };
    const query = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', subjectId: subject.id, sampleMode: 'true' });
    const loaded = await fetch(`${base}/api/academic/score-entry/roster?${query}`, { headers });
    assert.equal(loaded.status, 200);
    const roster = await loaded.json();
    assert.equal(roster.students.length, 1);
    assert.equal(roster.students[0].permanentStudentId, 'OSAAH/DEMO/001');
    assert.equal(roster.students[0].isTestRecord, true);
    const savedResponse = await fetch(`${base}/api/academic/scores`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(query), studentId: roster.students[0].studentId, caScore: 25, examScore: 35, sampleMode: true }) });
    assert.equal(savedResponse.status, 201);
    const saved = await savedResponse.json();
    assert.equal(saved.studentIndexNumber, 'OSAAH/DEMO/001');
    assert.equal(saved.isTestRecord, true);
    const officialQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', subjectId: subject.id });
    const official = await fetch(`${base}/api/academic/score-entry/roster?${officialQuery}`, { headers });
    assert.equal(official.status, 200);
    assert.deepEqual((await official.json()).students, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('durable Score Entry HTTP contract keeps empty, sample, validation, authorization, and server-error states distinct', async () => {
  let failRoster = false;
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'ay_2026_01', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term_2026_01', academicYearId: 'ay_2026_01', name: '1st Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class_bs4_01', name: 'Basic 4' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subj_math', code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class_bs4_01', className: 'Basic 4', academicYearId: null, assignmentActive: 1 }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        if (failRoster) throw new Error('database connection reset');
        return [];
      }
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const actor = { ...teacher, assignedClassIds: ['class_bs4_01'], assignedSubjectIds: ['subj_math'] };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const server = http.createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/academic/score-entry/roster`;
    const context = { academicYearId: 'ay_2026_01', termId: 'term_2026_01', classId: 'class_bs4_01', subjectId: 'subj_math' };
    const request = async (params, token = 'authorized') => fetch(`${base}?${new URLSearchParams(params)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    const official = await request({ ...context, sampleMode: 'false' });
    assert.equal(official.status, 200);
    assert.deepEqual((await official.json()).students, []);

    const sample = await request({ ...context, sampleMode: 'true' });
    assert.equal(sample.status, 200);
    const sampleStudents = (await sample.json()).students;
    assert.deepEqual(sampleStudents.map((student) => student.permanentStudentId), ['OSAAH/DEMO/001']);

    const malformed = await request({ academicYearId: context.academicYearId, termId: context.termId, classId: context.classId });
    assert.equal(malformed.status, 400);

    const unauthorizedClass = await request({ ...context, classId: 'class_not_assigned' });
    assert.equal(unauthorizedClass.status, 403);

    const unauthenticated = await request(context, null);
    assert.equal(unauthenticated.status, 401);

    failRoster = true;
    const serverFailure = await request({ ...context, sampleMode: 'false' });
    assert.equal(serverFailure.status, 500);
    assert.equal((await serverFailure.json()).error, 'Unable to load students. Please try again.');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('durable sample Score Entry maps verified database IDs to the in-memory sample catalogue without widening teacher scope', async () => {
  const classId = 'class_jhs1_db';
  const subjectId = 'subject_math_db';
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  const subjects = createSubjectService({ schoolId });
  const academicResults = createAcademicResultsService({ schoolId, students, subjects });
  const actor = { ...teacher, assignedClassIds: [classId], assignedSubjectIds: [subjectId] };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : token === 'other-class' ? { ...actor, assignedClassIds: ['class_other'] } : null };
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'ay_2026_01', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term_2026_01', academicYearId: 'ay_2026_01', name: '1st Term' }];
      if (sql.includes('FROM classes WHERE school_id=? AND id=?')) return [{ id: classId, name: 'JHS 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: subjectId, code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId, className: 'JHS 1', academicYearId: null, assignmentActive: 1 }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  const app = createApp({ auth, database, students, subjects, academicResults, aiEnabled: false });
  if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
  else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer authorized' };
    const context = { academicYear: '2026/2027', term: 'term_2026_01', classId, subjectId };
    const rosterResponse = await fetch(`${base}/api/academic/score-entry/roster?${new URLSearchParams({ ...context, sampleMode: 'true' })}`, { headers });
    assert.equal(rosterResponse.status, 200);
    const roster = await rosterResponse.json();
    assert.equal(roster.students.length, 1);
    const savedResponse = await fetch(`${base}/api/academic/scores`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, studentId: roster.students[0].studentId, caScore: 25, examScore: 35, sampleMode: true }) });
    assert.equal(savedResponse.status, 201);
    const saved = await savedResponse.json();
    assert.equal(saved.studentIndexNumber, 'OSAAH/DEMO/001');
    assert.equal(saved.classId, 'JHS 1', 'only the verified DB ID is translated at the in-memory sample-service boundary');
    assert.equal(saved.totalScore, 60);

    const denied = await fetch(`${base}/api/academic/scores`, { method: 'POST', headers: { Authorization: 'Bearer other-class', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, studentId: roster.students[0].studentId, caScore: 25, examScore: 35, sampleMode: true }) });
    assert.equal(denied.status, 403, 'the sample mapping must not bypass database class assignment checks');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Score Entry UI has dependent single-select subjects, required-selection gates, ID display, loading and error states', () => {
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/score-entry.js', import.meta.url), 'utf8');
  for (const header of ['OSAAH STUDENT INDEX', 'STUDENT NAME', 'CA / 50', 'Exam / 50', 'TOTAL', 'GRADE', 'SAVE STATUS']) assert.match(html, new RegExp(header));
  assert.match(js, /Select Class First/);
  assert.match(js, /Loading subjects…/);
  assert.match(js, /No subjects configured for this class\./);
  assert.match(js, /Loading students…/);
  assert.match(js, /No students found for the selected class, term and academic year\./);
  assert.match(js, /\/api\/academic\/score-entry\/roster/);
  assert.match(js, /student\.permanentStudentId/);
  assert.match(js, /subjectSelect\.value = ''/);
  assert.match(js, /ca < 0 \|\| ca > 50/);
  assert.match(js, /exam < 0 \|\| exam > 50/);
  assert.match(js, /setTimeout\(\(\) => \{/);
  assert.match(js, /save\(row, sequence\)/);
  assert.match(js, /latestSaves\.set\(row, \{ sequence, data, stateCell \}\)/);
  assert.match(js, /activeSaves\.has\(row\)/);
  assert.match(js, /queuedSaves\.add\(row\)/);
  assert.match(js, /retry-score-save/);
  assert.match(js, /classId: classSelect\.value/);
  assert.match(js, /!caInput\.value\.trim\(\)/);
  assert.match(js, /Error saving/);
  assert.match(html, /<select name="academicYear" required>/);
  assert.match(html, /<select name="term" required>/);
  assert.match(js, /optionId\(item\)/);
  assert.match(js, /renderAcademicOptions/);
  assert.match(js, /renderTerms/);
  assert.match(html, /name="sampleMode"/);
  assert.match(js, /sampleMode/);
});

test('Score Entry terminates academic-option loading with an actionable retry state', () => {
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/score-entry.js', import.meta.url), 'utf8');
  assert.match(html, /id="retry-options"/);
  assert.match(js, /Academic years unavailable/);
  assert.match(js, /Terms unavailable/);
  assert.match(js, /Academic options could not be loaded\./);
  assert.match(js, /retryOptions\.hidden = false/);
  assert.match(js, /retryOptions\.addEventListener\('click', load\)/);
  assert.match(js, /optionsRequest/);
  assert.match(js, /'Term 1': '1st Term'/);
  assert.match(js, /'TERM_3': '3rd Term'/);
});
