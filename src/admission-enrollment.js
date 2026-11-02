import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { admissionYearFor } from './permanent-student-id.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId } from './student-classes.js';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function value(...items) { return items.find((item) => item !== undefined && item !== null && item !== '') ?? null; }
function json(valueToEncode) { return JSON.stringify(valueToEncode ?? {}); }
function rows(result) { return Array.isArray(result) ? result : []; }

/**
 * Durable database final step for the existing admission review workflow. The
 * application service remains responsible for validation and the decision;
 * this service atomically materializes the accepted application as a student.
 */
export function createAdmissionEnrollmentService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Enrollment persistence is unavailable.', 503);

  async function nextStudentId(tx) {
    const latest = rows(await tx.query("SELECT id FROM students WHERE id LIKE 'STD-%' ORDER BY id DESC LIMIT 1 FOR UPDATE"))[0]?.id;
    const sequence = /^STD-(\d+)$/.exec(String(latest ?? '')) ? Number(RegExp.$1) + 1 : 1;
    return `STD-${String(sequence).padStart(6, '0')}`;
  }

  async function nextPermanentStudentId(tx, yearInput, timestamp) {
    const year = admissionYearFor(yearInput);
    await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?)', insertParameters: [year, 1, timestamp], conflictSql: 'SELECT admission_year FROM student_id_sequences WHERE admission_year=?', conflictParameters: [year] });
    const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [year]))[0];
    let sequence = Number(sequenceRow?.next_sequence);
    if (!Number.isInteger(sequence) || sequence < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'Annual permanent Student ID sequence is invalid.', 409);
    // Reconcile stale counters against all IDs already allocated for this year,
    // including legacy four-digit IDs, before creating a new identity.
    const existingIds = rows(await tx.query('SELECT permanent_student_id FROM students WHERE permanent_student_id LIKE ? FOR UPDATE', [`OSAAH/${year}/%`]))
      .map((row) => String(row.permanent_student_id ?? ''));
    const profileIds = rows(await tx.query('SELECT student_id FROM student_profiles WHERE student_id LIKE ? FOR UPDATE', [`OSAAH/${year}/%`]))
      .map((row) => String(row.student_id ?? ''));
    const existingSequences = [...existingIds, ...profileIds].map((id) => {
      const match = new RegExp(`^OSAAH/${year}/(\\d+)$`).exec(id);
      if (!match) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this admission year need reconciliation before another ID can be issued.', 409);
      const value = Number(match[1]);
      if (!Number.isSafeInteger(value) || value < 1) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this admission year need reconciliation before another ID can be issued.', 409);
      return value;
    });
    sequence = Math.max(sequence, ...existingSequences.map((value) => value + 1));
    const permanentStudentId = `OSAAH/${year}/${String(sequence).padStart(3, '0')}`;
    await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, timestamp, year]);
    return permanentStudentId;
  }

  async function resolveParent(tx, application, applicant, timestamp) {
    const email = String(value(application.parent_email, applicant.primaryGuardianEmail, applicant.guardianEmail, applicant.email) ?? '').trim().toLowerCase();
    const phone = normalizeGhanaPhone(value(applicant.primaryGuardianPrimaryPhone, application.parent_phone));
    if (!phone) fail('PARENT_IDENTITY_REQUIRED', 'A valid parent telephone number is required before enrollment.', 409);
    const parents = rows(await tx.query(`SELECT u.id,u.email,u.phone,u.username FROM users u
      JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id AND r.role_key='PARENT'
      WHERE u.school_id=?`, [application.school_id]));
    const parent = parents.find((item) => (email && String(item.email ?? '').trim().toLowerCase() === email) || normalizeGhanaPhone(item.phone) === phone || String(item.username ?? '') === phone);
    if (parent) return parent.id;
    if (email && rows(await tx.query('SELECT id FROM users WHERE school_id=? AND LOWER(email)=? LIMIT 1', [application.school_id, email])).length) {
      fail('PARENT_IDENTITY_CONFLICT', 'The parent email belongs to another account; verify the parent record before enrollment.', 409);
    }
    const parentId = idFactory();
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
    await tx.execute('INSERT INTO users (id,school_id,username,email,password_hash,full_name,phone,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [parentId, application.school_id, phone, email || null, passwordHash, value(application.parent_name, applicant.primaryGuardianFullName, 'Parent'), phone, 'PARENT', 'ACTIVE', timestamp]);
    const parentRole = rows(await tx.query("SELECT id FROM roles WHERE school_id=? AND role_key='PARENT' LIMIT 1", [application.school_id]))[0];
    if (!parentRole) fail('PARENT_ROLE_UNAVAILABLE', 'Parent role configuration is unavailable.', 503);
    const roleValues = [idFactory(), parentId, parentRole.id, timestamp];
    await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)', insertParameters: roleValues, conflictSql: 'SELECT user_id FROM user_roles WHERE user_id=? AND role_id=?', conflictParameters: [parentId, parentRole.id] });
    return parentId;
  }

  async function enroll({ applicationId, applicationNumber, actorId, expectedStatus = 'ACCEPTED' }) {
    try {
      return await database.transaction(async (tx) => {
        const application = rows(await tx.query('SELECT * FROM admission_applications WHERE (id=? OR application_number=?) FOR UPDATE', [applicationId ?? '', applicationNumber ?? '']))[0];
        if (!application) fail('APPLICATION_NOT_FOUND', 'Admission application not found.', 404);
        if (application.student_id || application.permanent_student_id) {
          if (!application.student_id || !application.permanent_student_id) fail('ENROLLMENT_INCONSISTENT', 'The existing enrollment record is incomplete.', 409);
          const existing = rows(await tx.query('SELECT * FROM students WHERE id=? AND permanent_student_id=? LIMIT 1', [application.student_id, application.permanent_student_id]))[0];
          if (!existing) fail('ENROLLMENT_INCONSISTENT', 'The existing enrollment record could not be resolved.', 409);
          return { student: existing, created: false };
        }
        const status = String(value(application.status, application.stage) ?? '').toUpperCase();
        const eligibleStatuses = expectedStatus === 'ACCEPTED' ? ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED'] : [expectedStatus];
        if (!eligibleStatuses.includes(status)) fail('APPLICATION_NOT_ELIGIBLE', 'Admission application is not eligible for enrollment.', 409);

        let applicant = application.applicant_data;
        if (typeof applicant === 'string') { try { applicant = JSON.parse(applicant); } catch { fail('APPLICANT_DATA_INVALID', 'Admission applicant data is invalid.', 409); } }
        applicant = { ...application, ...(applicant ?? {}) };
        const timestamp = clock();
        const studentId = await nextStudentId(tx);
        const admissionType = String(applicant.admissionType ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
        const currentYear = String(new Date(timestamp).getUTCFullYear());
        const historicalYear = value(applicant.historicalAdmissionYear);
        if (admissionType === 'ALREADY_ENROLLED' && !/^\d{4}$/.test(String(historicalYear ?? ''))) fail('HISTORICAL_ADMISSION_YEAR_REQUIRED', 'A valid historical admission year is required for an already-enrolled student.', 409);
        const requestedAdmissionYear = value(applicant.admissionYear);
        if (['TRANSFER', 'FIRST_TIME'].includes(admissionType) && requestedAdmissionYear !== null && (!/^\d{4}$/.test(String(requestedAdmissionYear)) || String(requestedAdmissionYear) !== currentYear)) fail('ADMISSION_YEAR_NOT_AUTHORIZED', 'The OSAAH admission year must match the actual admission event for this category.', 409);
        const yearForId = ['TRANSFER', 'FIRST_TIME'].includes(admissionType) ? currentYear : historicalYear ?? value(applicant.admissionYear, applicant.academicYear, application.academic_year_id, application.admission_date, timestamp);
        const permanentStudentId = await nextPermanentStudentId(tx, yearForId, timestamp);
        const requestedClassId = value(application.class_id, applicant.classAssigned, applicant.officialUse?.classAssigned, applicant.classId, applicant.classAppliedFor);
        const classId = canonicalClassId(requestedClassId) ?? requestedClassId;
        const admissionNumber = value(application.admission_number, applicant.admissionNumber, application.application_number);
        const firstName = value(applicant.firstName, applicant.studentFirstName);
        const middleName = value(applicant.middleName, applicant.studentMiddleName);
        const lastName = value(applicant.lastName, applicant.surname, applicant.studentSurname);
        if (!firstName || !lastName || !classId) fail('APPLICANT_DATA_INCOMPLETE', 'Candidate name and assigned class are required for enrollment.', 409);
        const gender = requireStudentGender(applicant.gender);

        await tx.execute('INSERT INTO students (id,permanent_student_id,school_id,admission_number,current_class_id,first_name,middle_name,last_name,gender,date_of_birth,admission_date,admission_type,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [studentId, permanentStudentId, application.school_id, admissionNumber, classId, firstName, middleName, lastName, gender, value(applicant.dateOfBirth), value(application.admission_date, applicant.applicationDate, timestamp.slice(0, 10)), value(applicant.admissionType, 'NEW'), 'ACTIVE', false, timestamp, timestamp]);
        const profileId = idFactory();
        await tx.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,class_id,stream_id,admission_number,admission_date,first_name,surname,gender,date_of_birth,qr_code,enrollment_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [profileId, studentId, permanentStudentId, application.school_id, classId, value(application.stream_id, applicant.streamId), admissionNumber, value(application.admission_date, applicant.applicationDate, timestamp.slice(0, 10)), firstName, lastName, gender, value(applicant.dateOfBirth), `osaah:student:${profileId}`, 'ACTIVE', timestamp]);
        const enrollmentId = idFactory();
        const academicYearId = value(application.academic_year_id, applicant.academicYearId, applicant.academicYear);
        const termId = value(application.term_id, applicant.termId, applicant.term);
        await tx.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at) VALUES (?,?,?,?,?,?,?,?,?)', [enrollmentId, studentId, application.school_id, classId, academicYearId, termId, 'ACTIVE', true, timestamp]);
        const parentUserId = await resolveParent(tx, application, applicant, timestamp);
        const parentLinkValues = [parentUserId, profileId, permanentStudentId, value(applicant.primaryGuardianPrimaryPhone, applicant.guardianPhone, applicant.telephone), value(applicant.primaryGuardianRelationship, 'Guardian'), value(applicant.primaryGuardianRelationship, 'GUARDIAN'), 'ACTIVE', timestamp, timestamp];
        await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO parent_student_links (parent_user_id,student_id,permanent_student_id,telephone,relationship,relationship_type,link_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', insertParameters: parentLinkValues, conflictSql: 'SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? AND student_id=?', conflictParameters: [parentUserId, profileId] });
        await tx.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,updated_at=? WHERE id=? AND student_id IS NULL AND permanent_student_id IS NULL', [studentId, permanentStudentId, 'ENROLLMENT', timestamp, application.id]);
        await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [idFactory(), application.school_id, actorId ?? null, 'ADMISSION_ENROLLMENT_CREATED', 'Student', studentId, json({ applicationId: application.id, studentId, permanentStudentId, profileId, enrollmentId, parentUserId }), timestamp]);
        return { student: { id: studentId, permanentStudentId, schoolId: application.school_id, admissionNumber, classId, firstName, middleName, lastName }, profileId, enrollmentId, parentUserId, created: true };
      });
    } catch (cause) {
      if (cause?.code && cause?.status) throw cause;
      fail('ENROLLMENT_FAILED', 'Enrollment could not be completed.', 503);
    }
  }

  async function authorizeParentStudent({ parentUserId, permanentStudentId, schoolId }) {
    if (!parentUserId || !permanentStudentId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent, student, and school scope are required.', 400);
    const result = rows(await database.query('SELECT s.id AS id,s.id AS studentId,s.id AS student_id,s.permanent_student_id AS permanentStudentId,s.permanent_student_id,s.gender,s.student_status AS studentStatus,sp.id AS studentProfileId,sp.id AS student_profile_id,sp.class_id AS classId,sp.class_id,sp.enrollment_status AS profileEnrollmentStatus,(SELECT e.enrollment_status FROM student_enrollments e WHERE e.student_id=s.id AND e.school_id=s.school_id AND e.is_current IS TRUE ORDER BY e.enrolled_at DESC,e.id DESC LIMIT 1) AS enrollmentStatus FROM students s JOIN student_profiles sp ON sp.student_master_id=s.id AND (sp.student_id=s.permanent_student_id OR sp.student_id=?) JOIN parent_student_links psl ON psl.student_id=sp.id AND psl.parent_user_id=? AND psl.link_status=? WHERE s.school_id=? AND s.permanent_student_id=? AND s.is_test_record IS FALSE LIMIT 1', [permanentStudentId, parentUserId, 'ACTIVE', schoolId, permanentStudentId]))[0];
    if (!result) fail('PARENT_STUDENT_FORBIDDEN', 'You are not authorized to access this student.', 403);
    return result;
  }

  async function listParentStudents({ parentUserId, schoolId } = {}) {
    if (!parentUserId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent and school scope are required.', 400);
    return rows(await database.query(`SELECT s.id AS id,s.id AS studentId,s.id AS student_id,
      s.permanent_student_id AS permanentStudentId,s.permanent_student_id,
      sp.id AS studentProfileId,sp.id AS student_profile_id,sp.class_id AS classId,sp.class_id,
      s.first_name AS firstName,s.last_name AS lastName,s.gender,s.student_status AS studentStatus,
      sp.enrollment_status AS profileEnrollmentStatus,
      (SELECT e.enrollment_status FROM student_enrollments e WHERE e.student_id=s.id AND e.school_id=s.school_id AND e.is_current IS TRUE ORDER BY e.enrolled_at DESC,e.id DESC LIMIT 1) AS enrollmentStatus,
      c.name AS className
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=?
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=pu.school_id
      LEFT JOIN classes c ON c.id=sp.class_id AND c.school_id=pu.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE' AND s.school_id=? AND s.is_test_record IS FALSE
      ORDER BY s.permanent_student_id,s.id`, [schoolId, parentUserId, schoolId]));
  }

  async function parentEnrolledInClass({ parentUserId, schoolId, permanentStudentId, academicYearId, termId, termName, classId, recordType = 'student-summary', legacyTermEvidence = null } = {}) {
    if (!parentUserId || !schoolId || !permanentStudentId || !academicYearId || !termId || !classId) return false;
    const result = rows(await database.query(`SELECT e.class_id AS classId
      ,e.term_id AS termId
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=? AND UPPER(COALESCE(pu.status,'ACTIVE'))='ACTIVE'
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=sp.school_id
      JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE' AND s.school_id=?
        AND s.permanent_student_id=? AND e.academic_year_id=? AND e.class_id=?
        AND (e.term_id=? OR e.term_id IS NULL)
        AND s.is_test_record IS FALSE LIMIT 1`, [schoolId, parentUserId, schoolId, permanentStudentId, academicYearId, classId, termId]));
    const enrollment = result[0];
    if (!enrollment) return false;
    if (enrollment.termId !== null && enrollment.termId !== undefined && String(enrollment.termId) !== String(termId)) return false;
    if (enrollment.termId !== null && enrollment.termId !== undefined) return true;
    if (recordType === 'student-summary') return true;
    return typeof legacyTermEvidence === 'function' && Boolean(await legacyTermEvidence({ parentUserId, schoolId, permanentStudentId, academicYearId, termId, termName, classId, recordType }));
  }

  return Object.freeze({ enroll, authorizeParentStudent, listParentStudents, parentEnrolledInClass });
}
