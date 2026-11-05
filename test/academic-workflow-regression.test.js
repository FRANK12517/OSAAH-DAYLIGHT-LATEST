import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { PROPRIETOR_PAGE_ALIASES } from '../src/proprietor-sidebar-routes.js';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { createAttendanceService } from '../src/attendance.js';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';

test('academic sidebar routes keep Promotion and Attendance Alerts isolated from result and register views', async () => {
  assert.equal(PROPRIETOR_PAGE_ALIASES['/promotion'], '/promotion.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/alerts'], '/attendance-alerts.html');
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/promotion'], PROPRIETOR_PAGE_ALIASES['/results']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/attendance/alerts'], PROPRIETOR_PAGE_ALIASES['/attendance']);
  assert.match(await readFile(new URL('../public/promotion.html', import.meta.url), 'utf8'), /Promotion decision/);
  assert.match(await readFile(new URL('../public/attendance-alerts.html', import.meta.url), 'utf8'), /Attendance Alerts/);
});

test('Score Entry class catalogue shows canonical labels without changing IDs', async () => {
  const { SCHOOL_CLASS_CATALOGUE } = await import('../public/class-catalogue.js');
  assert.deepEqual(SCHOOL_CLASS_CATALOGUE.map(({ label }) => label), ['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  assert.equal(SCHOOL_CLASS_CATALOGUE.find(({ label }) => label === 'Primary 6').id, 'Primary 6');
  assert.equal(SCHOOL_CLASS_CATALOGUE.find(({ label }) => label === 'KG 1').id, 'KG1');
});

test('Attendance Alerts has deterministic loading, empty, error, and retry states', async () => {
  const html = await readFile(new URL('../public/attendance-alerts.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/attendance-alerts.js', import.meta.url), 'utf8');
  assert.match(html, /Loading attendance alerts\.\.\./);
  assert.match(html, /id="retry-alerts"/);
  assert.match(script, /No attendance alert\./);
  assert.match(script, /Unable to load attendance alerts/);
  assert.match(script, /retry\.addEventListener\('click',load\)/);
  assert.match(script, /Array\.isArray\(data\.alerts\)/);
});

test('Attendance Alerts is authenticated, assignment scoped, deduplicated and excludes sample students', async () => {
  const auth = createAuthService();
  const students = createStudentService();
  const sample = students.seedSampleStudents()[0];
  const assigned = students.createStudent({ firstName: 'Ama', surname: 'Assigned', classId: 'Primary 4' });
  const other = students.createStudent({ firstName: 'Kojo', surname: 'Other', classId: 'Primary 5' });
  const attendance = createAttendanceService();
  const actor = { id: 'teacher-alerts', userId: 'teacher-alerts', schoolId: 'school-osaah-daylight', roleKey: 'TEACHER' };
  attendance.saveStudentAttendance({ date: '2026-10-08', classId: 'Primary 4', studentId: assigned.id, status: 'ABSENT' }, actor);
  attendance.saveStudentAttendance({ date: '2026-10-08', classId: 'Primary 5', studentId: other.id, status: 'ABSENT' }, actor);
  attendance.saveStudentAttendance({ date: '2026-10-08', classId: sample.classId, studentId: sample.id, status: 'ABSENT' }, actor);
  const wrapped = { ...attendance, listStudentRecords: () => [...attendance.listStudentRecords(), ...attendance.listStudentRecords().map((item) => ({ ...item }))] };
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const server = createServer(createApp({ auth, students, attendance: wrapped }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const get = (token) => new Promise((resolve, reject) => { const req = httpRequest({ port, path: '/api/attendance/alerts', headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })); }); req.on('error', reject); req.end(); });
  try {
    assert.equal((await get()).status, 401);
    const result = await get(teacher.token);
    assert.equal(result.status, 200);
    assert.equal(result.body.alerts.length, 0); // the demo teacher has no assigned classes
    assert.ok(!result.body.alerts.some((item) => [sample.permanentStudentId, other.permanentStudentId].includes(item.permanentStudentId)));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('sample students use reserved IDs, populate every class, and stay out of normal lists', () => {
  const students = createStudentService();
  const samples = students.seedSampleStudents();
  const repeated = students.seedSampleStudents();
  assert.equal(samples.length, 2);
  assert.deepEqual(repeated.map((student) => student.id), samples.map((student) => student.id));
  assert.ok(samples.every((student) => student.isTestRecord && /^OSAAH\/DEMO\/(?:001|002)$/.test(student.permanentStudentId)));
  assert.equal(students.listStudents().length, 0);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, 2);
  assert.deepEqual(samples.map((student) => student.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
  assert.throws(() => students.createStudent({ firstName: 'Unsafe', surname: 'Record', permanentStudentId: 'OSAAH-DEMO-X-001' }), /(reserved|malformed)/);
});

test('attendance page exposes all canonical classes through one selector', async () => {
  const html = await readFile(new URL('../public/attendance.html', import.meta.url), 'utf8');
  assert.equal((html.match(/<select id="attendance-class"/g) ?? []).length, 1);
  assert.match(html, /Loading assigned classes/);
  assert.doesNotMatch(html, /<option value="(?:Nursery 1|Primary 1|JHS 1)">/);
});
