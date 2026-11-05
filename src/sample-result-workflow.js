import { CORE_LEVELS } from './students.js';
import { GES_ASSESSMENT_LIBRARIES } from './ges-assessment-libraries.js';
import { SAMPLE_STUDENT_IDS } from './sample-student-identities.js';

const SAMPLE_CLASSES = Object.freeze([...CORE_LEVELS]);
const SAMPLE_MOCK_CLASSES = Object.freeze(['JHS 1', 'JHS 2', 'JHS 3']);
const ASSESSMENT_KEYS = Object.freeze(['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks']);
const SCORE_MAX = 50;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(input) { let h = 2166136261; for (const char of String(input)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(input, size) { return size ? hash(input) % size : 0; }
function score(input, min, max) { return min + (hash(input) % (max - min + 1)); }
function assessmentCategory(key) { return key === 'classTeacherRemarks' ? 'ctRemarks' : key === 'headteacherRemarks' ? 'htRemarks' : key; }
function assertActor(actor, permission = 'marks.write') { if (!actor?.schoolId || (!actor.permissions?.has?.(permission) && !actor.permissions?.has?.('marks.write') && !actor.permissions?.has?.('results.generate') && actor.roleKey !== 'PROPRIETOR' && actor.roleKey !== 'HEADTEACHER' && actor.roleKey !== 'SCHOOL_ADMIN')) throw new Error('Sample result generation permission required.'); }

export function createSampleResultWorkflow({ students, subjects, academicResults, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  if (!students || !subjects || !academicResults) throw new Error('Sample workflow dependencies are required.');
  const sampleState = new Map();
  function sampleStudents(classId) { return students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true }).filter((student) => student.isTestRecord && SAMPLE_STUDENT_IDS.includes(student.permanentStudentId) && (!classId || !student.classId || student.classId === classId)); }
  function generate(input, actor) {
    assertActor(actor); if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const academicYear = String(input?.academicYear ?? '').trim(); const term = String(input?.term ?? '').trim(); const examinationType = String(input?.examinationType ?? 'TERMINAL').trim(); const classId = String(input?.classId ?? '').trim();
    if (!academicYear || !term || !classId || !SAMPLE_CLASSES.includes(classId)) throw new Error('Academic year, term, and configured sample class are required.');
    const roster = sampleStudents(classId); if (!roster.length) throw new Error('No existing sample student is available for this class.');
    const target = input.studentId ? roster.find((student) => student.id === input.studentId || student.permanentStudentId === input.studentId) : roster[0]; if (!target) throw new Error('Existing sample student not found.');
    const availableSubjects = subjects.list({ classId }, actor).filter((subject) => subject.active); if (!availableSubjects.length) throw new Error('No active subjects are configured for this class.');
    const key = `${schoolId}:${target.permanentStudentId}:${academicYear}:${term}:${examinationType}`;
    for (const sampleStudent of roster) {
      const studentKey = `${schoolId}:${sampleStudent.permanentStudentId}:${academicYear}:${term}:${examinationType}`;
      for (const subject of availableSubjects) academicResults.saveScore({ studentId: sampleStudent.id, classId, subjectId: subject.id, academicYear, term, caScore: score(`${studentKey}:${subject.id}:ca`, 24, 45), examScore: score(`${studentKey}:${subject.id}:exam`, 24, 50), caMax: SCORE_MAX, examMax: SCORE_MAX }, actor);
    }
    const assessments = Object.fromEntries(ASSESSMENT_KEYS.map((assessmentKey) => { const category = assessmentCategory(assessmentKey); const side = hash(`${key}:${assessmentKey}:side`) % 2 ? 'positive' : 'negative'; const bank = GES_ASSESSMENT_LIBRARIES[category][side]; return [assessmentKey, bank[pick(`${key}:${assessmentKey}:statement`, bank.length)]]; }));
    const attendance = { timesPresent: fiftyFive(key, 'present'), timesAbsent: 60 - fiftyFive(key, 'present'), totalSchoolDays: 60, term, isSample: true };
    const state = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType, assessments, attendance, generatedAt: now() };
    sampleState.set(key, state);
    const result = academicResults.result({ studentId: target.id, classId, academicYear, term, examinationType, sample: true }, actor);
    return { ...clone(result), ...clone(state), sampleLabel: 'SAMPLE DATA' };
  }
  function generateMock(input, actor) {
    assertActor(actor, 'mock.scores.write'); if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const academicYear = String(input?.academicYear ?? '').trim(); const term = String(input?.term ?? '').trim(); const mockLabel = String(input?.mockLabel ?? input?.mockType ?? '1st Mock').trim(); const classId = String(input?.classId ?? '').trim();
    if (!academicYear || !term || !classId || !SAMPLE_MOCK_CLASSES.includes(classId)) throw new Error('Sample Mock data is available for JHS 1, JHS 2, and JHS 3 only.');
    const roster = sampleStudents(classId); if (!roster.length) throw new Error('No existing sample student is available for this JHS class.');
    const target = input.studentId ? roster.find((student) => student.id === input.studentId || student.permanentStudentId === input.studentId) : roster[0]; if (!target) throw new Error('Existing sample student not found.');
    const availableSubjects = subjects.list({ classId }, actor).filter((subject) => subject.active); if (!availableSubjects.length) throw new Error('No active subjects are configured for this class.');
    for (const sampleStudent of roster) { const studentKey = schoolId + ':' + sampleStudent.permanentStudentId + ':' + academicYear + ':' + term + ':MOCK:' + mockLabel; for (const subject of availableSubjects) academicResults.saveMockScore({ studentId: sampleStudent.id, classId, subjectId: subject.id, academicYear, term, mockLabel, totalScore: score(studentKey + ':' + subject.id + ':total', 55, 98) }, actor); }
    const stateKey = schoolId + ':' + target.permanentStudentId + ':' + academicYear + ':' + term + ':MOCK:' + mockLabel;
    const assessments = Object.fromEntries(ASSESSMENT_KEYS.map((assessmentKey) => { const category = assessmentCategory(assessmentKey); const side = hash(stateKey + ':' + assessmentKey + ':side') % 2 ? 'positive' : 'negative'; const bank = GES_ASSESSMENT_LIBRARIES[category][side]; return [assessmentKey, bank[pick(stateKey + ':' + assessmentKey + ':statement', bank.length)]]; }));
    const attendance = { timesPresent: fiftyFive(stateKey, 'present'), timesAbsent: 60 - fiftyFive(stateKey, 'present'), totalSchoolDays: 60 };
    academicResults.saveResult({ studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examination: 'MOCK', attendance, assessment: assessments }, actor);
    const stateValue = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType: 'MOCK', mockLabel, assessments, attendance, generatedAt: now() }; sampleState.set(stateKey, stateValue);
    const result = academicResults.result({ studentId: target.id, classId, academicYear, term, mockLabel }, actor, { mock: true });
    return { ...clone(result), assessment: { ...clone(assessments) }, attendance: clone(attendance), isSample: true, sampleLabel: 'SAMPLE DATA / DEMONSTRATION' };
  }
  function resetMock(input, actor) { assertActor(actor, 'mock.scores.write'); const target = sampleStudents().find((student) => student.permanentStudentId === input.permanentStudentId); if (!target?.isTestRecord) throw new Error('Only existing sample records can be reset.'); if (!SAMPLE_MOCK_CLASSES.includes(input.classId)) throw new Error('Only JHS sample Mock records can be reset.'); const removed = academicResults.resetMockScores({ studentId: target.id, classId: input.classId, academicYear: input.academicYear, term: input.term, mockLabel: input.mockLabel }, actor); for (const key of sampleState.keys()) if (key.includes(':' + target.permanentStudentId + ':' + input.academicYear + ':' + input.term + ':MOCK:')) sampleState.delete(key); return { ok: true, isSample: true, removed: removed.removed ?? 0, permanentStudentId: target.permanentStudentId }; }
  function state(input, actor) { assertActor(actor); const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId }); if (!target?.isTestRecord) return null; return clone(sampleState.get(`${schoolId}:${target.permanentStudentId}:${input.academicYear}:${input.term}:${input.examinationType ?? 'TERMINAL'}`) ?? null); }
  function reset(input, actor) { assertActor(actor); const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId }); if (!target?.isTestRecord) throw new Error('Only existing sample records can be reset.'); const prefix = `${schoolId}:${target.permanentStudentId}:${input.academicYear}:${input.term}:`; for (const key of sampleState.keys()) if (key.startsWith(prefix)) sampleState.delete(key); return { ok: true, isSample: true, permanentStudentId: target.permanentStudentId }; }
  function saveMock(input, actor) {
    assertActor(actor, 'mock.scores.write');
    if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const target = sampleStudents(input.classId).find((student) => student.id === input.studentId || student.permanentStudentId === input.permanentStudentId);
    if (!target) throw new Error('Existing sample student not found.');
    if (String(input.examination ?? '').toUpperCase() !== 'MOCK') throw new Error('Sample Mock result is required.');
    return academicResults.saveResult({ ...input, studentId: target.id, permanentStudentId: target.permanentStudentId, isSample: true }, actor);
  }
  function publish(input, actor) { assertActor(actor); const target = (students.getStudent(input.studentId, { requestedSchoolId: schoolId })?.isTestRecord ? students.getStudent(input.studentId, { requestedSchoolId: schoolId }) : students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId })); if (!target?.isTestRecord) throw new Error('Only existing sample records can be published through the sample workflow.'); return academicResults.publishResults({ ...input, studentId: target.id, isSample: true }, actor); }
  function broadsheet(input, actor, { mock = false } = {}) {
    if (actor?.schoolId !== schoolId || !(actor?.permissions?.has?.('results.read') || actor?.permissions?.has?.('mock.results.read') || actor?.permissions?.has?.('*') || ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'].includes(actor?.roleKey))) throw new Error('Forbidden.');
    const classId = String(input?.classId ?? '').trim();
    if (!(mock ? SAMPLE_MOCK_CLASSES : SAMPLE_CLASSES).includes(classId)) throw new Error('A configured sample class is required.');
    students.seedSampleStudents?.();
    const reader = { ...actor, permissions: new Set([...(actor.permissions ?? []), 'results.generate', 'mock.results.generate', 'marks.write', 'mock.scores.write']) };
    return sampleStudents(classId).map((student) => {
      const report = mock
        ? generateMock({ ...input, classId, studentId: student.id }, reader)
        : generate({ ...input, classId, studentId: student.id }, reader);
      const subjectCas = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.caScore]));
      const subjectExams = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.examScore]));
      const subjectTotals = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.totalScore]));
      const subjectGrades = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.grade]));
      return { studentId: student.id, permanentStudentId: student.permanentStudentId, studentName: report.studentName, classId, subjectCas, subjectExams, subjectTotals, subjectGrades, totalScore: report.totalScore, averageScore: report.average, aggregate: report.aggregate ?? null, classPosition: report.classPosition ?? report.position ?? null, subjectsSat: report.subjectsSat ?? report.subjects?.length ?? 0, isSample: true };
    });
  }
  return { classes: () => [...SAMPLE_CLASSES], mockClasses: () => [...SAMPLE_MOCK_CLASSES], students: sampleStudents, generate, generateMock, saveMock, state, publish, reset, resetMock, broadsheet };
}
function fiftyFive(key, field) { return 55 + (hash(`${key}:${field}`) % 6); }
export { ASSESSMENT_KEYS };
