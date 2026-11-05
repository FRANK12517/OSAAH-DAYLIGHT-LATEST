import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createStudentService } from '../src/students.js';

const schoolId = 'sch_default_01';
const manager = { id: 'manager-1', schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['subjects.manage', 'subjects.read', 'marks.write', 'academics.read']) };

function fakeDatabase() {
  const assignments = [];
  const calls = [];
  return {
    assignments,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-07-31', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM classes c JOIN levels')) return [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'LOWER_PRIMARY' }];
      if (sql.includes('FROM subjects WHERE')) return [{ id: 'subject-math', name: 'Mathematics' }];
      if (sql.includes('SELECT c.id,c.name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) {
        const classId = params[1];
        const academicYearId = params[2];
        return assignments.filter((item) => item.classId === classId && (!item.academicYearId || item.academicYearId === academicYearId));
      }
      if (sql.includes('FROM subject_class_assignments') && sql.includes('JOIN subjects')) {
        return assignments.filter((item) => (!params[1] || item.subjectId === params[1]) && (!params[2] || item.classId === params[2]));
      }
      if (sql.includes('SELECT id,active FROM subject_class_assignments')) {
        return assignments.filter((item) => item.subjectId === params[1] && item.classId === params[2] && item.academicYearId === params[3]);
      }
      return [];
    },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO subject_class_assignments')) {
        assignments.push({ id: params[0], schoolId: params[1], subjectId: params[2], classId: params[3], academicYearId: params[4], active: 1 });
        return { affectedRows: 1 };
      }
      return { affectedRows: 1 };
    }
  };
}

test('production durable academic service requires a database adapter', () => {
  assert.throws(() => createDurableAcademicService({ schoolId }), /database is unavailable/i);
});

test('empty durable mappings return no subjects rather than every subject', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'assignment-1' });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1', academicYearId: 'year-2026' }, manager), []);
});

test('authorized subject assignment is tenant-scoped and idempotent', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'assignment-1', clock: () => '2026-09-25T00:00:00.000Z' });
  const first = await service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1', academicYearId: 'year-2026' }, manager);
  const second = await service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1', academicYearId: 'year-2026' }, manager);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(database.assignments.length, 1);
  assert.equal((await service.listAssignments('subject-math', manager)).length, 1);
  assert.equal(database.calls.some(({ sql }) => sql.includes('UPDATE subjects SET is_active=TRUE')), false, 'a year-scoped assignment must not globally reactivate the subject record');
});

test('durable score validation rejects values outside CA and Exam limits', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(() => service.saveScore({ classId: 'class-basic-1', subjectId: 'subject-math', studentId: 'student-1', academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, manager), /CA score must be between 0 and 50/);
  await assert.rejects(() => service.saveScore({ classId: 'class-basic-1', subjectId: 'subject-math', studentId: 'student-1', academicYear: '2026/2027', term: 'First Term', caScore: 0, examScore: -1 }, manager), /Exam score must be between 0 and 50/);
});

test('durable Score Entry saves with the canonical class ID and rejects a student enrollment from another term', async () => {
  const database = fakeDatabase();
  const classId = 'class-jhs1-canonical';
  const subjectId = 'subject-english';
  const originalQuery = database.query.bind(database);
  const scoreWrites = [];
  database.assignments.push({ id: subjectId, code: 'ENG', name: 'English Language', classId, className: 'JHS 1', academicYearId: null, active: 1, assignmentActive: 1, subjectActive: 1, isScoring: 1 });
  database.query = async (sql, params = []) => {
    database.calls.push({ sql, params });
    if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
    if (sql.includes('FROM terms t JOIN academic_years')) {
      return [{ id: 'term-1', name: 'First Term' }, { id: 'term-2', name: 'Second Term' }]
        .filter((term) => term.id === params[2] || term.name === params[3]);
    }
    if (sql.includes('SELECT id,name FROM classes WHERE school_id=? AND id=?')) {
      return params[1] === classId ? [{ id: classId, name: 'JHS 1' }] : [];
    }
    if (sql.includes('FROM student_enrollments e JOIN students s') && sql.includes('e.term_id=?')) {
      const [tenantId, studentId, enrolledClassId, yearId, termId] = params;
      return tenantId === schoolId && studentId === 'student-1' && enrolledClassId === classId && yearId === 'year-2026' && termId === 'term-1'
        ? [{ student_id: studentId, permanent_student_id: 'OSAAH/2026/0001', className: 'JHS 1' }]
        : [];
    }
    if (sql.includes('SELECT id FROM academic_score_records')) return [];
    if (sql.includes('SELECT id FROM student_profiles')) return [{ id: 'profile-1' }];
    return originalQuery(sql, params);
  };
  const originalExecute = database.execute.bind(database);
  database.execute = async (sql, params = []) => {
    if (sql.startsWith('INSERT INTO academic_score_records')) scoreWrites.push({ sql, params });
    return originalExecute(sql, params);
  };
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'score-1' });
  const teacher = { ...manager, roleKey: 'TEACHER', assignedClassIds: [classId], assignedSubjectIds: [subjectId] };
  const selected = { studentId: 'student-1', classId, subjectId, academicYear: '2026/2027', term: 'First Term', caScore: 42, examScore: 38 };

  const saved = await service.saveScore(selected, teacher);
  assert.equal(saved.classId, classId);
  assert.equal(saved.totalScore, 80);
  assert.equal(scoreWrites.length, 1);
  const enrollmentRead = database.calls.find(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s') && sql.includes('e.term_id=?'));
  assert.deepEqual(enrollmentRead.params, [schoolId, 'student-1', classId, 'year-2026', 'term-1']);
  await assert.rejects(() => service.saveScore({ ...selected, term: 'Second Term' }, teacher), /selected class, academic year, and term/);
  assert.equal(scoreWrites.length, 1, 'an enrollment in a different term must not create another score');
});

test('durable Sample Mode accepts production year, term, class, and subject IDs and returns only the canonical demo student', async () => {
  const database = fakeDatabase();
  const originalQuery = database.query.bind(database);
  database.query = async (sql, params = []) => {
    if (sql.includes('FROM academic_years')) return [{ id: 'ay_2026_01', name: '2026/2027' }];
    if (sql.includes('FROM terms')) return [{ id: 'term_2026_01', academicYearId: 'ay_2026_01', name: '1st Term' }];
    if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class_bs4_01', name: 'Basic 4' }];
    return originalQuery(sql, params);
  };
  database.assignments.push({ id: 'subj_math', subjectId: 'subj_math', classId: 'class_bs4_01', className: 'Basic 4', academicYearId: null, assignmentActive: 1, subjectActive: 1, isScoring: 1, name: 'Mathematics', code: 'MATH', subjectType: 'CORE', configurationVersion: '1' });
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  const service = createDurableAcademicService({ database, schoolId, students });
  const teacher = { ...manager, roleKey: 'TEACHER', assignedClassIds: ['class_bs4_01'], assignedSubjectIds: ['subj_math'] };

  const context = { academicYearId: 'ay_2026_01', termId: 'term_2026_01', classId: 'class_bs4_01', subjectId: 'subj_math' };
  const sampleRoster = await service.sampleScoreEntryRoster(context, teacher);
  assert.equal(sampleRoster.length, 1);
  assert.equal(sampleRoster[0].permanentStudentId, 'OSAAH/DEMO/001');
  assert.equal(sampleRoster[0].isTestRecord, true);
  assert.equal(sampleRoster[0].classId, 'class_bs4_01');
  assert.equal(sampleRoster[0].saved, false);
  await assert.rejects(() => service.sampleScoreEntryRoster({ ...context, subjectId: 'unassigned-subject' }, teacher), /Subject is invalid for this class and academic context/);
  await assert.rejects(() => service.sampleScoreEntryRoster(context, { ...teacher, assignedClassIds: ['another-class'] }), /outside your assignment/);
});

test('cross-school durable academic access is rejected', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(() => service.options({ ...manager, schoolId: 'sch_other_02' }), /Forbidden/);
  await assert.rejects(() => service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1' }, { ...manager, schoolId: 'sch_other_02' }), /Forbidden/);
});

test('Score Entry options use the authoritative production classes table without requiring levels.level_id', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term', isCurrent: 1 }];
      if (sql.includes('FROM classes c WHERE c.school_id')) return [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'PRIMARY' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.options(manager);
  assert.deepEqual(result.classes, [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'PRIMARY' }]);
  assert.equal(calls.some(({ sql }) => sql.includes('JOIN levels')), false);
});

test('Score Entry options survive production class tables without optional ordering metadata', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('c.sort_order')) throw new Error("Unknown column 'c.sort_order' in 'field list'");
      if (sql.includes('SELECT c.id,c.name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.options(manager);
  assert.deepEqual(result.classes, [{ id: 'class-basic-1', name: 'Basic 1' }]);
  assert.equal(calls.some((sql) => sql.includes('c.level_id')), false);
});

test('Teacher academic scope requires class and subject assignments while class catalog remains browseable', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  const teacher = { ...manager, roleKey: 'TEACHER', permissions: new Set(['results.read', 'marks.write']), assignedClassIds: [], assignedSubjectIds: [] };
  assert.equal((await service.options(teacher)).classes.length, 0, 'fake database has no configured class rows');
  await assert.rejects(() => service.subjectCascade({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, teacher), (error) => error.status === 403);
  await assert.rejects(() => service.saveScore({ classId: 'class-basic-1', subjectId: 'subject-math', studentId: 'student-1', academicYear: '2026/2027', term: 'First Term', caScore: 20, examScore: 20 }, teacher), (error) => error.status === 403);
});

test('year-scoped subject configuration prefers a year override, displays inactive assignments and excludes other years', async () => {
  const assignments = [
    { assignmentId: 'global-english', id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: null, assignmentActive: 1 },
    { assignmentId: 'year-english', id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: 'year-2026', assignmentActive: 0 },
    { assignmentId: 'other-year-math', id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: 'year-2027', assignmentActive: 1 }
  ];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-primary-1', name: 'Primary 1' }];
      if (sql.includes('FROM subjects WHERE school_id=? ORDER BY name,id')) return [
        { id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' },
        { id: 'subject-history', code: 'HIST', name: 'History', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' },
        { id: 'subject-jhs-only', code: 'CAREER', name: 'Career Technology', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' }
      ];
      if (sql.includes('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className')) return [];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return assignments.filter((row) => row.classId === params[1] && (row.academicYearId == null || row.academicYearId === params[2]));
      if (sql.includes('FROM subject_class_assignments WHERE school_id=? AND class_id=?')) return assignments.filter((row) => row.classId === params[1]).map((row) => ({ id: row.id }));
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.subjectConfiguration(manager, { academicYearId: 'year-2026', classId: 'class-primary-1' });
  assert.equal(result.academicYear, '2026/2027');
  assert.equal(result.className, 'Primary 1');
  assert.deepEqual(result.subjects.map((subject) => subject.name), ['English Language', 'History']);
  assert.equal(result.subjects[0].active, false, 'the selected year override wins over the active school default');
  assert.equal(result.subjects[0].mandatory, true);
  assert.equal(result.subjects[0].subjectType, 'CORE');
  const history = result.subjects.find((subject) => subject.id === 'subject-history');
  assert.equal(history.assigned, false);
  assert.equal(history.active, false);
  assert.equal(history.subjectType, 'CORE');
  assert.equal(result.subjects.some((subject) => subject.name === 'Career Technology'), false, 'subjects from a different class band are not offered here');
  await assert.rejects(() => service.subjectConfiguration({ ...manager, schoolId: 'sch_other_02' }, { academicYearId: 'year-2026', classId: 'class-primary-1' }), /Forbidden/);
});

test('legacy class_subjects mapping remains an authoritative subject source when normalized assignments are unavailable', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('subject_class_assignments')) throw new Error("Table 'subject_class_assignments' doesn't exist");
      if (sql.includes('class_subjects')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1' }, manager), [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1', active: true, subjectActive: true }]);
});

test('legacy class_subjects mapping is used when normalized assignments exist but contain no active rows', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('subject_class_assignments')) return [];
      if (sql.includes('class_subjects')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1', academicYearId: 'year-2026' }, manager), [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, classId: 'class-basic-1', active: true, subjectActive: true }]);
});

test('absent legacy class_subjects mapping returns an empty subject collection instead of a schema-unavailable error', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM subjects WHERE school_id')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' }];
      if (sql.includes('subject_class_assignments')) return [];
      if (sql.includes('class_subjects')) throw Object.assign(new Error("Table 'osaahdaylightschool.class_subjects' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1' }, manager), []);
  assert.equal(calls.filter((sql) => sql.includes('class_subjects')).length, 1);
});

test('unexpected legacy subject database errors remain diagnosable', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM subjects WHERE school_id')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' }];
      if (sql.includes('subject_class_assignments')) return [];
      if (sql.includes('class_subjects')) throw Object.assign(new Error('Too many connections'), { code: 'ER_CON_COUNT_ERROR' });
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(() => service.listSubjects({ classId: 'class-basic-1' }, manager), /Too many connections/);
});

test('inactive normalized assignments do not leak back through legacy class_subjects rows', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('subject_class_assignments')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1', assignmentActive: 0 }];
      if (sql.includes('class_subjects')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1' }, manager), []);
});

test('Result Slip roster falls back when production enrollment status columns are absent', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        if (sql.includes('enrollment_status') || sql.includes('is_current')) throw new Error("Unknown column 'e.enrollment_status' in 'where clause'");
        return [
          { studentId: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', classId: 'class-basic-1' },
          { studentId: 'student-2', permanentStudentId: 'OSAAH-2026-002', firstName: 'Kojo', middleName: null, surname: 'Learner', classId: 'class-basic-1' }
        ];
      }
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const actor = { ...manager, permissions: new Set(['results.read']) };
  const roster = await service.resultStudents({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.deepEqual(roster.map((student) => student.id), ['student-1', 'student-2']);
  const enrollmentQueries = calls.filter(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s'));
  assert.equal(enrollmentQueries.length, 2);
  assert.match(enrollmentQueries[0].sql, /enrollment_status/);
  assert.doesNotMatch(enrollmentQueries[1].sql, /enrollment_status|is_current/);
  assert.match(enrollmentQueries[1].sql, /SELECT DISTINCT/);
});

test('Result-student roster retries legacy enrollment and student columns without exposing reserved sample IDs', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-jhs-1', name: 'JHS 1' }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        if (sql.includes('enrollment_status') || sql.includes('is_current')) throw new Error("Unknown column 'e.enrollment_status' in 'where clause'");
        if (sql.includes('is_test_record')) throw new Error("Unknown column 's.is_test_record' in 'where clause'");
        if (sql.includes('student_status')) throw new Error("Unknown column 's.student_status' in 'where clause'");
        return [{ studentId: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', classId: 'class-jhs-1' }];
      }
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const actor = { ...manager, permissions: new Set(['results.read']) };
  const roster = await service.resultStudents({ classId: 'class-jhs-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.deepEqual(roster.map((student) => student.permanentStudentId), ['OSAAH-2026-001']);
  const attempts = calls.filter((sql) => sql.includes('FROM student_enrollments e JOIN students s'));
  assert.equal(attempts.length, 4);
  assert.match(attempts[0], /enrollment_status/);
  assert.doesNotMatch(attempts[1], /enrollment_status|is_current/);
  assert.match(attempts[2], /permanent_student_id NOT LIKE 'OSAAH-DEMO-%'/);
  assert.match(attempts[2], /permanent_student_id NOT LIKE 'OSAAH\/DEMO\/%'/);
  assert.doesNotMatch(attempts[3], /student_status/);
  assert.match(attempts[3], /permanent_student_id NOT LIKE 'OSAAH-DEMO-%'/);
  assert.match(attempts[3], /permanent_student_id NOT LIKE 'OSAAH\/DEMO\/%'/);
});

test('Score Entry roster falls back when production enrollment status columns are absent', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: null, assignmentActive: 1 }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        if (sql.includes('enrollment_status') || sql.includes('is_current')) throw new Error("Unknown column 'e.enrollment_status' in 'where clause'");
        return [{ studentId: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', classId: 'class-basic-1' }];
      }
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const roster = await service.roster({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, manager);
  assert.deepEqual(roster.map((student) => student.studentId), ['student-1']);
  const enrollmentQueries = calls.filter(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s'));
  assert.equal(enrollmentQueries.length, 2);
  assert.match(enrollmentQueries[0].sql, /enrollment_status/);
  assert.doesNotMatch(enrollmentQueries[1].sql, /enrollment_status|is_current/);
  assert.match(enrollmentQueries[1].sql, /s\.school_id=\?/);
  assert.match(enrollmentQueries[1].sql, /s\.is_test_record IS NOT TRUE/);
});

test('Score Entry roster falls back to permanent-ID sample exclusion when students.is_test_record is absent', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: null, assignmentActive: 1 }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        if (sql.includes('is_test_record')) throw new Error("Unknown column 's.is_test_record' in 'where clause'");
        return [{ studentId: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', classId: 'class-basic-1' }];
      }
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const roster = await service.roster({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, manager);
  assert.deepEqual(roster.map((student) => student.permanentStudentId), ['OSAAH-2026-001']);
  const rosterQueries = calls.filter(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s'));
  assert.equal(rosterQueries.length, 2);
  assert.match(rosterQueries[0].sql, /s\.is_test_record IS NOT TRUE/);
  assert.match(rosterQueries[1].sql, /s\.permanent_student_id NOT LIKE 'OSAAH-DEMO-%'/);
  assert.match(rosterQueries[1].sql, /s\.permanent_student_id NOT LIKE 'OSAAH\/DEMO\/%'/);
  assert.doesNotMatch(rosterQueries[1].sql, /is_test_record/);
});

test('Score Entry roster does not retry for an unrelated missing database column', async () => {
  const calls = [];
  const unrelatedColumnError = new Error("Unknown column 's.student_status' in 'where clause'");
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: null, assignmentActive: 1 }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) throw unrelatedColumnError;
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(
    () => service.roster({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, manager),
    (error) => error === unrelatedColumnError
  );
  assert.equal(calls.filter(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s')).length, 1);
});

test('Result Slip retrieves durable saved scores after enrollment-flag compatibility fallback', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM students s JOIN student_enrollments e')) {
        if (sql.includes('enrollment_status') || sql.includes('is_current')) throw new Error("Unknown column 'e.is_current' in 'where clause'");
        return [{ id: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', gender: 'FEMALE', classId: 'class-basic-1' }];
      }
      if (sql.includes('FROM academic_score_records r')) return [{ subjectId: 'subject-math', subjectName: 'Mathematics', caScore: 44, examScore: 48, totalScore: 92, updatedAt: '2026-10-01T00:00:00.000Z' }];
      if (sql.includes('FROM academic_result_records')) return [];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const actor = { ...manager, permissions: new Set(['results.read']) };
  const result = await service.result({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(result.studentIndexNumber, 'OSAAH-2026-001');
  assert.equal(result.isSample, false);
  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects[0].totalScore, 92);
  assert.ok(calls.some(({ sql }) => sql.includes('FROM academic_score_records r')));
  assert.ok(calls.some(({ sql }) => sql.includes('FROM academic_result_records')));
  assert.equal(calls.filter(({ sql }) => sql.includes('FROM students s JOIN student_enrollments e')).length, 2);
});

test('durable terminal Broadsheet reads persisted scores, excludes demo IDs, and enforces teacher subject assignments', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: null, assignmentActive: 1 }];
      if (sql.includes('FROM students s JOIN student_enrollments e')) return [{ studentId: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner' }];
      if (sql.includes('FROM academic_score_records r JOIN student_profiles sp')) return [{ profileId: 'profile-1', studentId: 'student-1', totalScore: 92, caScore: 44, examScore: 48, subjectId: 'subject-math', subjectName: 'Mathematics' }];
      if (sql.includes('FROM academic_score_records r') && sql.includes('JOIN subjects sub')) return [{ subjectId: 'subject-math', subjectName: 'Mathematics', caScore: 44, examScore: 48, totalScore: 92 }];
      if (sql.includes('FROM academic_result_records')) return [];
      return [];
    },
    async execute() { return { affectedRows: 0 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const teacher = { ...manager, roleKey: 'TEACHER', permissions: new Set(['results.read']), assignedClassIds: ['class-basic-1'], assignedSubjectIds: ['subject-math'] };
  const report = await service.broadsheet({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, teacher);
  assert.equal(report.length, 1);
  assert.equal(report[0].permanentStudentId, 'OSAAH-2026-001');
  assert.equal(report[0].subjectTotals.Mathematics, 92);
  assert.equal(report[0].subjectCas.Mathematics, 44);
  assert.equal(report[0].subjectExams.Mathematics, 48);
  assert.equal(report[0].isSample, false);
  assert.ok(calls.some(({ sql }) => sql.includes('permanent_student_id NOT LIKE')));
  await assert.rejects(() => service.broadsheet({ classId: 'class-other', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, teacher), (error) => error.status === 403);
  await assert.rejects(() => service.broadsheet({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, { ...teacher, assignedSubjectIds: [] }), (error) => error.status === 403);
  await assert.rejects(() => service.broadsheet({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, { ...teacher, assignedSubjectIds: ['subject-other'] }), (error) => error.status === 403);
  await assert.rejects(() => service.broadsheet({ classId: 'class-basic-1', subjectId: 'subject-other', academicYear: '2026/2027', term: 'First Term' }, { ...manager, permissions: new Set(['results.read']) }), (error) => error.code === 'CLASS_SUBJECT_MISMATCH');
});

test('Score Entry cascade excludes inactive subjects and inactive assignments', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return [
        { id: 'subject-active', code: 'ENG', name: 'English Language', subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: 'year-2026', assignmentActive: 1 },
        { id: 'subject-inactive', code: 'HIST', name: 'History', subjectType: 'ELECTIVE', isScoring: 1, subjectActive: 0, classId: 'class-basic-1', className: 'Basic 1', academicYearId: 'year-2026', assignmentActive: 1 },
        { id: 'subject-unassigned', code: 'SCI', name: 'Science', subjectType: 'ELECTIVE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: 'year-2026', assignmentActive: 0 }
      ];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const cascade = await service.subjectCascade({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, manager);
  assert.deepEqual(cascade.subjects.map((subject) => subject.id), ['subject-active']);
});

test('Score Entry durable roster rejects a subject not actively assigned to the selected class and year', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return [{
        id: 'subject-other-class', code: 'SCI', name: 'Science', subjectType: 'ELECTIVE', isScoring: 1, subjectActive: 1, classId: 'class-basic-1', className: 'Basic 1', academicYearId: 'year-2026', assignmentActive: 1
      }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(
    () => service.roster({ classId: 'class-basic-1', subjectId: 'subject-not-assigned', academicYear: '2026/2027', term: 'First Term' }, manager),
    (error) => error.message === 'Subject is invalid for this class and academic context.' && error.status === 400 && error.code === 'INVALID_CLASS_SUBJECT'
  );
});

test('Score Entry durable roster returns a valid empty collection with exact term scoping and official sample exclusion', async () => {
  const database = fakeDatabase();
  const originalQuery = database.query.bind(database);
  database.query = async (sql, params = []) => {
    database.calls.push({ sql, params });
    if (sql.includes('FROM subject_class_assignments a JOIN subjects s') && sql.includes('WHERE a.school_id=? AND a.class_id=?')) return [{ id: 'subject-math', name: 'Mathematics', classId: 'class-basic-1', className: 'Basic 1', academicYearId: 'year-2026', isScoring: 1, subjectActive: 1, assignmentActive: 1 }];
    if (sql.includes('FROM student_enrollments e JOIN students s') && sql.includes('academic_score_records')) return [];
    return originalQuery(sql, params);
  };
  const service = createDurableAcademicService({ database, schoolId });
  const roster = await service.roster({ classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, manager);
  assert.deepEqual(roster, [], 'zero eligible enrollment rows are a successful empty result');
  const rosterQuery = database.calls.find(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s') && sql.includes('academic_score_records'));
  assert.ok(rosterQuery);
  assert.match(rosterQuery.sql, /e\.term_id=\?/);
  assert.match(rosterQuery.sql, /s\.is_test_record IS NOT TRUE/);
  assert.equal(rosterQuery.params[6], 'term-1');
});


test('durable result roster accepts Mock-only access only for a JHS Mock context', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-jhs-1', name: 'JHS 1' }];
      if (sql.includes('FROM student_enrollments e JOIN students s')) return [{ studentId: 'student-jhs-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', classId: 'class-jhs-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const mockReader = { id: 'teacher-mock-reader', roleKey: 'TEACHER', schoolId, assignedClassIds: ['class-jhs-1'], permissions: new Set(['mock.results.read']) };
  await assert.rejects(
    () => service.resultStudents({ classId: 'class-jhs-1', academicYear: '2026/2027', term: 'First Term' }, mockReader),
    /Forbidden\./
  );
  const roster = await service.resultStudents({ classId: 'class-jhs-1', academicYear: '2026/2027', term: 'First Term', resultType: 'MOCK' }, mockReader);
  assert.deepEqual(roster.map((student) => student.permanentStudentId), ['OSAAH-2026-001']);
});
