import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableStudentProfileService } from '../src/durable-student-profile.js';
import { createDurableAdmissionsService } from '../src/durable-admissions.js';

function databaseFixture() {
  const students = [{ id: 'student-1', school_id: 'school-1', permanent_student_id: 'OSAAH/2026/0001', admission_number: 'ADM-1', first_name: 'Ama', middle_name: null, last_name: 'Mensah', gender: 'Female', date_of_birth: '2015-01-01', current_class_id: 'class-1', student_status: 'ACTIVE', updated_at: '2026-01-01' }];
  const profiles = [{ id: 'profile-1', student_master_id: 'student-1', student_id: 'OSAAH/2026/0001', school_id: 'school-1', admission_number: 'ADM-1', first_name: 'Ama', last_name: 'Mensah', gender: 'Female', date_of_birth: '2015-01-01', class_id: 'class-1', enrollment_status: 'ACTIVE', updated_at: '2026-01-01' }];
  const contacts = [];
  const admissions = [];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM students')) return students.filter((row) => row.school_id === params[0] && (row.id === params[1] || row.permanent_student_id === params[2]));
      if (sql.includes('FROM student_profiles') && sql.includes('student_master_id')) return profiles.filter((row) => row.school_id === params[0] && (row.student_master_id === params[1] || row.student_id === params[2]));
      if (sql.includes('FROM student_family_contacts')) return contacts.filter((row) => row.student_id === params[0]);
      if (sql.includes("TABLE_NAME='classes'")) return ['id', 'name', 'school_id', 'status'].map((columnName) => ({ columnName }));
      if (sql.includes("TABLE_NAME='admission_applications'")) return ['id', 'school_id', 'application_number', 'enquiry_request_id', 'stage', 'applicant_data', 'created_at', 'updated_at'].map((columnName) => ({ columnName }));
      if (sql.includes('FROM classes')) return params[0] === 'school-1' ? [{ id: 'class-basic-4', name: 'Basic 4', school_id: 'school-1', status: 'ACTIVE' }] : [];
      if (sql.includes('WHERE id=? AND school_id=?')) return admissions.filter((row) => row.id === params[0] && row.school_id === params[1]);
      if (sql.includes('enquiry_request_id=?')) return admissions.filter((row) => row.school_id === params[0] && row.enquiry_request_id === params[1]);
      if (sql.includes('FROM admission_applications') && sql.includes('application_number=?')) return admissions.filter((row) => row.school_id === params[0] && row.application_number === params[1]);
      if (sql.includes('FROM admission_applications') && sql.includes('ORDER BY created_at')) return admissions.filter((row) => row.school_id === params[0]).slice(-1);
      if (sql.includes('FROM admission_applications')) return admissions.filter((row) => row.school_id === params[0]);
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('UPDATE students SET')) { const row = students.find((item) => item.id === params.at(-2) && item.school_id === params.at(-1)); const assignments = sql.slice('UPDATE students SET '.length).split(' WHERE ')[0].split(','); assignments.forEach((assignment, index) => { row[assignment.split('=')[0]] = params[index]; }); return; }
      if (sql.startsWith('UPDATE student_profiles SET')) { const row = profiles.find((item) => item.id === params.at(-2) && item.school_id === params.at(-1)); const assignments = sql.slice('UPDATE student_profiles SET '.length).split(' WHERE ')[0].split(','); assignments.forEach((assignment, index) => { row[assignment.split('=')[0]] = params[index]; }); return; }
      if (sql.startsWith('INSERT INTO admission_applications')) { const columns = /INSERT INTO admission_applications \(([^)]+)\)/.exec(sql)[1].split(','); admissions.push(Object.fromEntries(columns.map((column, index) => [column, params[index]]))); return; }
      if (sql.startsWith('UPDATE admission_applications SET')) { const row = admissions.find((item) => item.school_id === params.at(-2) && item.application_number === params.at(-1)); const assignmentNames = sql.slice('UPDATE admission_applications SET '.length).split(' WHERE ')[0].split(',').map((x) => x.split('=')[0]); assignmentNames.forEach((name, index) => { row[name] = params[index]; }); }
    }
  };
  return { database, students, profiles, admissions };
}

test('student profile edits update canonical student and profile rows and reload after restart', async () => {
  const fixture = databaseFixture(); const service = createDurableStudentProfileService({ database: fixture.database, clock: () => '2026-10-05T00:00:00.000Z' }); const actor = { schoolId: 'school-1' };
  const saved = await service.update('student-1', { firstName: 'Ama-Marie', surname: 'Mensah', dateOfBirth: '2015-02-02', classId: 'class-2' }, actor);
  assert.equal(saved.firstName, 'Ama-Marie'); assert.equal(saved.dateOfBirth, '2015-02-02'); assert.equal(saved.classId, 'class-2'); assert.equal(saved.permanentStudentId, 'OSAAH/2026/0001');
  const reopened = await createDurableStudentProfileService({ database: fixture.database }).getStudent('OSAAH/2026/0001', actor);
  assert.equal(reopened.firstName, 'Ama-Marie'); assert.equal(reopened.classId, 'class-2');
});

test('admission form values persist, reopen, and update without allocating an identity', async () => {
  const fixture = databaseFixture(); const service = createDurableAdmissionsService({ database: fixture.database, schoolId: 'school-1', idFactory: () => 'application-id', clock: () => '2026-10-05T00:00:00.000Z' }); const actor = { schoolId: 'school-1', portal: 'school', id: 'admissions-1' };
  const created = await service.createApplication({ studentFirstName: 'Kojo', studentSurname: 'Asare', classAppliedFor: 'Basic 4', academicYear: '2026/2027', admissionTerm: 'First Term' }, actor);
  const edited = await service.updateApplication(created.applicationNumber, { primaryGuardianFullName: 'Esi Asare', primaryGuardianPrimaryPhone: '0240000000' }, actor);
  assert.equal(edited.section1.primaryGuardianFullName, 'Esi Asare'); assert.equal(edited.officialUse.permanentStudentId, null);
  const reopened = await createDurableAdmissionsService({ database: fixture.database, schoolId: 'school-1' }).getApplication(created.applicationNumber, actor);
  assert.equal(reopened.section3.primaryGuardianFullName, 'Esi Asare'); assert.equal(reopened.applicationNumber, created.applicationNumber); assert.equal(reopened.officialUse.permanentStudentId, null);
});

test('retries of the same durable enquiry token return one application and normalize the Ghanaian phone', async () => {
  const fixture = databaseFixture(); const service = createDurableAdmissionsService({ database: fixture.database, schoolId: 'school-1', clock: () => '2026-10-05T00:00:00.000Z' }); const actor = { schoolId: 'school-1', portal: 'school', id: 'headteacher-1' };
  const input = { studentFirstName: 'Ama', studentSurname: 'Asare', classAppliedFor: 'class-basic-4', primaryGuardianPrimaryPhone: '0240000000', enquiryRequestId: 'retry-token-20261005' };
  const first = await service.createApplication(input, actor), retry = await service.createApplication(input, actor);
  assert.equal(retry.applicationNumber, first.applicationNumber);
  assert.equal(retry.section1.primaryGuardianPrimaryPhone, '+233240000000');
  assert.equal(fixture.admissions.length, 1);
  assert.equal(JSON.parse(fixture.admissions[0].applicant_data).enquiryRequestId, input.enquiryRequestId);
});
