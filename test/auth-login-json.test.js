import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';

async function withServer(app, run) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('login returns JSON with an explicit content type for invalid request bodies', async () => {
  await withServer(createApp({ aiEnabled: false }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid'
    });

    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON request body.' });
  });
});

test('login returns a safe JSON error when authentication throws', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const auth = {
      sessionTtlMs: 60_000,
      async loginFromDatabase() { throw new Error('private database detail'); }
    };
    await withServer(createApp({ auth, aiEnabled: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'staff@example.test', password: 'not-a-real-password' })
      });

      assert.equal(response.status, 503);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
      assert.deepEqual(await response.json(), { error: 'Authentication service unavailable.' });
    });
  } finally {
    console.error = originalError;
  }
});
