import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createExaminationService, TIMETABLE_CREATOR_ROLES } from '../src/examinations.js';
import { PROPRIETOR_PAGE_ALIASES, PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

const publicFile = (page) => new URL(`../public/${page.replace(/^\//, '')}`, import.meta.url);

test('broken academic links resolve to their intended existing module pages', async () => {
  const expected = {
    '/examinations/timetable': ['/exam-timetable.html', /Examination Timetable/],
    '/results/broadsheets': ['/academic-modules.html', /Broadsheet/],
    '/academics/classes': ['/academic-modules.html', /academic-classes/],
    '/results/report-cards': ['/results.html', /Student Result Slip/],
    '/academics/subjects/list': ['/subjects.html', /Subject Configuration/],
    '/results/promotions': ['/promotion-results.html', /Promotion Results/],
    '/academics/curriculum': ['/academic-modules.html', /curriculum/],
    '/academics/lesson-plans': ['/academic-modules.html', /lesson-plans/],
    '/academics/assignments': ['/academic-modules.html', /academic-assignments/],
    '/academics/timetable': ['/exam-timetable.html', /Examination Timetable/],
    '/academics/spreadsheets': ['/academic-modules.html', /spreadsheets/]
  };
  for (const [route, [page, marker]] of Object.entries(expected)) {
    assert.equal(PROPRIETOR_PAGE_ALIASES[route], page, route);
    await access(publicFile(page));
    assert.match(await readFile(publicFile(page), 'utf8'), marker, route);
  }
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/examinations/timetable'], PROPRIETOR_PAGE_ALIASES['/examinations/marks']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/results/broadsheets'], PROPRIETOR_PAGE_ALIASES['/results']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/academics/classes'], PROPRIETOR_PAGE_ALIASES['/academics/subjects']);
});

test('administrative and academic oversight children use distinct canonical routes', () => {
  const expected = {
    'school-profile': '/settings/profile', 'academic-calendar': '/academic-calendar',
    academics: '/academics', 'attendance-dashboard': '/attendance', examinations: '/examinations',
    'sporting-activities': '/sporting-activities', 'student-attendance': '/attendance/students',
    'staff-attendance': '/attendance/staff', results: '/results',
    'attendance-reports': '/attendance/reports', promotion: '/promotion', 'mock-score-entry': '/examinations/mock',
    'subject-management': '/academics/subjects', 'mock-results': '/results/mock', 'subject-register': '/academics/subject-register',
    'academic-years': '/academics/years', 'attendance-alerts': '/attendance/alerts', 'exam-timetable': '/examinations/timetable',
    'academic-terms': '/academics/terms', spreadsheets: '/academics/spreadsheets', 'academic-classes': '/academics/classes',
    broadsheets: '/results/broadsheets', 'report-cards': '/results/report-cards', 'academic-subjects': '/academics/subjects/list',
    'promotion-results': '/results/promotions', 'teacher-assignments': '/academics/teacher-assignments', curriculum: '/academics/curriculum',
    'lesson-plans': '/academics/lesson-plans', 'academic-assignments': '/academics/assignments', timetable: '/academics/timetable'
  };
  const routes = new Map(PROPRIETOR_SIDEBAR_ROUTES.map((item) => [item.moduleKey, item.route]));
  for (const [moduleKey, route] of Object.entries(expected)) assert.equal(routes.get(moduleKey), route, moduleKey);
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
  assert.equal(PROPRIETOR_PAGE_ALIASES['/results/broadsheets'], '/academic-modules.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/reports'], '/reports-academic.html');
});

test('finance, staff, and student management children retain canonical route identity', () => {
  const expected = {
    fees: '/fees', finance: '/finance', invoices: '/fees/invoices', 'finance-reports': '/finance/reports', 'finance-receipts': '/finance/receipts',
    'fee-structure': '/fees/structure', 'fee.scholarships': '/fees/scholarships', 'admission-fee-management': '/fees/admission-structures',
    'student-fees': '/fees/students', income: '/finance/income', payments: '/fees/payments', expenses: '/finance/expenses',
    receipts: '/fees/receipts', cashbook: '/finance/cashbook', arrears: '/fees/arrears', budgets: '/finance/budgets',
    discounts: '/fees/discounts', 'fee-statements': '/fees/statements', 'staff-directory': '/staff', teachers: '/staff/teachers',
    hr: '/staff/hr', leave: '/staff/leave', 'staff-attendance-hr': '/staff/attendance', qualifications: '/staff/qualifications-licences',
    performance: '/staff/performance', 'staff.professional-development': '/staff/professional-development',
    'qualifications-licences': '/staff/qualifications', 'ntc-records': '/staff/ntc-records', appraisals: '/staff/appraisal',
    'hr-documents': '/staff/documents', 'student-profiles': '/students', admissions: '/admissions', 'student-search': '/students/search',
    'admission-prospectus': '/admissions/prospectus', 'student-directory': '/students/directory', 'admission-enquiries': '/admissions/enquiries',
    'student-ids': '/students/ids', 'admission-applications': '/admissions/applications', 'student-transfers': '/students/transfers',
    'admission-review': '/admissions/review', 'student-alumni': '/students/alumni', 'admission-offers': '/admissions/offers',
    'admission-enrollment': '/admissions/enrollment'
  };
  const routes = new Map(PROPRIETOR_SIDEBAR_ROUTES.map((item) => [item.moduleKey, item.route]));
  for (const [moduleKey, route] of Object.entries(expected)) assert.equal(routes.get(moduleKey), route, moduleKey);
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
});

test('reports, operations, and system children are all canonical and unique', () => {
  const expectedKeys = [
    'reports', 'admission-analytics', 'academic-reports', 'attendance-reports-management', 'financial-reports',
    'enrollment-reports', 'staff-reports', 'operational-reports', 'management-dashboard', 'library', 'transport',
    'transport.gps', 'transport-routes', 'hostel-residences', 'health-records', 'inventory', 'assets', 'procurement',
    'library-circulation', 'transport-students', 'hostel-roll-call', 'discipline', 'inventory-movements', 'property',
    'counselling', 'shep-activities', 'books', 'vehicles', 'houses', 'health', 'stock', 'buildings', 'purchase-requests',
    'borrowing', 'drivers', 'dormitories', 'sick-bay', 'stock-in', 'furniture', 'quotations', 'returns', 'routes', 'beds',
    'student-welfare', 'stock-out', 'maintenance', 'purchase-orders', 'library-reports', 'boarders', 'suppliers',
    'property-reports', 'goods-received', 'trips', 'roll-call', 'inventory-reports', 'transport-fees', 'hostel-fees',
    'compliance', 'documents', 'privacy', 'nasia', 'roles', 'ntc', 'permissions', 'fire-safety', 'audit-logs', 'emis-census',
    'sessions', 'inspections', 'backups', 'compliance-calendar', 'document-repository'
  ];
  const routes = new Map(PROPRIETOR_SIDEBAR_ROUTES.map((item) => [item.moduleKey, item.route]));
  for (const moduleKey of expectedKeys) assert.match(routes.get(moduleKey) ?? '', /^\//, moduleKey);
  assert.equal(new Set(expectedKeys.map((moduleKey) => routes.get(moduleKey))).size, expectedKeys.length);
});

test('every proprietor route has a real render target and unique module identity', async () => {
  assert.equal(new Set(PROPRIETOR_SIDEBAR_ROUTES.map((item) => item.route)).size, PROPRIETOR_SIDEBAR_ROUTES.length);
  for (const item of PROPRIETOR_SIDEBAR_ROUTES) await access(publicFile(item.page));
});

test('exam timetable creation is restricted, conflict checked and publication scoped', () => {
  assert.deepEqual(TIMETABLE_CREATOR_ROLES, ['HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN']);
  const service = createExaminationService({ now: () => '2026-09-09T12:00:00.000Z' });
  const head = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight' };
  const draft = service.saveTimetable({ academicYearId: '2026/2027', termId: 'First Term', classId: 'Primary 4', examination: 'End of Term', subjectId: 'Mathematics', date: '2026-12-01', startTime: '09:00', endTime: '10:00', venue: 'Room 4' }, head);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(service.listTimetables({}, { roleKey: 'PROPRIETOR', schoolId: draft.schoolId }).length, 0);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 4' }], schoolId: draft.schoolId }).length, 0);
  assert.throws(() => service.saveTimetable({ ...draft, id: undefined, subjectId: 'English' }, { id: 'exam-1', roleKey: 'EXAMINATION_OFFICER' }), /permission/);
  assert.throws(() => service.saveTimetable({ ...draft, id: undefined, subjectId: 'English', startTime: '09:30', endTime: '10:30' }, head), { code: 'TIMETABLE_CONFLICT' });
  service.publishTimetable(draft.id, { id: 'admin-1', roleKey: 'SCHOOL_ADMIN' });
  assert.equal(service.listTimetables({}, { roleKey: 'PROPRIETOR', schoolId: draft.schoolId }).length, 1);
  assert.equal(service.listTimetables({}, { roleKey: 'TEACHER', assignedClassIds: ['Primary 4'], schoolId: draft.schoolId }).length, 1);
  assert.equal(service.listTimetables({}, { roleKey: 'TEACHER', assignedClassIds: ['Primary 5'], schoolId: draft.schoolId }).length, 0);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 4' }], schoolId: draft.schoolId }).length, 1);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 5' }], schoolId: draft.schoolId }).length, 0);
});

test('all school roles use canonical non-fallback routes for their visible navigation', () => {
  const rolePermissions = new Set(['*']);
  for (const roleKey of ['PROPRIETOR','HEADTEACHER','ASSISTANT_HEADTEACHER','SCHOOL_ADMIN','ACCOUNTANT_BURSAR','TEACHER','HR_OFFICER','EXAMINATION_OFFICER']) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: rolePermissions, roleKey, portal: 'school' }).flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
    for (const module of modules.filter((item) => !['dashboard','logout'].includes(item.moduleKey))) assert.ok(module.route.startsWith('/') && module.route !== '/', `${roleKey}:${module.moduleKey}`);
  }
});

test('workspace navigation normalizes the route inside the renderer and terminates iframe failures', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const renderStart = app.indexOf('function renderWorkspaceRoute');
  const navigateStart = app.indexOf('function navigateToRoute');
  assert.ok(renderStart >= 0);
  assert.ok(navigateStart > renderStart);
  const renderBody = app.slice(renderStart, navigateStart);
  assert.match(renderBody, /const normalizedRoute = String\(route \|\| '\/'\)/);
  assert.match(renderBody, /url\.searchParams\.set\('route', normalizedRoute\)/);
  assert.match(renderBody, /frame\.onerror = \(error\) =>/);
  assert.match(renderBody, /Unable to open \$\{title\}/);
});

test('embedded module navigation preserves exact identity, refreshes the shell, and ends stalled loading', async () => {
  const [app, index, serviceWorker] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  ]);
  assert.match(app, /data-navigation-key=/);
  assert.match(app, /data-module-route=/);
  assert.match(app, /data-exact-view=/);
  assert.match(app, /url\.searchParams\.set\('navigationKey', navigationKey\)/);
  assert.match(app, /url\.searchParams\.set\('view', exactView\)/);
  assert.match(app, /setTimeout\(\(\) => failToOpen\('timeout'\), 20000\)/);
  assert.match(app, /taking too long to open/);
  assert.match(app, /clearTimeout\(Number\(dashboard\.dataset\.navigationTimer\)\)/);
  assert.match(index, /app\.js\?v=20261103-1/);
  assert.match(serviceWorker, /osaah-shell-v5/);
});

test('school dashboard bootstrap consumes the server role redirect after login and session restoration', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../src/auth.js', import.meta.url), 'utf8');
  const reports = await readFile(new URL('../public/reports-canonical.html', import.meta.url), 'utf8');
  assert.match(auth, /PROPRIETOR:\s*'\/'/);
  assert.match(auth, /SCHOOL_ADMIN:\s*'\/settings'/);
  assert.match(auth, /HEADTEACHER:\s*'\/academics'/);
  assert.match(auth, /ASSISTANT_HEADTEACHER:\s*'\/academics'/);
  assert.match(auth, /ACCOUNTANT_BURSAR:\s*'\/fees'/);
  assert.match(auth, /TEACHER:\s*'\/academics'/);
  assert.doesNotMatch(app, /window\.location\.assign\('\/reports'\)/);
  assert.match(reports, /postMessage\(\{type:'osaah:navigate-dashboard'\},location\.origin\)/);
  assert.match(app, /event\.source !== frame\?\.contentWindow/);
  assert.match(app, /navigateToRoute\(dashboard, '\/', 'Dashboard Overview'\)/);
  assert.match(app, /function renderDashboard\(user, redirectTo = '\/'\)/);
  assert.match(app, /function resolvePostLoginRoute\(user, redirectTo\)/);
  assert.match(app, /const initialRoute = location\.pathname === '\/' \? resolvePostLoginRoute\(user, redirectTo\) : location\.pathname/);
  assert.match(app, /findRouteLink\(requestedUrl\.pathname, requestedUrl\.searchParams\.get\('navigationKey'\)\)/);
  assert.match(app, /if \(location\.pathname === '\/' && redirectLink\)/);
  assert.match(app, /navigateToRoute\(dashboard, requestedUrl\.pathname/);
  assert.match(app, /renderDashboard\(result\.user, result\.redirectTo\)/);
});

test('every configured role sidebar child has a stable identity and deterministic route', () => {
  const roles = ['ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
  for (const roleKey of roles) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['*']), roleKey, portal: 'school' })
      .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]))
      .filter((module) => !['dashboard', 'logout'].includes(module.moduleKey));
    assert.ok(modules.length > 0, `${roleKey} must expose configured navigation`);
    assert.equal(new Set(modules.map((module) => module.navigationKey)).size, modules.length, `${roleKey} navigation keys must be unique`);
    for (const module of modules) {
      assert.equal(module.navigationKey, module.moduleKey, `${roleKey}:${module.moduleKey} must use its canonical identity`);
      assert.match(module.route, /^\//, `${roleKey}:${module.moduleKey} route`);
    }
  }
});

test('duplicate visible labels remain isolated by navigation identity', async () => {
  const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['*']), roleKey: 'ACCOUNTANT_BURSAR', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  const receipts = modules.filter((module) => module.moduleName === 'Receipts');
  assert.deepEqual(receipts.map((module) => module.moduleKey), ['receipts', 'finance-receipts']);
  assert.deepEqual(receipts.map((module) => module.route), ['/fees/receipts', '/finance/receipts']);
  assert.equal(new Set(modules.map((module) => module.navigationKey)).size, modules.length);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-navigation-key/);
  assert.match(app, /link\.dataset\.navigationKey/);
  assert.match(app, /resolvedComponent: navigationKey/);
});
