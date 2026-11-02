import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import bcrypt from 'bcryptjs';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

const SESSION_SECRET = 'diagnostic-test-session-secret-with-32-plus-characters';
const PASSWORD = 'Diagnostic-Test-Password-2026!';
const USER_ID = 'test-proprietor-id';
const SCHOOL_ID = 'test-school-id';

function request(server, path, { method = 'GET', cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ port: server.address().port, host: '127.0.0.1', path, method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: responseBody, headers: response.headers }));
    });
    request.on('error', reject);
    request.end(body ?? undefined);
  });
}

async function makeDatabase({ restoreRows = null, classificationRow = null } = {}) {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const savedSessions = new Map();
  const classificationLookups = [];
  const restoreQueries = [];
  return {
    supportsDurableAuthSessions: true,
    dialect: 'mysql',
    savedSessions,
    classificationLookups,
    restoreQueries,
    async execute(sql, params) {
      if (sql.startsWith('INSERT INTO auth_sessions')) savedSessions.set(params[3], { sessionId: params[0], userId: params[1], schoolId: params[2], expiresAt: params[5], revokedAt: null });
      return { affectedRows: 1 };
    },
    async query(sql, params) {
      if (sql.includes('LOWER(COALESCE(u.username')) return [{ id: USER_ID, schoolId: SCHOOL_ID, username: 'proprietor@example.invalid', email: 'proprietor@example.invalid', passwordHash, status: 'ACTIVE', roleKey: 'PROPRIETOR', oversightRank: 100, permissionKey: '*' }];
      if (sql.includes('CASE WHEN u.id IS NULL')) { classificationLookups.push({ sql, params }); return classificationRow ? [{ ...classificationRow }] : []; }
      if (sql.includes('FROM auth_sessions s JOIN users u')) { restoreQueries.push(sql); return typeof restoreRows === 'function' ? restoreRows(params, savedSessions) : restoreRows ?? []; }
      throw new Error(`Unexpected diagnostic test query: ${sql.slice(0, 40)}`);
    }
  };
}

test('diagnostics are opt in and trace cross-instance restoration without credential values', async () => {
  const database = await makeDatabase({ restoreRows: (_params, savedSessions) => {
    const row = [...savedSessions.values()][0];
    return row ? [{ sessionId: row.sessionId, userId: USER_ID, schoolId: SCHOOL_ID, expiresAt: row.expiresAt, username: 'proprietor@example.invalid', email: 'proprietor@example.invalid', status: 'ACTIVE', roleKey: 'PROPRIETOR', oversightRank: 100, permissionKey: '*' }] : [];
  } });
  const loginAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: true });
  const restoreAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: true });
  const events = [];
  const originalInfo = console.info;
  console.info = (message, details) => { if (message === 'Authentication session diagnostic') events.push(details); };
  try {
    const login = await loginAuth.loginFromDatabase({ username: 'proprietor@example.invalid', password: PASSWORD, portal: 'school', role: 'PROPRIETOR', diagnosticContext: { requestId: 'diag-login-1', requestPath: '/api/auth/login' } });
    assert.equal(login.ok, true);
    const restored = await restoreAuth.authenticateAsync(login.token, { requestId: 'diag-session-1', requestPath: '/api/auth/session', cookieReceived: true, cookieParsed: true, credentialSource: 'cookie' });
    assert.equal(restored.roleKey, 'PROPRIETOR');
    assert.equal(restored.schoolId, SCHOOL_ID);
    const stages = events.map(({ stage }) => stage);
    for (const stage of ['session_persisted', 'credential_received', 'signature_verification', 'session_store_lookup', 'identity_restoration']) assert.ok(stages.includes(stage), `missing ${stage}`);
    const emitted = JSON.stringify(events);
    for (const secret of [login.token, PASSWORD, SESSION_SECRET, SCHOOL_ID, USER_ID, restored.sessionId]) assert.equal(emitted.includes(secret), false, 'diagnostic records must not contain credentials or identity values');
    assert.ok(events.every((event) => !event.tokenFingerprint || /^[a-f0-9]{20}$/.test(event.tokenFingerprint)));
    assert.ok(events.some((event) => event.stage === 'credential_received' && event.cookieReceived && event.cookieParsed));
    assert.ok(events.some((event) => event.stage === 'identity_restoration' && event.identityRestored && event.roleKey === 'PROPRIETOR' && event.schoolAssignmentRestored));
  } finally { console.info = originalInfo; }
});

test('durable session restoration accepts NULL user status consistently with login validation', async () => {
  const now = Date.now();
  const database = await makeDatabase({ restoreRows: (_params, savedSessions) => {
    const session = [...savedSessions.values()][0];
    return session ? [{ sessionId: session.sessionId, userId: USER_ID, schoolId: SCHOOL_ID, expiresAt: session.expiresAt, username: 'proprietor@example.invalid', email: 'proprietor@example.invalid', status: null, roleKey: 'PROPRIETOR', oversightRank: 100, permissionKey: '*' }] : [];
  } });
  const loginAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: true, now: () => now });
  const restoreAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: true, now: () => now });
  const login = await loginAuth.loginFromDatabase({ username: 'proprietor@example.invalid', password: PASSWORD, portal: 'school', role: 'PROPRIETOR' });
  assert.equal(login.ok, true);
  const events = [];
  const originalInfo = console.info;
  console.info = (message, details) => { if (message === 'Authentication session diagnostic') events.push(details); };
  try {
    const restored = await restoreAuth.authenticateAsync(login.token, { requestId: 'diag-null-status', requestPath: '/api/auth/session', cookieReceived: true, cookieParsed: true, credentialSource: 'cookie' });
    assert.equal(restored.roleKey, 'PROPRIETOR');
    assert.equal(restored.schoolId, SCHOOL_ID);
    assert.match(database.restoreQueries[0], /UPPER\(COALESCE\(u\.status,'ACTIVE'\)\)='ACTIVE'/);
    assert.equal(database.classificationLookups.length, 0);
    assert.ok(events.some((event) => event.stage === 'identity_restoration' && event.identityRestored && event.roleKey === 'PROPRIETOR'));
  } finally { console.info = originalInfo; }
});

test('protected session rejection logs a sanitized reason when detailed diagnostics are disabled', async () => {
  const database = await makeDatabase();
  const loginAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: false });
  const restoreAuth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: false });
  const events = [];
  const originalWarn = console.warn;
  console.warn = (message, details) => { if (message === 'Authentication session rejected') events.push(details); };
  try {
    const login = await loginAuth.loginFromDatabase({ username: 'proprietor@example.invalid', password: PASSWORD, portal: 'school', role: 'PROPRIETOR' });
    assert.equal(login.ok, true);
    assert.equal(await restoreAuth.authenticateAsync(login.token, { requestId: 'diag-rejected-1', requestPath: '/reports', cookieReceived: true, cookieParsed: true, credentialSource: 'cookie' }), null);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      requestId: 'diag-rejected-1', requestPath: '/reports', stage: 'session_rejected', reason: 'SESSION_RECORD_NOT_FOUND',
      cookieReceived: true, cookieParsed: true, credentialSource: 'cookie', signatureResult: 'signature_valid',
      classificationAvailable: true, recordFound: false, revoked: false, expired: null, identityFound: false,
      accountActive: null, restoreStatusAccepted: false
    });
    const emitted = JSON.stringify(events);
    for (const secret of [login.token, PASSWORD, SESSION_SECRET, SCHOOL_ID, USER_ID]) assert.equal(emitted.includes(secret), false);
  } finally { console.warn = originalWarn; }
});

test('session diagnostics produce no records when the service flag is disabled', async () => {
  const database = await makeDatabase();
  const auth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: false });
  let emitted = false;
  const originalInfo = console.info;
  console.info = (message) => { if (message === 'Authentication session diagnostic') emitted = true; };
  try {
    const login = await auth.loginFromDatabase({ username: 'proprietor@example.invalid', password: PASSWORD, portal: 'school', role: 'PROPRIETOR', diagnosticContext: { requestId: 'disabled', requestPath: '/api/auth/login' } });
    assert.equal(login.ok, true);
    await auth.authenticateAsync(login.token, { requestId: 'disabled', requestPath: '/api/auth/session' });
    assert.equal(emitted, false);
  } finally { console.info = originalInfo; }
});

test('server traces cookie receipt, issued attributes, and protected page authorization without changing responses', async () => {
  const database = await makeDatabase({ restoreRows: (_params, savedSessions) => {
    const row = [...savedSessions.values()][0];
    return row ? [{ sessionId: row.sessionId, userId: USER_ID, schoolId: SCHOOL_ID, expiresAt: row.expiresAt, username: 'proprietor@example.invalid', email: 'proprietor@example.invalid', status: 'ACTIVE', roleKey: 'PROPRIETOR', oversightRank: 100, permissionKey: '*' }] : [];
  } });
  const auth = createAuthService({ users: [], database, sessionSecret: SESSION_SECRET, sessionDiagnostics: true });
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  const previousFlag = process.env.OSAAH_AUTH_SESSION_DIAGNOSTICS;
  const events = [];
  const originalInfo = console.info;
  process.env.OSAAH_AUTH_SESSION_DIAGNOSTICS = '1';
  console.info = (message, details) => { if (message === 'Authentication session diagnostic') events.push(details); else originalInfo(message, details); };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const login = await request(server, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'proprietor@example.invalid', password: PASSWORD, portal: 'school', role: 'PROPRIETOR' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie);
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);
    assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);
    assert.equal((await request(server, '/api/auth/session', { cookie })).status, 200);
    const reports = await request(server, '/reports', { cookie, headers: { 'Sec-Fetch-Mode': 'navigate' } });
    assert.equal(reports.status, 200);
    assert.ok(events.some((event) => event.stage === 'session_cookie_issued' && event.httpOnly && event.hostOnly && event.path === '/'));
    assert.ok(events.some((event) => event.stage === 'credential_received' && event.cookieReceived && event.cookieParsed));
    assert.ok(events.some((event) => event.stage === 'session_endpoint_result' && event.authenticated));
    assert.ok(events.some((event) => event.stage === 'protected_page_authorization' && event.authorizationGranted && event.roleKey === 'PROPRIETOR'));
    assert.ok(events.every((event) => !JSON.stringify(event).includes(cookie.split('=').slice(1).join('='))));
  } finally {
    console.info = originalInfo;
    if (previousFlag === undefined) delete process.env.OSAAH_AUTH_SESSION_DIAGNOSTICS;
    else process.env.OSAAH_AUTH_SESSION_DIAGNOSTICS = previousFlag;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('protected page rejection logs cookie and authorization state without cookie contents', async () => {
  const rejectedCookieValue = 'must-not-be-logged-session-value';
  const auth = { async authenticateAsync() { return null; } };
  const server = createServer(createApp({ auth, aiEnabled: false }));
  const events = [];
  const originalWarn = console.warn;
  console.warn = (message, details) => { if (message === 'Protected page access rejected') events.push(details); };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, '/reports', { cookie: `osaah_session=${rejectedCookieValue}` });
    assert.equal(response.status, 401);
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionCookiePresent, true);
    assert.equal(events[0].sessionValid, false);
    assert.equal(events[0].roleResolved, false);
    assert.equal(events[0].rejectionReason, 'SESSION_VALIDATION_FAILED');
    assert.equal(JSON.stringify(events).includes(rejectedCookieValue), false);
  } finally { console.warn = originalWarn; await new Promise((resolve) => server.close(resolve)); }
});
