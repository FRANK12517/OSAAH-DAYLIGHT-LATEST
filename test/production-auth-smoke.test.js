import test from 'node:test';
import { chromium } from 'playwright';

const PRODUCTION_URL = 'https://www.osaahdaylightschool.online';
const enabled = process.env.OSAAH_RUN_PRODUCTION_AUTH_SMOKE_TESTS === '1';
const flows = [
  { label: 'Proprietor', role: 'PROPRIETOR', route: '/', identifierEnv: 'PROD_PROPRIETOR_IDENTIFIER', passwordEnv: 'PROD_PROPRIETOR_PASSWORD' },
  { label: 'Administrator', role: 'SCHOOL_ADMIN', route: '/settings', identifierEnv: 'PROD_ADMINISTRATOR_IDENTIFIER', passwordEnv: 'PROD_ADMINISTRATOR_PASSWORD' },
  { label: 'Headteacher', role: 'HEADTEACHER', route: '/academics', identifierEnv: 'PROD_HEADTEACHER_IDENTIFIER', passwordEnv: 'PROD_HEADTEACHER_PASSWORD' },
  { label: 'Assistant Headteacher', role: 'ASSISTANT_HEADTEACHER', route: '/academics', identifierEnv: 'PROD_ASSISTANT_HEADTEACHER_IDENTIFIER', passwordEnv: 'PROD_ASSISTANT_HEADTEACHER_PASSWORD' },
  { label: 'Accountant', role: 'ACCOUNTANT_BURSAR', route: '/fees', identifierEnv: 'PROD_ACCOUNTANT_IDENTIFIER', passwordEnv: 'PROD_ACCOUNTANT_PASSWORD' },
  { label: 'Teacher username', role: 'TEACHER', route: '/academics', identifierEnv: 'PROD_TEACHER_USERNAME', passwordEnv: 'PROD_TEACHER_PASSWORD' },
  { label: 'Teacher email', role: 'TEACHER', route: '/academics', identifierEnv: 'PROD_TEACHER_EMAIL', passwordEnv: 'PROD_TEACHER_PASSWORD' }
];

function verify(condition, message) {
  if (!condition) throw new Error(message);
}

async function sessionState(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const result = await response.json().catch(() => null);
    return { status: response.status, user: result?.user ?? null, redirectTo: result?.redirectTo ?? null };
  });
}

test('production staff accounts authenticate, restore sessions, enforce roles, and log out', { skip: !enabled, timeout: 300_000 }, async () => {
  const missing = [...new Set(flows.flatMap((flow) => [flow.identifierEnv, flow.passwordEnv]))]
    .filter((name) => !process.env[name]);
  verify(missing.length === 0, `Configure the required production environment secrets: ${missing.join(', ')}.`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let teacherUserId = null;
  try {
    for (const flow of flows) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(30_000);
      let stage = 'open production login';
      try {
        await page.goto(PRODUCTION_URL, { waitUntil: 'domcontentloaded' });
        stage = 'select the school portal';
        await page.locator('[data-portal="school"]').click();
        stage = 'select role and enter credentials';
        await page.locator('[name="role"]').selectOption(flow.role);
        await page.locator('[name="username"]').fill(process.env[flow.identifierEnv]);
        await page.locator('[name="password"]').fill(process.env[flow.passwordEnv]);
        const loginResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login', { timeout: 30_000 });
        await page.locator('#login-form button[type="submit"]').click();

        stage = 'verify the login API response';
        const loginResponse = await loginResponsePromise;
        const loginType = loginResponse.headers()['content-type'] ?? '';
        verify(/\bapplication\/(?:[a-z0-9.-]+\+)?json\b/i.test(loginType), `${flow.label}: login endpoint returned a non-JSON response.`);
        verify(loginResponse.status() === 200, `${flow.label}: login endpoint did not accept the supplied test credentials.`);
        const loginResult = await loginResponse.json().catch(() => null);
        verify(Boolean(loginResult?.user?.id) && loginResult.user.roleKey === flow.role, `${flow.label}: login response identity or role did not match.`);
        verify(loginResult.redirectTo === flow.route, `${flow.label}: server returned an unexpected dashboard destination.`);

        stage = 'verify the authenticated dashboard';
        await page.waitForURL((url) => url.pathname === flow.route, { timeout: 30_000 });
        const expectedLandmark = `${flow.role.replaceAll('_', ' ')} · SCHOOL PORTAL`;
        await page.locator('.workspace .topbar .eyebrow').filter({ hasText: expectedLandmark }).waitFor();
        const sidebarResponse = await page.evaluate(async () => {
          const response = await fetch('/api/sidebar', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          const result = await response.json().catch(() => null);
          return { status: response.status, moduleCount: result?.categories?.reduce((count, item) => count + (item.modules?.length ?? 0), 0) ?? 0 };
        });
        verify(sidebarResponse.status === 200 && sidebarResponse.moduleCount > 0, `${flow.label}: authorized dashboard data did not load.`);

        stage = 'verify the server-restored identity and session cookie';
        let restored = await sessionState(page);
        verify(restored.status === 200 && restored.user?.id === loginResult.user.id && restored.user.roleKey === flow.role, `${flow.label}: session restoration did not preserve the authenticated identity and role.`);
        verify(restored.redirectTo === flow.route, `${flow.label}: restored session returned an unexpected dashboard destination.`);
        const sessionCookie = (await context.cookies(PRODUCTION_URL)).find((cookie) => cookie.name === 'osaah_session');
        verify(Boolean(sessionCookie?.httpOnly && sessionCookie.secure && sessionCookie.sameSite === 'Lax' && sessionCookie.path === '/'), `${flow.label}: session cookie security attributes are incomplete.`);

        stage = 'verify cross-role authorization';
        const restrictedStatus = await page.evaluate(async () => (await fetch('/api/administrators', { credentials: 'same-origin' })).status);
        verify(restrictedStatus === (flow.role === 'PROPRIETOR' ? 200 : 403), `${flow.label}: proprietor-only API access did not match the expected policy.`);

        stage = 'verify session persistence after refresh';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.workspace .topbar .eyebrow').filter({ hasText: expectedLandmark }).waitFor();
        restored = await sessionState(page);
        verify(restored.status === 200 && restored.user?.id === loginResult.user.id && restored.user.roleKey === flow.role, `${flow.label}: the session did not survive refresh.`);

        if (flow.role === 'TEACHER') {
          if (teacherUserId === null) teacherUserId = loginResult.user.id;
          else verify(teacherUserId === loginResult.user.id, 'Teacher username and email identifiers did not resolve to the same account.');
        }

        stage = 'log out and verify session invalidation';
        await page.locator('[data-module="logout"]').click();
        await page.locator('[data-portal="school"]').waitFor({ state: 'visible' });
        const loggedOut = await sessionState(page);
        verify(loggedOut.status === 401 && loggedOut.user === null, `${flow.label}: logout did not invalidate the session.`);
        verify(!(await context.cookies(PRODUCTION_URL)).some((cookie) => cookie.name === 'osaah_session'), `${flow.label}: logout did not clear the session cookie.`);
      } catch {
        throw new Error(`${flow.label} production smoke test failed while attempting to ${stage}. Remaining accounts were not attempted.`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
