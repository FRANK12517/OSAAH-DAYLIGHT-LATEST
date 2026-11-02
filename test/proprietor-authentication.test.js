import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createServer, request as httpRequest } from 'node:http';
import { createProprietorAuthenticationController } from '../src/proprietor-authentication-controller.js';
import { createApp } from '../src/server.mjs';

const hash = await bcrypt.hash('SecurePass123!', 4);
const proprietor = { id: 'portal-1', portal_name: 'OSAAH Daylight School', email: 'owner@osaah.edu.gh', password_hash: hash, role: 'PROPRIETOR', is_active: 1 };

function request(server, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path: '/api/auth/proprietor/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('proprietor controller queries portal_users and returns safe metadata after bcrypt verification', async () => {
  let query;
  const controller = createProprietorAuthenticationController({ database: { query: async (...args) => { query = args; return [proprietor]; } } });
  const result = await controller({ email: ' OWNER@OSAAH.EDU.GH ', password: 'SecurePass123!' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.user, { id: 'portal-1', portalName: 'OSAAH Daylight School', role: 'PROPRIETOR', email: 'owner@osaah.edu.gh' });
  assert.match(query[0], /SELECT id, portal_name, email, password_hash, role, is_active FROM portal_users WHERE email = \? LIMIT 1/);
  assert.deepEqual(query[1], ['owner@osaah.edu.gh']);
});

test('proprietor controller returns 401 for missing, unknown, wrong-password, or non-proprietor credentials', async () => {
  const controller = createProprietorAuthenticationController({ database: { query: async () => [proprietor] } });
  assert.equal((await controller({})).status, 401);
  assert.equal((await controller({ email: 'owner@osaah.edu.gh', password: 'wrong' })).status, 401);
  const nonProprietor = createProprietorAuthenticationController({ database: { query: async () => [{ ...proprietor, role: 'TEACHER' }] } });
  assert.equal((await nonProprietor({ email: proprietor.email, password: 'SecurePass123!' })).status, 401);
  const unknown = createProprietorAuthenticationController({ database: { query: async () => [] } });
  assert.equal((await unknown({ email: proprietor.email, password: 'SecurePass123!' })).status, 401);
});

test('proprietor controller returns 403 for deactivated accounts and 500 for database errors', async () => {
  const deactivated = createProprietorAuthenticationController({ database: { query: async () => [{ ...proprietor, is_active: 0 }] } });
  assert.equal((await deactivated({ email: proprietor.email, password: 'SecurePass123!' })).status, 403);
  const broken = createProprietorAuthenticationController({ database: { query: async () => { throw new Error('database offline'); } } });
  const result = await broken({ email: proprietor.email, password: 'SecurePass123!' });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'Authentication service unavailable.' });
});

test('proprietor authentication API route returns controller status and body', async () => {
  const server = createServer(createApp({ database: { query: async () => [proprietor] }, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await request(server, { email: proprietor.email, password: 'SecurePass123!' });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.portalName, 'OSAAH Daylight School');
    assert.equal(response.body.user.role, 'PROPRIETOR');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
