import { normalizeStudentGender } from './student-gender.js';
import { STUDENT_STATUSES } from './attendance.js';
import { CANONICAL_CLASS_IDS, canonicalClassId, displayClassName } from './student-classes.js';

const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 366;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const PRESENT = new Set(['PRESENT', 'LATE']);
const ABSENT = new Set(['ABSENT', 'UNEXCUSED_ABSENCE']);
const EXCUSED = new Set(['EXCUSED_ABSENCE', 'SICK_ABSENCE']);
const CLOSURE = /HOLIDAY|CLOSING|VACATION|NON.?WORKING|CLOSURE|MID.?TERM.?BREAK/i;
const MISSING_SCHEMA = /unknown column|doesn'?t exist|no such table|table .* does not exist/i;

const records = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const fail = (message, status = 400, code = 'STUDENT_ATTENDANCE_OVERVIEW_ERROR') => {
  throw Object.assign(new Error(message), { status, code });
};
function sqlDate(value, label = 'date') {
  const raw = text(value);
  const match = DATE_RE.exec(raw);
  if (!match) fail(`Invalid ${label}; use YYYY-MM-DD.`);
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw) fail(`Invalid ${label}; use a real calendar date.`);
  return raw;
}
function dateObject(value) { return new Date(`${value}T00:00:00.000Z`); }
function dateText(value) { return value.toISOString().slice(0, 10); }
function addDays(value, amount) { const result = dateObject(value); result.setUTCDate(result.getUTCDate() + amount); return dateText(result); }
function minDate(a, b) { return a <= b ? a : b; }
function maxDate(a, b) { return a >= b ? a : b; }
function daysBetween(start, end) { return Math.floor((dateObject(end) - dateObject(start)) / DAY_MS) + 1; }
function asDate(value) {
  if (value == null || value === '') return null;
  const candidate = String(value).slice(0, 10);
  try { return sqlDate(candidate); } catch { return null; }
}
function monthRange(value) {
  const match = MONTH_RE.exec(text(value));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) fail('Month must use YYYY-MM format.');
  const start = `${match[1]}-${match[2]}-01`;
  const end = dateText(new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)));
  return { start, end };
}
function isoWeekRange(value) {
  const match = WEEK_RE.exec(text(value));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) fail('Week must use ISO YYYY-Www format.');
  const year = Number(match[1]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = dateText(new Date(jan4.valueOf() - (weekday - 1) * DAY_MS + (Number(match[2]) - 1) * 7 * DAY_MS));
  const thursday = dateObject(monday); thursday.setUTCDate(thursday.getUTCDate() + 3);
  if (thursday.getUTCFullYear() !== year) fail('Week must identify a valid ISO week.');
  return { start: monday, end: addDays(monday, 6) };
}
function genderGroup(value) {
  const normalized = normalizeStudentGender(value);
  if (normalized === 'Male') return 'BOYS';
  if (normalized === 'Female') return 'GIRLS';
  return 'UNSPECIFIED';
}
function validGenderFilter(value) {
  if (!value) return null;
  const normalized = upper(value).replace(/[\s-]+/g, '_');
  if (['BOYS', 'BOY', 'MALE'].includes(normalized)) return 'BOYS';
  if (['GIRLS', 'GIRL', 'FEMALE'].includes(normalized)) return 'GIRLS';
  if (['UNSPECIFIED', 'OTHER', 'UNKNOWN', 'NOT_SPECIFIED'].includes(normalized)) return 'UNSPECIFIED';
  fail('Gender must be boys, girls, or unspecified.');
}
function validStatusFilter(value) {
  if (!value) return null;
  const status = upper(value);
  if (!STUDENT_STATUSES.includes(status)) fail('Invalid attendance status filter.');
  return status;
}
function isTeacher(actor) { return upper(actor?.roleKey ?? actor?.role) === 'TEACHER'; }
function authorized(actor, schoolId) {
  if (!actor || actor.portal === 'parent' || actor.portal === 'student') fail('Forbidden.', 403, 'ATTENDANCE_SCOPE_DENIED');
  if (!actor.schoolId || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'ATTENDANCE_SCOPE_DENIED');
  const permissions = actor.permissions;
  if (!(permissions?.has?.('*') || permissions?.has?.('attendance.read') || upper(actor.roleKey) === 'PROPRIETOR')) {
    fail('Forbidden.', 403, 'ATTENDANCE_PERMISSION_REQUIRED');
  }
  if (isTeacher(actor) && !Array.isArray(actor.assignedClassIds)) fail('Forbidden.', 403, 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
  if (isTeacher(actor) && actor.assignedClassIds.length === 0) fail('Forbidden.', 403, 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
}
function dateWithin(date, start, end) { return date >= start && date <= end; }
function statusOf(row) { return upper(row.status ?? row.attendanceStatus ?? row.attendance_status); }
function isTestFlag(value) { return value === true || Number(value) === 1 || String(value).trim().toLowerCase() === 'true'; }
function updatedRank(row) { return text(row.updatedAt ?? row.updated_at ?? row.recordedAt ?? row.recorded_at ?? row.enteredAt ?? row.entered_at); }
function effectiveMarks(rows) {
  const byStudentDate = new Map();
  for (const row of rows) {
    if (!row.profileId || !row.date || !STUDENT_STATUSES.includes(statusOf(row))) continue;
    const key = `${row.profileId}\u0000${row.date}`;
    const previous = byStudentDate.get(key);
    const currentVersion = Number(row.version ?? 0);
    const previousVersion = Number(previous?.version ?? 0);
    const currentUpdated = updatedRank(row); const previousUpdated = previous ? updatedRank(previous) : '';
    if (!previous || currentVersion > previousVersion || (currentVersion === previousVersion && currentUpdated > previousUpdated)
      || (currentVersion === previousVersion && currentUpdated === previousUpdated && text(row.id) > text(previous.id))) {
      byStudentDate.set(key, { ...row, status: statusOf(row) });
    }
  }
  return byStudentDate;
}
function safeClassScopes(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch { return []; }
}
function classKey(value, catalog) {
  const raw = text(value);
  if (!raw) return null;
  const mapped = catalog.byId.get(raw);
  return mapped?.canonical ?? canonicalClassId(raw) ?? null;
}
function classMatches(left, right, catalog) {
  const leftKey = classKey(left, catalog);
  const rightKey = classKey(right, catalog);
  return leftKey && rightKey ? leftKey === rightKey : text(left) === text(right);
}
function makeClasses(catalog, requestedCanonical = null, allowedCanonical = null) {
  return CANONICAL_CLASS_IDS
    .filter((canonical) => !requestedCanonical || canonical === requestedCanonical)
    .filter((canonical) => !allowedCanonical || allowedCanonical.has(canonical))
    .map((canonical, index) => {
      const found = catalog.byCanonical.get(canonical);
      return { no: index + 1, classId: found?.id ?? canonical, canonicalClassId: canonical, className: displayClassName(canonical) };
    });
}

export function createStudentAttendanceOverviewService({ database, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  if (!database?.query) fail('Database-backed attendance reporting is unavailable.', 503, 'DATABASE_REQUIRED');
  const query = async (sql, params = []) => records(await database.query(sql, params));

  async function loadYears() {
    return query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', [schoolId]);
  }
  async function loadTerms() {
    return query(`SELECT t.id,t.academic_year_id AS academicYearId,y.name AS academicYearName,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn,t.is_current AS isCurrent
      FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on,t.id`, [schoolId]);
  }
  async function loadClassCatalog() {
    let rows;
    try {
      rows = await query('SELECT c.id,c.name,c.sort_order AS sortOrder,c.status FROM classes c WHERE c.school_id=? ORDER BY c.sort_order,c.id', [schoolId]);
    } catch (error) {
      if (!MISSING_SCHEMA.test(String(error?.message ?? error))) throw error;
      try {
        // Several deployed schema generations have the canonical school_id
        // but lack optional display-order/status columns.
        rows = await query('SELECT c.id,c.name FROM classes c WHERE c.school_id=? ORDER BY c.id', [schoolId]);
      } catch (fallbackError) {
        if (!MISSING_SCHEMA.test(String(fallbackError?.message ?? fallbackError))) throw fallbackError;
        try { rows = await query('SELECT c.id,c.name,c.display_order AS sortOrder FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? ORDER BY c.display_order,c.id', [schoolId]); }
        catch (legacyError) { if (MISSING_SCHEMA.test(String(legacyError?.message ?? legacyError))) rows = []; else throw legacyError; }
      }
    }
    const catalog = { byId: new Map(), byCanonical: new Map() };
    for (const row of rows) {
      const canonical = canonicalClassId(row.name) ?? canonicalClassId(row.id);
      if (!canonical) continue;
      const normalized = { ...row, id: String(row.id), canonical };
      catalog.byId.set(String(row.id), normalized);
      if (!catalog.byCanonical.has(canonical) || upper(catalog.byCanonical.get(canonical).status) !== 'ACTIVE') catalog.byCanonical.set(canonical, normalized);
    }
    return catalog;
  }

  async function options(actor) {
    authorized(actor, schoolId);
    const [years, terms, catalog] = await Promise.all([loadYears(), loadTerms(), loadClassCatalog()]);
    const allowed = isTeacher(actor) ? allowedClasses(actor, catalog) : null;
    return {
      academicYears: years.map(({ id, name, startsOn, endsOn, isCurrent }) => ({ id, name, startsOn, endsOn, isCurrent: Boolean(Number(isCurrent)) })),
      terms: terms.map(({ id, academicYearId, academicYearName, name, startsOn, endsOn, isCurrent }) => ({ id, academicYearId, academicYearName, name, startsOn, endsOn, isCurrent: Boolean(Number(isCurrent)) })),
      classes: makeClasses(catalog, null, allowed)
    };
  }
  function allowedClasses(actor, catalog) {
    if (!isTeacher(actor)) return null;
    const result = new Set();
    for (const value of actor.assignedClassIds ?? []) {
      const canonical = classKey(value, catalog);
      if (canonical) result.add(canonical);
    }
    if (!result.size) fail('Forbidden: no valid assigned-class attendance scope is available.', 403, 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
    return result;
  }
  function resolveYear(input, years, asOfDate) {
    if (input) {
      const match = years.find((year) => String(year.id) === String(input) || String(year.name) === String(input));
      if (!match) fail('Academic year is not available for this school.', 400, 'INVALID_ACADEMIC_YEAR');
      return match;
    }
    return years.find((year) => asDate(year.startsOn) && asDate(year.endsOn) && dateWithin(asOfDate, asDate(year.startsOn), asDate(year.endsOn)))
      ?? years.find((year) => Number(year.isCurrent) === 1 || year.isCurrent === true)
      ?? null;
  }
  function resolveTerm(input, year, terms) {
    if (!input) return null;
    let matches = terms.filter((term) => (String(term.id) === String(input) || String(term.name).toLowerCase() === String(input).toLowerCase())
      && (!year || String(term.academicYearId) === String(year.id)));
    if (matches.length !== 1) fail(matches.length ? 'Term is ambiguous; select an academic year.' : 'Term is not available in the selected academic year.', 400, 'INVALID_TERM');
    if (year && String(matches[0].academicYearId) !== String(year.id)) fail('Term does not belong to the selected academic year.');
    return matches[0];
  }
  function resolveClass(input, catalog, allowed) {
    if (!input) return null;
    const canonical = classKey(input, catalog);
    if (!canonical || !CANONICAL_CLASS_IDS.includes(canonical)) fail('Class is not available in the canonical school class list.', 400, 'INVALID_CLASS');
    if (allowed && !allowed.has(canonical)) fail('Forbidden: class is outside your assignment.', 403, 'ATTENDANCE_CLASS_SCOPE_DENIED');
    return canonical;
  }
  function resolveRange(filters, year, term, asOfDate) {
    const hasStart = Boolean(filters.startDate);
    const hasEnd = Boolean(filters.endDate);
    if (hasStart !== hasEnd) fail('Custom Date Range requires both startDate and endDate.');
    const custom = hasStart ? { start: sqlDate(filters.startDate, 'startDate'), end: sqlDate(filters.endDate, 'endDate') } : null;
    if (custom && custom.start > custom.end) fail('Custom Date Range startDate must be on or before endDate.');
    const periodSelectors = Number(Boolean(custom)) + Number(Boolean(filters.week)) + Number(Boolean(filters.month));
    if (periodSelectors > 1) fail('Choose only one of week, month, or custom range.');
    let range = custom ?? (filters.week ? isoWeekRange(filters.week) : filters.month ? monthRange(filters.month) : filters.asOfDate && !year && !term ? { start: sqlDate(filters.asOfDate, 'asOfDate'), end: sqlDate(filters.asOfDate, 'asOfDate') } : null);
    if (!range) {
      if (term) range = { start: asDate(term.startsOn) ?? asDate(year?.startsOn) ?? asOfDate, end: asDate(term.endsOn) ?? asDate(year?.endsOn) ?? asOfDate };
      else if (year) range = { start: asDate(year.startsOn) ?? asOfDate, end: asDate(year.endsOn) ?? asOfDate };
      else range = { start: asOfDate, end: asOfDate };
    }
    if (year) {
      const start = asDate(year.startsOn); const end = asDate(year.endsOn);
      if (start) range.start = maxDate(range.start, start);
      if (end) range.end = minDate(range.end, end);
    }
    if (term) {
      const start = asDate(term.startsOn); const end = asDate(term.endsOn);
      if (start) range.start = maxDate(range.start, start);
      if (end) range.end = minDate(range.end, end);
    }
    range.end = minDate(range.end, asOfDate);
    if (range.start > range.end) fail('The selected reporting period has not started as of the selected as-of date.');
    const windowDays = daysBetween(range.start, range.end);
    if (windowDays > MAX_WINDOW_DAYS) fail(`Reporting windows cannot exceed ${MAX_WINDOW_DAYS} days.`);
    return range;
  }
  async function loadEnrollments(range, year, term) {
    const clauses = ['e.school_id=?', 's.school_id=?', 'y.school_id=?', 's.is_test_record IS NOT TRUE', 's.permanent_student_id IS NOT NULL', 'sp.id IS NOT NULL', 'y.starts_on<=?', 'y.ends_on>=?'];
    const params = [schoolId, schoolId, schoolId, range.end, range.start];
    if (year) { clauses.push('e.academic_year_id=?'); params.push(year.id); }
    if (term) { clauses.push('(e.term_id IS NULL OR e.term_id=? OR e.term_id=?)'); params.push(term.id, term.name); }
    const sql = `SELECT e.student_id AS masterStudentId,s.permanent_student_id AS permanentStudentId,sp.id AS profileId,
      CASE WHEN UPPER(TRIM(COALESCE(s.gender,''))) IN ('','NOT_SPECIFIED','UNKNOWN','UNSPECIFIED','NOT RECORDED') THEN sp.gender ELSE s.gender END AS gender,s.admission_date AS admissionDate,
      e.class_id AS classId,e.academic_year_id AS academicYearId,y.name AS academicYearName,
      e.term_id AS termId,t.name AS termName,t.starts_on AS termStartsOn,t.ends_on AS termEndsOn,
      e.enrollment_status AS enrollmentStatus,e.is_current AS isCurrent,e.enrolled_at AS enrolledAt,e.completed_at AS completedAt,
      s.is_test_record AS isTestRecord
      FROM student_enrollments e
      JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
      JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=e.school_id
      LEFT JOIN terms t ON t.academic_year_id=e.academic_year_id AND (t.id=e.term_id OR t.name=e.term_id)
      JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id))
      WHERE ${clauses.join(' AND ')} ORDER BY e.enrolled_at,e.id`;
    let candidate = sql;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { return await query(candidate, params); }
      catch (error) {
        if (!MISSING_SCHEMA.test(String(error?.message ?? error))) throw error;
        const message = String(error?.message ?? error).toLowerCase();
        const previous = candidate;
        // Preserve school scope and permanent-ID linkage while tolerating the
        // documented optional fields across production schema revisions.
        if (message.includes('is_test_record')) {
          candidate = candidate.replace('s.is_test_record IS NOT TRUE', "s.permanent_student_id NOT LIKE 'OSAAH-DEMO-%' AND s.permanent_student_id NOT LIKE 'OSAAH/DEMO/%'")
            .replace('s.is_test_record AS isTestRecord', '0 AS isTestRecord');
        }
        if (message.includes('student_master_id')) candidate = candidate.replace('sp.student_master_id=s.id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id)', 'sp.student_id=s.permanent_student_id');
        if (message.includes('enrolled_at')) candidate = candidate.replace('e.enrolled_at AS enrolledAt', 'NULL AS enrolledAt').replace('ORDER BY e.enrolled_at,e.id', 'ORDER BY e.id');
        if (message.includes('completed_at')) candidate = candidate.replace('e.completed_at AS completedAt', 'NULL AS completedAt');
        if (message.includes('enrollment_status')) candidate = candidate.replace('e.enrollment_status AS enrollmentStatus', "'ACTIVE' AS enrollmentStatus");
        if (message.includes('is_current')) candidate = candidate.replace('e.is_current AS isCurrent', '1 AS isCurrent');
        if (candidate === previous) throw error;
      }
    }
    fail('Enrollment history does not match a supported school schema.', 503, 'ENROLLMENT_SCHEMA_UNAVAILABLE');
  }
  async function loadCalendar(range) {
    const params = [schoolId, range.end, range.start];
    const sql = `SELECT start_date AS startDate,end_date AS endDate,category,title,class_scope_json AS classScopeJson,status
      FROM academic_calendar_events WHERE school_id=? AND status='PUBLISHED' AND start_date<=? AND COALESCE(end_date,start_date)>=?`;
    try { return await query(sql, params); }
    catch (error) {
      if (!MISSING_SCHEMA.test(String(error?.message ?? error))) throw error;
      const message = String(error?.message ?? error).toLowerCase();
      if (message.includes('class_scope_json')) {
        return query(`SELECT start_date AS startDate,end_date AS endDate,category,title,'[]' AS classScopeJson,status
          FROM academic_calendar_events WHERE school_id=? AND status='PUBLISHED' AND start_date<=? AND COALESCE(end_date,start_date)>=?`, params);
      }
      fail('Published academic calendar data is unavailable; eligible attendance days cannot be verified.', 503, 'ACADEMIC_CALENDAR_UNAVAILABLE');
    }
  }
  async function loadMarks(range, year, term) {
    const clauses = ['school_id=?', 'attendance_date>=?', 'attendance_date<=?', "COALESCE(subject_key,'daily')='daily'"];
    const params = [schoolId, range.start, range.end];
    if (year) { clauses.push('(academic_year=? OR academic_year=?)'); params.push(year.id, year.name); }
    if (term) { clauses.push('(term=? OR term=?)'); params.push(term.id, term.name); }
    return query(`SELECT id,student_id AS profileId,attendance_date AS date,class_id AS classId,status,version,
      updated_at AS updatedAt,recorded_at AS recordedAt,entered_at AS enteredAt,reason,subject_key AS subjectKey
      FROM student_attendance WHERE ${clauses.join(' AND ')} ORDER BY attendance_date,updated_at,id`, params);
  }
  function buildClosures(events, range, catalog) {
    const global = new Set(); const byClass = new Map();
    for (const event of events) {
      if (!CLOSURE.test(`${event.category ?? ''} ${event.title ?? ''}`)) continue;
      const start = maxDate(asDate(event.startDate) ?? range.start, range.start);
      const end = minDate(asDate(event.endDate) ?? asDate(event.startDate) ?? range.end, range.end);
      const scopes = safeClassScopes(event.classScopeJson);
      const targetClasses = scopes.length ? new Set(scopes.map((scope) => classKey(scope, catalog)).filter(Boolean)) : null;
      for (let date = start; date <= end; date = addDays(date, 1)) {
        if (!targetClasses) global.add(date);
        else for (const classId of targetClasses) {
          if (!byClass.has(classId)) byClass.set(classId, new Set());
          byClass.get(classId).add(date);
        }
      }
    }
    return { global, byClass };
  }
  function buildEnrollmentRoster(enrollments, range, catalog, year, term) {
    const candidates = [];
    for (const row of enrollments) {
      if (!row.profileId || !row.permanentStudentId || isTestFlag(row.isTestRecord) || upper(row.enrollmentStatus) === 'CANCELLED') continue;
      const classId = classKey(row.classId, catalog);
      if (!classId) continue;
      // Term-scoped enrollments must only contribute inside their own term even
      // when the report spans a full academic year; this preserves promotion and
      // transfer history instead of assigning old days to the current class.
      const scopeStart = row.termId != null ? asDate(row.termStartsOn) : null;
      const scopeEnd = row.termId != null ? asDate(row.termEndsOn) : null;
      let start = maxDate(range.start, scopeStart ?? (year ? asDate(year.startsOn) : range.start) ?? range.start);
      let end = minDate(range.end, scopeEnd ?? (year ? asDate(year.endsOn) : range.end) ?? range.end);
      const enrolledAt = asDate(row.enrolledAt);
      const admissionDate = asDate(row.admissionDate);
      const completedAt = asDate(row.completedAt);
      if (enrolledAt) start = maxDate(start, enrolledAt);
      if (admissionDate) start = maxDate(start, admissionDate);
      if (completedAt) end = minDate(end, completedAt);
      if (start > end) continue;
      candidates.push({
        studentKey: String(row.permanentStudentId), profileId: String(row.profileId), permanentStudentId: String(row.permanentStudentId),
        masterStudentId: String(row.masterStudentId ?? ''), classId, gender: genderGroup(row.gender), start, end,
        enrolledAt: enrolledAt ?? start, isCurrent: Number(row.isCurrent) === 1
      });
    }
    return candidates;
  }
  function betterEnrollment(next, previous) {
    if (!previous) return true;
    if (next.enrolledAt !== previous.enrolledAt) return next.enrolledAt > previous.enrolledAt;
    if (next.isCurrent !== previous.isCurrent) return next.isCurrent;
    return next.classId < previous.classId;
  }
  function summarize(enrollments, marks, calendarEvents, range, catalog, filters, allowed) {
    const closures = buildClosures(calendarEvents, range, catalog);
    const candidates = buildEnrollmentRoster(enrollments, range, catalog);
    const genderFilter = filters.gender;
    const candidatesFiltered = candidates.filter((item) => !genderFilter || item.gender === genderFilter)
      .filter((item) => !allowed || allowed.has(item.classId))
      .filter((item) => !filters.classCanonical || item.classId === filters.classCanonical);
    const byStudentDate = new Map();
    const headcounts = new Map();
    const identities = new Map();
    for (const item of candidatesFiltered) {
      if (!headcounts.has(item.classId)) headcounts.set(item.classId, new Map());
      headcounts.get(item.classId).set(item.studentKey, item.gender);
      if (!identities.has(item.studentKey)) identities.set(item.studentKey, item.gender);
      for (let day = item.start; day <= item.end; day = addDays(day, 1)) {
        const weekday = dateObject(day).getUTCDay();
        if (weekday === 0 || weekday === 6 || closures.global.has(day) || closures.byClass.get(item.classId)?.has(day)) continue;
        const key = `${item.studentKey}\u0000${day}`;
        const current = byStudentDate.get(key);
        if (betterEnrollment(item, current)) byStudentDate.set(key, { ...item, date: day });
      }
    }
    const effective = effectiveMarks(marks);
    const countMap = new Map();
    for (const [key, slot] of byStudentDate) {
      const mark = effective.get(`${slot.profileId}\u0000${slot.date}`);
      let countedMark = mark;
      if (countedMark && !classMatches(countedMark.classId, slot.classId, catalog) && text(countedMark.classId)) countedMark = null;
      const filteredOut = Boolean(countedMark && filters.status && countedMark.status !== filters.status);
      const status = countedMark && !filteredOut ? countedMark.status : filteredOut ? 'FILTERED_OUT' : null;
      const result = { slot, status };
      countMap.set(key, result);
    }
    const classRows = makeClasses(catalog, filters.classCanonical, allowed);
    const sums = new Map(classRows.map((item) => [item.canonicalClassId, {
      ...item, totalBoysEnrolled: 0, totalGirlsEnrolled: 0, totalUnspecifiedGenderEnrolled: 0,
      boysPresent: 0, girlsPresent: 0, unspecifiedGenderPresent: 0,
      boysAbsent: 0, girlsAbsent: 0, unspecifiedGenderAbsent: 0,
      totalPresent: 0, totalAbsent: 0, unmarkedStudentDays: 0, eligibleStudentDays: 0, scheduledStudentDays: 0,
      excusedStudentDays: 0, otherMarkedStudentDays: 0, attendancePercentage: 0
    }]));
    for (const [classId, enrolled] of headcounts) {
      const row = sums.get(classId); if (!row) continue;
      for (const gender of enrolled.values()) {
        if (gender === 'BOYS') row.totalBoysEnrolled += 1;
        else if (gender === 'GIRLS') row.totalGirlsEnrolled += 1;
        else row.totalUnspecifiedGenderEnrolled += 1;
      }
    }
    const totals = {
      totalEnrolledStudents: identities.size, boysEnrolled: 0, girlsEnrolled: 0, unspecifiedGenderEnrolled: 0,
      presentStudentDays: 0, absentStudentDays: 0, unmarkedStudentDays: 0, eligibleStudentDays: 0, scheduledStudentDays: 0,
      excusedStudentDays: 0, otherMarkedStudentDays: 0, attendancePercentage: 0, unspecifiedGenderPresent: 0, unspecifiedGenderAbsent: 0
    };
    for (const gender of identities.values()) {
      if (gender === 'BOYS') totals.boysEnrolled += 1;
      else if (gender === 'GIRLS') totals.girlsEnrolled += 1;
      else totals.unspecifiedGenderEnrolled += 1;
    }
    for (const { slot, status } of countMap.values()) {
      const row = sums.get(slot.classId); if (!row) continue;
      row.scheduledStudentDays += 1; totals.scheduledStudentDays += 1;
      // The established attendance policy excludes approved/sick excused marks
      // from eligible attendance days, while keeping them visible separately.
      if (status && EXCUSED.has(status)) {
        row.excusedStudentDays += 1; totals.excusedStudentDays += 1; continue;
      }
      row.eligibleStudentDays += 1; totals.eligibleStudentDays += 1;
      if (!status) { row.unmarkedStudentDays += 1; totals.unmarkedStudentDays += 1; continue; }
      if (status === 'FILTERED_OUT') continue;
      const prefix = slot.gender === 'BOYS' ? 'boys' : slot.gender === 'GIRLS' ? 'girls' : 'unspecifiedGender';
      if (PRESENT.has(status)) {
        row[`${prefix}Present`] += 1; row.totalPresent += 1;
        totals.presentStudentDays += 1;
        if (slot.gender === 'UNSPECIFIED') totals.unspecifiedGenderPresent += 1;
      } else if (ABSENT.has(status)) {
        row[`${prefix}Absent`] += 1; row.totalAbsent += 1;
        totals.absentStudentDays += 1;
        if (slot.gender === 'UNSPECIFIED') totals.unspecifiedGenderAbsent += 1;
      } else {
        row.otherMarkedStudentDays += 1; totals.otherMarkedStudentDays += 1;
      }
    }
    for (const row of sums.values()) {
      row.attendancePercentage = row.eligibleStudentDays ? Math.round(row.totalPresent / row.eligibleStudentDays * 10000) / 100 : 0;
    }
    totals.attendancePercentage = totals.eligibleStudentDays ? Math.round(totals.presentStudentDays / totals.eligibleStudentDays * 10000) / 100 : 0;
    const overall = {
      no: '', classId: null, canonicalClassId: null, className: 'Overall Totals',
      totalBoysEnrolled: totals.boysEnrolled, totalGirlsEnrolled: totals.girlsEnrolled,
      totalUnspecifiedGenderEnrolled: totals.unspecifiedGenderEnrolled,
      boysPresent: 0, girlsPresent: 0, unspecifiedGenderPresent: totals.unspecifiedGenderPresent,
      boysAbsent: 0, girlsAbsent: 0, unspecifiedGenderAbsent: totals.unspecifiedGenderAbsent,
      totalPresent: totals.presentStudentDays, totalAbsent: totals.absentStudentDays,
      unmarkedStudentDays: totals.unmarkedStudentDays, eligibleStudentDays: totals.eligibleStudentDays, scheduledStudentDays: totals.scheduledStudentDays,
      excusedStudentDays: totals.excusedStudentDays, otherMarkedStudentDays: totals.otherMarkedStudentDays, attendancePercentage: totals.attendancePercentage
    };
    for (const row of sums.values()) {
      overall.boysPresent += row.boysPresent; overall.girlsPresent += row.girlsPresent;
      overall.boysAbsent += row.boysAbsent; overall.girlsAbsent += row.girlsAbsent;
    }
    return { classes: [...sums.values(), overall], summary: totals };
  }

  async function overview(inputFilters = {}, actor = null) {
    authorized(actor, schoolId);
    const filters = { ...inputFilters };
    const today = sqlDate(text(now()).slice(0, 10), 'current date');
    const asOfDate = sqlDate(filters.asOfDate ?? today, 'asOfDate');
    if (asOfDate > today) fail('As-of Date cannot be in the future.');
    // Do not treat the default as-of date as an explicit competing period selector.
    const explicitAsOf = filters.asOfDate ? asOfDate : null;
    filters.asOfDate = undefined;
    const requestedStatus = validStatusFilter(filters.status);
    const gender = validGenderFilter(filters.gender);
    const [years, terms, catalog] = await Promise.all([loadYears(), loadTerms(), loadClassCatalog()]);
    const hasDateSelector = Boolean(filters.week || filters.month || filters.startDate || filters.endDate);
    const selectedYear = filters.academicYear
      ? resolveYear(filters.academicYear, years, asOfDate)
      : hasDateSelector ? null : resolveYear(null, years, asOfDate);
    const selectedTerm = resolveTerm(filters.term, selectedYear, terms);
    const effectiveYear = selectedYear ?? (selectedTerm ? years.find((year) => String(year.id) === String(selectedTerm.academicYearId)) ?? null : null);
    const allowed = allowedClasses(actor, catalog);
    const classCanonical = resolveClass(filters.classId ?? filters.class, catalog, allowed);
    const range = resolveRange({ ...filters, asOfDate: explicitAsOf }, effectiveYear, selectedTerm, asOfDate);
    if (isTeacher(actor) && !allowed) fail('Forbidden.', 403, 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
    const boundedFilters = {
      ...filters, gender, status: requestedStatus, classCanonical,
      academicYear: effectiveYear?.id ?? null, term: selectedTerm?.id ?? null
    };
    const [enrollments, marks, calendarEvents] = await Promise.all([
      loadEnrollments(range, effectiveYear, selectedTerm), loadMarks(range, effectiveYear, selectedTerm), loadCalendar(range)
    ]);
    const report = summarize(enrollments, marks, calendarEvents, range, catalog, boundedFilters, allowed);
    return {
      filters: {
        academicYear: effectiveYear ? { id: effectiveYear.id, name: effectiveYear.name } : null,
        term: selectedTerm ? { id: selectedTerm.id, name: selectedTerm.name } : null,
        classId: classCanonical, gender, status: requestedStatus, week: inputFilters.week ?? null, month: inputFilters.month ?? null,
        startDate: range.start, endDate: range.end, asOfDate
      },
      periodLabel: `${range.start} – ${range.end}`,
      classes: report.classes,
      summary: report.summary,
      options: {
        academicYears: years.map(({ id, name, startsOn, endsOn, isCurrent }) => ({ id, name, startsOn, endsOn, isCurrent: Boolean(Number(isCurrent)) })),
        terms: terms.map(({ id, academicYearId, academicYearName, name, startsOn, endsOn, isCurrent }) => ({ id, academicYearId, academicYearName, name, startsOn, endsOn, isCurrent: Boolean(Number(isCurrent)) })),
        classes: makeClasses(catalog, null, allowed)
      },
      calculationPolicy: {
        presentStatuses: [...PRESENT], absentStatuses: [...ABSENT], excusedStatuses: [...EXCUSED],
        attendancePercentage: 'present eligible student-days / eligible student-days * 100; approved/sick excused days are excluded from eligibility per the existing attendance policy',
        unmarkedIsNotAbsent: true, oneEffectiveDailyMarkPerStudentDate: true
      },
      source: 'student_attendance + student_enrollments', authoritative: true
    };
  }
  return Object.freeze({ overview, options });
}

export default createStudentAttendanceOverviewService;
