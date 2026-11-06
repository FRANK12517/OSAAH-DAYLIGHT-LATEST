import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.js';

test('all three leadership sessions can open Admissions and save/reopen a durable enquiry; teachers are denied', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  const leader = auth.authenticate(proprietor.token);
  const sessions = [proprietor];
  for (const roleKey of ['HEADTEACHER', 'ASSISTANT_HEADTEACHER']) {
    const registered = auth.registerStaff({ fullName: roleKey, staffId: `TEST-${roleKey}`, primaryRole: roleKey }, leader);
    sessions.push(auth.login({ username: registered.staff.username, password: registered.temporaryPassword, portal: 'school' }));
  }
  const applications = [];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS') && sql.includes("TABLE_NAME='classes'")) return ['id', 'name', 'school_id', 'status'].map((columnName) => ({ columnName }));
      if (sql.includes('information_schema.COLUMNS') && sql.includes("TABLE_NAME='admission_applications'")) return ['id', 'school_id', 'application_number', 'enquiry_request_id', 'stage', 'applicant_data', 'created_at', 'updated_at'].map((columnName) => ({ columnName }));
      if (sql.includes('FROM classes')) return params[0] === leader.schoolId ? [{ id: 'class-jhs1', name: 'JHS 1', school_id: leader.schoolId, status: 'ACTIVE' }] : [];
      if (sql.includes('FROM admission_applications')) {
        if (sql.includes('WHERE id=? AND school_id=?')) return applications.filter((row) => row.id === params[0] && row.school_id === params[1]);
        return applications.filter((row) => row.school_id === params[0] && (!sql.includes('application_number=?') || row.application_number === params[1]) && (!sql.includes('enquiry_request_id=?') || row.enquiry_request_id === params[1]));
      }
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO admission_applications')) {
        const columns = /INSERT INTO admission_applications \(([^)]+)\)/.exec(sql)[1].split(',');
        applications.push(Object.fromEntries(columns.map((column, index) => [column, params[index]])));
      }
      if (sql.startsWith('UPDATE admission_applications SET applicant_data=?')) {
        const row = applications.find((item) => item.application_number === params.at(-1));
        row.applicant_data = params[0]; row.updated_at = params[1];
      }
      return { affectedRows: 1 };
    }
  };
  const server = createServer(createApp({ auth, database }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [index, session] of sessions.entries()) {
      const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
      for (const route of ['/admissions', '/api/admission-applications']) {
        const response = await fetch(base + route, { headers });
        assert.equal(response.status, 200, `${index}: ${route}`);
      }
      const created = await fetch(base + '/api/admission-applications', { method: 'POST', headers, body: JSON.stringify({ studentFirstName: 'Sample', studentSurname: `Applicant${index}`, classAppliedFor: 'class-jhs1', enquiryRequestId: `leadership-request-${index}`, primaryGuardianPrimaryPhone: '0241234567' }) });
      assert.equal(created.status, 201, await created.clone().text());
      const application = await created.json();
      const path = `/api/admission-applications/${application.applicationNumber}`;
      const updated = await fetch(base + path + '/update', { method: 'PATCH', headers, body: JSON.stringify({ hometown: 'Bogoso' }) });
      assert.equal(updated.status, 200);
      const reopened = await fetch(base + path, { headers });
      assert.equal((await reopened.json()).section1.hometown, 'Bogoso');
    }
    const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
    const denied = await fetch(base + '/api/admission-applications', { method: 'POST', headers: { Authorization: `Bearer ${teacher.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 403);
    assert.equal(applications.length, 3);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
