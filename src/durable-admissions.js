import { createHash, randomUUID } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { canonicalClassId } from './student-classes.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => Array.isArray(value) ? value : [];
const pick = (...items) => items.find((item) => item !== undefined && item !== null && item !== '') ?? null;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const STAFF_ADMISSION_TYPES = new Set(['ALREADY_ENROLLED', 'TRANSFER', 'FIRST_TIME']);
function stableApplicationId(schoolId, requestId) {
  const bytes = createHash('sha256').update(`${schoolId}\0${requestId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function staffAdmissionType(value) {
  const type = String(value ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
  const aliases = { ENROLLED: 'ALREADY_ENROLLED', ENROLLED_STUDENT: 'ALREADY_ENROLLED', TRANSFER_STUDENT: 'TRANSFER', FIRST_TIME_STUDENT: 'FIRST_TIME' };
  return aliases[type] ?? type;
}
function requiredDocumentTypes(record, actor) {
  const isStaff = actor.portal !== 'parent';
  const admissionType = staffAdmissionType(record.section1.admissionType) || 'ALREADY_ENROLLED';
  if (isStaff && admissionType === 'ALREADY_ENROLLED') return [];
  const required = ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD'];
  const level = canonicalClassId(record.section1.className);
  if (level?.startsWith('Primary') || level?.startsWith('JHS')) required.push('LAST_ACADEMIC_REPORT');
  if (isStaff) required.push('ADMISSION_RECEIPT');
  return required;
}
function parse(value, fallback = {}) { if (!value) return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { fail('Admission applicant data is invalid.', 409); } }
function recordFromRow(row) {
  const applicant = parse(row.applicant_data ?? row.applicantData);
  const officialUse = applicant.officialUse ?? {};
  const record = { id: row.id, schoolId: row.school_id ?? row.schoolId, applicationNumber: row.application_number ?? row.applicationNumber, academicYear: applicant.academicYear ?? null, admissionTerm: applicant.admissionTerm ?? null, applicationDate: applicant.applicationDate ?? row.created_at?.slice?.(0, 10) ?? null, status: String(row.stage ?? row.status ?? applicant.status ?? 'DRAFT').toUpperCase(), parentUserId: applicant.parentUserId ?? null, section1: { ...applicant }, section2: { ...applicant }, section3: { ...applicant }, parentDeclarationAccepted: Boolean(applicant.parentDeclarationAccepted), parentSignatureReference: applicant.parentSignatureReference ?? null, parentDeclarationDate: applicant.parentDeclarationDate ?? null, officialUse: { entranceAssessmentScore: officialUse.entranceAssessmentScore ?? null, classAssigned: officialUse.classAssigned ?? null, admissionGranted: officialUse.admissionGranted ?? recordStatusAccepted(row), permanentStudentId: row.permanent_student_id ?? officialUse.permanentStudentId ?? null, studentId: row.student_id ?? applicant.studentId ?? null, reviewerId: officialUse.reviewerId ?? null, reviewerRole: officialUse.reviewerRole ?? null, reviewedAt: officialUse.reviewedAt ?? null }, feeSnapshot: applicant.feeSnapshot ?? null, feeAssessment: applicant.feeAssessment ?? null, documents: applicant.documents ?? [], workflow: applicant.workflow ?? { currentStage: applicant.status === 'SUBMITTED' ? 'DOCUMENT_REVIEW' : 'APPLICATION', completedStages: ['ENQUIRY', 'APPLICATION'] }, studentId: row.student_id ?? applicant.studentId ?? null, createdAt: row.created_at ?? row.createdAt ?? null, updatedAt: row.updated_at ?? row.updatedAt ?? null };
  return clone(record);
}
function recordStatusAccepted(row) { return String(row.stage ?? '').toUpperCase() === 'ACCEPTED'; }
function payload(record) { return { ...record.section1, ...record.section2, ...record.section3, academicYear: record.academicYear, admissionTerm: record.admissionTerm, applicationDate: record.applicationDate, parentUserId: record.parentUserId, parentDeclarationAccepted: record.parentDeclarationAccepted, parentSignatureReference: record.parentSignatureReference, parentDeclarationDate: record.parentDeclarationDate, officialUse: record.officialUse, feeSnapshot: record.feeSnapshot, feeAssessment: record.feeAssessment ?? null, documents: record.documents ?? [], workflow: record.workflow ?? {} }; }

export function createDurableAdmissionsService({ database, schoolId, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.query || !database?.execute) return null;
  let applicationColumnsPromise;
  async function applicationColumns() {
    applicationColumnsPromise ??= database.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admission_applications'")
      .then((result) => new Set(rows(result).map((row) => String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase())));
    return applicationColumnsPromise;
  }
  async function existingEnquiry(school, requestId, columns) {
    if (columns.has('enquiry_request_id')) {
      return rows(await database.query('SELECT * FROM admission_applications WHERE school_id=? AND enquiry_request_id=? LIMIT 1', [school, requestId]))[0] ?? null;
    }
    return rows(await database.query('SELECT * FROM admission_applications WHERE id=? AND school_id=? LIMIT 1', [stableApplicationId(school, requestId), school]))[0] ?? null;
  }
  async function load(applicationNumber, actor) {
    const row = rows(await database.query('SELECT * FROM admission_applications WHERE school_id=? AND application_number=? LIMIT 1', [actor.schoolId ?? schoolId, applicationNumber]))[0];
    if (!row) return null;
    const result = recordFromRow(row);
    if (actor.portal === 'parent' && result.parentUserId !== actor.id) return null;
    return result;
  }
  async function nextNumber() {
    return `APP-${new Date(clock()).getFullYear()}-${idFactory().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  }
  async function resolveClass(value, actor) {
    const requested = String(value ?? '').trim();
    if (!requested) fail('A requested class is required.');
    const classes = rows(await database.query("SELECT id,name FROM classes WHERE school_id=? AND status='ACTIVE'", [actor.schoolId ?? schoolId]));
    const match = classes.find((item) => String(item.id) === requested || String(item.name) === requested || canonicalClassId(item.name) === canonicalClassId(requested));
    if (!match || !canonicalClassId(match.name)) fail('Select a valid active school class.');
    return match;
  }
  async function createApplication(input, actor) {
    if (!input?.studentSurname || !input?.studentFirstName || !input?.classAppliedFor) fail('Candidate name and a valid class are required.');
    const requestId = String(input.enquiryRequestId ?? '').trim();
    if (requestId && !/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) fail('Enquiry request reference is invalid.');
    const recordSchoolId = actor.schoolId ?? schoolId;
    const columns = await applicationColumns();
    if (requestId) {
      const existing = await existingEnquiry(recordSchoolId, requestId, columns);
      if (existing) { const record = await load(existing.application_number, actor); if (!record) fail('Application not found.', 404); return record; }
    }
    const selectedClass = await resolveClass(input.classAppliedFor, actor);
    const now = clock(); const applicationNumber = await nextNumber(); const id = requestId ? stableApplicationId(recordSchoolId, requestId) : idFactory();
    let primaryPhone = input.primaryGuardianPrimaryPhone;
    if (primaryPhone) { try { primaryPhone = normalizeGhanaPhone(primaryPhone); } catch (error) { fail(error.message); } }
    input = { ...input, classAppliedFor: selectedClass.id, className: selectedClass.name, ...(primaryPhone ? { primaryGuardianPrimaryPhone: primaryPhone } : {}) };
    input.admissionYear ??= String(input.academicYear ?? '').match(/^\d{4}/)?.[0] ?? null;
    const record = { id, schoolId: recordSchoolId, applicationNumber, academicYear: input.academicYear ?? null, admissionTerm: input.admissionTerm ?? null, applicationDate: input.applicationDate ?? now.slice(0, 10), status: 'DRAFT', parentUserId: actor.portal === 'parent' ? actor.id : input.parentUserId ?? null, section1: { ...input }, section2: { ...input }, section3: { ...input }, parentDeclarationAccepted: false, parentSignatureReference: null, parentDeclarationDate: null, officialUse: { entranceAssessmentScore: null, classAssigned: null, admissionGranted: null, permanentStudentId: null, studentId: null, reviewerId: null, reviewerRole: null, reviewedAt: null }, feeSnapshot: null, workflow: { currentStage: 'APPLICATION', completedStages: ['ENQUIRY', 'APPLICATION'], offer: null }, createdAt: now, updatedAt: now };
    try {
      const insertColumns = ['id', 'school_id', 'application_number', ...(columns.has('enquiry_request_id') ? ['enquiry_request_id'] : []), 'stage', 'applicant_data', 'created_at', 'updated_at'];
      const insertValues = [id, record.schoolId, applicationNumber, ...(columns.has('enquiry_request_id') ? [requestId || null] : []), 'DRAFT', JSON.stringify(payload(record)), now, now];
      await database.execute(`INSERT INTO admission_applications (${insertColumns.join(',')}) VALUES (${insertColumns.map(() => '?').join(',')})`, insertValues);
    } catch (error) {
      if (!requestId) throw error;
      const existing = await existingEnquiry(record.schoolId, requestId, columns);
      if (!existing) throw error;
      const recovered = await load(existing.application_number, actor); if (!recovered) fail('Application not found.', 404); return recovered;
    }
    return clone(record);
  }
  async function listApplications(filters = {}, actor) {
    const records = rows(await database.query('SELECT * FROM admission_applications WHERE school_id=? ORDER BY created_at DESC,application_number DESC', [actor.schoolId ?? schoolId])).map(recordFromRow).filter((record) => (actor.portal !== 'parent' || record.parentUserId === actor.id) && (!filters.status || record.status === String(filters.status).toUpperCase()) && (!filters.academicYear || record.academicYear === filters.academicYear) && (!filters.term || record.admissionTerm === filters.term));
    return records;
  }
  async function updateApplication(applicationNumber, input, actor) {
    const record = await load(applicationNumber, actor); if (!record || (actor.portal === 'parent' && record.status !== 'DRAFT')) fail('Application not found or cannot be edited.');
    if (input.classAppliedFor !== undefined) { const selectedClass = await resolveClass(input.classAppliedFor, actor); input = { ...input, classAppliedFor: selectedClass.id, className: selectedClass.name }; }
    if (input.primaryGuardianPrimaryPhone) { try { input = { ...input, primaryGuardianPrimaryPhone: normalizeGhanaPhone(input.primaryGuardianPrimaryPhone) }; } catch (error) { fail(error.message); } }
    Object.assign(record.section1, input); Object.assign(record.section2, input); Object.assign(record.section3, input); if (input.parentDeclarationAccepted !== undefined) record.parentDeclarationAccepted = Boolean(input.parentDeclarationAccepted); record.academicYear = input.academicYear ?? record.academicYear; record.admissionTerm = input.admissionTerm ?? record.admissionTerm; record.updatedAt = clock();
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(record);
  }
  async function submitApplication(applicationNumber, actor, activeFee = null, feeAssessment = null) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); const required = ['studentSurname', 'studentFirstName', 'dateOfBirth', 'gender', 'hometown', 'region', 'nationality', 'classAppliedFor', 'residentialAddress', 'digitalAddress', 'nearestLandmark', 'primaryGuardianFullName', 'primaryGuardianRelationship', 'primaryGuardianPrimaryPhone']; for (const field of required) if (!String(record.section1[field] ?? '').trim()) fail(`Missing required field: ${field}.`); const isStaff = actor.portal !== 'parent'; const admissionType = staffAdmissionType(record.section1.admissionType) || 'ALREADY_ENROLLED'; if (isStaff && !STAFF_ADMISSION_TYPES.has(admissionType)) fail('Select a valid admission type: Already-Enrolled Student, Transfer Student, or First-Time Student.'); if (!isStaff && !record.parentDeclarationAccepted) fail('Parent or guardian declaration must be accepted.'); if (record.status === 'SUBMITTED') return clone(record); if (record.status !== 'DRAFT') fail('Only a draft application can be submitted.', 409); for (const field of ['primaryGuardianPrimaryPhone', 'primaryGuardianSecondaryPhone', 'secondaryGuardianPrimaryPhone', 'secondaryGuardianSecondaryPhone', 'emergencyContactPhone']) if (record.section1[field]) { const normalized = normalizeGhanaPhone(record.section1[field]); if (!normalized) fail(`Enter a valid Ghanaian phone number for ${field}.`); record.section1[field] = normalized; } const documents = record.documents ?? []; const requiredDocuments = requiredDocumentTypes(record, actor); for (const type of requiredDocuments) if (!documents.some((item) => item.documentType === type && item.uploadStatus === 'UPLOADED')) fail(`Missing required document: ${type}.`); record.section1.admissionType = isStaff ? admissionType : record.section1.admissionType; record.status = 'SUBMITTED'; record.feeSnapshot = activeFee ? clone(activeFee) : record.feeSnapshot; record.feeAssessment = feeAssessment ? clone(feeAssessment) : record.feeAssessment; record.workflow = { ...record.workflow, currentStage: 'DOCUMENT_REVIEW', completedStages: [...new Set([...(record.workflow?.completedStages ?? []), 'ENQUIRY', 'APPLICATION'])] }; record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', ['SUBMITTED', JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function reviewApplicationLegacy(applicationNumber, input, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); if (!['ACCEPTED', 'REJECTED', 'UNDER_REVIEW'].includes(input.status)) fail('Invalid application status.'); if (!['SUBMITTED', 'UNDER_REVIEW'].includes(record.status)) fail('Application is not eligible for review.'); if (input.entranceAssessmentScore !== undefined && (!Number.isFinite(Number(input.entranceAssessmentScore)) || Number(input.entranceAssessmentScore) < 0 || Number(input.entranceAssessmentScore) > 100)) fail('Assessment score must be between 0 and 100.'); if (input.status === 'ACCEPTED' && (!input.classAssigned || input.entranceAssessmentScore === undefined)) fail('Assessment score and assigned class are required for approval.'); if (input.status === 'REJECTED' && !String(input.rejectionReason ?? '').trim()) fail('A rejection reason is required.'); if (input.status === 'ACCEPTED') { const requiredTypes = requiredDocumentTypes(record, actor); const incomplete = requiredTypes.some((type) => !record.documents.some((item) => item.documentType === type && item.reviewStatus === 'APPROVED')); if (incomplete) fail('Required documents must be reviewed and approved before an admission decision.'); } const selectedClass = input.status === 'ACCEPTED' ? await resolveClass(input.classAssigned, actor) : null; const now = clock(); record.status = input.status; record.rejectionReason = input.status === 'REJECTED' ? String(input.rejectionReason).trim() : null; record.officialUse = { ...record.officialUse, entranceAssessmentScore: input.entranceAssessmentScore === undefined ? record.officialUse.entranceAssessmentScore : Number(input.entranceAssessmentScore), classAssigned: selectedClass?.id ?? input.classAssigned ?? record.officialUse.classAssigned, admissionGranted: input.status === 'ACCEPTED', reviewerId: actor.id, reviewerRole: actor.roleKey, reviewedAt: now }; record.workflow = { ...record.workflow, currentStage: input.status === 'ACCEPTED' ? 'ADMISSION_OFFER' : input.status === 'REJECTED' ? 'DECISION' : 'ASSESSMENT', completedStages: [...new Set([...(record.workflow?.completedStages ?? []), ...(input.status === 'ACCEPTED' || input.status === 'REJECTED' ? ['DOCUMENT_REVIEW', 'ASSESSMENT', 'DECISION'] : ['DOCUMENT_REVIEW'])])], assessment: input.entranceAssessmentScore === undefined ? record.workflow?.assessment : { score: Number(input.entranceAssessmentScore), remarks: String(input.assessmentRemarks ?? '').trim() || null, assessedBy: actor.id, assessedAt: now }, decision: { status: input.status, decidedBy: actor.id, decidedAt: now, reason: record.rejectionReason } }; if (input.status === 'ACCEPTED') record.workflow.offer = { issuedBy: actor.id, issuedAt: now, acceptedBy: null, acceptedAt: null }; record.updatedAt = now; await database.execute('UPDATE admission_applications SET stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [record.status, JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function reviewApplication(applicationNumber, input, actor) {
    const existing = await load(applicationNumber, actor);
    const savedAssessment = existing?.workflow?.assessment ?? {};
    const scoreValue = input.assessmentScore ?? input.entranceAssessmentScore ?? savedAssessment.score;
    input = { ...input, assessmentDate: input.assessmentDate ?? savedAssessment.assessmentDate, assessmentRemarks: input.assessmentRemarks ?? savedAssessment.remarks };
    if (input.status === 'UNDER_REVIEW') {
      const record = await load(applicationNumber, actor); if (!record || record.status !== 'SUBMITTED') fail('A submitted application is required to record an assessment.', 409);
      const score = Number(scoreValue), assessmentDate = String(input.assessmentDate ?? '');
      if (!Number.isFinite(score) || score < 0 || score > 100) fail('Assessment score must be between 0 and 100.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || Number.isNaN(Date.parse(`${assessmentDate}T00:00:00Z`))) fail('A valid assessment date is required.');
      if (!String(input.assessmentRemarks ?? '').trim()) fail('Assessment remarks are required.');
      const requiredTypes = requiredDocumentTypes(record, actor);
      if (requiredTypes.some((type) => !record.documents.some((item) => item.documentType === type && item.reviewStatus === 'APPROVED'))) fail('Required documents must be reviewed and approved before assessment.');
      const now = clock();
      record.status = 'UNDER_REVIEW'; record.officialUse = { ...record.officialUse, entranceAssessmentScore: score, reviewerId: actor.id, reviewerRole: actor.roleKey };
      record.workflow = { ...record.workflow, currentStage: 'DECISION', completedStages: [...new Set([...(record.workflow?.completedStages ?? []), 'DOCUMENT_REVIEW', 'ASSESSMENT'])], assessment: { assessmentDate, score, remarks: String(input.assessmentRemarks).trim(), assessedBy: actor.id, assessedAt: now } };
      record.updatedAt = now;
      await database.execute('UPDATE admission_applications SET stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [record.status, JSON.stringify(payload(record)), now, actor.schoolId ?? schoolId, applicationNumber]);
      return clone(record);
    }
    const record = await reviewApplicationLegacy(applicationNumber, { ...input, entranceAssessmentScore: scoreValue }, actor);
    if (!record) return record;
    const now = clock();
    if (record.workflow?.assessment && input.assessmentDate) record.workflow.assessment = { ...record.workflow.assessment, assessmentDate: input.assessmentDate, remarks: String(input.assessmentRemarks ?? record.workflow.assessment.remarks ?? '').trim(), assessedBy: record.workflow.assessment.assessedBy ?? actor.id, assessedAt: record.workflow.assessment.assessedAt ?? now };
    if (record.status === 'ACCEPTED') record.workflow.decision = { ...record.workflow.decision, reason: String(input.decisionReason ?? '').trim() || null };
    record.updatedAt = now;
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), now, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(record);
  }
  async function acceptOffer(applicationNumber, actor) { const record = await load(applicationNumber, actor); if (!record || record.status !== 'ACCEPTED' || !record.workflow?.offer?.issuedAt) fail('An active admission offer is required.', 409); if (record.workflow.offer.acceptedAt) return clone(record); const now = clock(); record.workflow = { ...record.workflow, currentStage: 'REGISTRATION', completedStages: [...new Set([...(record.workflow.completedStages ?? []), 'ADMISSION_OFFER', 'ACCEPTANCE'])], offer: { ...record.workflow.offer, acceptedBy: actor.id, acceptedAt: now } }; record.updatedAt = now; await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), now, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function attachStudent(applicationNumber, student, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); record.status = 'ENROLLMENT'; const studentId = typeof student === 'string' ? student : student.id; record.studentId = studentId; record.officialUse.studentId = studentId; record.officialUse.permanentStudentId = typeof student === 'string' ? record.officialUse.permanentStudentId : (student.permanentStudentId ?? student.permanent_student_id ?? record.officialUse.permanentStudentId); record.workflow = { ...record.workflow, currentStage: 'CLASS_ASSIGNMENT', completedStages: [...new Set([...(record.workflow?.completedStages ?? []), 'REGISTRATION', 'FEE_ASSESSMENT', 'ENROLLMENT', 'STUDENT_ID', 'CLASS_ASSIGNMENT'])] }; record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [record.studentId, record.officialUse.permanentStudentId, 'ENROLLMENT', JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function attachDocument(applicationNumber, input, actor) {
    const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404);
    if (!input?.documentType || !(input.storageKey ?? input.fileReference)) fail('Invalid admission document.');
    const document = { id: idFactory(), applicationNumber, schoolId: actor.schoolId ?? schoolId, documentType: input.documentType, fileReference: input.storageKey ?? input.fileReference, storageKey: input.storageKey ?? input.fileReference, originalName: input.originalName ?? null, mimeType: input.mimeType ?? null, size: input.size ?? null, sha256: input.sha256 ?? null, uploadStatus: 'UPLOADED', uploadedAt: clock(), verified: false, reviewStatus: 'PENDING' };
    record.documents = [...(record.documents ?? []), document];
    record.updatedAt = clock();
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(document);
  }
  async function replaceDocument(applicationNumber, documentId, input, actor) {
    const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404);
    const index = (record.documents ?? []).findIndex((item) => item.id === documentId);
    if (index < 0) fail('Admission document not found.', 404);
    if (!input?.storageKey || input.documentType !== record.documents[index].documentType) fail('Replacement must match the original document type.');
    record.documents[index] = { ...record.documents[index], fileReference: input.storageKey, storageKey: input.storageKey, originalName: input.originalName ?? null, mimeType: input.mimeType ?? null, size: input.size ?? null, sha256: input.sha256 ?? null, uploadedAt: clock(), uploadStatus: 'UPLOADED', verified: false, reviewStatus: 'PENDING', reviewNote: null, reviewedBy: null, reviewedAt: null };
    record.updatedAt = clock();
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(record.documents[index]);
  }
  async function reviewDocument(applicationNumber, documentId, input, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); const document = (record.documents ?? []).find((item) => item.id === documentId); if (!document) fail('Admission document not found.', 404); if (!['APPROVED', 'FLAGGED'].includes(input.status)) fail('Document decision must be APPROVED or FLAGGED.'); document.reviewStatus = input.status; document.reviewNote = String(input.note ?? '').trim() || null; document.reviewedBy = actor.id; document.reviewedAt = clock(); document.verified = input.status === 'APPROVED'; record.workflow = { ...record.workflow, currentStage: 'ASSESSMENT', completedStages: [...new Set([...(record.workflow?.completedStages ?? []), 'DOCUMENT_REVIEW'])] }; record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(document); }
  async function listDocuments(applicationNumber, actor) { const record = await load(applicationNumber, actor); return record?.documents ?? []; }
  return Object.freeze({ createApplication, listApplications, getApplication: load, updateApplication, submitApplication, reviewApplication, acceptOffer, attachStudent, attachDocument, replaceDocument, reviewDocument, listDocuments });
}
