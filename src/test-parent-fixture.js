import { normalizeGhanaPhone } from './ghana-phone.js';
import { isSampleStudentId, SAMPLE_STUDENT_IDS } from './sample-student-identities.js';

export const TEST_PARENT_PHONE = '+233247293733';
export const TEST_PARENT_STUDENT_IDS = SAMPLE_STUDENT_IDS;
export const TEST_PARENT_ID = 'user-test-parent-sample';
export const TEST_PARENT_SCHOOL_ID = 'school-osaah-daylight';

export function sampleFixturesEnabled(env = process.env) {
  if (env.OSAAH_ENABLE_SAMPLE_FIXTURES === 'false') return false;
  // Never seed synthetic school records or authenticate the built-in QA
  // Parent in a production runtime, even if a stale flag enables fixtures.
  if (String(env.NODE_ENV ?? '').toLowerCase() === 'production'
    || String(env.VERCEL_ENV ?? '').toLowerCase() === 'production') return false;
  return true;
}

export function seedSampleStudentsIfEnabled(students, schoolId) {
  if (!sampleFixturesEnabled() || typeof students?.listStudents !== 'function') return false;
  if (students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true }).some((student) => student.isTestRecord)) return false;
  students.seedSampleStudents?.();
  return true;
}

export function isConfiguredTestParentPhone(value) {
  return normalizeGhanaPhone(value) === TEST_PARENT_PHONE;
}

export function isConfiguredTestStudentId(value) {
  return isSampleStudentId(value);
}

export function isConfiguredTestParentActor(actor, schoolId = TEST_PARENT_SCHOOL_ID) {
  return actor?.id === TEST_PARENT_ID
    && actor?.portal === 'parent'
    && actor?.roleKey === 'PARENT'
    && actor?.schoolId === schoolId
    && sampleFixturesEnabled();
}

// This server-owned mapping is the complete authorization boundary for the
// controlled test parent. It is intentionally not copied into session data.
export function listConfiguredTestParentRelationships(parentUserId, schoolId = TEST_PARENT_SCHOOL_ID) {
  if (parentUserId !== TEST_PARENT_ID || !sampleFixturesEnabled()) return [];
  return TEST_PARENT_STUDENT_IDS.map((permanentStudentId) => ({
    parentUserId: TEST_PARENT_ID,
    schoolId,
    permanentStudentId,
    linkStatus: 'ACTIVE',
    isTestFixture: true
  }));
}

export function createConfiguredTestParent(schoolId = TEST_PARENT_SCHOOL_ID) {
  return {
    id: TEST_PARENT_ID,
    username: 'test-parent.sample@osaah.local',
    phone: TEST_PARENT_PHONE,
    telephone: TEST_PARENT_PHONE,
    portal: 'parent',
    roleKey: 'PARENT',
    schoolId,
    accountStatus: 'ACTIVE',
    is_active: true,
    isTestFixture: true,
    permissions: new Set(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read'])
  };
}
