import { randomBytes, randomUUID } from 'node:crypto';

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
function passwordCompliant(value) { const password = String(value ?? ''); return password.length >= PASSWORD_MIN_LENGTH && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password); }
function generatedPassword() { const required = ['A', 'a', '1', PASSWORD_SYMBOLS[0]]; const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + PASSWORD_SYMBOLS; const bytes = randomBytes(20); const chars = required.concat([...bytes].map((byte) => alphabet[byte % alphabet.length])); for (let i = chars.length - 1; i > 0; i -= 1) { const j = bytes[i % bytes.length] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; } return chars.join(''); }
function normalizedUsername(value, fallback) { return String(value ?? fallback ?? '').trim().toLowerCase(); }

const STAFF_ROLES = Object.freeze({
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  ADMINISTRATOR: 'SCHOOL_ADMIN',
  HEADTEACHER: 'HEADTEACHER',
  ASSISTANT_HEADTEACHER: 'ASSISTANT_HEADTEACHER',
  ACCOUNTANT: 'ACCOUNTANT_BURSAR',
  ACCOUNTANT_BURSAR: 'ACCOUNTANT_BURSAR',
  CLASSROOM_TEACHER: 'TEACHER',
  TEACHER: 'TEACHER'
});

function failure(message, status = 400, code = 'STAFF_PROVISIONING_FAILED') {
  return Object.assign(new Error(message), { status, code });
}

function normalizedEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function splitName(value) {
  const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() ?? '', lastName: parts.join(' ') };
}

function roleFor(value) {
  const key = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return STAFF_ROLES[key] ?? null;
}

function staffView(row) {
  return {
    id: String(row.id),
    fullName: row.fullName ?? [row.firstName, row.lastName].filter(Boolean).join(' '),
    staffId: row.staffId,
    username: row.username,
    email: row.email ?? null,
    phone: row.phone ?? null,
    roleKey: row.roleKey,
    primaryRole: row.roleKey === 'TEACHER' ? 'CLASSROOM_TEACHER' : row.roleKey === 'ACCOUNTANT_BURSAR' ? 'ACCOUNTANT' : row.roleKey,
    assignedClassIds: row.assignedClassId ? [String(row.assignedClassId)] : [],
    assignedSubjectIds: row.assignedSubjectId ? [String(row.assignedSubjectId)] : [],
    accountStatus: String(row.accountStatus ?? 'ACTIVE').toUpperCase(),
    createdAt: row.createdAt ?? null,
    mustChangePassword: false
  };
}

function aggregateStaffRows(rows) {
  const staff = new Map();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    let item = staff.get(String(row.id));
    if (!item) {
      item = { ...row, assignedClassIds: [], assignedSubjectIds: [] };
      staff.set(String(row.id), item);
    }
    if (row.assignedClassId && !item.assignedClassIds.includes(String(row.assignedClassId))) item.assignedClassIds.push(String(row.assignedClassId));
    if (row.assignedSubjectId && !item.assignedSubjectIds.includes(String(row.assignedSubjectId))) item.assignedSubjectIds.push(String(row.assignedSubjectId));
  }
  return [...staff.values()].map((row) => ({
    ...staffView({ ...row, assignedClassId: null, assignedSubjectId: null }),
    assignedClassIds: row.assignedClassIds,
    assignedSubjectIds: row.assignedSubjectIds
  }));
}

export function createDurableStaffProvisioning({ database, passwordHash, verifyLogin, revokeSession, now = () => Date.now() } = {}) {
  if (!database?.query || !database?.transaction || !database?.execute || typeof verifyLogin !== 'function' || typeof revokeSession !== 'function') throw failure('Durable staff provisioning is unavailable.', 503, 'DURABLE_STAFF_UNAVAILABLE');
  const nowIso = () => new Date(now()).toISOString();

  async function findRole(tx, roleKey, schoolId) {
    const rows = await tx.query(`SELECT id, role_key AS roleKey
      FROM roles
      WHERE role_key=? AND (school_id=? OR school_id IS NULL)
      ORDER BY CASE WHEN school_id=? THEN 0 ELSE 1 END, id
      LIMIT 1`, [roleKey, schoolId, schoolId]);
    return rows?.[0] ?? null;
  }

  async function validateOptionalAssignments(tx, schoolId, input) {
    const classId = String(input.assignedClassId ?? '').trim() || null;
    const subjectId = String(input.assignedSubjectId ?? '').trim() || null;
    if (classId) {
      const rows = await tx.query('SELECT id FROM classes WHERE id=? AND school_id=? LIMIT 1', [classId, schoolId]);
      if (!rows?.length) throw failure('The selected class is not available for this school.', 400, 'INVALID_CLASS');
    }
    if (subjectId) {
      const rows = await tx.query('SELECT id FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]);
      if (!rows?.length) throw failure('The selected subject is not available for this school.', 400, 'INVALID_SUBJECT');
    }
    return { classId, subjectId };
  }

  async function register(input, actor) {
    const fullName = String(input?.fullName ?? '').trim().replace(/\s+/g, ' ');
    const staffId = String(input?.staffId ?? '').trim();
    const roleKey = roleFor(input?.primaryRole ?? input?.roleKey);
    const email = normalizedEmail(input?.email);
    const username = normalizedUsername(input?.username);
    const suppliedPassword = String(input?.password ?? '');
    const temporaryPassword = suppliedPassword || generatedPassword();
    const schoolId = String(actor?.schoolId ?? '').trim();
    if (!fullName || !staffId || !username || !roleKey || !schoolId) throw failure('Full name, Staff ID, school, and an assignable role are required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('Enter a valid staff email address.');
    if (!passwordCompliant(temporaryPassword)) throw failure('Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.', 400, 'PASSWORD_POLICY');
    const { firstName, lastName } = splitName(fullName);
    const id = randomUUID();
    const hash = passwordHash(temporaryPassword);
    const timestamp = nowIso();
    const { classId, subjectId } = await database.transaction(async (tx) => {
      const schoolRows = await tx.query('SELECT id FROM schools WHERE id=? FOR UPDATE', [schoolId]);
      if (!schoolRows?.length) throw failure('The school associated with this administrator is unavailable.', 409, 'SCHOOL_NOT_FOUND');

      const existingEmail = await tx.query('SELECT id FROM users WHERE LOWER(COALESCE(email,\'\'))=? LIMIT 1', [email]);
      const existingUsername = await tx.query('SELECT id FROM users WHERE school_id=? AND LOWER(username)=? LIMIT 1', [schoolId, username]);
      if (existingUsername?.length) throw failure('Username already exists for this school.', 409, 'DUPLICATE_USERNAME');
      if (existingEmail?.length) throw failure('An account with this email already exists. Review or reconcile that account before registering staff.', 409, 'DUPLICATE_EMAIL');
      const existingStaff = await tx.query('SELECT id, user_id AS userId FROM staff WHERE school_id=? AND staff_number=? LIMIT 1', [schoolId, staffId]);
      if (existingStaff?.length) throw failure('Staff ID already exists. Review the existing staff record before registering another account.', 409, 'DUPLICATE_STAFF_ID');
      const existingProfile = await tx.query('SELECT id FROM staff_profiles WHERE school_id=? AND staff_number=? LIMIT 1', [schoolId, staffId]);
      if (existingProfile?.length) throw failure('Staff ID already exists in the staff directory. Review the existing staff record before registering another account.', 409, 'DUPLICATE_STAFF_PROFILE');

      const role = await findRole(tx, roleKey, schoolId);
      if (!role) throw failure('The requested staff role is not configured for this school.', 409, 'ROLE_NOT_CONFIGURED');
      const assignment = await validateOptionalAssignments(tx, schoolId, input ?? {});

      await tx.execute('INSERT INTO users (id, school_id, username, email, password_hash, full_name, phone, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, schoolId, username, email, hash, fullName, String(input?.phone ?? '').trim() || null, roleKey, 'ACTIVE', timestamp, timestamp]);
      await tx.execute('INSERT INTO staff (id, school_id, user_id, staff_number, first_name, last_name, department_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)', [id, schoolId, id, staffId, firstName, lastName, timestamp, timestamp]);
      // Share the canonical staff identity so staff_assignments satisfies deployments
      // whose FK targets staff_profiles.id as well as schemas targeting staff.id.
      await tx.execute('INSERT INTO staff_profiles (id, school_id, user_id, staff_number, department, position, date_hired, qualification, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?)', [id, schoolId, id, staffId, roleKey, timestamp]);
      await tx.execute('INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)', [randomUUID(), id, role.id, timestamp]);
      if (assignment.classId || assignment.subjectId) {
        await tx.execute('INSERT INTO staff_assignments (id, staff_id, subject_id, class_id, stream_id, department_id, timetable_id, academic_year_id, term_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)', [randomUUID(), id, assignment.subjectId, assignment.classId, timestamp]);
      }

      const verified = await tx.query(`SELECT u.id
        FROM users u
        JOIN staff s ON s.user_id=u.id AND s.school_id=u.school_id
        JOIN staff_profiles sp ON sp.user_id=s.user_id AND sp.school_id=s.school_id
        JOIN user_roles ur ON ur.user_id=u.id
        JOIN roles r ON r.id=ur.role_id AND r.role_key=?
        WHERE u.id=? AND u.school_id=? AND u.status='ACTIVE'
        LIMIT 1`, [roleKey, id, schoolId]);
      if (!verified?.length) throw failure('Staff account persistence could not be verified.', 503, 'STAFF_PERSISTENCE_UNVERIFIED');
      return assignment;
    });

    const loginProbe = await verifyLogin({ username, password: temporaryPassword, portal: 'school' });
    if (!loginProbe?.ok || loginProbe.user?.id !== id || loginProbe.user?.roleKey !== roleKey || !loginProbe.token) throw failure('The committed staff account did not pass the durable login check. Credentials were not issued.', 503, 'STAFF_LOGIN_VERIFICATION_FAILED');
    await revokeSession(loginProbe.token);
    return { staff: { id, fullName, staffId, username, email, phone: String(input?.phone ?? '').trim() || null, roleKey, primaryRole: roleKey === 'TEACHER' ? 'CLASSROOM_TEACHER' : roleKey === 'ACCOUNTANT_BURSAR' ? 'ACCOUNTANT' : roleKey, assignedClassIds: classId ? [classId] : [], assignedSubjectIds: subjectId ? [subjectId] : [], accountStatus: 'ACTIVE', createdAt: timestamp, mustChangePassword: false }, temporaryPassword };
  }

  async function readRows(schoolId, userId = null) {
    const conditions = userId ? 's.user_id=? AND s.school_id=?' : 's.school_id=?';
    const params = userId ? [userId, schoolId] : [schoolId];
    return database.query(`SELECT s.id AS id, s.staff_number AS staffId, s.first_name AS firstName, s.last_name AS lastName,
        u.username AS username, u.email AS email, u.status AS accountStatus, u.created_at AS createdAt,
        u.full_name AS fullName, u.phone AS phone, r.role_key AS roleKey,
        sa.class_id AS assignedClassId, sa.subject_id AS assignedSubjectId
      FROM staff s
      JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id
      JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id AND (r.school_id=s.school_id OR r.school_id IS NULL)
      LEFT JOIN staff_profiles sp ON sp.user_id=s.user_id AND sp.school_id=s.school_id
      LEFT JOIN staff_assignments sa ON sa.staff_id=s.id
      WHERE ${conditions} AND r.role_key IN ('SCHOOL_ADMIN','TEACHER','HEADTEACHER','ASSISTANT_HEADTEACHER','ACCOUNTANT_BURSAR')
      ORDER BY s.staff_number,s.id`, params);
  }

  async function list(schoolId) {
    return aggregateStaffRows(await readRows(schoolId));
  }

  async function get(userId, schoolId) {
    return (await aggregateStaffRows(await readRows(schoolId, userId)))[0] ?? null;
  }

  async function setStatus(userId, schoolId, status = 'DISABLED') {
    return database.transaction(async (tx) => {
      const rows = await tx.query('SELECT s.id FROM staff s JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id WHERE s.user_id=? AND s.school_id=? LIMIT 1', [userId, schoolId]);
      if (!rows?.length) return false;
      const timestamp = nowIso();
      await tx.execute('UPDATE users SET status=? WHERE id=? AND school_id=?', [status, userId, schoolId]);
      await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL', [timestamp, userId, schoolId]);
      return true;
    });
  }

  async function update(userId, input, schoolId) {
    const patch = input ?? {};
    const current = await get(userId, schoolId);
    if (!current) return null;
    const nextStaffId = patch.staffId === undefined ? current.staffId : String(patch.staffId).trim();
    const nextName = patch.fullName === undefined ? current.fullName : String(patch.fullName).trim().replace(/\s+/g, ' ');
    if (!nextStaffId || !nextName) throw failure('Full name and Staff ID are required.');
    const names = splitName(nextName);
    const email = patch.email === undefined ? current.email : normalizedEmail(patch.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('Enter a valid staff email address.');
    await database.transaction(async (tx) => {
      if (nextStaffId !== current.staffId) {
        const duplicates = await tx.query('SELECT id FROM staff WHERE school_id=? AND staff_number=? AND id<>? LIMIT 1', [schoolId, nextStaffId, userId]);
        const profiles = await tx.query('SELECT id FROM staff_profiles WHERE school_id=? AND staff_number=? AND user_id<>? LIMIT 1', [schoolId, nextStaffId, userId]);
        if (duplicates?.length || profiles?.length) throw failure('Staff ID already exists.', 409, 'DUPLICATE_STAFF_ID');
      }
      if (email !== current.email) {
        const duplicates = await tx.query('SELECT id FROM users WHERE LOWER(COALESCE(email,\'\'))=? AND id<>? LIMIT 1', [email, userId]);
        if (duplicates?.length) throw failure('An account with this email already exists.', 409, 'DUPLICATE_EMAIL');
        await tx.execute('UPDATE users SET email=? WHERE id=? AND school_id=?', [email, userId, schoolId]);
      }
      await tx.execute('UPDATE users SET full_name=?, phone=? WHERE id=? AND school_id=?', [nextName, patch.phone === undefined ? current.phone : String(patch.phone ?? '').trim() || null, userId, schoolId]);
      await tx.execute('UPDATE staff SET staff_number=?, first_name=?, last_name=?, updated_at=? WHERE user_id=? AND school_id=?', [nextStaffId, names.firstName, names.lastName, nowIso(), userId, schoolId]);
      await tx.execute('UPDATE staff_profiles SET staff_number=? WHERE user_id=? AND school_id=?', [nextStaffId, userId, schoolId]);
    });
    return get(userId, schoolId);
  }

  async function changeRole(userId, requestedRole, schoolId) {
    const roleKey = roleFor(requestedRole);
    if (!roleKey) return null;
    let previousRole = null;
    const exists = await database.transaction(async (tx) => {
      const staffRows = await tx.query('SELECT s.id FROM staff s JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id WHERE s.user_id=? AND s.school_id=? LIMIT 1', [userId, schoolId]);
      if (!staffRows?.length) return false;
      const role = await findRole(tx, roleKey, schoolId);
      if (!role) throw failure('The requested staff role is not configured for this school.', 409, 'ROLE_NOT_CONFIGURED');
      const previous = await tx.query('SELECT r.role_key AS roleKey FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND (r.school_id=? OR r.school_id IS NULL) ORDER BY r.oversight_rank DESC LIMIT 1', [userId, schoolId]);
      previousRole = previous?.[0]?.roleKey ?? null;
      await tx.execute('DELETE ur FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND (r.school_id=? OR r.school_id IS NULL)', [userId, schoolId]);
      await tx.execute('INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)', [randomUUID(), userId, role.id, nowIso()]);
      await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL', [nowIso(), userId, schoolId]);
      return true;
    });
    if (!exists) return null;
    return { staff: await get(userId, schoolId), previousRole, newRole: roleKey };
  }

  async function assign(userId, input, schoolId) {
    const classId = String(input?.classId ?? '').trim() || null;
    const subjectId = String(input?.subjectId ?? '').trim() || null;
    await database.transaction(async (tx) => {
      const staffRows = await tx.query('SELECT id FROM staff WHERE user_id=? AND school_id=? LIMIT 1', [userId, schoolId]);
      if (!staffRows?.length) return null;
      const assignment = await validateOptionalAssignments(tx, schoolId, { assignedClassId: classId, assignedSubjectId: subjectId });
      await tx.execute('DELETE FROM staff_assignments WHERE staff_id=?', [staffRows[0].id]);
      if (assignment.classId || assignment.subjectId) {
        await tx.execute('INSERT INTO staff_assignments (id, staff_id, subject_id, class_id, stream_id, department_id, timetable_id, academic_year_id, term_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)', [randomUUID(), staffRows[0].id, assignment.subjectId, assignment.classId, nowIso()]);
      }
    });
    return get(userId, schoolId);
  }

  async function resetCredentials(userId, schoolId) {
    const temporaryPassword = generatedPassword();
    return database.transaction(async (tx) => {
      const rows = await tx.query('SELECT u.username AS username FROM staff s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.school_id=? LIMIT 1', [userId, schoolId]);
      if (!rows?.length) return null;
      const timestamp = nowIso();
      const result = await tx.execute('UPDATE users SET password_hash=? WHERE id=? AND school_id=?', [passwordHash(temporaryPassword), userId, schoolId]);
      if (!Number(result?.affectedRows)) return null;
      await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL', [timestamp, userId, schoolId]);
      return { username: rows[0].username, temporaryPassword };
    });
  }

  return Object.freeze({ register, list, get, setStatus, update, changeRole, assign, resetCredentials });
}
