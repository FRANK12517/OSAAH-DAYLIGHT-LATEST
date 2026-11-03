import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAdmissionProspectusService } from '../src/admission-prospectus.js';
import { createApp } from '../src/server.js';
import { createAdmissionProspectusPdfService } from '../src/admission-prospectus-pdf.js';
import { readFile } from 'node:fs/promises';

function request(port, path, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let payload = '';
      res.on('data', (chunk) => { payload += chunk; });
      res.on('end', () => { let body = payload; try { body = payload ? JSON.parse(payload) : null; } catch {} resolve({ status: res.statusCode, body, headers: res.headers }); });
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

test('prospectus service enforces combination uniqueness, sanitizes content, and hides drafts from parents', () => {
  const service = createAdmissionProspectusService({ academicYears: [{ id: '2026', name: '2026/2027' }] });
  const manager = { id: 'head-1', roleKey: 'HEADTEACHER', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['admission.prospectus.manage']) };
  const parent = { id: 'parent-1', portal: 'parent', schoolId: 'school-osaah-daylight' };
  const draft = service.create({ classId: 'Basic 1', academicYearId: '2026', content: '<h2>Rules</h2><script>alert(1)</script><p>Be punctual.</p>' }, manager);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(service.list({}, parent).length, 0);
  assert.throws(() => service.create({ classId: 'Basic 1', academicYearId: '2026', content: '<p>Duplicate</p>' }, manager), /already exists/);
  service.publish(draft.id, manager);
  const visible = service.list({ classId: 'Basic 1', academicYearId: '2026' }, parent);
  assert.equal(visible.length, 1);
  assert.match(visible[0].content, /Be punctual/);
  assert.doesNotMatch(visible[0].content, /script|alert/);
  assert.throws(() => service.validateProspectusDocument({ documentName: 'unsafe.exe', documentType: 'application/octet-stream', documentSize: 10 }), /supported/);
  for (const [roleKey, classId] of [['PROPRIETOR', 'Basic 2'], ['HEADTEACHER', 'Basic 3'], ['ASSISTANT_HEADTEACHER', 'Basic 4']]) {
    const actor = { id: `${roleKey}-1`, roleKey, portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['admission.prospectus.manage']) };
    assert.equal(service.create({ classId, academicYearId: '2026', content: '<p>Authorized</p>' }, actor).status, 'DRAFT');
  }
  assert.throws(() => service.create({ classId: 'Basic 4', academicYearId: '2026', content: '<p>Wrong school</p>' }, { ...manager, schoolId: 'school-other' }), /Forbidden/);
});

test('prospectus HTTP routes enforce role, publication, and school boundaries', async () => {
  const actors = {
    proprietor: { id: 'test-proprietor', roleKey: 'PROPRIETOR', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) },
    headteacher: { id: 'test-headteacher', roleKey: 'HEADTEACHER', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage']) },
    assistant: { id: 'test-assistant', roleKey: 'ASSISTANT_HEADTEACHER', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage']) },
    teacher: { id: 'test-teacher', roleKey: 'TEACHER', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) },
    parent: { id: 'test-parent', roleKey: 'PARENT', portal: 'parent', schoolId: 'school-osaah-daylight', permissions: new Set() }
  };
  const auth = { authenticateAsync: async (token) => actors[token] ?? null };
  const admissionProspectus = createAdmissionProspectusService({ academicYears: [{ id: '2026', name: '2026/2027' }] });
  const server = http.createServer(createApp({ auth, admissionProspectus }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const created = await request(port, '/api/admission-prospectus', { method: 'POST', token: 'proprietor', body: { classId: 'Basic 2', academicYearId: '2026', content: '<p>Published safely</p>' } });
  assert.equal(created.status, 201);
  for (const token of ['headteacher', 'assistant']) {
    const response = await request(port, '/api/admission-prospectus', { method: 'POST', token, body: { classId: token === 'headteacher' ? 'Basic 3' : 'Basic 4', academicYearId: '2026', content: '<p>Leadership access</p>' } });
    assert.equal(response.status, 201, `${token} retains prospectus management through its explicit permission`);
  }
  assert.equal((await request(port, '/api/admission-prospectus', { token: 'parent' })).body.prospectuses.length, 0);
  const teacherPublish = await request(port, '/api/admission-prospectus/' + created.body.id + '/publish', { method: 'POST', token: 'teacher' });
  const proprietorPublish = await request(port, '/api/admission-prospectus/' + created.body.id + '/publish', { method: 'POST', token: 'proprietor' });
  assert.equal(teacherPublish.status, 403);
  assert.equal(proprietorPublish.status, 200);
  const visible = await request(port, '/api/admission-prospectus?classId=Basic%202&academicYearId=2026', { token: 'parent' });
  assert.equal(visible.status, 200);
  assert.equal(visible.body.prospectuses[0].content, '<p>Published safely</p>');
  const publicVisible = await request(port, '/api/public/admission-prospectus?classId=Basic%202&academicYearId=2026');
  assert.equal(publicVisible.status, 200);
  assert.equal(publicVisible.body.prospectuses[0].content, '<p>Published safely</p>');
  const publicPdf = await request(port, `/api/public/admission-prospectus/${created.body.id}/pdf`);
  assert.equal(publicPdf.status, 200);
  assert.match(publicPdf.headers['content-type'], /application\/pdf/);
  assert.match(publicPdf.headers['content-disposition'], /OSAAH-Admission-Prospectus-Basic_2-2026_2027\.pdf/);
  assert.equal((await request(port, '/api/admission-prospectus', { method: 'POST', token: 'teacher', body: { classId: 'Basic 2', academicYearId: '2026', content: '<p>Denied</p>' } })).status, 403);
  const teacherPage = await request(port, '/admissions/prospectus', { token: 'teacher' });
  const parentPage = await request(port, '/parent/admission-prospectus', { token: 'parent' });
  assert.equal(teacherPage.status, 403);
  assert.equal(parentPage.status, 200);
  await new Promise((resolve) => server.close(resolve));
});

test('parent portal exposes prospectus below online admission and produces branded PDF', async () => {
  const [index, app, page, serviceWorker] = await Promise.all([readFile(new URL('../public/index.html', import.meta.url), 'utf8'), readFile(new URL('../public/app.js', import.meta.url), 'utf8'), readFile(new URL('../public/parent-admission-prospectus.html', import.meta.url), 'utf8'), readFile(new URL('../public/sw.js', import.meta.url), 'utf8')]);
  assert.ok(index.indexOf('Online Admission') < index.indexOf('Admission Prospectus'));
  assert.match(index, /Online Admission<\/a><a class="admission-button" href="\/parent\/admission-prospectus">Admission Prospectus/);
  assert.doesNotMatch(index, /parent-admission-actions[^>]*hidden/);
  assert.doesNotMatch(app, /parent-admission-actions/);
  assert.match(index, /app\.js\?v=\d{8}-\d+/);
  assert.match(serviceWorker, /osaah-shell-v\d+/);
  assert.match(serviceWorker, /caches\.delete/);
  assert.match(page, /Export Branded PDF/);
  assert.match(page, /\/api\/public\/admission-prospectus/);
  const service = createAdmissionProspectusService({ academicYears: [{ id: '2026', name: '2026/2027' }] });
  const manager = { id: 'head-1', roleKey: 'HEADTEACHER', portal: 'school', schoolId: 'school-osaah-daylight', permissions: new Set(['admission.prospectus.manage']) };
  const record = service.create({ classId: 'Basic 2', academicYearId: '2026', content: '<h2>Existing content</h2><ul><li>One item</li></ul>' }, manager); service.publish(record.id, manager);
  const pdf = await createAdmissionProspectusPdfService().pdf(service.get(record.id, { portal: 'parent', schoolId: 'school-osaah-daylight' }));
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/); assert.ok((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 2); assert.match(pdf.toString('latin1'), /\/FontFile2/);
});
