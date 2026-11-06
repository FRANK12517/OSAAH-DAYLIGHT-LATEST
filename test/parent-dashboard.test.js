import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentDashboardService } from '../src/parent-dashboard.js';
import { createStudentService } from '../src/students.js';
import { createConfiguredTestParent, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';
import { createCommunicationService } from '../src/communication.js';
import { createOperationsService } from '../src/operations.js';
import { parentDashboardModules } from '../src/sidebar-registry.js';
import '../src/module-registry.js';
import { createParentDashboardViewState, isCurrentParentChildResolution, parentClassOptions, parentContextAfterChildResolution } from '../public/parent-dashboard.js';

const child = {
  id: 'student-1',
  studentId: 'student-1',
  studentProfileId: 'profile-1',
  permanentStudentId: 'OSAAH/2026/0001',
  firstName: 'Ama',
  lastName: 'Mensah',
  classId: 'class-primary-1',
  className: 'Primary 1',
  gender: 'Female',
  studentStatus: 'ACTIVE',
  enrollmentStatus: 'ACTIVE',
  schoolId: 'school-1',
  isTestRecord: false
};
const actor = (children = [child]) => ({
  id: 'parent-1',
  portal: 'parent',
  roleKey: 'PARENT',
  schoolId: 'school-1',
  permissions: new Set(['children.read']),
  children
});
const cards = [
  { moduleKey: 'parent-attendance', moduleName: 'Attendance', route: '#attendance' },
  { moduleKey: 'parent-documents', moduleName: 'Documents', route: '#documents' }
];

test('Parent Dashboard card routes resolve to explicit dashboard views instead of hash fragments', () => {
  const modules = parentDashboardModules();
  assert.equal(modules.length, 12);
  assert.ok(modules.every((item) => item.route.startsWith('/?parentCard=parent-')));
  assert.ok(modules.every((item) => !item.route.includes('#')));
});

test('switching Child A to Child B clears Child A data and prevents stale in-flight responses from reappearing', () => {
  const state = createParentDashboardViewState();
  const childARequest = state.invalidate('OSAAH/2026/0001');
  assert.equal(state.commit('record', childARequest, { permanentStudentId: childARequest.childId, attendance: ['A'] }), true);
  assert.equal(state.snapshot().record.permanentStudentId, childARequest.childId);

  const staleChildARequest = state.capture();
  state.invalidate('OSAAH/2026/0002');
  assert.equal(state.snapshot().record, null);
  assert.equal(state.snapshot().component, null);
  assert.equal(state.commit('record', staleChildARequest, { permanentStudentId: 'OSAAH/2026/0001', attendance: ['stale'] }), false);

  const childBRequest = state.capture();
  assert.equal(state.commit('record', childBRequest, { permanentStudentId: childBRequest.childId, attendance: ['B'] }), true);
  assert.equal(state.snapshot().record.permanentStudentId, 'OSAAH/2026/0002');
});

test('a delayed Child A resolution cannot overwrite a later Child B selection', () => {
  assert.equal(isCurrentParentChildResolution('OSAAH/2026/0002', 'OSAAH/2026/0001'), false);
  assert.equal(isCurrentParentChildResolution(' OSAAH/2026/0002 ', 'OSAAH/2026/0002'), true);
});

test('same-child re-resolution without a recorded class preserves the Parent academic context', () => {
  const context = { academicYear: 'year-2026', classId: 'class-primary-4', term: 'term-2' };
  const classes = [{ id: 'class-primary-4', name: 'Primary 4' }];
  for (const missingClass of [null, '', undefined]) {
    assert.deepEqual(parentContextAfterChildResolution(context, {
      previousChildId: 'OSAAH/DEMO/001',
      child: { permanentStudentId: 'OSAAH/DEMO/001', classId: missingClass, className: missingClass },
      classes
    }), context);
  }
});

test('same-child re-resolution with a valid canonical class retains existing synchronization behavior', () => {
  const context = { academicYear: 'year-2026', classId: 'class-primary-4', term: 'term-2' };
  assert.deepEqual(parentContextAfterChildResolution(context, {
    previousChildId: 'OSAAH/DEMO/001',
    child: { permanentStudentId: 'OSAAH/DEMO/001', classId: 'class-primary-1', className: 'Primary 1' },
    classes: [{ id: 'class-primary-1', name: 'Primary 1' }, { id: 'class-primary-4', name: 'Primary 4' }]
  }), { ...context, classId: 'class-primary-1' });
});

test('a legacy Basic 6 child label resolves to the configured Primary 6 ID without changing the ID', () => {
  const context = { academicYear: 'year-2026', classId: '', term: 'term-2' };
  assert.deepEqual(parentContextAfterChildResolution(context, {
    previousChildId: 'OSAAH/DEMO/001',
    child: { permanentStudentId: 'OSAAH/DEMO/001', classId: 'student-class-uuid-6', className: 'Basic 6' },
    classes: [{ id: 'student-class-uuid-6', name: 'Primary 6' }]
  }), { ...context, classId: 'student-class-uuid-6' });
});

test('switching children clears a stale class when the new child has no recorded class', () => {
  const context = { academicYear: 'year-2026', classId: 'class-primary-1', term: 'term-1' };
  assert.deepEqual(parentContextAfterChildResolution(context, {
    previousChildId: 'OSAAH/DEMO/001',
    child: { permanentStudentId: 'OSAAH/DEMO/002', classId: null, className: null },
    classes: [{ id: 'class-primary-1', name: 'Primary 1' }]
  }), { ...context, classId: '' });
});

function dependencies(overrides = {}) {
  const databaseRows = [child, { ...child, id: 'student-2', studentId: 'student-2', studentProfileId: 'profile-2', permanentStudentId: 'OSAAH/2026/0002', firstName: 'Kojo' }];
  return {
    students: { findByPermanentStudentId: () => null },
    admissionEnrollment: {
      listParentStudents: async ({ parentUserId, schoolId }) => {
        assert.equal(parentUserId, 'parent-1');
        assert.equal(schoolId, 'school-1');
        return databaseRows;
      },
      authorizeParentStudent: async ({ parentUserId, schoolId, permanentStudentId }) => parentUserId === 'parent-1' && schoolId === 'school-1' && permanentStudentId === child.permanentStudentId ? child : null
    },
    durableAcademic: {
      options: async () => ({
        academicYears: [{ id: 'year-2026', name: '2026/2027', isCurrent: true }, { id: 'year-2027', name: '2027/2028' }],
        terms: [{ id: 'term-1', name: '1st Term', academicYearId: 'year-2026' }, { id: 'term-2', name: '2nd Term', academicYearId: 'year-2026' }, { id: 'term-next', name: '1st Term', academicYearId: 'year-2027' }],
        classes: [{ id: 'class-primary-1', name: 'Primary 1' }, { id: 'class-jhs-3', name: 'JHS 3' }]
      })
    },
    cards,
    ...overrides
  };
}

test('Parent child list is resolved from the authenticated school-scoped relationship service', async () => {
  const service = createParentDashboardService(dependencies());
  const children = await service.listChildren(actor());
  assert.deepEqual(children.map((item) => item.permanentStudentId), ['OSAAH/2026/0001', 'OSAAH/2026/0002']);
  assert.deepEqual(children.map((item) => item.name), ['Ama Mensah', 'Kojo Mensah']);
  assert.equal(children[0].gender, 'Female');
  assert.equal(children[0].studentStatus, 'ACTIVE');
  assert.equal(children[0].enrollmentStatus, 'ACTIVE');
  assert.ok(children.every((item) => !('id' in item) && !('studentId' in item)));
});

test('Student Summary returns canonical gender and status fields for only the authorized child', async () => {
  const service = createParentDashboardService(dependencies());
  const result = await service.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'student-summary' });
  assert.equal(result.student.gender, 'Female');
  assert.equal(result.student.studentStatus, 'ACTIVE');
  assert.equal(result.student.enrollmentStatus, 'ACTIVE');
  assert.equal(result.student.permanentStudentId, child.permanentStudentId);
  await assert.rejects(() => service.loadRecord(actor(), { permanentStudentId: 'OSAAH/2026/0002', recordType: 'student-summary' }), (error) => error.status === 403);
});

test('Parent student summary canonicalizes Basic 6 while retaining the stored class identifier', async () => {
  const legacyChild = { ...child, classId: 'class-primary-6', className: 'Basic 6' };
  const service = createParentDashboardService(dependencies({
    admissionEnrollment: {
      listParentStudents: async () => [legacyChild],
      authorizeParentStudent: async () => legacyChild
    }
  }));
  const result = await service.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'student-summary' });
  assert.equal(result.student.classId, 'class-primary-6');
  assert.equal(result.student.className, 'Primary 6');
});

test('missing canonical gender and status remain absent rather than being fabricated', async () => {
  const missing = { ...child, gender: null, studentStatus: null, enrollmentStatus: null };
  const service = createParentDashboardService(dependencies({
    admissionEnrollment: {
      listParentStudents: async () => [missing],
      authorizeParentStudent: async () => missing
    }
  }));
  const [listed, summary] = [await service.listChildren(actor()), await service.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'student-summary' })];
  assert.equal('gender' in listed[0], false);
  assert.equal('studentStatus' in listed[0], false);
  assert.equal('enrollmentStatus' in listed[0], false);
  assert.equal('gender' in summary.student, false);
  assert.equal('studentStatus' in summary.student, false);
  assert.equal('enrollmentStatus' in summary.student, false);
});

test('selected-child resolution rechecks the live link and rejects stale session relationships after revocation', async () => {
  let linked = true;
  const base = dependencies();
  const service = createParentDashboardService({
    ...base,
    admissionEnrollment: {
      ...base.admissionEnrollment,
      authorizeParentStudent: async () => linked ? child : null
    }
  });
  assert.equal((await service.resolveChild(actor(), child.permanentStudentId)).permanentStudentId, child.permanentStudentId);
  linked = false;
  await assert.rejects(() => service.resolveChild(actor(), child.permanentStudentId), (error) => error.status === 403 && error.code === 'PARENT_STUDENT_FORBIDDEN');
});

test('controlled Parent children come from existing server-side sample links without changing official student counts', async () => {
  const students = createStudentService({ schoolId: 'school-osaah-daylight' });
  students.seedSampleStudents();
  const parent = createConfiguredTestParent();
  const before = students.counts().students;
  const service = createParentDashboardService({ students, cards: [] });
  const children = await service.listChildren(parent);
  assert.deepEqual(children.map((item) => item.permanentStudentId), [...TEST_PARENT_STUDENT_IDS]);
  assert.ok(children.every((item) => item.isTestRecord && item.sampleLabel === 'SAMPLE DATA'));
  assert.equal(students.counts().students, before);
  assert.equal(students.listStudents().length, 0);
});

test('controlled Parent fixture follows the canonical production school while other Parents cannot claim its sample children', async () => {
  const productionSchoolId = 'sch_default_01';
  const students = createStudentService({ schoolId: productionSchoolId });
  students.seedSampleStudents();
  const parent = createConfiguredTestParent(productionSchoolId);
  const service = createParentDashboardService({ students, testParentSchoolId: productionSchoolId, cards: [] });

  const children = await service.listChildren(parent);
  assert.deepEqual(children.map((item) => item.permanentStudentId), [...TEST_PARENT_STUDENT_IDS]);
  assert.ok(children.every((item) => item.isTestRecord));
  assert.equal((await service.resolveChild(parent, TEST_PARENT_STUDENT_IDS[0])).permanentStudentId, TEST_PARENT_STUDENT_IDS[0]);

  const unrelatedParent = { ...parent, id: 'another-parent', children: [{ permanentStudentId: TEST_PARENT_STUDENT_IDS[0] }] };
  assert.deepEqual(await service.listChildren(unrelatedParent), []);
  await assert.rejects(() => service.resolveChild(unrelatedParent, TEST_PARENT_STUDENT_IDS[0]), (error) => error.status === 403);
});

test('controlled Parent attendance reads use the isolated durable sample fixture for the selected term', async () => {
  const productionSchoolId = 'sch_default_01';
  const students = createStudentService({ schoolId: productionSchoolId });
  students.seedSampleStudents();
  const parent = createConfiguredTestParent(productionSchoolId);
  const fixture = {
    async getFixture(identity) {
      assert.equal(identity.sampleStudentId, 'OSAAH/DEMO/001');
      assert.equal(identity.academicYearId, 'year-2026');
      assert.equal(identity.termId, 'term-2');
      assert.equal(identity.classId, 'class-primary-6');
      assert.equal(identity.fixtureType, 'attendance');
      return { fixturePayload: { records: [{ date: '2026-10-01', status: 'PRESENT' }, { date: '2026-10-02', status: 'ABSENT' }] } };
    }
  };
  const service = createParentDashboardService({
    students,
    attendance: { summary: () => ({ records: [] }) },
    sampleFixtureRepository: fixture,
    testParentSchoolId: productionSchoolId,
    durableAcademic: { options: async () => ({ academicYears: [{ id: 'year-2026', name: '2026/2027' }], terms: [{ id: 'term-2', name: '2nd Term', academicYearId: 'year-2026' }], classes: [{ id: 'class-primary-6', name: 'Basic 6' }] }) }
  });
  const parentOptions = await service.options(parent);
  assert.deepEqual(parentOptions.classes.slice(0, 13).map((item) => item.name), [
    'Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3',
    'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'
  ]);
  assert.ok(parentOptions.sampleContexts['OSAAH/DEMO/001'].every((context) => context.classId === 'class-primary-6' && context.provenance === 'TEST'));
  const result = await service.loadRecord(parent, { permanentStudentId: 'OSAAH/DEMO/001', recordType: 'attendance', academicYear: 'year-2026', classId: 'class-primary-6', term: 'term-2' });
  assert.deepEqual(result.records.map(({ studentId, term, status }) => ({ studentId, term, status })), [
    { studentId: 'OSAAH/DEMO/001', term: '2nd Term', status: 'PRESENT' },
    { studentId: 'OSAAH/DEMO/001', term: '2nd Term', status: 'ABSENT' }
  ]);
  assert.equal(result.attendanceSummary.present, 1);
  assert.equal(result.attendanceSummary.absent, 1);
});

test('Parent announcements include school, parent, selected-class, and selected-student audiences only', async () => {
  const communication = createCommunicationService({ schoolId: 'school-1' });
  const schoolActor = { id: 'staff-1', roleKey: 'HEADTEACHER', schoolId: 'school-1' };
  for (const item of [
    { title: 'School notice', audience: 'SCHOOL' },
    { title: 'Parent notice', audience: 'PARENT' },
    { title: 'Selected class notice', audience: 'CLASS', classId: 'class-primary-1' },
    { title: 'Sibling class notice', audience: 'CLASS', classId: 'class-jhs-3' },
    { title: 'Selected child notice', audience: 'STUDENT', studentIds: ['student-1'] },
    { title: 'Sibling notice', audience: 'STUDENT', studentIds: ['student-2'] }
  ]) communication.announce(item, schoolActor);
  const service = createParentDashboardService(dependencies({ communication, cards: [{ moduleKey: 'parent-announcements', moduleName: 'Announcements', route: '#announcements' }] }));
  const result = await service.component(actor(), 'parent-announcements', { permanentStudentId: child.permanentStudentId });
  assert.deepEqual(result.records.map((item) => item.title), ['School notice', 'Parent notice', 'Selected class notice', 'Selected child notice']);
});

test('Parent transport exposes only the selected child assignment and strips route rosters', async () => {
  const operations = createOperationsService({ schoolId: 'school-1' });
  const staff = { id: 'staff-1', roleKey: 'HEADTEACHER', schoolId: 'school-1' };
  const selectedRoute = operations.createRoute({ name: 'Selected route', stops: ['Gate'], studentIds: ['profile-1', 'profile-2'], boarding: { 'profile-1': '07:00' }, dropOff: { 'profile-1': '15:00' } }, staff);
  const siblingRoute = operations.createRoute({ name: 'Sibling route', stops: ['Other'], studentIds: ['profile-2'] }, staff);
  operations.assignTransport({ studentId: 'profile-1', routeId: selectedRoute.id, stopId: 'Gate' }, staff);
  operations.assignTransport({ studentId: 'profile-2', routeId: siblingRoute.id, stopId: 'Other' }, staff);
  const service = createParentDashboardService(dependencies({ operations, cards: [{ moduleKey: 'parent-transport', moduleName: 'Transport', route: '#transport' }] }));
  const result = await service.component(actor(), 'parent-transport', { permanentStudentId: child.permanentStudentId });
  assert.deepEqual(result.records.assignments.map((item) => item.routeName), ['Selected route']);
  assert.equal(result.records.assignments[0].pickupPoint, 'Gate');
  assert.ok(!('studentId' in result.records.assignments[0]));
  assert.ok(!('studentIds' in result.records.assignments[0]));
});

test('Parent class options include all 13 canonical classes in order and preserve configured class IDs', async () => {
  const service = createParentDashboardService(dependencies({ durableAcademic: { options: async () => ({
    academicYears: [{ id: 'year-2026', name: '2026/2027' }],
    terms: [{ id: 'term-2', name: '2nd Term', academicYearId: 'year-2026' }],
    classes: [{ id: 'class-primary-6', name: 'Basic 6' }, { id: 'class-jhs-3', name: 'JHS 3' }]
  }) } }));
  const result = await service.options(actor());
  assert.deepEqual(result.classes.slice(0, 13).map((item) => item.name), [
    'Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3',
    'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'
  ]);
  assert.equal(result.classes[9].id, 'class-primary-6');
  assert.equal(result.classes[9].name, 'Primary 6');
  assert.equal(result.classes[12].id, 'class-jhs-3');
  assert.equal(result.classes.some((item) => item.name === 'Basic 6'), false);
  assert.equal(result.classes.at(-1).name, 'Completed / Graduated');
});

test('sample context metadata does not narrow the Parent class dropdown', () => {
  const classes = Array.from({ length: 13 }, (_, index) => ({ id: `class-${index}`, name: `Class ${index}` }));
  assert.deepEqual(parentClassOptions({ classes, sampleContexts: { 'OSAAH/DEMO/001': [{ classId: 'class-9' }] } }), classes);
});

test('a class being present in the canonical dropdown does not authorize records without a matching enrollment', async () => {
  const base = dependencies();
  const service = createParentDashboardService({
    ...base,
    attendance: { summary: () => ({ records: [] }) },
    admissionEnrollment: {
      ...base.admissionEnrollment,
      parentEnrolledInClass: async () => false
    }
  });
  await assert.rejects(() => service.loadRecord(actor(), {
    permanentStudentId: child.permanentStudentId,
    recordType: 'attendance',
    academicYear: 'year-2026',
    classId: 'Primary 6',
    term: 'term-1'
  }), (error) => error.status === 403 && error.code === 'PARENT_CLASS_FORBIDDEN');
});

test('the Parent class selector remains a native single-select control', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../public/parent-dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /field\('Class', 'parent-class', \[\], \{ required: false \}\)/);
  assert.match(source, /<select id="\$\{esc\(id\)\}" name="\$\{esc\(id\)\}"/);
  assert.doesNotMatch(source, /<select[^>]*multiple/);
});

test('academic options retain configured years, terms, and record views', async () => {
  const service = createParentDashboardService(dependencies({ attendance: { summary: () => ({ records: [] }) } }));
  const result = await service.options(actor());
  assert.deepEqual(result.academicYears.map((item) => item.name), ['2026/2027', '2027/2028']);
  assert.equal(result.terms.find((item) => item.id === 'term-next').academicYearId, 'year-2027');
  assert.ok(result.classes.some((item) => item.name === 'JHS 3'));
  assert.ok(result.classes.some((item) => item.name === 'Completed / Graduated'));
  assert.equal(result.classes.slice(0, 13).length, 13);
  assert.equal(result.recordTypes.find((item) => item.id === 'attendance').available, true);
  assert.ok(!result.recordTypes.some((item) => item.id === 'documents'));
});

test('attendance record reads are scoped to one authorized child and the selected academic context', async () => {
  let seenFilters;
  const service = createParentDashboardService(dependencies({
    attendanceRepository: {
      async listStudentRecords(filters) {
        seenFilters = filters;
        return [
          { studentId: 'profile-1', attendanceDate: '2026-09-01', status: 'PRESENT' },
          { studentId: 'profile-2', attendanceDate: '2026-09-01', status: 'ABSENT' }
        ];
      }
    }
  }));
  const result = await service.loadRecord(actor(), {
    permanentStudentId: child.permanentStudentId,
    recordType: 'attendance',
    academicYear: 'year-2026',
    classId: 'class-primary-1',
    term: 'term-1'
  });
  assert.deepEqual(seenFilters, { schoolId: 'school-1', academicYear: '2026/2027', term: '1st Term', classId: 'class-primary-1', studentId: 'profile-1' });
  assert.deepEqual(result.records.map((item) => item.studentId), ['profile-1']);
  assert.equal(result.context.yearName, '2026/2027');
});

function parentAttendanceRow({ date, status, subjectId = 'daily', studentId = 'profile-1', schoolId = 'school-1', academicYear = '2026/2027', term = '1st Term', classId = 'class-primary-1' }) {
  return { date, status, subjectId, studentId, schoolId, academicYear, term, classId };
}

test('Parent attendance summary counts every canonical status and distinct recorded dates across subject records', async () => {
  const source = [
    parentAttendanceRow({ date: '2026-09-01', status: 'PRESENT', subjectId: 'math' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'PRESENT', subjectId: 'english' }),
    parentAttendanceRow({ date: '2026-09-02', status: 'ABSENT' }),
    parentAttendanceRow({ date: '2026-09-03', status: 'LATE' }),
    parentAttendanceRow({ date: '2026-09-04', status: 'EARLY_DEPARTURE' }),
    parentAttendanceRow({ date: '2026-09-05', status: 'EXCUSED_ABSENCE' }),
    parentAttendanceRow({ date: '2026-09-06', status: 'UNEXCUSED_ABSENCE' }),
    parentAttendanceRow({ date: '2026-09-07', status: 'SICK_ABSENCE' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'ABSENT', studentId: 'profile-2' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'ABSENT', academicYear: '2025/2026' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'ABSENT', term: '2nd Term' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'ABSENT', classId: 'class-jhs-3' }),
    parentAttendanceRow({ date: '2026-09-01', status: 'ABSENT', schoolId: 'school-other' })
  ];
  const service = createParentDashboardService(dependencies({ attendanceRepository: { listStudentRecords: async () => source } }));
  const result = await service.loadRecord(actor(), {
    permanentStudentId: child.permanentStudentId,
    recordType: 'attendance',
    academicYear: 'year-2026',
    classId: 'class-primary-1',
    term: 'term-1'
  });

  assert.equal(result.records.length, 8, 'the detailed records remain available and out-of-scope rows are removed');
  assert.deepEqual(result.attendanceSummary, {
    recordedDays: 7,
    present: 2,
    absent: 1,
    late: 1,
    earlyDeparture: 1,
    excusedAbsence: 1,
    unexcusedAbsence: 1,
    sickAbsence: 1,
    recordedAttendancePercentage: 50,
    unknownStatuses: []
  });
});

test('Parent attendance summary uses neutral zero-record and zero-denominator values', async () => {
  const emptyService = createParentDashboardService(dependencies({ attendanceRepository: { listStudentRecords: async () => [] } }));
  const empty = await emptyService.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'attendance', academicYear: 'year-2026', classId: 'class-primary-1', term: 'term-1' });
  assert.deepEqual(empty.attendanceSummary, {
    recordedDays: 0, present: 0, absent: 0, late: 0, earlyDeparture: 0, excusedAbsence: 0,
    unexcusedAbsence: 0, sickAbsence: 0, recordedAttendancePercentage: null, unknownStatuses: []
  });
  const excusedService = createParentDashboardService(dependencies({ attendanceRepository: { listStudentRecords: async () => [
    parentAttendanceRow({ date: '2026-09-01', status: 'EXCUSED_ABSENCE' }), parentAttendanceRow({ date: '2026-09-02', status: 'SICK_ABSENCE' })
  ] } }));
  const excusedOnly = await excusedService.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'attendance', academicYear: 'year-2026', classId: 'class-primary-1', term: 'term-1' });
  assert.equal(excusedOnly.attendanceSummary.recordedDays, 2);
  assert.equal(excusedOnly.attendanceSummary.recordedAttendancePercentage, null);
});

test('Parent attendance keeps unknown statuses visible and never classifies them as present or absent', async () => {
  const service = createParentDashboardService(dependencies({ attendanceRepository: { listStudentRecords: async () => [
    parentAttendanceRow({ date: '2026-09-01', status: 'PRESENT' }), parentAttendanceRow({ date: '2026-09-02', status: 'LEGACY_REVIEW' })
  ] } }));
  const result = await service.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'attendance', academicYear: 'year-2026', classId: 'class-primary-1', term: 'term-1' });
  assert.equal(result.attendanceSummary.present, 1);
  assert.equal(result.attendanceSummary.absent, 0);
  assert.deepEqual(result.attendanceSummary.unknownStatuses, [{ status: 'LEGACY_REVIEW', count: 1 }]);
  assert.equal(result.attendanceSummary.recordedAttendancePercentage, 50);
});

test('changing academic context clears a visible Parent attendance summary and blocks stale responses', () => {
  const state = createParentDashboardViewState();
  const originalContextRequest = state.invalidate(child.permanentStudentId);
  assert.equal(state.commit('record', originalContextRequest, { attendanceSummary: { present: 3 } }), true);
  const staleRequest = state.capture();
  state.invalidate(child.permanentStudentId);
  assert.equal(state.snapshot().record, null);
  assert.equal(state.commit('record', staleRequest, { attendanceSummary: { present: 3 } }), false);
});

test('Parent cannot request an unlinked Permanent Student ID', async () => {
  const service = createParentDashboardService(dependencies());
  await assert.rejects(() => service.loadRecord(actor(), { permanentStudentId: 'OSAAH/2026/9999', recordType: 'student-summary' }), (error) => error.status === 403 && error.code === 'PARENT_STUDENT_FORBIDDEN');
});

test('academic terms cannot be mixed across years and unsupported record types do not fabricate data', async () => {
  const service = createParentDashboardService(dependencies({ attendance: { summary: () => ({ records: [] }) } }));
  await assert.rejects(() => service.loadRecord(actor(), {
    permanentStudentId: child.permanentStudentId,
    recordType: 'attendance',
    academicYear: 'year-2026',
    classId: 'class-primary-1',
    term: 'term-next'
  }), (error) => error.status === 400 && error.code === 'INVALID_TERM');
  await assert.rejects(() => service.loadRecord(actor(), {
    permanentStudentId: child.permanentStudentId,
    recordType: 'attendance',
    academicYear: 'year-2026',
    classId: 'class-jhs-3',
    term: 'term-1'
  }), (error) => error.status === 403 && error.code === 'PARENT_CLASS_FORBIDDEN');
  await assert.rejects(() => service.loadRecord(actor(), { permanentStudentId: child.permanentStudentId, recordType: 'documents' }), (error) => error.status === 400 && error.code === 'INVALID_RECORD_TYPE');
  await assert.rejects(() => service.component(actor(), 'parent-documents', { permanentStudentId: child.permanentStudentId }), (error) => error.status === 501 && error.code === 'PARENT_COMPONENT_NOT_AVAILABLE');
});

test('an empty canonical academic-year catalog is reported instead of being hard-coded', async () => {
  const service = createParentDashboardService(dependencies({ durableAcademic: { options: async () => ({ academicYears: [], terms: [], classes: [] }) } }));
  await assert.rejects(() => service.options(actor()), (error) => error.status === 503 && error.code === 'PARENT_ACADEMIC_YEARS_NOT_CONFIGURED');
});
