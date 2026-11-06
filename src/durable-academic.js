import { createHash, randomUUID } from 'node:crypto';
import { gradeForTotal } from './grading.js';
import { canonicalAcademicClass, defaultSubjectForClass, defaultSubjectsForClass, DEFAULT_SUBJECT_CONFIGURATION_VERSION, DEFAULT_SUBJECT_ASSIGNMENT_SLOTS, DEFAULT_DISTINCT_SUBJECT_NAMES } from './default-subject-catalog.js';
import { calculateStudentResult, calculateClassPositions } from './result-calculation.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';
import { isSampleModeEnabled } from './academic-sample-mode.js';
import { SAMPLE_STUDENT_IDS } from './sample-student-identities.js';

const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400, code = 'ACADEMIC_DATA_ERROR', details = null) => { throw Object.assign(new Error(message), { status, code, details }); };
const schemaCompatibilityError = (error) => /unknown column|doesn'?t exist|no such table|table .* does not exist/i.test(String(error?.message ?? error));
const missingLegacySubjectTable = (error) => {
  const message = String(error?.message ?? error);
  return /ER_NO_SUCH_TABLE|no such table|table .* does not exist|table .* doesn't exist/i.test(message) && /class_subjects/i.test(message);
};
const missingOptionalEnrollmentStateColumn = (error) => {
  const message = String(error?.message ?? error);
  return /unknown column|no such column|column .*does not exist|column .*doesn't exist|invalid column name/i.test(message)
    && /\b(?:enrollment_status|is_current)\b/i.test(message);
};
const missingOptionalStudentTestRecordColumn = (error) => {
  const message = String(error?.message ?? error);
  return /unknown column|no such column|column .*does not exist|column .*doesn't exist|invalid column name/i.test(message)
    && /\bis_test_record\b/i.test(message);
};
const missingOptionalStudentStatusColumn = (error) => {
  const message = String(error?.message ?? error);
  return /unknown column|no such column|column .*does not exist|column .*doesn't exist|invalid column name/i.test(message)
    && /\bstudent_status\b/i.test(message);
};
async function historicalAcademicCounts(database, schoolId) {
  const tables = new Set(rows(await database.query(
    "SELECT table_name AS \"tableName\" FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('academic_score_records','academic_result_records') AND table_type='BASE TABLE'"
  )).map((row) => row.tableName ?? row.TABLE_NAME));
  const count = async (table, where = 'school_id=?', params = [schoolId]) => Number(rows(await database.query(
    `SELECT COUNT(*) AS rowCount FROM ${table} WHERE ${where}`, params
  ))[0]?.rowCount ?? 0);
  const result = { academicScoreRecords: 0, academicResultRecords: 0, publishedResults: 0 };
  if (tables.has('academic_score_records')) result.academicScoreRecords = await count('academic_score_records');
  if (tables.has('academic_result_records')) {
    result.academicResultRecords = await count('academic_result_records');
    result.publishedResults = await count('academic_result_records', 'school_id=? AND status=?', [schoolId, 'PUBLISHED']);
  }
  return result;
}
const MOCK_TYPES = Object.freeze(Array.from({ length: 10 }, (_, index) => `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'} Mock`));
const JHS_CLASSES = new Set(['JHS 1', 'JHS 2', 'JHS 3']);

function authorized(actor, permission) {
  return actor?.permissions?.has?.('*') || actor?.permissions?.has?.(permission) || actor?.roleKey === 'PROPRIETOR';
}

export function createDurableAcademicService({ database, schoolId, signatures = null, idFactory = randomUUID, clock = () => new Date().toISOString(), students = null } = {}) {
  if (!database?.query || !database?.execute) fail('Durable academic database is unavailable.', 503, 'DURABLE_ACADEMIC_DATABASE_REQUIRED');

  function assertActor(actor, permission = null) {
    if (!actor?.schoolId || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'TENANT_SCOPE_VIOLATION');
    if (permission && !authorized(actor, permission)) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
  }

  function assertClassScope(classId, actor) {
    if (!classId) fail('Class is required.');
    if (actor?.roleKey === 'TEACHER' && !authorized(actor, 'academics.manage')) {
      const assigned = new Set((actor.assignedClassIds ?? []).map(String));
      if (!assigned.size || !assigned.has(String(classId))) fail('Class is outside your assignment.', 403, 'CLASS_SCOPE_DENIED');
    }
  }

  async function classFor(classId) {
    const item = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]))[0];
    if (!item) fail('Class not found.', 404, 'CLASS_NOT_FOUND');
    return item;
  }

  function stableId(prefix, ...parts) {
    return `${prefix}-${createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32)}`;
  }

  async function options(actor) {
    assertActor(actor);
    const [academicYears, terms] = await Promise.all([
      database.query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', [schoolId]),
      database.query('SELECT t.id,t.academic_year_id AS academicYearId,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn,t.is_current AS isCurrent FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on ASC,t.id', [schoolId])
    ]);
    let classes;
    try {
      // Production's canonical class catalogue is the existing classes table.
      // Do not join levels here: older production rows use classes.school_id,
      // classes.level, and classes.sort_order rather than classes.level_id.
      classes = await database.query('SELECT c.id,c.name,c.sort_order AS displayOrder,c.level AS levelName FROM classes c WHERE c.school_id=? ORDER BY c.sort_order,c.id', [schoolId]);
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      try {
        // Some production revisions have the tenant key and class names but
        // not the optional ordering/level columns. Names and IDs are enough
        // for Score Entry; do not fail because presentation metadata was not
        // migrated.
        classes = await database.query('SELECT c.id,c.name FROM classes c WHERE c.school_id=? ORDER BY c.id', [schoolId]);
      } catch (minimalError) {
        if (!schemaCompatibilityError(minimalError)) throw minimalError;
        // Keep compatibility with the normalized foundation schema used by
        // installations where classes are tenant-scoped through levels.
        classes = await database.query('SELECT c.id,c.name,c.display_order AS displayOrder,l.name AS levelName FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? ORDER BY c.display_order,c.id', [schoolId]);
      }
    }
    // The selector is a catalogue for browsing. Record reads and writes are
    // scoped separately by assertClassScope and subject assignment checks.
    const allowedClasses = rows(classes);
    return { academicYears: rows(academicYears), terms: rows(terms), classes: allowedClasses, mockTypes: [...MOCK_TYPES] };
  }

  function decorateSubject(subject, classId) {
    const configured = defaultSubjectForClass(subject.className ?? classId, subject.name);
    if (!configured) return subject;
    return {
      ...subject,
      subjectType: configured?.subjectType ?? subject.subjectType ?? 'ELECTIVE',
      isScoring: configured ? configured.isScoring : Number(subject.isScoring ?? 1) !== 0,
      mandatory: Boolean(configured?.mandatory),
      optional: Boolean(configured?.optional),
      maximumMarks: configured?.maximumMarks ?? 100,
      configurationVersion: configured?.configurationVersion ?? null,
      assessmentComponents: configured?.assessmentComponents ?? []
    };
  }

  async function configureDefaultSubjects(actor, { academicYearId: requestedYearId = null } = {}) {
    assertActor(actor, 'subjects.manage');
    const sync = async (tx) => {
      let academicYearId = text(requestedYearId) || null;
      if (academicYearId) {
        const year = rows(await tx.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
        if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
        academicYearId = text(year.id);
      }
      const classes = rows(await tx.query('SELECT c.id,c.name FROM classes c WHERE c.school_id=? ORDER BY c.id', [schoolId]));
      const duplicateSubjects = rows(await tx.query('SELECT LOWER(name) AS normalizedName,COUNT(*) AS recordCount FROM subjects WHERE school_id=? GROUP BY LOWER(name) HAVING COUNT(*)>1', [schoolId]));
      if (duplicateSubjects.length) fail('Duplicate subject names require manual reconciliation before synchronization.', 409, 'DUPLICATE_SUBJECTS', { duplicateSubjects });
      const historyBefore = await historicalAcademicCounts(tx, schoolId);
      let classesConfigured = 0, subjectsCreated = 0, assignmentsCreated = 0, mandatoryAssignmentsRestored = 0;
      const nurseryNames = new Set(classes.flatMap((item) => canonicalAcademicClass(item.name)?.startsWith('Nursery') ? defaultSubjectsForClass(item.name).map((item) => item.name.toLocaleLowerCase('en')) : []));
      for (const classRow of classes) {
        const classId = canonicalAcademicClass(classRow.name);
        if (!classId) continue;
        const defaults = defaultSubjectsForClass(classId);
        if (!defaults.length) continue;
        classesConfigured += 1;
        for (const definition of defaults) {
          const matches = rows(await tx.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 2', [schoolId, definition.name]));
          if (matches.length > 1) fail(`Duplicate subject records exist for ${definition.name}.`, 409, 'DUPLICATE_SUBJECTS', { subjectName: definition.name });
          let subject = matches[0];
          if (!subject) {
            const codeStem = `CFG_${definition.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 28);
            let code = codeStem, suffix = 1;
            while (rows(await tx.query('SELECT id FROM subjects WHERE school_id=? AND code=? LIMIT 1', [schoolId, code])).length) {
              suffix += 1;
              code = `${codeStem.slice(0, 27 - String(suffix).length)}_${suffix}`;
            }
            const subjectId = stableId('default-subject', schoolId, definition.name.toLocaleLowerCase('en'));
            const subjectValues=[subjectId, schoolId, null, code, definition.name, definition.subjectType, Boolean(definition.isScoring), JSON.stringify(definition.assessmentComponents), clock(), clock()];
            if(database.dialect==='tidb') await tidbInsertIfAbsent(tx,{insertSql:'INSERT INTO subjects (id,school_id,department_id,code,name,subject_type,is_scoring,assessment_components_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',insertParameters:subjectValues,conflictSql:'SELECT id FROM subjects WHERE school_id=? AND (id=? OR code=? OR LOWER(name)=LOWER(?))',conflictParameters:[schoolId,subjectId,code,definition.name]});
            subject = rows(await tx.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 2', [schoolId, definition.name]))[0];
            if (!subject) fail(`Unable to create the configured subject ${definition.name}.`, 409, 'SUBJECT_CONFIGURATION_CONFLICT');
            subjectsCreated += 1;
          }
          // Subject metadata is global, while approved classification can vary by class.
          // The class-specific catalogue overlay remains authoritative; never mutate any
          // subject used by Nursery as part of the default sync.
          if (!nurseryNames.has(definition.name.toLocaleLowerCase('en'))) {
            let storedComponents = subject.assessmentComponentsJson ?? [];
            if (typeof storedComponents === 'string') { try { storedComponents = JSON.parse(storedComponents); } catch { storedComponents = []; } }
            const components = definition.assessmentComponents ?? [];
            if (String(subject.subjectType ?? '').toUpperCase() !== definition.subjectType || Number(subject.isScoring ?? 1) !== (definition.isScoring === false ? 0 : 1) || JSON.stringify(Array.isArray(storedComponents) ? storedComponents : []) !== JSON.stringify(components)) {
              await tx.execute('UPDATE subjects SET subject_type=?,is_scoring=?,assessment_components_json=?,updated_at=? WHERE id=? AND school_id=?', [definition.subjectType, definition.isScoring !== false, JSON.stringify(components), clock(), subject.id, schoolId]);
            }
          }
          if (definition.mandatory && Number(subject.isActive ?? 1) === 0 && !academicYearId && !classId.startsWith('Nursery')) await tx.execute('UPDATE subjects SET is_active=TRUE,updated_at=? WHERE id=? AND school_id=?', [clock(), subject.id, schoolId]);
          if (definition.activeByDefault === false) continue;

          const scopes = academicYearId
            ? rows(await tx.query('SELECT id,active,academic_year_id AS academicYearId FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND (academic_year_id IS NULL OR academic_year_id=?) ORDER BY academic_year_id', [schoolId, subject.id, classRow.id, academicYearId]))
            : rows(await tx.query('SELECT id,active,academic_year_id AS academicYearId FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND academic_year_id IS NULL LIMIT 2', [schoolId, subject.id, classRow.id]));
          const scopedDuplicates = scopes.filter((item) => (item.academicYearId ?? null) === academicYearId);
          if (scopedDuplicates.length > 1) fail('Duplicate class-subject assignments require manual reconciliation.', 409, 'DUPLICATE_SUBJECT_ASSIGNMENTS', { classId: classRow.id, subjectId: subject.id, academicYearId });
          const yearAssignment = academicYearId ? scopes.find((item) => text(item.academicYearId) === academicYearId) : null;
          const globalAssignment = academicYearId ? scopes.find((item) => !item.academicYearId) : null;
          const existing = yearAssignment ?? globalAssignment ?? scopes[0];
          if (existing && (!academicYearId || yearAssignment || Number(existing.active ?? 1) === 1 || !definition.mandatory)) {
            const shouldRestore = definition.mandatory && Number(existing.active) === 0 && (!academicYearId || Boolean(yearAssignment));
            // Preserve Nursery configuration byte-for-byte except the already-approved
            // repair of an inactive mandatory assignment.
            if (shouldRestore || (!classId.startsWith('Nursery') && Boolean(yearAssignment || !academicYearId))) {
              await tx.execute('UPDATE subject_class_assignments SET active=?,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [shouldRestore ? true : Boolean(existing.active), String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
              if (shouldRestore) mandatoryAssignmentsRestored += 1;
            }
            continue;
          }
          const targetYear = academicYearId;
          const assignmentId=stableId('default-assignment', schoolId, classRow.id, subject.id, targetYear ?? 'default');
          const assignmentValues=[assignmentId, schoolId, subject.id, classRow.id, targetYear, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()];
          const inserted = database.dialect==='tidb'
            ? await tidbInsertIfAbsent(tx,{insertSql:'INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,TRUE,?,?,?)',insertParameters:assignmentValues,conflictSql:'SELECT id FROM subject_class_assignments WHERE id=? OR (school_id=? AND subject_id=? AND class_id=? AND academic_year_id<=>?)',conflictParameters:[assignmentId,schoolId,subject.id,classRow.id,targetYear]})
            : (await tx.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,TRUE,?,?,?)', assignmentValues), true);
          if (inserted) assignmentsCreated += 1;
        }
      }
      const historyAfter = await historicalAcademicCounts(tx, schoolId);
      if (JSON.stringify(historyBefore) !== JSON.stringify(historyAfter)) fail(
        'Historical academic records changed during default subject synchronization.',
        409,
        'HISTORICAL_RECORDS_CHANGED',
        { before: historyBefore, after: historyAfter }
      );
      return { schoolId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, classesConfigured, subjectsCreated, assignmentsCreated, mandatoryAssignmentsRestored, expectedBaseline: { assignmentSlots: DEFAULT_SUBJECT_ASSIGNMENT_SLOTS, distinctSubjectNames: DEFAULT_DISTINCT_SUBJECT_NAMES }, nurseryPreserved: true };
    };
    if (typeof database.transaction !== 'function') fail('Default subject synchronization requires a database transaction.', 503, 'SUBJECT_SYNC_TRANSACTION_REQUIRED');
    try { return await database.transaction(sync); }
    catch (error) {
      if (schemaCompatibilityError(error)) fail('Subject configuration requires the approved subject database migrations.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE');
      throw error;
    }
  }

  async function subjectCatalog(actor, { includeInactive = false } = {}) {
    assertActor(actor);
    let subjectRows;
    try { subjectRows = rows(await database.query('SELECT id,code,name,department_id AS departmentId,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? ORDER BY name,id', [schoolId])); }
    catch (error) { if (schemaCompatibilityError(error)) fail('Durable subject configuration is unavailable until the required subject database migrations are applied.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE'); throw error; }
    let assignmentRows = [];
    try {
      assignmentRows = rows(await database.query('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? ORDER BY c.id', [schoolId]));
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      try {
        assignmentRows = rows(await database.query('SELECT cs.subject_id AS subjectId,cs.class_id AS classId,c.name AS className,1 AS active FROM class_subjects cs JOIN classes c ON c.id=cs.class_id AND c.school_id=? WHERE c.school_id=? ORDER BY c.id', [schoolId, schoolId]));
      } catch (legacyError) {
        if (missingLegacySubjectTable(legacyError)) assignmentRows = [];
        else if (!schemaCompatibilityError(legacyError)) throw legacyError;
      }
    }
    const result = subjectRows.map((subject) => {
      const assignments = assignmentRows.filter((item) => item.subjectId === subject.id);
      const active = Number(subject.isActive ?? 1) === 1 && (!assignments.length || assignments.some((item) => Number(item.active ?? 1) === 1));
      let assessmentComponents = subject.assessmentComponentsJson ?? [];
      if (typeof assessmentComponents === 'string') { try { assessmentComponents = JSON.parse(assessmentComponents); } catch { assessmentComponents = []; } }
      return { id: subject.id, code: subject.code, name: subject.name, departmentId: subject.departmentId ?? null, subjectType: subject.subjectType ?? 'ELECTIVE', isScoring: Number(subject.isScoring ?? 1) !== 0, active, classIds: [...new Set(assignments.map((item) => item.classId))], classNames: [...new Set(assignments.map((item) => item.className ?? item.classId))], assessmentComponents: Array.isArray(assessmentComponents) ? assessmentComponents : [] };
    });
    const scoped = actor?.roleKey === 'TEACHER' && !authorized(actor, 'academics.manage')
      ? result.map((subject) => {
        const assignedClasses = new Set((actor.assignedClassIds ?? []).map(String));
        const assignedSubjects = new Set((actor.assignedSubjectIds ?? []).map(String));
        if (!assignedClasses.size || !assignedSubjects.size) return { ...subject, classIds: [], classNames: [] };
        const allowedAssignments = assignmentRows.filter((item) => item.subjectId === subject.id && assignedClasses.has(String(item.classId)) && assignedSubjects.has(String(item.subjectId)));
        return { ...subject, classIds: [...new Set(allowedAssignments.map((item) => item.classId))], classNames: [...new Set(allowedAssignments.map((item) => item.className ?? item.classId))] };
      }).filter((subject) => subject.classIds.length > 0)
      : result;
    return includeInactive ? scoped : scoped.filter((subject) => subject.active);
  }

  async function createSubject(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const name = text(input.name);
    if (!name) fail('Subject name is required.');
    const duplicate = rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 1', [schoolId, name]))[0];
    if (duplicate) fail('Subject already exists.', 409, 'SUBJECT_ALREADY_EXISTS');
    const codeBase = text(input.code).toUpperCase() || `CUSTOM_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 32);
    let code = codeBase, suffix = 1;
    while (rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND code=? LIMIT 1', [schoolId, code])).length) {
      suffix += 1;
      code = `${codeBase.slice(0, 31 - String(suffix).length)}_${suffix}`;
    }
    const subjectType = text(input.subjectType).toUpperCase() || 'ELECTIVE';
    if (!['CORE', 'ELECTIVE', 'NON_SCORING'].includes(subjectType)) fail('Subject type must be CORE, ELECTIVE, or NON_SCORING.');
    const isScoring = subjectType !== 'NON_SCORING' && input.isScoring !== false && Number(input.isScoring) !== 0;
    const id = idFactory();
    await database.execute('INSERT INTO subjects (id,school_id,department_id,code,name,subject_type,is_scoring,assessment_components_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, input.departmentId ?? null, code, name, subjectType, Boolean(isScoring), JSON.stringify(Array.isArray(input.assessmentComponents) ? input.assessmentComponents : []), true, clock(), clock()]);
    return { id, schoolId, departmentId: input.departmentId ?? null, code, name, subjectType, isScoring, mandatory: false, active: true, classIds: [], assessmentComponents: Array.isArray(input.assessmentComponents) ? input.assessmentComponents : [] };
  }

  async function updateSubject(subjectId, input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const current = rows(await database.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring FROM subjects WHERE id=? AND school_id=? LIMIT 1', [text(subjectId), schoolId]))[0];
    if (!current) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    const assignments = rows(await database.query('SELECT a.active,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? AND a.subject_id=?', [schoolId, text(subjectId)]));
    const protectsMandatory = assignments.some((assignment) => defaultSubjectForClass(assignment.className, current.name)?.mandatory);
    if (protectsMandatory && (input.name !== undefined && text(input.name).toLowerCase() !== current.name.toLowerCase() || input.isScoring === false || Number(input.isScoring) === 0 || String(input.subjectType ?? current.subjectType).toUpperCase() === 'NON_SCORING')) fail('Mandatory core subjects cannot be renamed or made non-scoring.');
    const name = input.name === undefined ? current.name : text(input.name);
    if (!name) fail('Subject name is required.');
    if (name.toLowerCase() !== current.name.toLowerCase() && rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) AND id<>? LIMIT 1', [schoolId, name, text(subjectId)])).length) fail('Subject already exists.', 409, 'SUBJECT_ALREADY_EXISTS');
    const code = input.code === undefined ? current.code : text(input.code).toUpperCase();
    const subjectType = input.subjectType === undefined ? current.subjectType : text(input.subjectType).toUpperCase();
    if (!['CORE', 'ELECTIVE', 'NON_SCORING'].includes(subjectType)) fail('Subject type must be CORE, ELECTIVE, or NON_SCORING.');
    const isScoring = input.isScoring === undefined ? Number(current.isScoring ?? 1) !== 0 : input.isScoring !== false && Number(input.isScoring) !== 0;
    await database.execute('UPDATE subjects SET name=?,code=?,subject_type=?,is_scoring=?,updated_at=? WHERE id=? AND school_id=?', [name, code, subjectType, Boolean(isScoring), clock(), text(subjectId), schoolId]);
    return { ...current, name, code, subjectType, isScoring, updatedAt: clock() };
  }

  async function deactivateSubject(subjectId, actor) {
    assertActor(actor, 'subjects.manage');
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [text(subjectId), schoolId]))[0];
    if (!subject) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    const assignments = rows(await database.query('SELECT a.id,a.class_id AS classId,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? AND a.subject_id=?', [schoolId, text(subjectId)]));
    if (assignments.some((assignment) => defaultSubjectForClass(assignment.className, subject.name)?.mandatory)) fail('Mandatory core subjects cannot be deactivated.');
    await database.execute('UPDATE subjects SET is_active=FALSE,updated_at=? WHERE id=? AND school_id=?', [clock(), text(subjectId), schoolId]);
    await database.execute('UPDATE subject_class_assignments SET active=FALSE,updated_at=? WHERE school_id=? AND subject_id=?', [clock(), schoolId, text(subjectId)]);
    return { id: text(subjectId), schoolId, active: false, archived: true, historicalRecordsPreserved: true };
  }

  async function mockSubjectCatalog(actor) { assertActor(actor); const catalogue = await subjectCatalog(actor); return catalogue.filter((subject) => ['JHS 1','JHS 2','JHS 3'].some((className) => Boolean(defaultSubjectForClass(className, subject.name)))).map((subject) => ({ ...decorateSubject(subject, 'JHS 1'), classNames: ['JHS 1','JHS 2','JHS 3'] })); }
  async function listSubjects(filters = {}, actor) {
    assertActor(actor);
    const classId = text(filters.classId);
    if (classId) assertClassScope(classId, actor);
    if (!classId) return subjectCatalog(actor, { includeInactive: filters.includeInactive === true || String(filters.includeInactive).toLowerCase() === 'true' });
    let academicYearId = text(filters.academicYearId || filters.academicYear);
    if (academicYearId) {
      const year = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(year.id);
    }
    const includeInactive = filters.includeInactive === true || String(filters.includeInactive).toLowerCase() === 'true';
    const params = [schoolId, classId];
    let yearClause = '';
    if (academicYearId) { yearClause = ' AND (a.academic_year_id IS NULL OR a.academic_year_id=?)'; params.push(academicYearId); }
    try {
      const assignments = rows(await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.subject_type AS subjectType,s.is_scoring AS isScoring,s.is_active AS subjectActive,a.class_id AS classId,c.name AS className,a.academic_year_id AS academicYearId,a.active AS assignmentActive,a.configuration_version AS configurationVersion
        FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
        JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
        WHERE a.school_id=? AND a.class_id=?${yearClause} ORDER BY s.name,s.id`, params));
      if (assignments.length) {
        const bySubject = new Map();
        for (const item of assignments) {
          const key = text(item.id);
          const isYearOverride = Boolean(academicYearId && item.academicYearId && text(item.academicYearId) === academicYearId);
          const previous = bySubject.get(key);
          if (academicYearId && previous && previous.isYearOverride === isYearOverride) fail('Duplicate class-subject assignments require manual reconciliation.', 409, 'DUPLICATE_SUBJECT_ASSIGNMENTS', { classId, subjectId: key, academicYearId });
          if (!previous || (isYearOverride && !previous.isYearOverride)) bySubject.set(key, { item, isYearOverride });
        }
        return [...bySubject.values()].filter(({ item }) => includeInactive || (Number(item.assignmentActive ?? 1) === 1 && Number(item.subjectActive ?? 1) === 1)).map(({ item }) => {
          const { assignmentActive, ...subject } = item;
          return { ...decorateSubject(subject, classId), active: Number(assignmentActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 };
        });
      }
      // A mapping that exists only for another academic year must not leak into
      // this year's view through the legacy class_subjects compatibility path.
      const anyNormalizedMapping = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND class_id=? LIMIT 1', [schoolId, classId]));
      if (anyNormalizedMapping.length) return [];
      return legacySubjects();
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      if (filters.requireNormalized === true) fail('Year-scoped subject configuration requires the approved subject database migrations.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE');
      // Some production databases retain the original class_subjects mapping.
      // It is authoritative and already references canonical subject/class
      // records; do not create a second mapping table or duplicate assignments.
      return legacySubjects();
    }
    async function legacySubjects() {
      try {
        const result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.subject_type AS subjectType,s.is_scoring AS isScoring,s.is_active AS subjectActive,cs.class_id AS classId,c.name AS className
          FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=?
          JOIN classes c ON c.id=cs.class_id AND c.school_id=?
          WHERE cs.class_id=? ORDER BY s.name,s.id`, [schoolId, schoolId, classId]);
        return rows(result).filter((subject) => includeInactive || Number(subject.subjectActive ?? 1) === 1).map((subject) => ({ ...decorateSubject(subject, classId), active: Number(subject.subjectActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 }));
      } catch (error) {
        if (missingLegacySubjectTable(error)) return [];
        if (!schemaCompatibilityError(error)) throw error;
        try {
          const result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.is_active AS subjectActive,cs.class_id AS classId,c.name AS className
            FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=?
            JOIN classes c ON c.id=cs.class_id AND c.school_id=?
            WHERE cs.class_id=? ORDER BY s.name,s.id`, [schoolId, schoolId, classId]);
          return rows(result).filter((subject) => includeInactive || Number(subject.subjectActive ?? 1) === 1).map((subject) => ({ ...decorateSubject(subject, classId), active: Number(subject.subjectActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 }));
        } catch (legacyError) {
          if (missingLegacySubjectTable(legacyError)) return [];
          throw legacyError;
        }
      }
    }
  }

  async function subjectConfiguration(actor, filters = {}) {
    assertActor(actor);
    const classId = text(filters.classId);
    const requestedYear = text(filters.academicYearId || filters.academicYear);
    if (!classId || !requestedYear) fail('Academic year and class are required.', 400, 'SUBJECT_CONFIGURATION_SCOPE_REQUIRED');
    assertClassScope(classId, actor);
    const [classRow, yearRows] = await Promise.all([
      classFor(classId),
      database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, requestedYear, requestedYear])
    ]);
    const academicYear = rows(yearRows)[0];
    if (!academicYear) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
    const [configuredSubjects, catalogue] = await Promise.all([
      listSubjects({ classId, academicYearId: academicYear.id, includeInactive: true, requireNormalized: true }, actor),
      subjectCatalog(actor, { includeInactive: true })
    ]);
    const configuredById = new Map(configuredSubjects.map((subject) => [text(subject.id), subject]));
    const approvedNames = new Set(defaultSubjectsForClass(classRow.name).map((definition) => definition.name.toLocaleLowerCase('en')));
    const subjects = catalogue.filter((subject) => configuredById.has(text(subject.id)) || approvedNames.has(text(subject.name).toLocaleLowerCase('en'))).map((subject) => {
      const configured = configuredById.get(text(subject.id));
      if (configured) return { ...configured, assigned: true };
      const decorated = decorateSubject({ ...subject, classId, className: classRow.name }, classId);
      return { ...decorated, active: false, subjectActive: subject.active !== false, assigned: false };
    }).sort((left, right) => text(left.name).localeCompare(text(right.name)));
    return { schoolId, academicYearId: text(academicYear.id), academicYear: academicYear.name, classId, className: classRow.name, subjects };
  }

  async function subjectAssigned(input, actor) {
    const subjectId = text(input.subjectId);
    if (actor?.roleKey === 'TEACHER' && !authorized(actor, 'academics.manage') && !(actor.assignedSubjectIds ?? []).map(String).includes(subjectId)) return false;
    const configured = await listSubjects({ classId: input.classId, academicYearId: input.academicYearId || input.academicYear }, actor);
    return configured.some((subject) => text(subject.id) === subjectId);
  }

  async function subjectCascade(input = {}, actor) {
    assertActor(actor);
    const classId = text(input.classId);
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const configuredSubjects = await listSubjects({ classId, academicYearId: period.yearId }, actor);
    return { academicYearId: period.yearId, academicYear: period.yearName, termId: period.termId, term: period.termName, classId, subjects: configuredSubjects.filter((subject) => subject.active !== false && subject.subjectActive !== false && subject.isScoring !== false && Number(subject.isScoring) !== 0) };
  }

  async function scoringSubjectAssigned(input, actor) {
    if (!await subjectAssigned(input, actor)) return false;
    const configured = await listSubjects({ classId: input.classId, academicYearId: input.academicYearId || input.academicYear }, actor);
    const subject = configured.find((item) => text(item.id) === text(input.subjectId));
    return Boolean(subject && subject.isScoring !== false && Number(subject.isScoring) !== 0);
  }

  async function listAssignments(subjectId, actor) {
    assertActor(actor);
    const result = await database.query(`SELECT a.id,a.subject_id AS subjectId,a.class_id AS classId,a.academic_year_id AS academicYearId,a.configuration_version AS configurationVersion,a.active,c.name AS className
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
      WHERE a.school_id=? AND a.subject_id=? ORDER BY c.id`, [schoolId, text(subjectId)]);
    return rows(result).filter((assignment) => !actor?.assignedClassIds?.length || actor.assignedClassIds.includes(assignment.classId));
  }

  async function assignSubject(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const subjectId = text(input.subjectId || input.subject_id);
    const classId = text(input.classId || input.class_id);
    let academicYearId = text(input.academicYearId || input.academic_year_id) || null;
    if (!subjectId || !classId) fail('Subject and class are required.');
    assertClassScope(classId, actor);
    await classFor(classId);
    if (academicYearId) {
      const academicYear = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!academicYear) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(academicYear.id);
    }
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]))[0];
    if (!subject) fail('Subject not found.', 404);
    const existing = rows(await database.query('SELECT id,active FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND ((academic_year_id IS NULL AND ? IS NULL) OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, academicYearId, academicYearId]))[0];
    if (existing) {
      await database.execute('UPDATE subject_class_assignments SET active=TRUE,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
      return { id: existing.id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: true, created: false };
    }
    const id = idFactory();
    await database.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, schoolId, subjectId, classId, academicYearId, 1, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()]);
    return { id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: true, created: true };
  }

  async function deactivateSubjectAssignment(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const subjectId = text(input.subjectId || input.subject_id);
    const classId = text(input.classId || input.class_id);
    let academicYearId = text(input.academicYearId || input.academic_year_id) || null;
    if (!subjectId || !classId) fail('Subject and class are required.');
    assertClassScope(classId, actor);
    const classRow = await classFor(classId);
    if (academicYearId) {
      const year = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(year.id);
    }
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]))[0];
    if (!subject) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    if (defaultSubjectForClass(classRow.name, subject.name)?.mandatory) fail('Mandatory core subjects cannot be deactivated.');
    const existing = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND ((academic_year_id IS NULL AND ? IS NULL) OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, academicYearId, academicYearId]))[0];
    if (existing) {
      await database.execute('UPDATE subject_class_assignments SET active=FALSE,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
      return { id: existing.id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: false, created: false, historicalRecordsPreserved: true };
    }
    const id = idFactory();
    await database.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?)', [id, schoolId, subjectId, classId, academicYearId, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()]);
    return { id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: false, created: true, historicalRecordsPreserved: true };
  }

  async function resolvePeriod(input = {}) {
    const year = text(input.academicYearId || input.academicYear);
    const term = text(input.termId || input.term);
    if (!year || !term) fail('Academic year and term are required.');
    const yearRow = rows(await database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, year, year]))[0];
    if (!yearRow) fail('Academic year not found.', 404);
    const termRow = rows(await database.query('SELECT t.id,t.name FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? AND y.id=? AND (t.id=? OR t.name=?) LIMIT 1', [schoolId, yearRow.id, term, term]))[0];
    if (!termRow) fail('Term not found.', 404);
    return { yearId: yearRow.id, yearName: yearRow.name, termId: termRow.id, termName: termRow.name };
  }

  async function assertMockClass(classId) {
    if (JHS_CLASSES.has(classId)) return;
    const classRow = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]))[0];
    if (!JHS_CLASSES.has(text(classRow?.name))) fail('Mock examinations are available for JHS 1, JHS 2, and JHS 3 only.');
  }

  async function roster(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'marks.write') && !authorized(actor, 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId || !text(input.subjectId)) fail('Class and subject are required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    if (!await scoringSubjectAssigned({ classId, subjectId: input.subjectId, academicYearId: period.yearId }, actor)) fail('Subject is invalid for this class and academic context.', 400, 'INVALID_CLASS_SUBJECT');
    const rosterProjection = `SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
      e.class_id AS classId,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.grade,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      LEFT JOIN academic_score_records r ON r.school_id=e.school_id AND r.student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=? AND r.term_id=? AND r.record_type='TERMINAL' AND r.mock_label IS NULL
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND s.is_test_record IS NOT TRUE`;
    const rosterParams = [text(input.subjectId), period.yearId, period.termId, schoolId, classId, period.yearId, period.termId, schoolId];
    let query = `${rosterProjection} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE ORDER BY s.last_name,s.first_name,s.id`;
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await database.query(query, rosterParams);
        break;
      } catch (error) {
        if (missingOptionalStudentTestRecordColumn(error) && query.includes('s.is_test_record IS NOT TRUE')) {
          // Older production student tables identify sample rows only by their
          // permanent ID. Keep official mode isolated without requiring a
          // column that the legacy schema never declared.
          query = query.replace('s.is_test_record IS NOT TRUE', "s.permanent_student_id NOT LIKE 'OSAAH-DEMO-%' AND s.permanent_student_id NOT LIKE 'OSAAH/DEMO/%'");
          continue;
        }
        if (missingOptionalEnrollmentStateColumn(error) && query.includes('COALESCE(e.enrollment_status')) {
          query = query.replace(" AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE", '');
          continue;
        }
        throw error;
      }
    }
    if (!result) throw new Error('Score Entry roster query did not return a result.');
    return rows(result).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore), grade: item.grade ?? null, saved: Boolean(item.scoreId) }));
  }

  async function sampleScoreEntryContext(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'marks.write') && !authorized(actor, 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    const subjectId = text(input.subjectId);
    if (!classId || !subjectId) fail('Class and subject are required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    const classRow = await classFor(classId);
    const subject = (await listSubjects({ classId, academicYearId: period.yearId }, actor)).find((item) => text(item.id) === subjectId && item.isScoring !== false && Number(item.isScoring) !== 0);
    if (!subject) fail('Subject is invalid for this class and academic context.', 400, 'INVALID_CLASS_SUBJECT');
    const fixtures = students?.listStudents?.({ requestedSchoolId: schoolId, includeTestRecords: true }) ?? [];
    const sampleStudents = fixtures
      .filter((student) => student.schoolId === schoolId && student.isTestRecord === true && student.permanentStudentId === SAMPLE_STUDENT_IDS[0])
      .map((student) => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, studentName: [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '), classId, caScore: null, examScore: null, totalScore: null, grade: null, saved: false, isTestRecord: true }));
    return { class: { id: classRow.id, name: classRow.name }, subject: { id: subject.id, name: subject.name }, academicYearId: period.yearId, termId: period.termId, students: sampleStudents };
  }

  async function sampleScoreEntryRoster(input = {}, actor) {
    return (await sampleScoreEntryContext(input, actor)).students;
  }

  async function resultStudents(input = {}, actor) {
    assertActor(actor);
    const mockContext = String(input.resultType ?? input.examination ?? '').toUpperCase() === 'MOCK';
    const hasResultAccess = authorized(actor, 'results.read') || authorized(actor, 'results.generate') || authorized(actor, 'examinations.read');
    const hasMockAccess = authorized(actor, 'mock.results.read') || authorized(actor, 'mock.results.generate');
    if (!hasResultAccess && !(mockContext && hasMockAccess)) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId) return [];
    assertClassScope(classId, actor);
    if (mockContext) await assertMockClass(classId);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const rosterProjection = `SELECT DISTINCT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,e.class_id AS classId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND s.is_test_record IS NOT TRUE`;
    const params = [schoolId, classId, period.yearId, period.termId, schoolId];
    let query = `${rosterProjection} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE ORDER BY s.last_name,s.first_name,s.id`;
    let result;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        result = await database.query(query, params);
        break;
      } catch (error) {
        if (missingOptionalEnrollmentStateColumn(error) && query.includes('COALESCE(e.enrollment_status')) {
          query = query.replace(" AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE", '');
          continue;
        }
        if (missingOptionalStudentTestRecordColumn(error) && query.includes('s.is_test_record IS NOT TRUE')) {
          query = query.replace('s.is_test_record IS NOT TRUE', "s.permanent_student_id NOT LIKE 'OSAAH-DEMO-%' AND s.permanent_student_id NOT LIKE 'OSAAH/DEMO/%'");
          continue;
        }
        if (missingOptionalStudentStatusColumn(error) && query.includes("COALESCE(s.student_status,'ACTIVE')='ACTIVE'")) {
          query = query.replace(" AND COALESCE(s.student_status,'ACTIVE')='ACTIVE'", '');
          continue;
        }
        throw error;
      }
    }
    if (!result) throw new Error('Result-student roster query did not return a result.');
    return rows(result).map((item) => ({ id: item.studentId, studentId: item.studentId, indexNumber: item.permanentStudentId, permanentStudentId: item.permanentStudentId, name: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, isTestRecord: false }));
  }

  async function resultContext(input = {}, actor) {
    assertActor(actor);
    const mockContext = String(input.resultType ?? input.examination ?? '').toUpperCase() === 'MOCK';
    const hasResultAccess = authorized(actor, 'results.read') || authorized(actor, 'results.generate') || authorized(actor, 'results.publish') || authorized(actor, 'examinations.read');
    const hasMockAccess = authorized(actor, 'mock.results.read') || authorized(actor, 'mock.results.generate');
    if (!hasResultAccess && !(mockContext && hasMockAccess)) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId) fail('Class is required.', 400, 'RESULT_CONTEXT_REQUIRED');
    assertClassScope(classId, actor);
    if (mockContext) await assertMockClass(classId);
    const [period, classRow] = await Promise.all([resolvePeriod(input), classFor(classId)]);
    return { classId, className: classRow.name, academicYearId: period.yearId, academicYear: period.yearName, termId: period.termId, term: period.termName };
  }

  async function saveScore(input = {}, actor) {
    assertActor(actor, 'marks.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId);
    const caScore = Number(input.caScore), examScore = Number(input.examScore);
    if (!classId || !subjectId || !studentId || !Number.isFinite(caScore) || !Number.isFinite(examScore)) fail('Student, class, subject, CA, and Exam are required.');
    if (caScore < 0 || caScore > 50) fail('CA score must be between 0 and 50.');
    if (examScore < 0 || examScore > 50) fail('Exam score must be between 0 and 50.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const enrollmentSql = 'SELECT e.student_id,s.permanent_student_id,c.name AS className FROM student_enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id WHERE e.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?';
    const enrollmentParams = [schoolId, studentId, classId, period.yearId, period.termId];
    let enrolledRows;
    try {
      enrolledRows = await database.query(`${enrollmentSql} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE LIMIT 1`, enrollmentParams);
    } catch (error) {
      if (!missingOptionalEnrollmentStateColumn(error)) throw error;
      enrolledRows = await database.query(`${enrollmentSql} LIMIT 1`, enrollmentParams);
    }
    const enrolled = rows(enrolledRows)[0];
    if (!enrolled) fail('Student is not enrolled in the selected class, academic year, and term.', 400, 'STUDENT_ENROLLMENT_NOT_FOUND');
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) fail('Subject is not assigned as a scoring subject for the selected class.', 400);
    const totalScore = caScore + examScore;
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'TERMINAL' });
    const existing = rows(await database.query("SELECT id FROM academic_score_records WHERE school_id=? AND record_type='TERMINAL' AND mock_label IS NULL AND academic_year_id=? AND term_id=? AND class_id=? AND student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=? OR sp.student_id=?) AND subject_id=? LIMIT 1", [schoolId, period.yearId, period.termId, classId, studentId, enrolled.permanent_student_id, subjectId]))[0];
    const scoreId = existing?.id ?? idFactory();
    if (existing) await database.execute('UPDATE academic_score_records SET ca_score=?,examination_score=?,total_score=?,grade=?,remark=?,entered_by=?,updated_at=? WHERE id=? AND school_id=?', [caScore, examScore, totalScore, grade, remark, actor.id, clock(), scoreId, schoolId]);
    else {
      const profile = rows(await database.query('SELECT id FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 1', [schoolId, studentId, enrolled.permanent_student_id]))[0];
      if (!profile) fail('Student profile is unavailable for score persistence.', 409);
      await database.execute('INSERT INTO academic_score_records (id,school_id,record_type,academic_year_id,term_id,class_id,student_id,subject_id,ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, 'TERMINAL', period.yearId, period.termId, classId, profile.id, subjectId, caScore, 50, examScore, 50, totalScore, grade, remark, actor.id, clock()]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, academicYear: period.yearName, term: period.termName, caScore, examScore, totalScore, grade, remark, saved: true };
  }

  async function mockRoster(input = {}, actor) {
    assertActor(actor);
    if (isSampleModeEnabled(input)) {
      const samples = (students?.listStudents?.({ requestedSchoolId: schoolId, includeTestRecords: true }) ?? []).filter((student) => student.schoolId === schoolId && student.isTestRecord === true && SAMPLE_STUDENT_IDS.includes(student.permanentStudentId));
      if (!samples.length) return [];
      const mockLabel = text(input.mockLabel);
      if (!mockLabel) fail('Class, subject, and Mock Examination are required.');
      const result = [];
      for (const sample of samples) {
        const scores = await listScores({ ...input, studentId: sample.id }, actor, { mock: true });
        const score = scores.find((row) => row.subjectId === text(input.subjectId));
        result.push({ studentId: sample.id, permanentStudentId: sample.permanentStudentId, studentName: [sample.firstName, sample.middleName, sample.surname].filter(Boolean).join(' '), classId: text(input.classId), subjectId: text(input.subjectId), totalScore: score?.totalScore ?? null, grade: score?.grade ?? null, saved: Boolean(score), isTestRecord: true });
      }
      return result;
    }
    if (!authorized(actor, 'mock.scores.read') && !authorized(actor, 'mock.scores.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), subjectId = text(input.subjectId), mockLabel = text(input.mockLabel);
    await assertMockClass(classId);
    if (!subjectId || !MOCK_TYPES.includes(mockLabel)) fail('Class, subject, and Mock Examination are required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) return [];
    const rosterProjection = `SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,s.gender,
      r.total_score AS totalScore,r.grade,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      LEFT JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id)
      LEFT JOIN academic_score_records r ON r.school_id=e.school_id AND r.student_id=sp.id AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=? AND r.term_id=? AND r.record_type='MOCK' AND r.mock_label=?
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND s.is_test_record IS NOT TRUE`;
    const rosterParams = [subjectId, period.yearId, period.termId, mockLabel, schoolId, classId, period.yearId, period.termId, schoolId];
    let query = `${rosterProjection} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE ORDER BY s.last_name,s.first_name,s.id`;
    let result;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { result = await database.query(query, rosterParams); break; }
      catch (error) {
        if (missingOptionalEnrollmentStateColumn(error) && query.includes('COALESCE(e.enrollment_status')) { query = query.replace(" AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE", ''); continue; }
        if (missingOptionalStudentTestRecordColumn(error) && query.includes('s.is_test_record IS NOT TRUE')) { query = query.replace('s.is_test_record IS NOT TRUE', "s.permanent_student_id NOT LIKE 'OSAAH-DEMO-%' AND s.permanent_student_id NOT LIKE 'OSAAH/DEMO/%'"); continue; }
        if (missingOptionalStudentStatusColumn(error) && query.includes("COALESCE(s.student_status,'ACTIVE')='ACTIVE'")) { query = query.replace(" AND COALESCE(s.student_status,'ACTIVE')='ACTIVE'", ''); continue; }
        throw error;
      }
    }
    if (!result) throw new Error('Mock Score Entry roster query did not return a result.');
    return rows(result).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), gender: item.gender ?? null, classId, subjectId, totalScore: item.totalScore == null ? null : Number(item.totalScore), grade: item.grade ?? null, saved: Boolean(item.scoreId) }));
  }

  async function saveMockScore(input = {}, actor) {
    assertActor(actor, 'mock.scores.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId), mockLabel = text(input.mockLabel);
    const totalScore = Number(input.totalScore);
    if (!classId || !subjectId || !studentId || !MOCK_TYPES.includes(mockLabel)) fail('Student, class, subject, Mock Examination, and Total Score are required.');
    await assertMockClass(classId);
    if (input.caScore !== undefined || input.examScore !== undefined) fail('Mock scores accept Total Score / 100 only.');
    if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) fail('Score must be between 0 and 100.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const enrollmentSql = 'SELECT e.student_id,s.permanent_student_id,c.name AS className FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE e.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?';
    const enrollmentParams = [schoolId, studentId, classId, period.yearId, period.termId];
    let enrolledRows;
    try { enrolledRows = await database.query(`${enrollmentSql} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE LIMIT 1`, enrollmentParams); }
    catch (error) {
      if (!missingOptionalEnrollmentStateColumn(error)) throw error;
      enrolledRows = await database.query(`${enrollmentSql} LIMIT 1`, enrollmentParams);
    }
    const enrolled = rows(enrolledRows)[0];
    if (!enrolled) fail('Student is not enrolled in the selected class and academic year.', 400);
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) fail('Subject is not assigned as a scoring subject for the selected class.', 400);
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'MOCK' });
    const existing = rows(await database.query("SELECT id FROM academic_score_records WHERE school_id=? AND record_type='MOCK' AND mock_label=? AND academic_year_id=? AND term_id=? AND class_id=? AND student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=? OR sp.student_id=?) AND subject_id=? LIMIT 1", [schoolId, mockLabel, period.yearId, period.termId, classId, studentId, enrolled.permanent_student_id, subjectId]))[0];
    const scoreId = existing?.id ?? idFactory();
    if (existing) await database.execute('UPDATE academic_score_records SET ca_score=0,ca_max=0,examination_score=?,examination_max=100,total_score=?,grade=?,remark=?,entered_by=?,updated_at=? WHERE id=? AND school_id=?', [totalScore, totalScore, grade, remark, actor.id, clock(), scoreId, schoolId]);
    else {
      const profile = rows(await database.query('SELECT id FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 1', [schoolId, studentId, enrolled.permanent_student_id]))[0];
      if (!profile) fail('Student profile is unavailable for score persistence.', 409);
      await database.execute('INSERT INTO academic_score_records (id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, 'MOCK', mockLabel, period.yearId, period.termId, classId, profile.id, subjectId, 0, 0, totalScore, 100, totalScore, grade, remark, actor.id, clock()]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, mockLabel, academicYear: period.yearName, term: period.termName, caScore: null, examScore: null, totalScore, grade, remark, saved: true };
  }

  async function listScores(input = {}, actor, { mock = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.scores.read' : 'results.read') && !authorized(actor, mock ? 'mock.scores.write' : 'marks.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), studentId = text(input.studentId), subjectId = text(input.subjectId);
    const academicYear = text(input.academicYearId || input.academicYear), term = text(input.termId || input.term);
    if (!academicYear || !term) return [];
    const period = await resolvePeriod(input);
    const conditions = ['r.school_id=?', 'r.record_type=?', 'r.academic_year_id=?', 'r.term_id=?'];
    const params = [schoolId, mock ? 'MOCK' : 'TERMINAL', period.yearId, period.termId];
    if (classId) { conditions.push('r.class_id=?'); params.push(classId); }
    if (studentId) { conditions.push('(s.id=? OR s.permanent_student_id=? OR sp.student_master_id=?)'); params.push(studentId, studentId, studentId); }
    if (subjectId) { conditions.push('r.subject_id=?'); params.push(subjectId); }
    if (mock) { conditions.push('r.mock_label=?'); params.push(text(input.mockLabel)); }
    else conditions.push('r.mock_label IS NULL');
    const result = await database.query(`SELECT r.id,r.school_id AS schoolId,sp.student_master_id AS studentId,s.permanent_student_id AS permanentStudentId,r.class_id AS classId,r.subject_id AS subjectId,r.record_type AS recordType,r.mock_label AS mockLabel,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.grade,r.remark,r.updated_at AS updatedAt
      FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id JOIN students s ON (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND s.school_id=r.school_id
      WHERE ${conditions.join(' AND ')} ORDER BY s.last_name,s.first_name,s.id,r.subject_id`, params);
    return rows(result).map((item) => ({ ...item, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore) }));
  }

  async function canonicalResult(input = {}, actor, { mock = false, skipRank = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.results.read' : 'results.read') && !authorized(actor, mock ? 'mock.results.generate' : 'results.generate')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), studentId = text(input.studentId), mockLabel = mock ? text(input.mockLabel) : null;
    if (!classId || !studentId) fail('Class and student are required.');
    if (mock) await assertMockClass(classId);
    const period = await resolvePeriod(input);
    const classRow = await classFor(classId);
    const studentQuery = `SELECT s.id,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,s.gender,e.class_id AS classId
      FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE s.school_id=? AND s.id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?`;
    const studentParams = [schoolId, studentId, classId, period.yearId, period.termId];
    let studentRows;
    try {
      studentRows = await database.query(`${studentQuery} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE LIMIT 1`, studentParams);
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      studentRows = await database.query(`${studentQuery} LIMIT 1`, studentParams);
    }
    const student = rows(studentRows)[0];
    if (!student) fail('Student is not enrolled in the selected academic context.', 404);
    const scoreRows = rows(await database.query(`SELECT r.subject_id AS subjectId,sub.name AS subjectName,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.updated_at AS updatedAt
      FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id
      WHERE r.school_id=? AND (sp.student_master_id=? OR sp.student_id=?) AND r.class_id=? AND r.academic_year_id=? AND r.term_id=? AND r.record_type=? AND ((r.mock_label IS NULL AND ? IS NULL) OR r.mock_label=?) ORDER BY sub.name,sub.id`, [schoolId, student.id, student.permanentStudentId, classId, period.yearId, period.termId, mock ? 'MOCK' : 'TERMINAL', mockLabel, mockLabel]));
    const subjects = scoreRows.map((row) => { const totalScore = Number(row.totalScore); const [grade, remark] = gradeForTotal(totalScore, { classId: classRow.name, examination: mock ? 'MOCK' : 'TERMINAL' }); return { ...row, caScore: Number(row.caScore), examScore: Number(row.examScore), totalScore, grade, remark, submitted: true }; });
    const canonical = calculateStudentResult(subjects, { classId: classRow.name, examination: mock ? 'MOCK' : 'TERMINAL' });
    const lifecycle = rows(await database.query(`SELECT id,attendance_json AS attendanceJson,assessment_json AS assessmentJson,status,version,saved_at AS savedAt,updated_at AS updatedAt,published_at AS publishedAt
      FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1`, [schoolId, student.id, classId, period.yearId, period.termId, mock ? 'MOCK' : 'TERMINAL', mockLabel, mockLabel]))[0];
    const decode = (value) => { if (!value) return null; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return null; } };
    const resolvedSignatures = signatures?.resolveForStudent?.(student, { academicYear: period.yearName, term: period.termName });
    const report = { headerAsset: '/assets/osaah-result-header.png', resultType: mock ? 'MOCK' : 'TERMINAL', studentId: student.id, studentIndexNumber: student.permanentStudentId, studentName: [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '), gender: student.gender ?? null, classId, className: classRow.name, academicYear: period.yearName, term: period.termName, mockLabel, subjects, totalScore: canonical.totalScore, average: canonical.average ?? 0, percentage: canonical.percentage, subjectsSat: canonical.subjectsSat, totalMaximum: canonical.totalMaximum, aggregateMaximum: canonical.aggregateMaximum, aggregateStatus: canonical.aggregateStatus, aggregate: canonical.aggregate, aggregateSubjects: canonical.aggregateSubjects.map((row) => row.subjectId), grade: gradeForTotal(canonical.average ?? 0, { classId: classRow.name, examination: mock ? 'MOCK' : 'TERMINAL' })[0], remark: gradeForTotal(canonical.average ?? 0, { classId: classRow.name, examination: mock ? 'MOCK' : 'TERMINAL' })[1], attendance: decode(lifecycle?.attendanceJson), assessment: decode(lifecycle?.assessmentJson), signatures: [{ signatoryRole: 'CLASS_TEACHER', name: resolvedSignatures?.classTeacher?.name, ...(resolvedSignatures?.classTeacher?.signature ?? {}) }, { signatoryRole: 'HEADTEACHER', name: resolvedSignatures?.headteacher?.name, ...(resolvedSignatures?.headteacher?.signature ?? {}) }].filter((item) => item.id), lifecycle: lifecycle ? { status: lifecycle.status, dirty: false, version: Number(lifecycle.version), savedAt: lifecycle.savedAt, publishedAt: lifecycle.publishedAt } : { status: 'UNSAVED/INCOMPLETE', dirty: true, version: 0, savedAt: null }, isSample: false };
    if (mock && !skipRank) {
      const cohort = await buildMockBroadsheet({ ...input, classId, academicYear: period.yearId, term: period.termId, mockLabel }, actor);
      const selected = cohort.find((item) => item.studentId === student.id);
      report.classPosition = selected?.classPosition ?? "—";
      report.position = report.classPosition;
      report.classGenderDistribution = selected?.classGenderDistribution ?? { totalBoys: 0, totalGirls: 0, totalStudents: cohort.length };
    }
    return report;
  }
  async function saveResult(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.write') && !authorized(actor, 'marks.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const result = await canonicalResult(input, { ...actor, permissions: new Set(['results.read', 'results.generate']) });
    const attendance = input.attendance ?? {}, assessment = input.assessment ?? {};
    for (const key of ['timesPresent', 'timesAbsent', 'totalSchoolDays']) if (!Number.isFinite(Number(attendance[key])) || Number(attendance[key]) < 0) fail(`${key} has not been captured.`);
    for (const key of ['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks']) if (!text(assessment[key])) fail(`${key} has not been selected.`);
    const existing = rows(await database.query(`SELECT id,version FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1`, [schoolId, result.studentId, result.classId, (await resolvePeriod(input)).yearId, (await resolvePeriod(input)).termId, result.resultType, result.mockLabel, result.mockLabel]))[0];
    const period = await resolvePeriod(input), id = existing?.id ?? idFactory(), now = clock(), version = Number(existing?.version ?? 0) + 1;
    if (existing) await database.execute("UPDATE academic_result_records SET attendance_json=?,assessment_json=?,status='SAVED',version=?,saved_by=?,saved_at=?,updated_at=? WHERE id=? AND school_id=?", [JSON.stringify(attendance), JSON.stringify(assessment), version, actor.id, now, now, id, schoolId]);
    else await database.execute('INSERT INTO academic_result_records (id,school_id,student_id,class_id,academic_year_id,term_id,examination,mock_label,attendance_json,assessment_json,status,version,saved_by,saved_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, result.studentId, result.classId, period.yearId, period.termId, result.resultType, result.mockLabel, JSON.stringify(attendance), JSON.stringify(assessment), 'SAVED', version, actor.id, now, now]);
    return { ...result, attendance, assessment, lifecycle: { status: 'SAVED', dirty: false, version, savedAt: now } };
  }

  async function publishResult(input = {}, actor) {
    assertActor(actor, 'results.publish');
    const period = await resolvePeriod(input);
    const result = await canonicalResult(input, { ...actor, permissions: new Set(['results.read', 'results.generate']) });
    const record = rows(await database.query('SELECT id,status,version FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1', [schoolId, result.studentId, result.classId, period.yearId, period.termId, result.resultType, result.mockLabel, result.mockLabel]))[0];
    if (!record || record.status !== 'SAVED') fail('Save this result before publishing.');
    await database.execute("UPDATE academic_result_records SET status='PUBLISHED',published_by=?,published_at=?,updated_at=? WHERE id=? AND school_id=?", [actor.id, clock(), clock(), record.id, schoolId]);
    return { id: record.id, schoolId, classId: result.classId, academicYear: result.academicYear, term: result.term, examination: result.resultType, mockLabel: result.mockLabel, status: 'PUBLISHED', studentId: result.studentId, isSample: false };
  }

  async function publicationFor(input = {}, actor) {
    assertActor(actor);
    const period = await resolvePeriod(input);
    return rows(await database.query("SELECT id,school_id AS schoolId,class_id AS classId,academic_year_id AS academicYearId,term_id AS termId,examination,mock_label AS mockLabel,status,student_id AS studentId,published_at AS publishedAt FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND status='PUBLISHED' AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1", [schoolId, input.studentId, input.classId, period.yearId, period.termId, input.examination === 'MOCK' ? 'MOCK' : 'TERMINAL', input.mockLabel ?? null, input.mockLabel ?? null]))[0] ?? null;
  }

  async function broadsheet(input = {}, actor, { mock = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.results.read' : 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    if (mock) await assertMockClass(classId);
    const subjectId = text(input.subjectId);
    if (!subjectId) fail('Subject is required.', 400, 'SUBJECT_REQUIRED');
    const catalog = await listSubjects({ classId, academicYearId: period.yearId }, actor);
    if (!catalog.some((subject) => String(subject.id) === subjectId)) fail('Subject is not configured for the selected class and academic context.', 400, 'CLASS_SUBJECT_MISMATCH');
    if (actor?.roleKey === 'TEACHER' && !authorized(actor, 'academics.manage') && !(actor.assignedSubjectIds ?? []).map(String).includes(subjectId)) fail('Subject is outside your assignment.', 403, 'SUBJECT_SCOPE_DENIED');
    let rosterSql = `SELECT DISTINCT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname
      FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND s.permanent_student_id NOT LIKE 'OSAAH-DEMO-%' AND s.permanent_student_id NOT LIKE 'OSAAH/DEMO/%' ORDER BY s.last_name,s.first_name,s.id`;
    const rosterParams = [schoolId, classId, period.yearId, period.termId];
    let students;
    try { students = rows(await database.query(`${rosterSql.replace(' ORDER BY', " AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,TRUE) IS TRUE ORDER BY")}`, rosterParams)); }
    catch (error) {
      if (!missingOptionalEnrollmentStateColumn(error)) throw error;
      rosterSql = rosterSql.replace(' AND COALESCE(e.enrollment_status,\'ACTIVE\')=\'ACTIVE\' AND COALESCE(e.is_current,TRUE) IS TRUE', '');
      students = rows(await database.query(rosterSql, rosterParams));
    }
    const assignedSubjects = actor?.roleKey === 'TEACHER' && !authorized(actor, 'academics.manage') ? new Set((actor.assignedSubjectIds ?? []).map(String)) : null;
    if (actor?.roleKey === 'TEACHER' && !assignedSubjects.size) fail('Subject is outside your assignment.', 403, 'SUBJECT_SCOPE_DENIED');
    const results = await Promise.all(students.map(async (student) => {
      const result = await canonicalResult({ ...input, studentId: student.studentId, classId, academicYear: period.yearId, term: period.termId }, actor, { mock });
      const subjects = result.subjects.filter((item) => !assignedSubjects || assignedSubjects.has(String(item.subjectId)));
      const subjectTotals = Object.fromEntries(subjects.map((row) => [row.subjectName, row.totalScore]));
      const subjectGrades = Object.fromEntries(subjects.map((row) => [row.subjectName, row.grade]));
      const subjectCas = Object.fromEntries(subjects.map((row) => [row.subjectName, row.caScore]));
      const subjectExams = Object.fromEntries(subjects.map((row) => [row.subjectName, row.examScore]));
      const calculation = calculateStudentResult(subjects, { classId, examination: mock ? 'MOCK' : 'TERMINAL' });
      const aggregateIds = new Set(result.aggregateSubjects);
      const aggregateRows = subjects.filter((row) => aggregateIds.has(String(row.subjectId)));
      return { studentId: result.studentId, permanentStudentId: result.studentIndexNumber, studentName: result.studentName, gender: result.gender ?? null, classId, subjectTotals, subjectGrades, subjectCas, subjectExams, totalScore: calculation.totalScore, averageScore: calculation.average ?? 0, aggregate: calculation.aggregate, aggregateTotal: aggregateRows.reduce((sum, row) => sum + Number(row.totalScore || 0), 0), aggregateCoreGradeSum: calculation.aggregateStatus === 'COMPLETE' ? aggregateRows.slice(0, 4).reduce((sum, row) => sum + Number(row.grade || 0), 0) : null, percentage: calculation.percentage, classPosition: '—', subjectsSat: calculation.subjectsSat, isSample: false };
    }));
    const positions = calculateClassPositions(results.map(({ studentId, totalScore, aggregate, aggregateTotal, aggregateCoreGradeSum }) => ({ studentId, totalScore, aggregate, aggregateTotal, aggregateCoreGradeSum })), { classId });
    return results.map((item) => ({ ...item, classPosition: positions.get(item.studentId) ?? '—' }));
  }

  async function buildMockBroadsheet(input = {}, actor) {
    const classId = text(input.classId), mockLabel = text(input.mockLabel);
    await assertMockClass(classId);
    if (!MOCK_TYPES.includes(mockLabel)) fail('Mock Examination is required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    const classRow = await classFor(classId);
    const roster = await resultStudents({ ...input, classId, academicYear: period.yearId, term: period.termId, resultType: 'MOCK' }, actor);
    const reports = await Promise.all(roster.map((student) => canonicalResult({ ...input, studentId: student.id, classId, academicYear: period.yearId, term: period.termId, mockLabel }, actor, { mock: true, skipRank: true })));
    const rankingRows = reports.map((result) => {
      const subjects = result.subjects.filter((subject) => !subject.placeholder);
      const aggregateIds = new Set(result.aggregateSubjects.map(String));
      const aggregateRows = subjects.filter((subject) => aggregateIds.has(String(subject.subjectId)));
      const coreNames = new Set(['english language', 'mathematics', 'integrated science', 'science', 'social studies']);
      const coreRows = subjects.filter((subject) => coreNames.has(String(subject.subjectName).trim().toLowerCase()));
      return { studentId: result.studentId, totalScore: result.totalScore, aggregate: result.aggregate, aggregateTotal: aggregateRows.reduce((sum, subject) => sum + Number(subject.totalScore || 0), 0), aggregateCoreGradeSum: coreRows.length === 4 ? coreRows.reduce((sum, subject) => sum + Number(subject.grade || 0), 0) : null };
    });
    const positions = calculateClassPositions(rankingRows, { classId: classRow.name });
    return reports.map((result) => {
      const subjects = result.subjects.filter((subject) => !subject.placeholder);
      return {
        studentId: result.studentId,
        permanentStudentId: result.studentIndexNumber,
        studentName: result.studentName,
        gender: result.gender ?? null,
        classId,
        subjectTotals: Object.fromEntries(subjects.map((subject) => [subject.subjectName, subject.totalScore])),
        subjectGrades: Object.fromEntries(subjects.map((subject) => [subject.subjectName, subject.grade])),
        totalScore: result.totalScore,
        aggregate: result.aggregate,
        classPosition: positions.get(result.studentId) ?? '—',
        classGenderDistribution: {
          totalBoys: reports.filter((item) => String(item.gender ?? '').toUpperCase() === 'MALE').length,
          totalGirls: reports.filter((item) => String(item.gender ?? '').toUpperCase() === 'FEMALE').length,
          totalStudents: reports.length
        },
        isSample: false
      };
    });
  }

  async function mockBroadsheet(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'mock.results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    return buildMockBroadsheet(input, actor);
  }

  return Object.freeze({ options, listSubjects, subjectCatalog, mockSubjectCatalog, subjectConfiguration, createSubject, updateSubject, deactivateSubject, subjectCascade, configureDefaultSubjects, listAssignments, assignSubject, deactivateSubjectAssignment, roster, sampleScoreEntryContext, sampleScoreEntryRoster, resultStudents, resultContext, saveScore, mockRoster, saveMockScore, listScores, resolvePeriod, result: canonicalResult, saveResult, publishResults: publishResult, publicationFor, savedResultFor: async (input, actor) => canonicalResult(input, actor), broadsheet, mockBroadsheet });
}

export default createDurableAcademicService;
