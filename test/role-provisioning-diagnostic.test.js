import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createRoleProvisioningDiagnostic } from '../src/role-provisioning-diagnostic.js';

const schoolId = 'school-osaah-daylight';
const emails = [
  'administrator@osaah.edu.gh',
  'headteacher@osaah.edu.gh',
  'assistantheadteacher@osaah.edu.gh',
  'accountant@osaah.edu.gh',
  'abbanfrank348@gmail.com'
];

test('role diagnostic inspects only fixed target emails and returns sanitized school-scoped status', async () => {
  let sqlSeen = '';
  let parametersSeen = [];
  const diagnostic = createRoleProvisioningDiagnostic({ database: { async query(sql, parameters) {
    sqlSeen = sql;
    parametersSeen = parameters;
    return [
      { email: emails[0], schoolId, accountStatus: 'ACTIVE', staffRecordCount: 1, staffProfileCount: 1, expectedRoleCount: 1, id: 'must-not-leak' },
      { email: emails[1], schoolId: 'another-school', accountStatus: 'ACTIVE', staffRecordCount: 4, staffProfileCount: 4, expectedRoleCount: 1 },
      { email: emails[3], schoolId, accountStatus: 'DISABLED', staffRecordCount: 0, staffProfileCount: 0, expectedRoleCount: 0 }
    ];
  } } });

  const accounts = await diagnostic.inspect(schoolId);
  assert.equal(accounts.length, 5);
  assert.deepEqual(parametersSeen, [schoolId, ...emails]);
  assert.match(sqlSeen, /WHERE LOWER\(u\.email\) IN/);
  assert.equal(accounts[0].schoolMatched, true);
  assert.equal(accounts[0].assignedRoleMatches, true);
  assert.equal(accounts[0].active, true);
  assert.equal(accounts[1].accountExists, true);
  assert.equal(accounts[1].schoolMatched, false);
  assert.equal(accounts[1].staffRecordCount, 0);
  assert.equal(accounts[2].accountExists, false);
  assert.equal(accounts[3].active, false);
  assert.equal(accounts[3].assignedRoleMatches, false);
  assert.equal(JSON.stringify(accounts).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(accounts).includes('@'), false);
});

test('diagnostic route requires proprietor session and does not query for other roles', async (t) => {
  const queried = [];
  const auth = { async authenticateAsync(token) {
    if (token === 'owner') return { id: 'owner-id', portal: 'school', roleKey: 'PROPRIETOR', schoolId };
    if (token === 'teacher') return { id: 'teacher-id', portal: 'school', roleKey: 'TEACHER', schoolId };
    return null;
  } };
  const database = { async query(_sql, parameters) {
    queried.push(parameters);
    return [{ email: emails[0], schoolId, accountStatus: 'ACTIVE', staffRecordCount: 1, staffProfileCount: 1, expectedRoleCount: 1 }];
  } };
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/admin/verify-role-provisioning`;

  const unauthenticated = await fetch(endpoint);
  assert.equal(unauthenticated.status, 401);
  const teacher = await fetch(endpoint, { headers: { Authorization: 'Bearer teacher' } });
  assert.equal(teacher.status, 403);
  assert.equal(queried.length, 0);

  const proprietor = await fetch(endpoint, { headers: { Authorization: 'Bearer owner' } });
  assert.equal(proprietor.status, 200);
  assert.equal(proprietor.headers.get('cache-control'), 'no-store');
  const body = await proprietor.json();
  assert.equal(body.accounts.length, 5);
  assert.equal(body.accounts[0].assignedRoleMatches, true);
  assert.equal(JSON.stringify(body).includes('@'), false);
  assert.equal(queried.length, 1);
});
