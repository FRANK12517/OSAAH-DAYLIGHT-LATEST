import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { closeHttpServer } from './helpers/close-http-server.js';

const SCHOOL_ID = 'sch_default_01';
const CHROMIUM_EXECUTABLE_PATH = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe` : null,
  process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
  '/usr/bin/chromium'
].find((candidate) => candidate && existsSync(candidate));
const ROLE_FLOWS = [
  { name: 'proprietor', roleKey: 'PROPRIETOR', route: '/', identifier: 'username' },
  { name: 'administrator', roleKey: 'SCHOOL_ADMIN', route: '/settings', identifier: 'username' },
  { name: 'headteacher', roleKey: 'HEADTEACHER', route: '/academics', identifier: 'username' },
  { name: 'assistant-headteacher', roleKey: 'ASSISTANT_HEADTEACHER', route: '/academics', identifier: 'username' },
  { name: 'accountant', roleKey: 'ACCOUNTANT_BURSAR', route: '/fees', identifier: 'username' },
  { name: 'teacher-username', roleKey: 'TEACHER', route: '/academics', identifier: 'username' },
  { name: 'teacher-email', roleKey: 'TEACHER', route: '/academics', identifier: 'email' }
];
const ROLE_FILTER = process.env.OSAAH_LOCAL_AUTH_BROWSER_ROLE;
if (ROLE_FILTER && !ROLE_FLOWS.some((flow) => flow.name === ROLE_FILTER)) throw new Error('OSAAH_LOCAL_AUTH_BROWSER_ROLE must match a named synthetic role flow.');
const BROWSER_TESTS_ENABLED = process.env.OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS === '1';
const BROWSER_SKIP_REASON = !BROWSER_TESTS_ENABLED
  ? 'Set OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1 to run the synthetic browser tests explicitly.'
  : !CHROMIUM_EXECUTABLE_PATH
    ? 'No installed Chromium-compatible browser is available.'
    : false;

function createSyntheticStaffUsers() {
  const accounts = new Map();
  const users = [...new Set(ROLE_FLOWS.map((flow) => flow.roleKey))].map((roleKey) => {
    const id = randomUUID();
    const username = `${roleKey.toLowerCase().replaceAll('_', '-')}-${randomBytes(6).toString('hex')}@osaah.invalid`;
    const email = `${randomBytes(6).toString('hex')}@osaah.invalid`;
    const password = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
    const user = { id, username, email, passwordHash, fullName: 'Synthetic Browser Account', portal: 'school', roleKey, schoolId: SCHOOL_ID, status: 'ACTIVE', is_active: true, permissions: new Set(['*']) };
    accounts.set(roleKey, { username, email, password });
    return user;
  });
  return { users, accounts };
}

async function startLocalApp(t, auth) {
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  let app;
  process.env.OSAAH_SCHOOL_ID = SCHOOL_ID;
  try { app = createApp({ auth, aiEnabled: false }); }
  finally {
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  }
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => closeHttpServer(server));
  return `http://127.0.0.1:${server.address().port}`;
}

async function startLocalBrowser(t) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  return browser;
}

test('synthetic local staff browser matrix verifies redirects, sessions, RBAC, and logout', { timeout: 180_000, skip: BROWSER_SKIP_REASON }, async (t) => {
  const { users, accounts } = createSyntheticStaffUsers();
  const auth = createAuthService({ users, sessionSecret: randomBytes(48).toString('base64url') });
  const baseUrl = await startLocalApp(t, auth);
  const browser = await startLocalBrowser(t);

  for (const flow of ROLE_FLOWS.filter((candidate) => !ROLE_FILTER || candidate.name === ROLE_FILTER)) {
    await t.test(flow.name, { timeout: 30_000 }, async (subtest) => {
      const credentials = accounts.get(flow.roleKey);
      const identifier = flow.identifier === 'email' ? credentials.email : credentials.username;
      const context = await browser.newContext();
      context.setDefaultTimeout(5_000);
      context.setDefaultNavigationTimeout(8_000);
      const page = await context.newPage();
      const network = [];
      let stage = 'open the local sign-in page';
      let consoleErrorCount = 0;
      let pageErrorCount = 0;
      page.on('response', (response) => {
        const { pathname } = new URL(response.url());
        if (['/api/auth/login', '/api/auth/session', '/api/sidebar', '/api/administrators'].includes(pathname)) {
          network.push({ path: pathname, status: response.status() });
        }
      });
      page.on('console', (message) => { if (message.type() === 'error') consoleErrorCount += 1; });
      page.on('pageerror', () => { pageErrorCount += 1; });

      try {
        await page.goto(baseUrl);
        stage = 'select the school portal';
        await page.locator('[data-portal="school"]').click();
        stage = 'submit generated synthetic credentials';
        await page.locator('[name="role"]').selectOption(flow.roleKey);
        await page.locator('[name="username"]').fill(identifier);
        await page.locator('[name="password"]').fill(credentials.password);
        await page.locator('#login-form button[type="submit"]').click();

        stage = 'verify the role-specific dashboard redirect';
        await page.waitForURL((url) => url.pathname === flow.route, { timeout: 10_000 });
        const roleLandmark = `${flow.roleKey.replaceAll('_', ' ')} · SCHOOL PORTAL`;
        await page.locator('.workspace .topbar .eyebrow').filter({ hasText: roleLandmark }).waitFor();
        stage = 'open the first visible role-specific sidebar module';
        const roleModuleLinks = page.locator('.sidebar-link:not([data-module="dashboard"]):not([data-module="logout"])');
        let childLink = roleModuleLinks.filter({ visible: true }).first();
        if (await childLink.count() === 0) {
          const firstGroupToggle = page.locator('.sidebar-group-toggle').first();
          if (await firstGroupToggle.count()) await firstGroupToggle.click();
          childLink = roleModuleLinks.filter({ visible: true }).first();
        }
        await childLink.waitFor({ state: 'visible' });
        const moduleContract = await childLink.evaluate((link) => ({
          name: link.dataset.moduleName,
          route: link.dataset.moduleRoute,
          navigationKey: link.dataset.navigationKey,
          exactView: link.dataset.exactView
        }));
        assert.ok(moduleContract.name && moduleContract.route && moduleContract.navigationKey && moduleContract.exactView);
        await childLink.click();
        await page.waitForURL((url) => url.pathname === moduleContract.route && url.searchParams.get('navigationKey') === moduleContract.navigationKey && url.searchParams.get('view') === moduleContract.exactView, { timeout: 10_000 });
        await page.waitForFunction(() => {
          const frame = document.querySelector('#module-frame');
          const status = document.querySelector('#module-status');
          return frame && !frame.hidden && frame.contentDocument?.readyState === 'complete' && status?.hidden;
        }, { timeout: 15_000 });
        const renderedContract = await page.frameLocator('#module-frame').locator('body').evaluate((body) => ({
          module: body.dataset.currentModule,
          view: body.dataset.currentView,
          component: body.dataset.currentComponent
        }));
        assert.equal(renderedContract.module, moduleContract.navigationKey, `${flow.roleKey} should open the selected module`);
        assert.equal(renderedContract.view, moduleContract.exactView, `${flow.roleKey} should open the exact selected view`);
        stage = 'verify role-specific API authorization';
        const adminAccess = await page.evaluate(async () => (await fetch('/api/administrators', { credentials: 'same-origin' })).status);
        assert.equal(adminAccess, flow.roleKey === 'PROPRIETOR' ? 200 : 403);
        assert.ok((await page.context().cookies()).some((cookie) => cookie.name === 'osaah_session'));

        stage = 'verify session restoration after refresh';
        await page.goto(baseUrl);
        await page.waitForURL((url) => url.pathname === flow.route, { timeout: 10_000 });
        await page.locator('.workspace .topbar .eyebrow').filter({ hasText: roleLandmark }).waitFor();

        if (flow.roleKey === 'PROPRIETOR') {
          stage = 'open Reports and use its Dashboard breadcrumb';
          await page.getByRole('button', { name: /REPORTS & ANALYTICS/ }).click();
          await page.locator('[data-module="reports"]').click();
          await page.waitForURL((url) => url.pathname === '/reports', { timeout: 10_000 });
          await page.frameLocator('#module-frame').locator('.text-button').click();
          await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });
          await page.locator('#dashboard-overview').waitFor({ state: 'visible' });
        }

        stage = 'verify logout';
        await page.locator('[data-module="logout"]').click();
        await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });
        await page.locator('[data-portal="school"]').waitFor();
        assert.equal((await page.context().cookies()).some((cookie) => cookie.name === 'osaah_session'), false);
        assert.ok(network.some((event) => event.path === '/api/auth/login' && event.status === 200));
        assert.ok(network.some((event) => event.path === '/api/auth/session' && event.status === 200));
        assert.ok(network.some((event) => event.path === '/api/sidebar' && event.status === 200));
        assert.ok(network.some((event) => event.path === '/api/administrators' && event.status === adminAccess));
        subtest.diagnostic(JSON.stringify({ route: flow.route, role: flow.roleKey, adminApiStatus: adminAccess, sanitizedNetwork: network, consoleErrorCount, pageErrorCount }));
      } catch (error) {
        subtest.diagnostic(JSON.stringify({ role: flow.roleKey, stage, error: error.message, sanitizedNetwork: network }));
        throw new Error(`Synthetic ${flow.roleKey} browser flow failed while attempting to ${stage}.`, { cause: error });
      } finally {
        await context.close();
      }
    });
  }
});

test('synthetic local browser login rejects invalid credentials without creating a session', { timeout: 60_000, skip: BROWSER_SKIP_REASON }, async (t) => {
  const { users, accounts } = createSyntheticStaffUsers();
  const auth = createAuthService({ users, sessionSecret: randomBytes(48).toString('base64url') });
  const baseUrl = await startLocalApp(t, auth);
  const browser = await startLocalBrowser(t);
  const context = await browser.newContext();
  context.setDefaultTimeout(5_000);
  context.setDefaultNavigationTimeout(8_000);
  const page = await context.newPage();
  try {
    const credentials = accounts.get('TEACHER');
    await page.goto(baseUrl);
    await page.locator('[data-portal="school"]').click();
    await page.locator('[name="role"]').selectOption('TEACHER');
    await page.locator('[name="username"]').fill(credentials.username);
    await page.locator('[name="password"]').fill(randomBytes(32).toString('base64url'));
    await page.locator('#login-form button[type="submit"]').click();
    await page.locator('#login-error').filter({ hasText: 'Incorrect username or password.' }).waitFor();
    assert.equal((await context.cookies()).some((cookie) => cookie.name === 'osaah_session'), false);
  } finally {
    await context.close();
    await browser.close();
  }
});
