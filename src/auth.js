import bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { createDurableStaffProvisioning } from './durable-staff-provisioning.js';
import { ROLE_KEYS } from './roles.js';
import { createDurableAdministratorCredentialReset } from './durable-administrator-credential-reset.js';
import { createDurableCredentialManagement, generatedPassword, passwordMeetsPolicy } from './durable-credential-management.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR = 'Incorrect username or password.';
const PARENT_GENERIC_LOGIN_ERROR = 'Unable to sign in. Check the phone number or contact the school.';
const PARENT_PHONE_LOGIN_LIMIT = 10;
const PARENT_PHONE_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const POSTGRES_DIAGNOSTIC_FIELDS = Object.freeze(['schema', 'table', 'column', 'constraint', 'routine']);
const AUTH_SESSION_DIAGNOSTICS = process.env.OSAAH_AUTH_SESSION_DIAGNOSTICS === '1';
const AUTH_PROCESS_INSTANCE_ID = randomUUID();
function safeDiagnosticIdentifier(value) { return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value) ? value : null; }
function safeRequestId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null; }
function safeDiagnosticCode(value) { return typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/.test(value) ? value : null; }
function safeAuthenticationStack(stack) {
  if (typeof stack !== 'string') return null;
  return stack.split('\n').slice(1, 9).map((line) => line.trim()
    .replace(/(?:mysql|postgres(?:ql)?|https?):\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/\bBearer\s+[^\s)]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|secret|token|connection[_ -]?string)\s*[:=]\s*[^\s,;)]+/gi, '$1=[redacted]')
    .slice(0, 300));
}
function safeDiagnosticText(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/failing row contains/i.test(value)) return '[redacted-row-detail]';
  const sanitized = value.slice(0, 1000)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|secret|token|access[_ -]?code|connection[_ -]?string)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/'[^']*'|\"[^\"]*\"/g, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:\+?\d[\d ()-]{6,}\d)\b/g, '[redacted-number]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted-id]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
    .replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  if (!sanitized) return null;
  const safeForms = [
    /^relation \[redacted\] does not exist$/i,
    /^column (?:\[redacted\]|[A-Za-z_][A-Za-z0-9_$.]*) does not exist$/i,
    /^column \[redacted\] of relation \[redacted\] does not exist$/i,
    /^permission denied for (?:table|sequence|schema|relation) \[redacted\]$/i,
    /^duplicate key value violates unique constraint \[redacted\]$/i,
    /^null value in column \[redacted\] of relation \[redacted\] violates not-null constraint$/i,
    /^insert or update on table \[redacted\] violates foreign key constraint \[redacted\]$/i,
    /^new row for relation \[redacted\] violates check constraint \[redacted\]$/i,
    /^current transaction is aborted, commands ignored until end of transaction block$/i,
    /^syntax error at or near \[redacted\]$/i,
  ];
  return safeForms.some((pattern) => pattern.test(sanitized)) ? sanitized : '[redacted-diagnostic-text]';
}
function postgresObjectNames(message) {
  const text = typeof message === 'string' ? message : '';
  const relation = text.match(/\brelation\s+["']?([A-Za-z_][A-Za-z0-9_$]*)["']?\s+does not exist/i);
  const column = text.match(/\bcolumn\s+["']?([A-Za-z_][A-Za-z0-9_$.]*)["']?\s+does not exist/i);
  const denied = text.match(/\bpermission denied for (?:table|sequence)\s+["']?([A-Za-z_][A-Za-z0-9_$]*)["']/i);
  return { table: safeDiagnosticIdentifier(relation?.[1] ?? denied?.[1]), column: safeDiagnosticIdentifier(column?.[1]) };
}
function schoolLoginDiagnostics(error, { requestId, requestPath } = {}) {
  const parsed = postgresObjectNames(error?.message);
  const sqlState = /^[0-9A-Z]{5}$/.test(error?.sqlState ?? '') ? error.sqlState : (/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null);
  const category = ['ER_BAD_FIELD_ERROR'].includes(error?.code) || ['42703', '42S22'].includes(sqlState)
    ? 'SCHEMA_COLUMN_MISMATCH'
    : ['ER_NO_SUCH_TABLE'].includes(error?.code) || ['42P01', '42S02'].includes(sqlState)
      ? 'SCHEMA_TABLE_MISSING'
      : sqlState === '3F000'
        ? 'SCHEMA_NOT_FOUND'
        : sqlState === '42501'
          ? 'DATABASE_PERMISSION_DENIED'
          : 'DATABASE_QUERY_FAILED';
  const diagnostic = {
    component: 'school_authentication', operation: 'login_lookup', stage: 'user_query_failed',
    category,
    requestId: safeRequestId(requestId) ?? randomUUID(),
    requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(requestPath) ? requestPath : null,
    name: safeDiagnosticIdentifier(error?.name), code: safeDiagnosticCode(error?.code),
    sqlState, severity: safeDiagnosticIdentifier(error?.severity),
    errno: Number.isSafeInteger(error?.errno) ? error.errno : null,
    message: safeDiagnosticText(error?.message),
    detail: error?.detail ? '[redacted-diagnostic-text]' : null,
    hint: error?.hint ? '[redacted-diagnostic-text]' : null,
    context: error?.where ? '[redacted-diagnostic-text]' : null,
    stack: safeAuthenticationStack(error?.stack),
  };
  for (const field of POSTGRES_DIAGNOSTIC_FIELDS) diagnostic[field] = safeDiagnosticIdentifier(error?.[field]) ?? (field === 'table' || field === 'column' ? parsed[field] : null);
  return diagnostic;
}
const PARENT_PERMISSIONS = Object.freeze(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read']);
export const SCHOOL_PORTAL_ROLE_ALIASES = Object.freeze({ ADMINISTRATOR: 'SCHOOL_ADMIN', SCHOOL_ADMINISTRATOR: 'SCHOOL_ADMIN', ACCOUNTANT: 'ACCOUNTANT_BURSAR', CLASSROOM_TEACHER: 'TEACHER', PROPRIETOR: 'PROPRIETOR', PROPRIETRESS: 'PROPRIETOR', SCHOOL_PROPRIETOR: 'PROPRIETOR', SCHOOL_PROPRIETRESS: 'PROPRIETOR' });
export const SCHOOL_PORTAL_DASHBOARDS = Object.freeze({ PROPRIETOR: '/', SCHOOL_ADMIN: '/settings', HEADTEACHER: '/academics', ASSISTANT_HEADTEACHER: '/academics', ACCOUNTANT_BURSAR: '/fees', TEACHER: '/academics', DEVELOPER: '/developer/communication-setup' });
const STAFF_ASSIGNABLE_ROLES = Object.freeze({ SCHOOL_ADMIN: 'SCHOOL_ADMIN', ADMINISTRATOR: 'SCHOOL_ADMIN', HEADTEACHER: 'HEADTEACHER', ASSISTANT_HEADTEACHER: 'ASSISTANT_HEADTEACHER', ACCOUNTANT: 'ACCOUNTANT_BURSAR', ACCOUNTANT_BURSAR: 'ACCOUNTANT_BURSAR', CLASSROOM_TEACHER: 'TEACHER', TEACHER: 'TEACHER' });
const ROLE_PERMISSIONS = Object.freeze({ HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'announcements.create', 'calendar.read', 'calendar.write', 'reports.read', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.delete', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'subject_register.manage', 'subject_register.assign_teacher', 'subject_register.activate', 'subject_register.deactivate', 'subject_register.copy_register', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports', 'staff.attendance.read', 'staff.attendance.write'], ASSISTANT_HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'announcements.create', 'calendar.read', 'calendar.write', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.delete', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'subject_register.manage', 'subject_register.assign_teacher', 'subject_register.activate', 'subject_register.deactivate', 'subject_register.copy_register', 'staff.attendance.read', 'staff.attendance.write'], ACCOUNTANT_BURSAR: ['students.read', 'fees.read', 'fees.write', 'finance.read', 'fees.configure', 'fees.collect'], TEACHER: ['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'calendar.read', 'messages.read', 'messages.write', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports'] });
for (const roleKey of ['HEADTEACHER', 'ASSISTANT_HEADTEACHER']) ROLE_PERMISSIONS[roleKey].push('admissions.write');
ROLE_PERMISSIONS.HEADTEACHER.push('messages.sms.send');
export function canonicalRoleKey(roleKey) { const normalized = String(roleKey ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return SCHOOL_PORTAL_ROLE_ALIASES[normalized] ?? normalized; }

function addStaffAttendanceRoleGrants(user) { if (['HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(canonicalRoleKey(user?.roleKey))) { user.permissions.add('staff.attendance.read'); user.permissions.add('staff.attendance.write'); } return user; }

function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; }
function passwordMatches(password, stored) { const [salt, expected] = stored.split(':'); const actual = scryptSync(password, salt, 32); return timingSafeEqual(actual, Buffer.from(expected, 'hex')); }
export const DEMO_USERS = [
  { id: 'user-proprietor-1', username: 'proprietor@osaah.edu.gh', passwordHash: passwordHash('Synthetic-Proprietor-Test-Only-2026!', 'proprietor-salt'), portal: 'school', roleKey: 'PROPRIETOR', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) },
  { id: 'user-teacher-1', username: 'teacher@osaah.edu.gh', passwordHash: passwordHash('Teacher123!', 'teacher-salt'), portal: 'school', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'messages.read', 'messages.write', 'discipline.read', 'discipline.write', 'property.request', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports']), assignedStudentIds: ['student-1'], assignedParentIds: ['user-parent-1'] },
  { id: 'user-hr-1', username: 'hr@osaah.edu.gh', passwordHash: passwordHash('HumanResources123!', 'hr-salt'), portal: 'school', roleKey: 'HR_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['staff.read', 'staff.write', 'hr.read', 'hr.write', 'hr.confidential.read', 'leave.read', 'leave.write', 'staff.attendance.read', 'staff.attendance.write']) },
  { id: 'user-examination-1', username: 'exams@osaah.edu.gh', passwordHash: passwordHash('Examination123!', 'examination-salt'), portal: 'school', roleKey: 'EXAMINATION_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['examinations.read', 'examinations.write', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'results.approve', 'promotion.write']) },
  { id: 'user-bursar-1', username: 'bursar@osaah.edu.gh', passwordHash: passwordHash('Bursar123!', 'bursar-salt'), portal: 'school', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'fees.read', 'fees.write', 'fees.configure', 'fees.collect', 'fee.scholarships.view', 'finance.read', 'hr.confidential.read']) },
  { id: 'user-librarian-1', username: 'librarian@osaah.edu.gh', passwordHash: passwordHash('Librarian123!', 'librarian-salt'), portal: 'school', roleKey: 'LIBRARIAN', schoolId: 'school-osaah-daylight', permissions: new Set(['library.read', 'library.write']) },
  { id: 'user-transport-1', username: 'transport@osaah.edu.gh', passwordHash: passwordHash('Transport123!', 'transport-salt'), portal: 'school', roleKey: 'TRANSPORT_MANAGER', schoolId: 'school-osaah-daylight', permissions: new Set(['transport.read', 'transport.write', 'transport.gps.view']) },
  { id: 'user-matron-1', username: 'matron@osaah.edu.gh', passwordHash: passwordHash('Matron12345!', 'matron-salt'), portal: 'school', roleKey: 'HOSTEL_MANAGER_MATRON', schoolId: 'school-osaah-daylight', permissions: new Set(['hostel.read', 'hostel.write', 'hostel.attendance.read']) },
  { id: 'user-health-1', username: 'health@osaah.edu.gh', passwordHash: passwordHash('HealthOfficer123!', 'health-salt'), portal: 'school', roleKey: 'HEALTH_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['health.read', 'health.write']) },
  { id: 'user-counsellor-1', username: 'counsellor@osaah.edu.gh', passwordHash: passwordHash('Counsellor123!', 'counsellor-salt'), portal: 'school', roleKey: 'COUNSELLOR', schoolId: 'school-osaah-daylight', permissions: new Set(['counselling.read', 'counselling.write']) },
  { id: 'user-storekeeper-1', username: 'storekeeper@osaah.edu.gh', passwordHash: passwordHash('Storekeeper123!', 'storekeeper-salt'), portal: 'school', roleKey: 'STOREKEEPER', schoolId: 'school-osaah-daylight', permissions: new Set(['inventory.read', 'inventory.write']) },
  { id: 'user-procurement-1', username: 'procurement@osaah.edu.gh', passwordHash: passwordHash('Procurement123!', 'procurement-salt'), portal: 'school', roleKey: 'PROCUREMENT_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['procurement.read', 'procurement.write']) },
  { id: 'user-property-1', username: 'property@osaah.edu.gh', passwordHash: passwordHash('PropertyManager123!', 'property-salt'), portal: 'school', roleKey: 'PROPERTY_MANAGER', schoolId: 'school-osaah-daylight', permissions: new Set(['assets.read', 'assets.write', 'property.read', 'property.write']) },
  { id: 'user-compliance-1', username: 'compliance@osaah.edu.gh', passwordHash: passwordHash('Compliance123!', 'compliance-salt'), portal: 'school', roleKey: 'COMPLIANCE_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['compliance.read', 'compliance.write', 'documents.read', 'documents.write']) },
  { id: 'user-dpo-1', username: 'dpo@osaah.edu.gh', passwordHash: passwordHash('DataProtection123!', 'dpo-salt'), portal: 'school', roleKey: 'DATA_PROTECTION_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['privacy.read', 'privacy.write', 'documents.read']) }
];

export function createAuthService({ users = DEMO_USERS, database = null, now = () => Date.now(), audit = () => {}, sessionSecret = process.env.OSAAH_SESSION_SECRET, sessionDiagnostics = AUTH_SESSION_DIAGNOSTICS } = {}) {
  users = users.map((user) => addStaffAttendanceRoleGrants({ ...user, permissions: new Set(user.permissions), children: user.children?.map((child) => ({ ...child })) }));
  const sessions = new Map(); const durableSessionIds = new Set(); const revokedSessionIds = new Set(); const attempts = new Map(); const resetTokens = new Map();
  const administratorAssignments = [];
  const durableStaff = database?.query && database?.execute && database?.transaction ? createDurableStaffProvisioning({ database, passwordHash, verifyLogin: (credentials) => loginFromDatabase(credentials), revokeSession: (token) => logoutSession(token), now }) : null;
  const durableAdministratorCredentialReset = database?.supportsDurableAuthSessions && database?.query && database?.execute && database?.transaction ? createDurableAdministratorCredentialReset({ database, passwordHash, now }) : null;
  const durableCredentialManagement = database?.query && database?.execute && database?.transaction ? createDurableCredentialManagement({ database, passwordHash, now }) : null;
  async function resetAdministratorCredentialsByEmail(email, newPassword, schoolId) {
    if (!durableAdministratorCredentialReset) { const error = new Error('Durable Administrator credential reset is unavailable.'); error.status = 503; error.code = 'PERSISTENCE_UNAVAILABLE'; throw error; }
    return durableAdministratorCredentialReset.resetByEmail(email, newPassword, schoolId);
  }
  const signingKey = typeof sessionSecret === 'string' && sessionSecret.length >= 32 ? sessionSecret : null;
  const durableSessionStore = Boolean(database?.supportsDurableAuthSessions && database?.query && database?.execute);
  const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');
  const fingerprint = (value) => value ? createHash('sha256').update(String(value)).digest('hex').slice(0, 20) : null;
  function databaseTargetFingerprint() {
    const dialect = ['tidb', 'postgres', 'mysql'].includes(database?.dialect) ? database.dialect : 'unknown';
    const candidateUrl = dialect === 'postgres'
      ? process.env.OSAAH_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
      : process.env.DATABASE_URL;
    let url = null;
    if (typeof candidateUrl === 'string' && candidateUrl) {
      try { url = new URL(candidateUrl); } catch { /* malformed or non-URL values are never logged */ }
    }
    const host = dialect === 'tidb' ? process.env.HOST || process.env.TIDB_HOST || url?.hostname : url?.hostname;
    const port = dialect === 'tidb' ? process.env.PORT || process.env.TIDB_PORT || url?.port : url?.port;
    const databaseName = dialect === 'tidb' ? process.env.DATABASE || process.env.TIDB_DATABASE || url?.pathname : url?.pathname;
    if (!host && !databaseName) return null;
    return fingerprint([dialect, host ?? '', port ?? '', String(databaseName ?? '').replace(/^\//, '')].join('\0'));
  }
  const sessionDiagnostic = (context, stage, details = {}) => {
    if (!sessionDiagnostics || !context || context.requestPath !== '/api/auth/session' && !context.requestPath?.startsWith('/')) return;
    console.info('Authentication session diagnostic', {
      requestId: safeRequestId(context.requestId) ?? null,
      requestPath: context.requestPath === '/api/auth/session' || /^\/(?!\/)[A-Za-z0-9._/-]{0,160}$/.test(context.requestPath ?? '') ? context.requestPath : null,
      processInstance: AUTH_PROCESS_INSTANCE_ID,
      tokenFingerprint: context.tokenFingerprint ?? null,
      signingKeyFingerprint: fingerprint(signingKey),
      durableSessionStore,
      databaseDialect: ['tidb', 'postgres', 'mysql'].includes(database?.dialect) ? database.dialect : 'unknown',
      databaseTargetFingerprint: databaseTargetFingerprint(),
      deploymentCommit: /^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
      stage,
      ...details
    });
  };
  const sessionRejectionDiagnostic = (context, reason, details = {}) => {
    if (!context || !['/reports', '/api/auth/session'].includes(context.requestPath)) return;
    console.warn('Authentication session rejected', {
      requestId: safeRequestId(context.requestId) ?? null,
      requestPath: context.requestPath,
      stage: 'session_rejected',
      reason,
      cookieReceived: context.cookieReceived === true,
      cookieParsed: context.cookieParsed === true,
      credentialSource: ['cookie', 'bearer', 'unknown'].includes(context.credentialSource) ? context.credentialSource : 'unknown',
      ...details
    });
  };
  const nowIso = () => new Date(now()).toISOString();
  async function persistDurableSession(user, session, token) {
    if (!durableSessionStore) return;
    await database.execute('INSERT INTO auth_sessions (id, user_id, school_id, token_hash, created_at, expires_at, revoked_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)', [session.sessionId, user.id, user.schoolId, tokenHash(token), nowIso(), new Date(session.expiresAt).toISOString(), nowIso()]);
  }
  async function revokeDurableSessionsForUser(userId) {
    if (!durableSessionStore) return;
    await database.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [nowIso(), userId]);
  }
  function revokeDurableSessionsBestEffort(userId) {
    void revokeDurableSessionsForUser(userId).catch((error) => {
      console.error('Durable session revocation failed', { userId, code: error?.code ?? 'UNKNOWN' });
      securityEvent('SESSION_REVOCATION_FAILED', { id: userId });
    });
  }
  function signSession(session) { const payload = Buffer.from(JSON.stringify(session)).toString('base64url'); const signature = createHmac('sha256', signingKey).update(payload).digest('base64url'); return `v1.${payload}.${signature}`; }
  function inspectSessionToken(token) {
    if (typeof token !== 'string' || !token) return { session: null, verification: 'token_missing' };
    if (!signingKey || !token.startsWith('v1.')) {
      const session = sessions.get(token) ?? null;
      return { session, verification: session ? 'local_session' : !signingKey ? 'signing_key_unavailable' : 'token_format_unsupported' };
    }
    const parts = token.split('.'); if (parts.length !== 3) return { session: null, verification: 'token_format_invalid' };
    const expected = createHmac('sha256', signingKey).update(parts[1]).digest(); let actual;
    try { actual = Buffer.from(parts[2], 'base64url'); } catch { return { session: null, verification: 'signature_encoding_invalid' }; }
    // Reject alternate base64url encodings that decode to the same bytes. Without
    // this canonical-form check, changing unused trailing bits can leave the
    // decoded HMAC unchanged and make a tampered token appear valid.
    if (actual.toString('base64url') !== parts[2]) return { session: null, verification: 'signature_encoding_invalid' };
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { session: null, verification: 'signature_invalid' };
    try {
      const session = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!session || typeof session.userId !== 'string' || typeof session.sessionId !== 'string' || !Number.isFinite(session.expiresAt)) return { session: null, verification: 'payload_invalid' };
      if (revokedSessionIds.has(session.sessionId)) return { session: null, verification: 'locally_revoked' };
      return { session, verification: 'signature_valid' };
    } catch { return { session: null, verification: 'payload_invalid' }; }
  }
  function verifiedSession(token) {
    return inspectSessionToken(token).session;
  }
  function revokeLocalSession(token, session = verifiedSession(token)) { if (session?.sessionId) revokedSessionIds.add(session.sessionId); if (token) sessions.delete(token); if (session?.sessionId) durableSessionIds.delete(session.sessionId); }
  function isActive(user) { return user.is_active !== false && user.isActive !== false && !['DISABLED', 'REVOKED', 'REMOVED', 'SUSPENDED', 'DEACTIVATED'].includes(String(user.accountStatus ?? '').toUpperCase()); }
  function securityEvent(action, user, sessionId = null) { audit({ action, entity: 'Authentication', entityId: user?.id ?? null, userId: user?.id ?? null, roleId: canonicalRoleKey(user?.roleKey), sessionId }); }
  function sanitize(user, sessionId = null) { const roleKey = canonicalRoleKey(user.roleKey); return { id: user.id, username: user.username, portal: user.portal, roleKey, role: roleKey, accountStatus: isActive(user) ? 'ACTIVE' : String(user.accountStatus ?? 'DISABLED').toUpperCase(), schoolId: user.schoolId, sessionId, dashboard: SCHOOL_PORTAL_DASHBOARDS[roleKey] ?? '/', schoolType: user.schoolType, subscription: user.subscription, entitlements: user.entitlements ?? [], featureAvailability: user.featureAvailability ?? [], ...(roleKey === 'PARENT' ? {} : { children: user.children ?? [], authorizedStaffIds: user.authorizedStaffIds ?? [], assignedStudentIds: user.assignedStudentIds ?? [], assignedParentIds: user.assignedParentIds ?? [], assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], assignedDepartmentIds: user.assignedDepartmentIds ?? [] }) }; }
  function selectAuthorizedRoleRows(rows, requestedRole = null) {
    const normalizedRequested = requestedRole ? canonicalRoleKey(requestedRole) : null;
    const grouped = new Map();
    for (const row of rows ?? []) {
      const roleKey = canonicalRoleKey(row.roleKey);
      if (!ROLE_KEYS.has(roleKey)) continue;
      if (!grouped.has(roleKey)) grouped.set(roleKey, []);
      grouped.get(roleKey).push(row);
    }
    const available = [...grouped.keys()].sort((left, right) => {
      const rank = (key) => Math.max(...(grouped.get(key) ?? []).map((row) => Number(row.oversightRank ?? 0)));
      return rank(right) - rank(left) || left.localeCompare(right);
    });
    const selectedRole = normalizedRequested
      ? available.find((roleKey) => roleKey === normalizedRequested)
      : available[0];
    return { roleKey: selectedRole ?? null, rows: selectedRole ? grouped.get(selectedRole) : [], availableRoles: available };
  }
  function createSessionResult(user) {
    // In-memory sessions are not portable across serverless instances. In
    // production, fail closed unless a stable HMAC signing key is configured.
    if (process.env.NODE_ENV === 'production' && !signingKey) return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    attempts.delete(user.id);
    const sessionId = randomUUID(); const expiresAt = now() + SESSION_TTL_MS;
    const session = { userId: user.id, roleKey: canonicalRoleKey(user.roleKey), sessionId, expiresAt };
    const token = signingKey ? signSession(session) : randomBytes(32).toString('hex');
    sessions.set(token, session); securityEvent('LOGIN_SUCCESS', user, sessionId);
    return { ok: true, token, user: sanitize(user, sessionId), redirectTo: SCHOOL_PORTAL_DASHBOARDS[canonicalRoleKey(user.roleKey)] ?? '/', expiresAt };
  }
  async function createDurableSessionResult(user, diagnosticContext = null) {
    if (process.env.NODE_ENV === 'production' && !durableSessionStore) return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    attempts.delete(user.id);
    const sessionId = randomUUID(); const expiresAt = now() + SESSION_TTL_MS;
    const session = { userId: user.id, roleKey: canonicalRoleKey(user.roleKey), sessionId, expiresAt };
    const token = signingKey ? signSession(session) : randomBytes(32).toString('hex');
    await persistDurableSession(user, session, token);
    sessionDiagnostic(diagnosticContext ? { ...diagnosticContext, tokenFingerprint: fingerprint(token) } : null, 'session_persisted', { persistenceCompleted: Boolean(durableSessionStore), sessionIdFingerprint: fingerprint(session.sessionId), sessionNotExpired: session.expiresAt > now() });
    sessions.set(token, session);
    if (durableSessionStore) durableSessionIds.add(session.sessionId);
    securityEvent('LOGIN_SUCCESS', user, sessionId);
    return { ok: true, token, user: sanitize(user, sessionId), redirectTo: SCHOOL_PORTAL_DASHBOARDS[canonicalRoleKey(user.roleKey)] ?? '/', expiresAt };
  }
  function loginByPhone({ phone, password, portal = 'parent' }) {
    return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR };
  }
  function login({ username, password, portal, role }) {
    if (portal === 'parent') return { ok: false, status: 401, error: PARENT_GENERIC_LOGIN_ERROR };
    const key = String(username ?? '').trim().toLowerCase(); const throttle = attempts.get(key); if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    const user = users.find((candidate) => (candidate.username.toLowerCase() === key || String(candidate.email ?? '').toLowerCase() === key) && candidate.portal === portal);
    if (user && portal === 'school' && !ROLE_KEYS.has(canonicalRoleKey(user.roleKey))) return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR };
    if (user && portal === 'school' && role && canonicalRoleKey(role) !== canonicalRoleKey(user.roleKey)) return { ok: false, status: 401, error: 'The selected role does not match this account.' };
    if (!user || typeof password !== 'string' || !passwordMatches(password, user.passwordHash) || !isActive(user)) { const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(key, next); securityEvent('LOGIN_FAILED', user); return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR }; }
    attempts.delete(key); return createSessionResult(user);
  }
  async function hydrateStaffAssignments(user) {
    if (canonicalRoleKey(user?.roleKey) !== 'TEACHER' || !database?.query) return user;
    try {
      const assignments = await database.query(`SELECT DISTINCT sa.class_id AS classId,sa.subject_id AS subjectId
        FROM staff s
        LEFT JOIN staff_assignments sa ON sa.staff_id=s.id
        WHERE s.user_id=? AND s.school_id=?`, [user.id, user.schoolId]);
      user.assignedClassIds = [...new Set((assignments ?? []).map((item) => item.classId).filter(Boolean).map(String))];
      user.assignedSubjectIds = [...new Set((assignments ?? []).map((item) => item.subjectId).filter(Boolean).map(String))];
    } catch (error) {
      console.error('Teacher assignment lookup failed', { code: error?.code ?? 'UNKNOWN', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null });
      user.assignedClassIds ??= [];
      user.assignedSubjectIds ??= [];
    }
    return user;
  }
  async function loginParentByPhone({ phone, portal = 'parent', diagnosticContext, verifiedOtp = false }) {
    const normalized = normalizeGhanaPhone(phone);
    if (portal !== 'parent') return { ok: false, status: 401, error: PARENT_GENERIC_LOGIN_ERROR };
    if (verifiedOtp !== true) return { ok: false, status: 401, error: PARENT_GENERIC_LOGIN_ERROR };
    if (!normalized) return { ok: false, status: 400, error: 'Enter a valid Ghanaian phone number.' };
    const parentAuthRequirements = {
      queryAvailable: typeof database?.query === 'function',
      transactionAvailable: typeof database?.transaction === 'function',
      durableSessionCapability: Boolean(database?.supportsDurableAuthSessions),
      durableSessionStoreAvailable: durableSessionStore,
      signingKeyAvailable: Boolean(signingKey)
    };
    if (Object.values(parentAuthRequirements).some((available) => !available)) {
      console.error('Parent authentication unavailable', {
        component: 'parent_authentication', operation: 'preflight', category: 'AUTH_REQUIREMENT_UNAVAILABLE',
        requestId: safeRequestId(diagnosticContext?.requestId),
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
        ...parentAuthRequirements
      });
      return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    }
    let rows = [], rateLimited = false;
    try {
      await database.transaction(async (tx) => {
        if (database.dialect !== 'tidb') throw new Error('Parent login requires TiDB.');
        const bucketHash = createHmac('sha256', signingKey).update(`parent-phone-login\0${normalized}`).digest('hex');
        const timestamp = new Date(now()).toISOString();
        await tidbInsertIfAbsent(tx, { insertSql:'INSERT INTO parent_auth_rate_limits (bucket_hash,window_started_at,request_count,updated_at) VALUES (?,?,0,?)', insertParameters:[bucketHash,timestamp,timestamp], conflictSql:'SELECT bucket_hash FROM parent_auth_rate_limits WHERE bucket_hash=?', conflictParameters:[bucketHash] });
        const limits = await tx.query('SELECT window_started_at AS windowStartedAt,request_count AS requestCount FROM parent_auth_rate_limits WHERE bucket_hash=? FOR UPDATE', [bucketHash]);
        if (!Array.isArray(limits) || limits.length !== 1) throw new Error('Parent login rate-limit row unavailable.');
        const limitRow = limits[0];
        const startedAt = Date.parse(limitRow.windowStartedAt);
        const expired = !Number.isFinite(startedAt) || now() - startedAt >= PARENT_PHONE_LOGIN_WINDOW_MS;
        const count = expired ? 0 : Number(limitRow.requestCount ?? 0);
        rateLimited = count >= PARENT_PHONE_LOGIN_LIMIT;
        await tx.execute('UPDATE parent_auth_rate_limits SET window_started_at=?,request_count=?,updated_at=? WHERE bucket_hash=?', [expired ? timestamp : limitRow.windowStartedAt, count + (rateLimited ? 0 : 1), timestamp, bucketHash]);
        if (rateLimited) return;
        rows = await tx.query(`SELECT DISTINCT u.id,u.school_id AS schoolId,COALESCE(u.username,u.email) AS username,u.email,u.status,u.phone AS parentPhone,
            (SELECT COUNT(DISTINCT phone_user.id) FROM users phone_user
              WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone_user.phone,''),' ',''),'-',''),'(',''),')',''),'+','') IN (?,?,?)) AS phoneMatchCount
          FROM users u JOIN schools school ON school.id=u.school_id
          JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
          JOIN parent_student_links psl ON psl.parent_user_id=u.id AND psl.link_status='ACTIVE'
          JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=u.school_id
          JOIN students s ON s.id=sp.student_master_id AND s.school_id=u.school_id
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(u.phone,''),' ',''),'-',''),'(',''),')',''),'+','') IN (?,?,?)
            AND r.school_id=u.school_id AND r.role_key='PARENT'
            AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'
            AND UPPER(COALESCE(sp.enrollment_status,'ACTIVE'))='ACTIVE'
            AND UPPER(COALESCE(s.student_status,'ACTIVE'))='ACTIVE'`, [normalized.slice(1), `0${normalized.slice(4)}`, normalized, normalized.slice(1), `0${normalized.slice(4)}`, normalized]);
      });
    } catch (error) {
      console.error('Parent database authentication query failed', {
        ...schoolLoginDiagnostics(error, diagnosticContext),
        component: 'parent_authentication', operation: 'login_lookup', category: 'DATABASE_QUERY_FAILED'
      });
      securityEvent('PARENT_LOGIN_DATABASE_ERROR', null);
      return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    }
    if (rateLimited) return { ok: false, status: 429, error: 'Too many sign-in attempts. Try again later.' };
    const matches = rows.filter((candidate) => normalizeGhanaPhone(candidate.parentPhone) === normalized);
    const row = matches.length === 1 && Number(matches[0].phoneMatchCount) === 1 ? matches[0] : null;
    if (!row) {
      securityEvent('PARENT_PHONE_LOGIN_FAILED', null); return { ok: false, status: 401, error: PARENT_GENERIC_LOGIN_ERROR };
    }
    const user = { id: row.id, username: row.username ?? row.email ?? row.id, email: row.email, portal: 'parent', roleKey: 'PARENT', schoolId: row.schoolId, phone: normalized, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(PARENT_PERMISSIONS) };
    try {
      const session = await createDurableSessionResult(user);
      if (session.ok) users.push(user);
      return session;
    } catch (error) {
      console.error('Parent authentication session creation failed', {
        component: 'parent_authentication', operation: 'session_create', category: 'SESSION_PERSISTENCE_FAILED',
        requestId: safeRequestId(diagnosticContext?.requestId),
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
        errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error',
        code: safeDiagnosticCode(error?.code),
        stack: safeAuthenticationStack(error?.stack)
      });
      return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    }
  }
  const loginByPhoneFromDatabase = loginParentByPhone;
  async function loginFromDatabase({ username, password, portal, role, diagnosticContext }) {
    const key = String(username ?? '').trim().toLowerCase();
    const throttle = attempts.get(key);
    if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    if (portal !== 'school' || !database?.query) return login({ username, password, portal, role });
    let rows;
    try {
      console.info('Authentication login checkpoint', {
        stage: 'user_query_before', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null
      });
      rows = await database.query(`SELECT u.id,u.school_id AS schoolId,COALESCE(u.username,u.email) AS username,u.email,u.password_hash AS passwordHash,u.status,r.role_key AS roleKey,r.oversight_rank AS oversightRank,p.permission_key AS permissionKey
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id=u.id
        LEFT JOIN roles r ON r.id=ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id=r.id
        LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE LOWER(COALESCE(u.username,''))=? OR LOWER(COALESCE(u.email,''))=? ORDER BY COALESCE(r.oversight_rank,0) DESC,r.role_key,p.permission_key`, [key, key]);
      console.info('Authentication login checkpoint', {
        stage: 'user_query_after', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
        rowsReturned: Array.isArray(rows) ? rows.length : 0
      });
    } catch (error) {
      console.error('School database authentication query failed', schoolLoginDiagnostics(error, diagnosticContext));
      securityEvent('LOGIN_DATABASE_ERROR', null);
      return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    }
    const identityRows = rows ?? [];
    const identity = identityRows[0];
    console.info('Authentication login checkpoint', {
      stage: 'user_lookup_result', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
      userFound: Boolean(identity)
    });
    const selected = selectAuthorizedRoleRows(identityRows, role);
    const row = selected.rows[0] ?? identity;
    const userRows = selected.rows;
    const roleKey = selected.roleKey;
    console.info('Authentication login checkpoint', {
      stage: 'role_resolution', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
      roleResolved: Boolean(roleKey), requestedRole: role ? canonicalRoleKey(role) : null,
      resolvedRole: roleKey
    });
    const scopedRows = userRows.filter((candidate) => canonicalRoleKey(candidate.roleKey) === roleKey);
    const active = row && String(row.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE';
    console.info('Authentication login checkpoint', {
      stage: 'account_status_validation', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
      accountActive: Boolean(active)
    });
    let passwordValid = false;
    let passwordCheckFailed = false;
    if (row && typeof password === 'string' && typeof row.passwordHash === 'string') {
      try {
        console.info('Authentication login checkpoint', {
          stage: 'password_compare_before', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
          algorithm: row.passwordHash.includes(':') ? 'scrypt' : 'bcrypt'
        });
        passwordValid = row.passwordHash.includes(':') ? passwordMatches(password, row.passwordHash) : await bcrypt.compare(password, row.passwordHash);
        console.info('Authentication login checkpoint', {
          stage: 'password_compare_after', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
          passwordMatched: Boolean(passwordValid)
        });
      } catch (error) {
        passwordCheckFailed = true;
        passwordValid = false;
        console.error('School password verification failed', {
          component: 'school_authentication', operation: 'password_verify', category: 'PASSWORD_HASH_INVALID',
          requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
          requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
          errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error'
        });
      }
    } else if (row) {
      console.info('Authentication login checkpoint', {
        stage: 'password_compare_skipped', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        reason: typeof password !== 'string' ? 'PASSWORD_NOT_PROVIDED' : 'PASSWORD_HASH_MISSING'
      });
    }
    if (role && !roleKey) {
      console.info('School login rejected', {
        component: 'school_authentication', operation: 'login_validation', category: identity ? 'ROLE_MISMATCH' : 'USER_NOT_FOUND',
        requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
        accountFound: Boolean(identity), requestedRole: canonicalRoleKey(role), availableRoles: selected.availableRoles
      });
      return { ok: false, status: 401, error: 'The selected role does not match this account.' };
    }
    if (!row || !active || !passwordValid || !roleKey) {
      const category = !identity ? 'USER_NOT_FOUND' : !active ? 'ACCOUNT_INACTIVE' : passwordCheckFailed ? 'PASSWORD_HASH_INVALID' : !roleKey ? 'ROLE_NOT_ASSIGNED' : 'PASSWORD_MISMATCH';
      console.info('School login rejected', {
        component: 'school_authentication', operation: 'login_validation', category,
        requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        requestPath: ['/api/auth/login', '/api/auth/parent/verify-code'].includes(diagnosticContext?.requestPath) ? diagnosticContext.requestPath : null,
        accountFound: Boolean(identity), accountActive: Boolean(active), roleAssigned: Boolean(roleKey), requestedRole: role ? canonicalRoleKey(role) : null,
        availableRoles: selected.availableRoles
      });
      const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(key, next); securityEvent('LOGIN_FAILED', row ? { ...row, roleKey } : null); return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR };
    }
    const user = addStaffAttendanceRoleGrants({ id: row.id, username: row.username ?? row.email, email: row.email, portal: 'school', roleKey, schoolId: row.schoolId, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(scopedRows.map((candidate) => candidate.permissionKey).filter(Boolean)) });
    if (!user.permissions.size) for (const permission of ROLE_PERMISSIONS[roleKey] ?? []) user.permissions.add(permission);
    await hydrateStaffAssignments(user);
    attempts.delete(key);
    users.push(user);
    console.info('Authentication login checkpoint', {
      stage: 'session_creation_before', requestId: safeRequestId(diagnosticContext?.requestId) ?? null
    });
    try {
      const result = await createDurableSessionResult(user, diagnosticContext);
      console.info('Authentication login checkpoint', {
        stage: 'session_creation_after', requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        sessionCreated: Boolean(result.ok), status: result.status ?? 200
      });
      return result;
    } catch (error) {
      console.error('Authentication session creation failed', {
        component: 'school_authentication', operation: 'session_create',
        requestId: safeRequestId(diagnosticContext?.requestId) ?? null,
        errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error',
        code: safeDiagnosticCode(error?.code), stack: safeAuthenticationStack(error?.stack)
      });
      throw error;
    }
  }
  function authenticate(token) {
    const session = verifiedSession(token);
    if (!session || session.expiresAt <= now()) { if (token) sessions.delete(token); return null; }
    if (session.roleKey && !ROLE_KEYS.has(canonicalRoleKey(session.roleKey))) { revokeLocalSession(token, session); return null; }
    const user = users.find((candidate) => candidate.id === session.userId && (!session.roleKey || canonicalRoleKey(candidate.roleKey) === canonicalRoleKey(session.roleKey)))
      ?? users.find((candidate) => candidate.id === session.userId);
    if (!user) { if (token) sessions.delete(token); return null; }
    if (!ROLE_KEYS.has(canonicalRoleKey(user.roleKey))) { revokeLocalSession(token, session); return null; }
    if (!isActive(user)) { revokeLocalSession(token, session); securityEvent('SESSION_REVOKED', user, session.sessionId); return null; }
    return { ...sanitize(user, session.sessionId), permissions: user.permissions };
  }
  async function authenticateAsync(token, diagnosticContext = null) {
    const context = diagnosticContext ? { ...diagnosticContext, tokenFingerprint: fingerprint(token) } : null;
    const local = authenticate(token);
    const inspected = inspectSessionToken(token);
    const session = inspected.session;
    sessionDiagnostic(context, 'credential_received', { credentialPresent: Boolean(token), cookieReceived: context?.cookieReceived === true, cookieParsed: context?.cookieParsed === true, credentialSource: ['cookie', 'bearer', 'unknown'].includes(context?.credentialSource) ? context.credentialSource : 'unknown' });
    sessionDiagnostic(context, 'signature_verification', { result: inspected.verification, sessionClaimsValid: Boolean(session), sessionNotExpired: Boolean(session && session.expiresAt > now()), sessionIdFingerprint: fingerprint(session?.sessionId) });
    if (!durableSessionStore || typeof token !== 'string' || !token || local && (!session || !durableSessionIds.has(session.sessionId))) {
      if (!local) sessionRejectionDiagnostic(context, !token ? 'CREDENTIAL_MISSING' : !durableSessionStore ? 'DURABLE_SESSION_STORE_UNAVAILABLE' : 'LOCAL_SESSION_INVALID', {
        signatureResult: inspected.verification,
        durableSessionStoreAvailable: durableSessionStore
      });
      return local;
    }
    let rows;
    try {
      rows = await database.query(`SELECT s.id AS sessionId,s.user_id AS userId,s.school_id AS schoolId,s.expires_at AS expiresAt,COALESCE(u.username,u.email) AS username,u.email,u.status,r.role_key AS roleKey,r.oversight_rank AS oversightRank,p.permission_key AS permissionKey FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE' ORDER BY COALESCE(r.oversight_rank,0) DESC,r.role_key,p.permission_key`, [tokenHash(token), nowIso()]);
    } catch (error) {
      sessionDiagnostic(context, 'session_store_lookup', { querySucceeded: false, errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error', errorCode: safeDiagnosticCode(error?.code) });
      sessionRejectionDiagnostic(context, 'SESSION_STORE_QUERY_FAILED', {
        errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error',
        errorCode: safeDiagnosticCode(error?.code)
      });
      throw error;
    }
    const row = rows?.[0];
    sessionDiagnostic(context, 'session_store_lookup', { querySucceeded: true, matchingRecord: Boolean(row), resultRowCount: Array.isArray(rows) ? rows.length : 0 });
    if (!row) {
      let classification = null;
      let classificationQueryFailed = false;
      if (sessionDiagnostics && context || context && ['/reports', '/api/auth/session'].includes(context.requestPath)) {
        try {
          const diagnosticRows = await database.query(`SELECT s.expires_at AS expiresAt,s.revoked_at AS revokedAt,u.status AS accountStatus,CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS identityFound,CASE WHEN UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE' THEN 1 ELSE 0 END AS restoreStatusAccepted FROM auth_sessions s LEFT JOIN users u ON u.id=s.user_id WHERE s.token_hash=? LIMIT 1`, [tokenHash(token)]);
          const diagnosticRow = diagnosticRows?.[0];
          const expiry = diagnosticRow ? Date.parse(diagnosticRow.expiresAt) : NaN;
          classification = {
            recordFound: Boolean(diagnosticRow),
            revoked: Boolean(diagnosticRow?.revokedAt),
            expired: Number.isFinite(expiry) ? expiry <= now() : null,
            identityFound: Boolean(Number(diagnosticRow?.identityFound)),
            accountActive: diagnosticRow ? String(diagnosticRow.accountStatus ?? 'ACTIVE').toUpperCase() === 'ACTIVE' : null,
            restoreStatusAccepted: Boolean(Number(diagnosticRow?.restoreStatusAccepted))
          };
          sessionDiagnostic(context, 'session_record_classification', { classificationQueryExecuted: true, ...classification });
        } catch (error) {
          classificationQueryFailed = true;
          sessionDiagnostic(context, 'session_record_classification', { querySucceeded: false, errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error', errorCode: safeDiagnosticCode(error?.code) });
          sessionRejectionDiagnostic(context, 'SESSION_RECORD_CLASSIFICATION_FAILED', {
            errorType: safeDiagnosticIdentifier(error?.name) ?? 'Error',
            errorCode: safeDiagnosticCode(error?.code)
          });
        }
      }
      const reason = classificationQueryFailed ? 'SESSION_RECORD_CLASSIFICATION_UNAVAILABLE'
        : classification && !classification.recordFound ? 'SESSION_RECORD_NOT_FOUND'
        : classification?.revoked ? 'SESSION_REVOKED'
        : classification?.expired ? 'SESSION_EXPIRED'
          : classification && !classification.identityFound ? 'SESSION_IDENTITY_MISSING'
            : classification && !classification.accountActive ? 'ACCOUNT_INACTIVE'
              : classification?.recordFound ? 'SESSION_RESTORE_PREDICATE_REJECTED'
                : 'SESSION_RECORD_NOT_FOUND';
      sessionRejectionDiagnostic(context, reason, {
        signatureResult: inspected.verification,
        classificationAvailable: Boolean(classification),
        recordFound: classification?.recordFound ?? false,
        revoked: classification?.revoked ?? null,
        expired: classification?.expired ?? null,
        identityFound: classification?.identityFound ?? null,
        accountActive: classification?.accountActive ?? null,
        restoreStatusAccepted: classification?.restoreStatusAccepted ?? null
      });
      if (session) revokeLocalSession(token, session); else sessions.delete(token); return null;
    }
    const userRows = rows.filter((candidate) => candidate.userId === row.userId && ROLE_KEYS.has(canonicalRoleKey(candidate.roleKey)));
    const selectedRoleKey = canonicalRoleKey(session?.roleKey ?? row.roleKey);
    if (session?.roleKey && !ROLE_KEYS.has(selectedRoleKey)) {
      sessionRejectionDiagnostic(context, 'SESSION_ROLE_INVALID', { roleResolved: false, signedRolePresent: true });
      return null;
    }
    const roleKey = userRows.some((candidate) => canonicalRoleKey(candidate.roleKey) === selectedRoleKey) ? selectedRoleKey : canonicalRoleKey(userRows[0]?.roleKey);
    if (!roleKey) {
      sessionRejectionDiagnostic(context, 'SESSION_ROLE_NOT_RESOLVED', { roleResolved: false, identityFound: true });
      return null;
    }
    const scopedRows = userRows.filter((candidate) => canonicalRoleKey(candidate.roleKey) === roleKey);
    const user = addStaffAttendanceRoleGrants({ id: row.userId, username: row.username, email: row.email, portal: roleKey === 'PARENT' ? 'parent' : 'school', roleKey, schoolId: row.schoolId, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(scopedRows.map((candidate) => candidate.permissionKey).filter(Boolean)) });
    if (user.roleKey === 'PARENT') for (const permission of PARENT_PERMISSIONS) user.permissions.add(permission);
    if (!user.permissions.size) for (const permission of ROLE_PERMISSIONS[user.roleKey] ?? []) user.permissions.add(permission);
    await hydrateStaffAssignments(user);
    await database.execute('UPDATE auth_sessions SET last_used_at=? WHERE id=? AND revoked_at IS NULL', [nowIso(), row.sessionId]);
    sessionDiagnostic(context, 'identity_restoration', { deserialized: true, notExpired: true, identityRestored: Boolean(user.id), roleRestored: Boolean(user.roleKey), roleKey: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'TEACHER', 'PARENT'].includes(user.roleKey) ? user.roleKey : 'OTHER', schoolAssignmentRestored: Boolean(user.schoolId), authorizationIdentityAvailable: true });
    return { ...sanitize(user, row.sessionId), permissions: user.permissions };
  }
  async function logoutSession(token) {
    const session = verifiedSession(token);
    const user = users.find((candidate) => candidate.id === session?.userId);
    if (token && durableSessionStore) await database.execute('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL', [nowIso(), tokenHash(token)]);
    if (session) { revokeLocalSession(token, session); if (user) securityEvent('SESSION_REVOKED', user, session.sessionId); }
  }
  function logout(token) { void logoutSession(token); }
  function changeAccountState(userId, active, status = active ? 'ACTIVE' : 'DISABLED') { const user = users.find((candidate) => candidate.id === userId); if (!user) return false; user.is_active = active; user.accountStatus = status; if (!active) for (const [token, session] of sessions) if (session.userId === userId) { revokeLocalSession(token, session); securityEvent(status === 'REVOKED' ? 'SESSION_REVOKED' : 'ACCOUNT_DISABLED', user, session.sessionId); } revokeDurableSessionsBestEffort(userId); for (const assignment of administratorAssignments) if (assignment.userId === userId && !active) { assignment.status = status; assignment.removedAt ??= new Date(now()).toISOString(); } return true; }
  function setAccountStatus(userId, status, schoolId = null) { if (database?.query && schoolId) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.setStatus(userId, schoolId, status === true ? 'ACTIVE' : 'DISABLED'); } return changeAccountState(userId, status === true); }
  function revokeAccount(userId, schoolId = null) { if (database?.query && schoolId) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.setStatus(userId, schoolId, 'REVOKED'); } return changeAccountState(userId, false, 'REVOKED'); }
  function administratorUsername(fullName) { const base = String(fullName ?? 'administrator').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'administrator'; let username = `${base}@osaah.edu.gh`; let suffix = 2; while (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) username = `${base}${suffix++}@osaah.edu.gh`; return username; }
  function administratorView(staff, actorId = null) { return { id: staff.id, userId: staff.id, fullName: staff.fullName, staffId: staff.staffId, username: staff.username, phone: staff.phone, email: staff.email, assignedAt: staff.createdAt ?? null, assignedBy: actorId, removedAt: null, status: staff.accountStatus ?? 'ACTIVE', mustChangePassword: Boolean(staff.mustChangePassword) }; }
  function createAdministrator(input, actor) {
    if (!input?.fullName || !input?.staffId) throw new Error('Full name and Staff ID are required');
    if (database?.query) {
      if (!input.email) throw Object.assign(new Error('Email address is required for a School Administrator account.'), { status: 400, code: 'INVALID_EMAIL' });
      if (!durableStaff) throw Object.assign(new Error('Durable staff provisioning is unavailable.'), { status: 503, code: 'DURABLE_STAFF_UNAVAILABLE' });
      return durableStaff.register({ ...input, username: input.username ?? input.email, primaryRole: 'SCHOOL_ADMIN' }, actor)
        .then((result) => ({ administrator: administratorView(result.staff, actor.id), temporaryPassword: result.temporaryPassword }));
    }
    if (users.some((user) => user.staffId === input.staffId)) throw new Error('Staff ID already exists'); const temporaryPassword = randomBytes(18).toString('base64url'); const assignedAt = input.assignedAt ?? new Date(now()).toISOString(); const accountStatus = input.accountStatus === 'REVOKED' ? 'REVOKED' : input.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE'; const user = { id: randomUUID(), username: administratorUsername(input.fullName), passwordHash: passwordHash(temporaryPassword), portal: 'school', roleKey: 'SCHOOL_ADMIN', schoolId: actor.schoolId, staffId: input.staffId, fullName: input.fullName, phone: input.phone ?? null, email: input.email ?? null, assignedAt, assignedBy: actor.id, must_change_password: true, is_active: accountStatus === 'ACTIVE', accountStatus, permissions: new Set(['users.read', 'users.credentials.manage', 'settings.read', 'settings.write', 'students.read', 'academics.read', 'attendance.read', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'fees.read', 'finance.read', 'staff.read', 'staff.manage', 'mock.scores.read', 'mock.scores.write', 'communication.read', 'announcements.create', 'calendar.read', 'calendar.write', 'documents.read', 'reports.read']) }; const active = administratorAssignments.find((assignment) => assignment.schoolId === actor.schoolId && assignment.status === 'ACTIVE'); if (active) { revokeAccount(active.userId); active.status = 'REASSIGNED'; active.removedAt = assignedAt; } users.push(user); const assignment = { id: randomUUID(), schoolId: actor.schoolId, userId: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, assignedAt, assignedBy: actor.id, removedAt: accountStatus === 'ACTIVE' ? null : assignedAt, status: accountStatus }; administratorAssignments.push(assignment); return { administrator: { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, phone: user.phone, email: user.email, assignedAt, assignedBy: user.assignedBy, status: user.accountStatus, mustChangePassword: user.must_change_password }, temporaryPassword }; }
  function listAdministrators(schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable administrator directory is unavailable.'); return durableStaff.list(schoolId).then((staff) => staff.filter((item) => item.roleKey === 'SCHOOL_ADMIN').map((item) => administratorView(item))); } return administratorAssignments.filter((assignment) => !schoolId || assignment.schoolId === schoolId).map((assignment) => ({ ...assignment })); }
  function getAdministrator(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable administrator lookup is unavailable.'); return durableStaff.get(userId, schoolId).then((staff) => staff?.roleKey === 'SCHOOL_ADMIN' ? administratorView(staff) : null); } const assignment = administratorAssignments.find((item) => item.userId === userId && item.schoolId === schoolId); return assignment ? { ...assignment } : null; }
  function updateAdministrator(userId, input, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable administrator update is unavailable.'); return durableStaff.update(userId, input, schoolId).then((staff) => staff?.roleKey === 'SCHOOL_ADMIN' ? administratorView(staff) : null); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId); if (!user) return null; if (input.staffId && input.staffId !== user.staffId && users.some((candidate) => candidate.staffId === input.staffId)) throw new Error('Staff ID already exists'); for (const field of ['fullName', 'staffId', 'phone', 'email']) if (input[field] !== undefined) user[field] = input[field]; const assignment = administratorAssignments.find((item) => item.userId === userId && item.schoolId === schoolId); if (assignment) Object.assign(assignment, { fullName: user.fullName, staffId: user.staffId }); return { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, phone: user.phone, email: user.email, status: user.accountStatus }; }
  function resetAdministratorCredentials(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable administrator credential reset is unavailable.'); return durableStaff.get(userId, schoolId).then((staff) => staff?.roleKey === 'SCHOOL_ADMIN' ? durableStaff.resetCredentials(userId, schoolId) : null); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.roleKey === 'SCHOOL_ADMIN'); if (!user) return null; const temporaryPassword = randomBytes(18).toString('base64url'); user.passwordHash = passwordHash(temporaryPassword); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { username: user.username, temporaryPassword }; }
  let staffSequence = users.filter((user) => /^OSAAH-STAFF-\d+$/.test(user.username)).length;
  function staffUsername() { let username; do { staffSequence += 1; username = `OSAAH-STAFF-${String(staffSequence).padStart(4, '0')}`; } while (users.some((user) => user.username === username)); return username; }
  function staffView(user) { return { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, email: user.email, phone: user.phone, roleKey: user.roleKey, primaryRole: user.roleKey === 'TEACHER' ? 'CLASSROOM_TEACHER' : user.roleKey === 'ACCOUNTANT_BURSAR' ? 'ACCOUNTANT' : user.roleKey, assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], accountStatus: user.accountStatus ?? 'ACTIVE', createdAt: user.createdAt, mustChangePassword: Boolean(user.must_change_password) }; }
  function registerStaff(input, actor) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff provisioning is unavailable.'); return durableStaff.register(input, actor); } const roleKey = STAFF_ASSIGNABLE_ROLES[input?.primaryRole ?? input?.roleKey]; if (!input?.fullName || !input?.staffId || !roleKey) throw new Error('Full name, Staff ID, and an assignable role are required'); if (users.some((user) => user.staffId === input.staffId)) throw new Error('Staff ID already exists'); const temporaryPassword = randomBytes(18).toString('base64url'); const user = { id: randomUUID(), username: staffUsername(), passwordHash: passwordHash(temporaryPassword), portal: 'school', roleKey, schoolId: actor.schoolId, staffId: input.staffId, fullName: input.fullName, phone: input.phone ?? null, email: input.email ?? null, assignedClassIds: input.assignedClassId ? [input.assignedClassId] : [], assignedSubjectIds: input.assignedSubjectId ? [input.assignedSubjectId] : [], accountStatus: 'ACTIVE', is_active: true, must_change_password: true, createdAt: new Date(now()).toISOString(), permissions: new Set(ROLE_PERMISSIONS[roleKey] ?? []) }; users.push(user); return { staff: staffView(user), temporaryPassword }; }
  function listStaff(schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff directory is unavailable.'); return durableStaff.list(schoolId); } return users.filter((user) => user.schoolId === schoolId && user.staffId && user.roleKey !== 'SCHOOL_ADMIN' && user.portal === 'school').map(staffView); }
  function getStaff(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff directory is unavailable.'); return durableStaff.get(userId, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); return user ? staffView(user) : null; }
  function updateStaff(userId, input, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.update(userId, input, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; if (input.staffId && input.staffId !== user.staffId && users.some((candidate) => candidate.staffId === input.staffId)) throw new Error('Staff ID already exists'); for (const field of ['fullName', 'staffId', 'phone', 'email']) if (input[field] !== undefined) user[field] = input[field]; return staffView(user); }
  function changeStaffRole(userId, requestedRole, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.changeRole(userId, requestedRole, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); const roleKey = STAFF_ASSIGNABLE_ROLES[requestedRole]; if (!user || !roleKey) return null; const previousRole = user.roleKey; user.roleKey = roleKey; user.permissions = new Set(ROLE_PERMISSIONS[roleKey] ?? []); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { staff: staffView(user), previousRole, newRole: roleKey }; }
  function assignStaff(userId, input, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.assign(userId, input, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; if (input.classId !== undefined) user.assignedClassIds = input.classId ? [input.classId] : []; if (input.subjectId !== undefined) user.assignedSubjectIds = input.subjectId ? [input.subjectId] : []; return staffView(user); }
  async function resetUserCredentials(userId, schoolId) {
    if (durableCredentialManagement) return durableCredentialManagement.reissue(userId, schoolId);
    const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.portal === 'school');
    if (!user) return null;
    if (!isActive(user)) { const error = new Error('Disabled accounts cannot receive credentials.'); error.status = 409; error.code = 'ACCOUNT_DISABLED'; throw error; }
    const temporaryPassword = generatedPassword();
    user.passwordHash = passwordHash(temporaryPassword);
    user.must_change_password = true;
    user.password_changed_at = new Date(now()).toISOString();
    user.credentials_provisioned_at = user.password_changed_at;
    for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session);
    await revokeDurableSessionsForUser(userId);
    return { userId: user.id, username: user.username, email: user.email ?? null, staffId: user.staffId ?? null, roleKey: user.roleKey ?? null, temporaryPassword, mustChangePassword: true };
  }
  async function changeOwnPassword(actor, input = {}, currentToken = null) {
    const currentPassword = input.currentPassword;
    const newPassword = input.newPassword;
    const confirmPassword = input.confirmPassword;
    const fail = (message, status = 400, code = 'PASSWORD_CHANGE_INVALID') => { throw Object.assign(new Error(message), { status, code }); };
    if (![currentPassword, newPassword, confirmPassword].every((value) => typeof value === 'string' && value.length > 0)) fail('Current password, new password, and confirmation are required.');
    if (newPassword !== confirmPassword) fail('New password and confirmation do not match.');
    if (!passwordMeetsPolicy(newPassword)) fail('New password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
    if (currentPassword === newPassword) fail('New password must be different from the current password.');
    if (!actor?.id || !actor?.schoolId) fail('Authenticated account context is required.', 401, 'UNAUTHENTICATED');
    let existingHash;
    let durableTarget = null;
    if (database?.query && database?.transaction) {
      const rows = await database.query('SELECT id, password_hash AS passwordHash, status FROM users WHERE id=? AND school_id=? LIMIT 1', [actor.id, actor.schoolId]);
      durableTarget = rows?.[0] ?? null;
      if (!durableTarget) fail('Authenticated account was not found.', 401, 'UNAUTHENTICATED');
      if (String(durableTarget.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') fail('Disabled accounts cannot change passwords.', 409, 'ACCOUNT_DISABLED');
      existingHash = durableTarget.passwordHash;
    } else {
      const user = users.find((candidate) => candidate.id === actor.id && candidate.schoolId === actor.schoolId);
      if (!user) fail('Authenticated account was not found.', 401, 'UNAUTHENTICATED');
      if (!isActive(user)) fail('Disabled accounts cannot change passwords.', 409, 'ACCOUNT_DISABLED');
      existingHash = user.passwordHash;
    }
    let matches = false;
    try { matches = typeof existingHash === 'string' && existingHash.includes(':') ? passwordMatches(currentPassword, existingHash) : await bcrypt.compare(currentPassword, existingHash ?? ''); } catch { matches = false; }
    if (!matches) fail('Current password is incorrect.', 401, 'CURRENT_PASSWORD_INVALID');
    const timestamp = nowIso();
    const nextHash = passwordHash(newPassword);
    if (durableTarget) {
      await database.transaction(async (tx) => {
        const result = await tx.execute("UPDATE users SET password_hash=?, updated_at=? WHERE id=? AND school_id=? AND status='ACTIVE'", [nextHash, timestamp, actor.id, actor.schoolId]);
        if (!Number(result?.affectedRows)) fail('Password update was not persisted.', 503, 'PASSWORD_UPDATE_FAILED');
        await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL', [timestamp, actor.id, actor.schoolId]);
      });
    } else {
      const user = users.find((candidate) => candidate.id === actor.id && candidate.schoolId === actor.schoolId);
      user.passwordHash = nextHash;
      user.must_change_password = false;
      user.password_changed_at = timestamp;
      await revokeDurableSessionsForUser(actor.id);
    }
    for (const [sessionToken, session] of sessions) if (session.userId === actor.id) revokeLocalSession(sessionToken, session);
    return { ok: true };
  }
  function resetStaffCredentials(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.resetCredentials(userId, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; const temporaryPassword = randomBytes(18).toString('base64url'); user.passwordHash = passwordHash(temporaryPassword); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { username: user.username, temporaryPassword }; }
  function requestPasswordReset(username) {
    // The in-memory token flow is retained only for local/test operation. It
    // cannot reset a durable account and must not expose a bearer token from a
    // public endpoint when PostgreSQL backs authentication.
    if (database?.query) return { ok: true };
    const user = users.find((candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return { ok: true };
    const token = randomUUID();
    resetTokens.set(token, { userId: user.id, expiresAt: now() + RESET_TTL_MS });
    return { ok: true, token };
  }
  function completePasswordReset(token, newPassword) {
    if (database?.query) return { ok: false, error: 'Invalid or expired reset request.' };
    const reset = resetTokens.get(token);
    if (!reset || reset.expiresAt <= now() || typeof newPassword !== 'string' || newPassword.length < 10) return { ok: false, error: 'Invalid or expired reset request.' };
    const user = users.find((candidate) => candidate.id === reset.userId);
    if (!user) return { ok: false, error: 'Invalid or expired reset request.' };
    user.passwordHash = passwordHash(newPassword);
    resetTokens.delete(token);
    for (const [sessionToken, session] of sessions) if (session.userId === user.id) revokeLocalSession(sessionToken, session);
    revokeDurableSessionsBestEffort(user.id);
    return { ok: true };
  }
  return { login, loginByPhone, loginParentByPhone, loginByPhoneFromDatabase, loginFromDatabase, authenticate, authenticateAsync, logout, logoutSession, hashPassword: passwordHash, requestPasswordReset, completePasswordReset, changeOwnPassword, setAccountStatus, revokeAccount, createAdministrator, listAdministrators, getAdministrator, updateAdministrator, resetAdministratorCredentials, resetAdministratorCredentialsByEmail, resetUserCredentials, registerStaff, listStaff, getStaff, updateStaff, changeStaffRole, assignStaff, resetStaffCredentials, sessionTtlMs: SESSION_TTL_MS, genericLoginError: GENERIC_LOGIN_ERROR };
}

export function canAccess(user, permission) { return Boolean(user && (user.permissions.has('*') || user.permissions.has(permission))); }
