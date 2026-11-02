import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const helperStart = appSource.indexOf('async function readApiJson(');
const helperEnd = appSource.indexOf("\nif ('serviceWorker' in navigator)", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'login response parser must remain a standalone helper');
const readApiJson = new Function(`${appSource.slice(helperStart, helperEnd)}\nreturn readApiJson;`)();

test('login response parser accepts JSON responses', async () => {
  const response = new Response(JSON.stringify({ user: { roleKey: 'TEACHER' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

  const result = await readApiJson(response, 'Sign-in service');
  assert.equal(result.user.roleKey, 'TEACHER');
});

test('login response parser rejects HTML, plain text, and empty responses with a safe message', async () => {
  const responses = [
    new Response('<html>Unavailable</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }),
    new Response('Service unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
    new Response(null, { status: 502 })
  ];

  for (const response of responses) {
    await assert.rejects(
      readApiJson(response, 'Sign-in service'),
      { message: 'Sign-in service returned an unexpected response. Please try again later.' }
    );
  }
});

test('login response parser masks malformed and empty JSON errors', async () => {
  for (const body of ['{broken', '']) {
    const response = new Response(body, { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(
      readApiJson(response, 'Sign-in service'),
      { message: 'Sign-in service returned an invalid response. Please try again later.' }
    );
  }
});

test('login submits a dashboard only after a successful response with a user', () => {
  const submitStart = appSource.indexOf("form.addEventListener('submit'");
  const submitEnd = appSource.indexOf("parentResend.addEventListener", submitStart);
  const submitHandler = appSource.slice(submitStart, submitEnd);

  assert.match(submitHandler, /await readApiJson\(response, 'Sign-in service'\)/);
  assert.match(submitHandler, /if \(!response\.ok \|\| result\.error \|\| .* !result\.user\)/);
  assert.ok(submitHandler.indexOf('if (!response.ok') < submitHandler.indexOf('await renderDashboard(result.user, result.redirectTo)'));
});
