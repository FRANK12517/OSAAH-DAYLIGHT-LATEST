import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentAttendanceOverviewService } from '../src/student-attendance-overview.js';

const SCHOOL = 'osaah-school';
const STAFF = { id: 'reporter', roleKey: 'HEADTEACHER', schoolId: SCHOOL, permissions: new Set(['attendance.read']) };
const YEARS = [
  { id: 'AY-2025', name: '2025/2026', startsOn: '2025-09-01', endsOn: '2026-07-31', isCurrent: 0 },
  { id: 'AY-2026', name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-07-31', isCurrent: 1 }
];
const TERMS = [
  { id: 'TERM-2025-1', academicYearId: 'AY-2025', academicYearName: '2025/2026', name: '1st Term', startsOn: '2025-09-01', endsOn: '2025-12-20', isCurrent: 0 },
  { id: 'TERM-2025-2', academicYearId: 'AY-2025', academicYearName: '2025/2026', name: '2nd Term', startsOn: '2026-01-05', endsOn: '2026-03-31', isCurrent: 0 },
  { id: 'TERM-2025-3', academicYearId: 'AY-2025', academicYearName: '2025/2026', name: '3rd Term', startsOn: '2026-04-01', endsOn: '2026-07-31', isCurrent: 0 },
  { id: 'TERM-2026-1', academicYearId: 'AY-2026', academicYearName: '2026/2027', name: '1st Term', startsOn: '2026-09-01', endsOn: '2026-12-20', isCurrent: 1 }
];
const CLASS_NAMES = ['Nursery 1','Nursery 2','KG1','KG2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JHS 1','JHS 2','JHS 3'];
const CLASSES = CLASS_NAMES.map((name) => ({ id: `class-${name.toLowerCase().replaceAll(' ', '-')}`, name, status: 'ACTIVE' }));
const ENROLLMENTS = [
  { masterStudentId: 'M1', permanentStudentId: 'OSAAH/2026/0001', profileId: 'P1', gender: 'Male', admissionDate: '2026-09-01', classId: 'class-primary-1', academicYearId: 'AY-2026', academicYearName: '2026/2027', termId: 'TERM-2026-1', termName: '1st Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-09-01', completedAt: null, isTestRecord: 0 },
  { masterStudentId: 'M2', permanentStudentId: 'OSAAH/2026/0002', profileId: 'P2', gender: 'Female', admissionDate: '2026-09-01', classId: 'class-primary-1', academicYearId: 'AY-2026', academicYearName: '2026/2027', termId: 'TERM-2026-1', termName: '1st Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-09-01', completedAt: null, isTestRecord: 0 },
  { masterStudentId: 'M3', permanentStudentId: 'OSAAH/2026/0003', profileId: 'P3', gender: 'NOT_SPECIFIED', admissionDate: '2026-09-01', classId: 'class-primary-1', academicYearId: 'AY-2026', academicYearName: '2026/2027', termId: 'TERM-2026-1', termName: '1st Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-09-01', completedAt: null, isTestRecord: 0 },
  { masterStudentId: 'M4', permanentStudentId: 'OSAAH/2024/0004', profileId: 'P4', gender: 'Male', admissionDate: '2024-09-01', classId: 'class-primary-3', academicYearId: 'AY-2025', academicYearName: '2025/2026', termId: 'TERM-2025-3', termName: '3rd Term', termStartsOn: '2026-04-01', termEndsOn: '2026-07-31', enrollmentStatus: 'PROMOTED', isCurrent: 0, enrolledAt: '2026-04-01', completedAt: '2026-07-31', isTestRecord: 0 },
  { masterStudentId: 'M4', permanentStudentId: 'OSAAH/2024/0004', profileId: 'P4', gender: 'Male', admissionDate: '2024-09-01', classId: 'class-primary-4', academicYearId: 'AY-2026', academicYearName: '2026/2027', termId: 'TERM-2026-1', termName: '1st Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-09-01', completedAt: null, isTestRecord: 0 },
  { masterStudentId: 'M5', permanentStudentId: 'OSAAH/2025/0005', profileId: 'P5', gender: 'Female', admissionDate: '2025-09-01', classId: 'class-primary-3', academicYearId: 'AY-2025', academicYearName: '2025/2026', termId: 'TERM-2025-1', termName: '1st Term', termStartsOn: '2025-09-01', termEndsOn: '2025-12-20', enrollmentStatus: 'TRANSFERRED', isCurrent: 0, enrolledAt: '2025-09-01', completedAt: '2025-12-19', isTestRecord: 0 },
  { masterStudentId: 'M5', permanentStudentId: 'OSAAH/2025/0005', profileId: 'P5', gender: 'Female', admissionDate: '2025-09-01', classId: 'class-primary-4', academicYearId: 'AY-2025', academicYearName: '2025/2026', termId: 'TERM-2025-2', termName: '2nd Term', termStartsOn: '2026-01-05', termEndsOn: '2026-03-31', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-01-05', completedAt: null, isTestRecord: 0 },
  { masterStudentId: 'MD', permanentStudentId: 'OSAAH/DEMO/001', profileId: 'PD', gender: 'Female', admissionDate: '2026-09-01', classId: 'class-primary-1', academicYearId: 'AY-2026', academicYearName: '2026/2027', termId: 'TERM-2026-1', termName: '1st Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20', enrollmentStatus: 'ACTIVE', isCurrent: 1, enrolledAt: '2026-09-01', completedAt: null, isTestRecord: 1 }
];
const MARKS = [
  { id: 'old-correction', profileId: 'P1', date: '2026-09-21', classId: 'class-primary-1', status: 'ABSENT', version: 1, updatedAt: '2026-09-21T08:01:00Z', subjectKey: 'daily' },
  { id: 'corrected-present', profileId: 'P1', date: '2026-09-21', classId: 'class-primary-1', status: 'PRESENT', version: 2, updatedAt: '2026-09-21T08:15:00Z', subjectKey: 'daily' },
  { id: 'older-higher-version', profileId: 'P1', date: '2026-09-22', classId: 'class-primary-1', status: 'ABSENT', version: 3, updatedAt: '2026-09-22T08:05:00Z', subjectKey: 'daily' },
  { id: 'newer-lower-version', profileId: 'P1', date: '2026-09-22', classId: 'class-primary-1', status: 'PRESENT', version: 2, updatedAt: '2026-09-22T08:20:00Z', subjectKey: 'daily' },
  { id: 'girl-absent-mon', profileId: 'P2', date: '2026-09-21', classId: 'class-primary-1', status: 'ABSENT', version: 1, updatedAt: '2026-09-21T08:10:00Z', subjectKey: 'daily' },
  { id: 'girl-absent-tue', profileId: 'P2', date: '2026-09-22', classId: 'class-primary-1', status: 'UNEXCUSED_ABSENCE', version: 1, updatedAt: '2026-09-22T08:10:00Z', subjectKey: 'daily' },
  { id: 'other-present-mon', profileId: 'P3', date: '2026-09-21', classId: 'class-primary-1', status: 'PRESENT', version: 1, updatedAt: '2026-09-21T08:10:00Z', subjectKey: 'daily' },
  { id: 'other-present-tue', profileId: 'P3', date: '2026-09-22', classId: 'class-primary-1', status: 'LATE', version: 1, updatedAt: '2026-09-22T08:10:00Z', subjectKey: 'daily' },
  { id: 'other-absent-fri', profileId: 'P3', date: '2026-09-25', classId: 'class-primary-1', status: 'ABSENT', version: 1, updatedAt: '2026-09-25T08:10:00Z', subjectKey: 'daily' },
  { id: 'excused-fri', profileId: 'P1', date: '2026-09-25', classId: 'class-primary-1', status: 'EXCUSED_ABSENCE', version: 1, updatedAt: '2026-09-25T08:10:00Z', subjectKey: 'daily' },
  { id: 'early-departure', profileId: 'P4', date: '2026-09-25', classId: 'class-primary-4', status: 'EARLY_DEPARTURE', version: 1, updatedAt: '2026-09-25T08:10:00Z', subjectKey: 'daily' },
  { id: 'subject-mark', profileId: 'P2', date: '2026-09-25', classId: 'class-primary-1', status: 'PRESENT', version: 1, updatedAt: '2026-09-25T08:10:00Z', subjectKey: 'mathematics' },
  { id: 'sample-mark', profileId: 'PD', date: '2026-09-21', classId: 'class-primary-1', status: 'PRESENT', version: 1, updatedAt: '2026-09-21T09:00:00Z', subjectKey: 'daily' },
  { id: 'historical-mark', profileId: 'P4', date: '2026-06-01', classId: 'class-primary-3', status: 'PRESENT', version: 1, updatedAt: '2026-06-01T08:00:00Z', subjectKey: 'daily' },
  { id: 'transfer-before', profileId: 'P5', date: '2025-11-03', classId: 'class-primary-3', status: 'PRESENT', version: 1, updatedAt: '2025-11-03T08:00:00Z', subjectKey: 'daily' },
  { id: 'transfer-after', profileId: 'P5', date: '2026-01-05', classId: 'class-primary-4', status: 'PRESENT', version: 1, updatedAt: '2026-01-05T08:00:00Z', subjectKey: 'daily' }
];
const CALENDAR = [
  { startDate: '2026-09-23', endDate: '2026-09-23', category: 'PUBLIC_HOLIDAY', title: 'Public Holiday', classScopeJson: '[]', status: 'PUBLISHED' },
  { startDate: '2026-09-24', endDate: '2026-09-24', category: 'Closing/Vacation', title: 'Primary 1 closure', classScopeJson: '["Primary 1"]', status: 'PUBLISHED' },
  { startDate: '2026-09-22', endDate: '2026-09-22', category: 'SCHOOL_CLOSURE', title: 'Unpublished closure', classScopeJson: '[]', status: 'DRAFT' }
];
function makeDatabase(overrides = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM academic_years WHERE school_id=\?/i.test(sql)) return YEARS;
      if (/FROM terms t JOIN academic_years/i.test(sql)) return TERMS;
      if (/FROM classes c WHERE c\.school_id=\?/i.test(sql)) return CLASSES;
      if (/FROM student_enrollments e/i.test(sql)) {
        let result = ENROLLMENTS;
        if (sql.includes('e.academic_year_id=?')) result = result.filter((row) => row.academicYearId === params[5]);
        if (sql.includes('e.term_id IS NULL OR e.term_id=?')) result = result.filter((row) => row.termId == null || row.termId === params.at(-2) || row.termId === params.at(-1));
        return result;
      }
      if (/FROM student_attendance WHERE/i.test(sql)) return MARKS.filter((row) => row.date >= params[1] && row.date <= params[2] && (row.subjectKey ?? 'daily') === 'daily');
      if (/FROM academic_calendar_events/i.test(sql)) return CALENDAR.filter((row) => row.status === 'PUBLISHED');
      return overrides.defaultRows ?? [];
    }
  };
}
function createService(database = makeDatabase()) {
  return createStudentAttendanceOverviewService({ database, schoolId: SCHOOL, now: () => '2026-09-25T12:00:00Z' });
}

const byClass = (report, name) => report.classes.find((row) => row.className === name);

test('returns all 13 canonical classes in school order plus an overall total row', async () => {
  const database = makeDatabase();
  const report = await createService(database).overview({ academicYear: 'AY-2026', week: '2026-W39', asOfDate: '2026-09-25' }, STAFF);
  assert.deepEqual(report.classes.slice(0, 13).map((row) => row.className), ['Nursery 1','Nursery 2','KG 1','KG 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JHS 1','JHS 2','JHS 3']);
  assert.equal(report.classes.length, 14);
  assert.equal(report.classes.at(-1).className, 'Overall Totals');
  assert.deepEqual(report.classes.at(-1).totalPresent, report.summary.presentStudentDays);
  assert.equal(database.queries.length, 6, 'overview uses a bounded set of batched queries, not per-student queries');
  assert.deepEqual(report.source, 'student_attendance + student_enrollments');
  assert.equal(report.authoritative, true);
});

test('aggregates unique eligible student-days, corrected marks, unspecified gender, excused absence, and unmarked days', async () => {
  const report = await createService().overview({ academicYear: 'AY-2026', term: 'TERM-2026-1', week: '2026-W39', asOfDate: '2026-09-25' }, STAFF);
  const p1 = byClass(report, 'Primary 1');
  assert.equal(p1.totalBoysEnrolled, 1);
  assert.equal(p1.totalGirlsEnrolled, 1);
  assert.equal(p1.totalUnspecifiedGenderEnrolled, 1);
  assert.equal(p1.boysPresent, 1, 'the corrected mark is effective; the stale duplicate absent mark is ignored');
  assert.equal(p1.girlsPresent, 0);
  assert.equal(p1.girlsAbsent, 2);
  assert.equal(p1.unspecifiedGenderPresent, 2);
  assert.equal(p1.unspecifiedGenderAbsent, 1);
  assert.equal(p1.totalPresent, 3, 'unspecified-gender presence stays in the overall total');
  assert.equal(p1.totalAbsent, 4, 'unspecified-gender and version-corrected absence stay in the overall total');
  assert.equal(p1.boysAbsent, 1, 'higher attendance correction version wins even if its timestamp is older');
  assert.equal(p1.eligibleStudentDays, 8, 'weekend, public holiday, class-scoped closure and excused days are excluded from eligible days');
  assert.equal(p1.scheduledStudentDays, 9);
  assert.equal(p1.excusedStudentDays, 1);
  assert.equal(p1.unmarkedStudentDays, 1);
  assert.equal(p1.attendancePercentage, 37.5);
  assert.equal(report.summary.totalEnrolledStudents, 4);
  assert.equal(report.summary.unspecifiedGenderEnrolled, 1);
  assert.equal(report.summary.otherMarkedStudentDays, 1, 'valid non-present/absent statuses stay distinct from unmarked days');
  assert.equal(report.summary.unmarkedStudentDays, 4, 'includes eligible but unmarked days; early departure is separately marked');
  assert.equal(report.summary.attendancePercentage, 25);
});

test('resolves old attendance to historical enrollment rather than the student’s promoted class', async () => {
  const report = await createService().overview({ academicYear: 'AY-2025', term: 'TERM-2025-3', month: '2026-06', asOfDate: '2026-06-30' }, STAFF);
  assert.equal(byClass(report, 'Primary 3').totalPresent, 1);
  assert.equal(byClass(report, 'Primary 4').totalPresent, 0);
  assert.equal(report.summary.totalEnrolledStudents, 1);
});

test('academic-year defaults are date-bounded and same-year transfers stay with their historical class', async () => {
  const annual = await createService().overview({ academicYear: 'AY-2026', asOfDate: '2026-09-25' }, STAFF);
  assert.equal(annual.filters.startDate, '2026-09-01');
  assert.equal(annual.filters.endDate, '2026-09-25');
  const transfer = await createService().overview({ academicYear: 'AY-2025', startDate: '2025-11-03', endDate: '2026-01-30', asOfDate: '2026-01-30' }, STAFF);
  assert.equal(byClass(transfer, 'Primary 3').totalPresent, 1);
  assert.equal(byClass(transfer, 'Primary 4').totalPresent, 1);
  assert.equal(transfer.summary.presentStudentDays, 2);
  assert.equal(transfer.summary.totalEnrolledStudents, 1, 'the transferred student is counted once in unique enrollment headcount');
});

test('validates week, month, custom range, date, gender, status, and academic scope on the server', async () => {
  const service = createService();
  await assert.rejects(() => service.overview({ week: '2026-W54' }, STAFF), /Week must use ISO/);
  await assert.rejects(() => service.overview({ month: '2026-13' }, STAFF), /Month/);
  await assert.rejects(() => service.overview({ startDate: '2026-09-20' }, STAFF), /both startDate and endDate/);
  await assert.rejects(() => service.overview({ startDate: '2026-09-30', endDate: '2026-09-20' }, STAFF), /on or before/);
  await assert.rejects(() => service.overview({ week: '2026-W39', month: '2026-09' }, STAFF), /only one/);
  await assert.rejects(() => service.overview({ asOfDate: '2026-02-30' }, STAFF), /real calendar date/);
  await assert.rejects(() => service.overview({ asOfDate: '2026-09-26' }, STAFF), /cannot be in the future/);
  await assert.rejects(() => service.overview({ gender: 'NONBINARY' }, STAFF), /Gender/);
  await assert.rejects(() => service.overview({ status: 'UNKNOWN' }, STAFF), /status/);
  await assert.rejects(() => service.overview({ academicYear: '1900/1901' }, STAFF), /Academic year/);
  await assert.rejects(() => service.overview({ academicYear: 'AY-2026', term: 'TERM-2025-3' }, STAFF), /Term is not available/);
});

test('supports month, gender, class and status filters; as-of date caps the selected range', async () => {
  const service = createService();
  const report = await service.overview({ academicYear: 'AY-2026', month: '2026-09', asOfDate: '2026-09-22', gender: 'BOYS', classId: 'class-primary-1', status: 'PRESENT' }, STAFF);
  assert.equal(report.filters.startDate, '2026-09-01');
  assert.equal(report.filters.endDate, '2026-09-22');
  assert.equal(report.classes.filter((row) => row.className !== 'Overall Totals').length, 1);
  assert.equal(report.classes[0].className, 'Primary 1');
  assert.equal(report.classes[0].totalBoysEnrolled, 1);
  assert.equal(report.classes[0].totalGirlsEnrolled, 0);
  assert.equal(report.classes[0].boysPresent, 1);
  assert.equal(report.classes[0].totalAbsent, 0, 'status filter limits marks included in status-specific totals');
});

test('excludes test identities and non-daily subject marks in SQL and output', async () => {
  const database = makeDatabase();
  const report = await createService(database).overview({ academicYear: 'AY-2026', week: '2026-W39', asOfDate: '2026-09-25' }, STAFF);
  assert.equal(report.summary.totalEnrolledStudents, 4);
  assert.equal(report.summary.presentStudentDays, 3);
  const enrollmentQuery = database.queries.find((item) => /FROM student_enrollments e/i.test(item.sql));
  const markQuery = database.queries.find((item) => /FROM student_attendance WHERE/i.test(item.sql));
  assert.match(enrollmentQuery.sql, /is_test_record/);
  assert.match(enrollmentQuery.sql, /CASE WHEN UPPER\(TRIM\(COALESCE\(s\.gender/);
  assert.match(enrollmentQuery.sql, /permanent_student_id/);
  assert.match(markQuery.sql, /subject_key/);
  assert.ok(database.queries.every(({ params }) => Array.isArray(params)));
});

test('enforces attendance permission, tenant scope, and assigned-class restrictions before returning data', async () => {
  const service = createService();
  await assert.rejects(() => service.overview({}, { ...STAFF, permissions: new Set() }), (error) => error.status === 403);
  await assert.rejects(() => service.overview({}, { ...STAFF, schoolId: 'other-school' }), (error) => error.status === 403);
  await assert.rejects(() => service.overview({}, { ...STAFF, roleKey: 'TEACHER', assignedClassIds: [], permissions: new Set(['attendance.read']) }), (error) => error.status === 403);
  const teacher = { ...STAFF, roleKey: 'TEACHER', assignedClassIds: ['class-primary-1'] };
  const own = await service.overview({}, teacher);
  assert.equal(own.classes.filter((row) => row.className !== 'Overall Totals').length, 1);
  assert.equal(own.classes[0].className, 'Primary 1');
  await assert.rejects(() => service.overview({ classId: 'class-primary-4' }, teacher), (error) => error.status === 403);
  await assert.rejects(() => service.overview({}, { ...STAFF, portal: 'parent' }), (error) => error.status === 403);
});

test('fails closed if published calendar data is unavailable rather than guessing eligible days', async () => {
  const database = makeDatabase();
  const query = database.query.bind(database);
  database.query = async (sql, params = []) => {
    if (/FROM academic_calendar_events/i.test(sql)) throw new Error('no such table: academic_calendar_events');
    return query(sql, params);
  };
  await assert.rejects(() => createService(database).overview({ academicYear: 'AY-2026', week: '2026-W39' }, STAFF), (error) => error.status === 503 && error.code === 'ACADEMIC_CALENDAR_UNAVAILABLE');
});

test('falls back to the school-scoped class catalogue when optional sort/status columns are absent', async () => {
  const database = makeDatabase();
  const query = database.query.bind(database);
  database.query = async (sql, params = []) => {
    if (/FROM classes c WHERE c\.school_id=\?/i.test(sql) && /sort_order|status/.test(sql)) throw new Error("Unknown column 'c.sort_order'");
    return query(sql, params);
  };
  const report = await createService(database).overview({ academicYear: 'AY-2026', week: '2026-W39' }, STAFF);
  assert.equal(report.classes.filter((row) => row.className !== 'Overall Totals').length, 13);
});

test('bounds custom reporting windows and keeps missing registers distinct from confirmed absence', async () => {
  const service = createService();
  await assert.rejects(() => service.overview({ startDate: '2025-01-01', endDate: '2026-09-25', asOfDate: '2026-09-25' }, STAFF), /cannot exceed 366 days/);
  const report = await service.overview({ academicYear: 'AY-2026', term: 'TERM-2026-1', startDate: '2026-09-21', endDate: '2026-09-25', asOfDate: '2026-09-25' }, STAFF);
  assert.equal(report.classes.at(-1).unmarkedStudentDays, 4);
  assert.equal(byClass(report, 'Primary 4').unmarkedStudentDays, 3);
  assert.equal(byClass(report, 'Primary 4').totalAbsent, 0, 'missing Primary 4 register days remain unmarked, not confirmed absences');
  assert.equal(report.calculationPolicy.unmarkedIsNotAbsent, true);
});
