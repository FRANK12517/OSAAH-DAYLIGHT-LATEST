import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

const schoolId = 'school-osaah-daylight';
const passwords = Object.freeze({
  accountant: 'SyntheticAccountant123!',
  administrator: 'SyntheticAdministrator123!',
  headteacher: 'SyntheticHeadteacher123!',
  assistant: 'SyntheticAssistant123!'
});
const accounts = [
  ['db-accountant', 'accountant@osaah.edu.gh', passwords.accountant, 'ACCOUNTANT_BURSAR', '/fees', ['fees.read', 'fees.write', 'finance.read']],
  ['db-administrator', 'administrator@osaah.edu.gh', passwords.administrator, 'SCHOOL_ADMIN', '/settings', ['users.read', 'settings.read']],
  ['db-headteacher', 'headteacher@osaah.edu.gh', passwords.headteacher, 'HEADTEACHER', '/academics', ['academics.read', 'students.read']],
  ['db-assistant', 'assistantheadteacher@osaah.edu.gh', passwords.assistant, 'ASSISTANT_HEADTEACHER', '/academics', ['academics.read', 'students.read']]
];

async function databaseFixture() {
  const rows = [];
  for (const [id, email, password, roleKey, , permissions] of accounts) {
    rows.push({ id, schoolId, username: email, email, passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE', roleKey, permissionKey: permissions[0] });
    for (const permissionKey of permissions.slice(1)) rows.push({ id, schoolId, username: email, email, passwordHash: rows.at(-1).passwordHash, status: 'ACTIVE', roleKey, permissionKey });
  }
  return { query: async (_sql, params) => rows.filter((row) => row.username.toLowerCase() === params[0] || row.email.toLowerCase() === params[1]) };
}

function http(server, path, { method = 'GET', body, cookie, token, headers: additionalHeaders = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...additionalHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const request = httpRequest({ port: server.address().port, path, method, headers }, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

test('Part 3 database staff authentication resolves canonical role, school, dashboard, and permissions', async () => {
  const database = await databaseFixture();
  const auth = createAuthService({ database, sessionSecret: 'part-3-test-session-secret-0123456789' });
  for (const [, email, password, roleKey, dashboard, permissions] of accounts) {
    const result = await auth.loginFromDatabase({ username: email, password, portal: 'school' });
    assert.equal(result.ok, true);
    assert.equal(result.user.schoolId, schoolId);
    assert.equal(result.user.roleKey, roleKey);
    assert.equal(result.redirectTo, dashboard);
    const authenticated = auth.authenticate(result.token);
    for (const permission of permissions) assert.equal(authenticated.permissions.has(permission), true);
    assert.equal(Object.hasOwn(result.user, 'passwordHash'), false);
    assert.equal(Object.hasOwn(result.user, 'password'), false);
  }
});

test('Part 3 rejects invalid, unknown, disabled, and cross-role database credentials', async () => {
  const database = await databaseFixture();
  const auth = createAuthService({ database });
  assert.equal((await auth.loginFromDatabase({ username: accounts[0][1], password: 'wrong', portal: 'school' })).ok, false);
  assert.equal((await auth.loginFromDatabase({ username: 'missing@osaah.edu.gh', password: 'wrong', portal: 'school' })).ok, false);
  const disabled = { ...database, query: async (...args) => (await database.query(...args)).map((row) => ({ ...row, status: 'DISABLED' })) };
  assert.equal((await createAuthService({ database: disabled }).loginFromDatabase({ username: accounts[0][1], password: passwords.accountant, portal: 'school' })).ok, false);
  assert.equal((await auth.loginFromDatabase({ username: accounts[0][1], password: passwords.accountant, portal: 'school', role: 'HEADTEACHER' })).ok, false);
});

test('Part 3 uses the existing School Portal route, preserves sessions, applies RBAC, and logs out', async () => {
  const database = await databaseFixture();
  const server = createServer(createApp({ database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const login = await http(server, '/api/auth/login', { method: 'POST', body: { username: accounts[0][1], password: passwords.accountant, portal: 'school' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.roleKey, 'ACCOUNTANT_BURSAR');
    assert.equal(login.body.redirectTo, '/fees');
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const session = await http(server, '/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.roleKey, 'ACCOUNTANT_BURSAR');
    assert.equal((await http(server, '/api/management', { cookie })).status, 403);
    assert.equal((await http(server, '/api/users', { cookie })).status, 403);
    const sidebar = await http(server, '/api/sidebar', { cookie });
    assert.equal(sidebar.status, 200);
    assert.match(JSON.stringify(sidebar.body).toLowerCase(), /fee/);
    assert.equal((await http(server, '/api/fees/collections', { cookie })).status, 503);
    const logout = await http(server, '/api/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    assert.equal((await http(server, '/api/auth/session', { cookie })).status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Part 3 preserves Proprietor login and canonical dashboard routing', async () => {
  const auth = createAuthService();
  const result = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  assert.equal(result.ok, true);
  assert.equal(result.user.roleKey, 'PROPRIETOR');
  assert.equal(result.redirectTo, '/');
  assert.equal(auth.authenticate(result.token).permissions.has('*'), true);
});

test('Part 3 login returns clean errors for invalid credentials and database failures', async () => {
  const database = await databaseFixture();
  const server = createServer(createApp({ database: { ...database, query: async () => { throw Object.assign(new Error('private database detail'), { code: 'ECONNRESET' }); } }, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const unavailable = await http(server, '/api/auth/login', { method: 'POST', body: { username: accounts[0][1], password: passwords.accountant, portal: 'school' } });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.body, { error: 'Authentication service unavailable.' });
    assert.equal(unavailable.headers['set-cookie'], undefined);
  } finally { await new Promise((resolve) => server.close(resolve)); }

  const invalidServer = createServer(createApp({ database, aiEnabled: false }));
  await new Promise((resolve) => invalidServer.listen(0, resolve));
  try {
    const invalid = await http(invalidServer, '/api/auth/login', { method: 'POST', body: { username: accounts[0][1], password: 'incorrect', portal: 'school' } });
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, { error: 'Incorrect username or password.' });
    assert.equal(invalid.headers['set-cookie'], undefined);
  } finally { await new Promise((resolve) => invalidServer.close(resolve)); }
});

test('Part 3 session persistence failure returns JSON 503 and never issues a cookie', async () => {
  const fixture = await databaseFixture();
  const events = [];
  const database = {
    ...fixture,
    supportsDurableAuthSessions: true,
    async execute() { throw Object.assign(new Error('private persistence detail'), { code: 'XX000' }); }
  };
  const auth = createAuthService({ database, audit: (event) => events.push(event), sessionSecret: 'part-3-test-session-secret-0123456789' });
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const result = await http(server, '/api/auth/login', { method: 'POST', body: { username: accounts[0][1], password: passwords.accountant, portal: 'school' } });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'Authentication service unavailable.' });
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(events.some((event) => event.action === 'LOGIN_SUCCESS'), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Part 3 HTTPS login sets a secure HTTP-only cookie and the session endpoint restores the role', async () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  const database = await databaseFixture();
  const auth = createAuthService({ database, sessionSecret: 'part-3-test-session-secret-0123456789' });
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const login = await http(server, '/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: { username: accounts[1][1], password: passwords.administrator, portal: 'school' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.redirectTo, '/settings');
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);
    assert.match(login.headers['set-cookie'][0], /Secure/);
    assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const session = await http(server, '/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.roleKey, 'SCHOOL_ADMIN');
    assert.equal(session.body.redirectTo, '/settings');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('Part 3 frontend uses the API role route and rejects unsafe redirect targets', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const helper = source.match(/function resolvePostLoginRoute\(user, redirectTo\) \{[^}]*\}/)?.[0];
  assert.ok(helper, 'login page must resolve the API-selected dashboard route');
  const resolvePostLoginRoute = vm.runInNewContext(`(${helper})`);
  assert.equal(resolvePostLoginRoute({ portal: 'school' }, '/reports'), '/reports');
  assert.equal(resolvePostLoginRoute({ portal: 'school' }, '/academics'), '/academics');
  assert.equal(resolvePostLoginRoute({ portal: 'school' }, '//example.test'), '/');
  assert.equal(resolvePostLoginRoute({ portal: 'parent' }, '/reports'), '/');
  assert.match(source, /function renderDashboard\(user, redirectTo = '\/'\)/);
  assert.match(source, /history\.replaceState\(\{ route: initialRoute \}, '', initialRoute\)/);
});
