import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableAdmissionsService } from '../src/durable-admissions.js';

function database() {
  const state = { row: null, writes: [] };
  return {
    state,
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS') && sql.includes("TABLE_NAME='classes'")) return [{ columnName: 'school_id' }, { columnName: 'status' }];
      if (sql.includes('information_schema.COLUMNS') && sql.includes("TABLE_NAME='admission_applications'")) return [{ columnName: 'enquiry_request_id' }];
      if (sql.includes('FROM classes')) return [{ id: 'class-jhs1', name: 'JHS 1', school_id: 'school-1', status: 'ACTIVE' }];
      if (sql.includes('FROM admission_applications')) return state.row && state.row.school_id === params[0] && (sql.includes('enquiry_request_id=?') ? state.row.enquiry_request_id : state.row.application_number) === params[1] ? [{ ...state.row }] : [];
      return [];
    },
    async execute(sql, params = []) {
      state.writes.push(sql);
      if (sql.startsWith('INSERT INTO admission_applications')) {
        state.row = { id: params[0], school_id: params[1], application_number: params[2], enquiry_request_id: params[3], stage: params[4], applicant_data: params[5], created_at: params[6], updated_at: params[7] };
      } else if (sql.startsWith('UPDATE admission_applications SET stage=?')) {
        state.row.stage = params[0]; state.row.applicant_data = params[1]; state.row.updated_at = params[2];
      } else if (sql.startsWith('UPDATE admission_applications SET applicant_data=?')) {
        state.row.applicant_data = params[0]; state.row.updated_at = params[1];
      }
      return { affectedRows: 1 };
    }
  };
}

test('durable admission workflow saves document review, assessment, decision, offer, and acceptance transitions', async () => {
  const db = database(); let id = 0;
  const service = createDurableAdmissionsService({ database: db, schoolId: 'school-1', clock: () => '2026-10-09T10:00:00.000Z', idFactory: () => `id-${++id}` });
  const actor = { id: 'headteacher-1', roleKey: 'HEADTEACHER', schoolId: 'school-1', portal: 'school' };
  const application = await service.createApplication({ studentSurname: 'Sample', studentFirstName: 'Applicant', dateOfBirth: '2018-01-01', gender: 'Female', hometown: 'Bogoso', region: 'Western', nationality: 'Ghanaian', classAppliedFor: 'class-jhs1', className: 'JHS 1', residentialAddress: 'Bogoso', digitalAddress: 'WS-000-0000', nearestLandmark: 'School', primaryGuardianFullName: 'Sample Guardian', primaryGuardianRelationship: 'Parent', primaryGuardianPrimaryPhone: '0241234567', academicYear: '2026', admissionTerm: 'TERM_1', parentDeclarationAccepted: true }, actor);
  await service.updateApplication(application.applicationNumber, { parentDeclarationAccepted: true }, actor);
  for (const documentType of ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT']) await service.attachDocument(application.applicationNumber, { documentType, storageKey: `private/${documentType}.pdf`, mimeType: 'application/pdf', size: 100 }, actor);
  let submitted = await service.submitApplication(application.applicationNumber, actor);
  assert.equal(submitted.workflow.currentStage, 'DOCUMENT_REVIEW');
  for (const document of submitted.documents) await service.reviewDocument(application.applicationNumber, document.id, { status: 'APPROVED', note: 'Verified' }, actor);
  const assessed = await service.reviewApplication(application.applicationNumber, { status: 'UNDER_REVIEW', assessmentDate: '2026-10-08', assessmentScore: 91, assessmentRemarks: 'Interview completed.' }, actor);
  assert.equal(assessed.workflow.currentStage, 'DECISION');
  assert.ok(assessed.workflow.completedStages.includes('ASSESSMENT'));
  assert.equal(assessed.workflow.assessment.assessmentDate, '2026-10-08');
  assert.equal(JSON.parse(db.state.row.applicant_data).workflow.assessment.score, 91);
  const approved = await service.reviewApplication(application.applicationNumber, { status: 'ACCEPTED', classAssigned: 'class-jhs1', decisionReason: 'Approved following interview.' }, actor);
  assert.equal(approved.workflow.currentStage, 'ADMISSION_OFFER');
  assert.equal(approved.workflow.offer.issuedBy, actor.id);
  assert.equal(approved.workflow.decision.reason, 'Approved following interview.');
  const accepted = await service.acceptOffer(application.applicationNumber, actor);
  assert.equal(accepted.workflow.currentStage, 'REGISTRATION');
  assert.ok(accepted.workflow.completedStages.includes('ACCEPTANCE'));
  assert.ok(db.state.writes.length >= 10);
});

test('enquiry retries cannot disclose another parent application', async () => {
  const db = database();
  const service = createDurableAdmissionsService({ database: db, schoolId: 'school-1' });
  const actor = { id: 'parent-1', portal: 'parent', schoolId: 'school-1' };
  const input = { studentSurname: 'Sample', studentFirstName: 'Applicant', classAppliedFor: 'class-jhs1', enquiryRequestId: 'same-request-token-123' };
  const created = await service.createApplication(input, actor);
  assert.equal((await service.createApplication(input, actor)).id, created.id);
  const writes = db.state.writes.length;
  await assert.rejects(service.createApplication(input, { ...actor, id: 'parent-2' }), { status: 404 });
  assert.equal(db.state.writes.length, writes);
});

test('completed admissions cannot be resubmitted to reset their workflow', async () => {
  const db = database();
  const service = createDurableAdmissionsService({ database: db, schoolId: 'school-1' });
  const actor = { id: 'leader', portal: 'school', schoolId: 'school-1' };
  const created = await service.createApplication({ studentSurname: 'Sample', studentFirstName: 'Applicant', classAppliedFor: 'class-jhs1' }, actor);
  for (const stage of ['ACCEPTED', 'ENROLLMENT', 'REJECTED']) {
    db.state.row.stage = stage;
    const before = db.state.writes.length;
    await assert.rejects(service.submitApplication(created.applicationNumber, actor));
    assert.equal(db.state.writes.length, before);
    assert.equal(db.state.row.stage, stage);
  }
});

test('staff admission types enforce only their required durable documents', async () => {
  const db = database(); let id = 0;
  const service = createDurableAdmissionsService({ database: db, schoolId: 'school-1', idFactory: () => `id-${++id}` });
  const actor = { id: 'leader', portal: 'school', schoolId: 'school-1' };
  const input = { studentSurname: 'Sample', studentFirstName: 'Applicant', dateOfBirth: '2018-01-01', gender: 'Female', hometown: 'Bogoso', region: 'Western', nationality: 'Ghanaian', classAppliedFor: 'class-jhs1', className: 'JHS 1', residentialAddress: 'Bogoso', digitalAddress: 'WS-000-0000', nearestLandmark: 'School', primaryGuardianFullName: 'Guardian', primaryGuardianRelationship: 'Parent', primaryGuardianPrimaryPhone: '0241234567' };
  const enrolled = await service.createApplication({ ...input, admissionType: 'ALREADY_ENROLLED' }, actor);
  assert.equal((await service.submitApplication(enrolled.applicationNumber, actor)).status, 'SUBMITTED');
  const transfer = await service.createApplication({ ...input, admissionType: 'TRANSFER' }, actor);
  await assert.rejects(() => service.submitApplication(transfer.applicationNumber, actor), /Missing required document/);
});
