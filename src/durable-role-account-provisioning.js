import { randomUUID } from 'node:crypto';
import { generatedPassword, passwordMeetsPolicy } from './durable-credential-management.js';

export const ROLE_ACCOUNT_TARGETS = Object.freeze([
  Object.freeze({ email: 'administrator@osaah.edu.gh', username: 'administrator@osaah.edu.gh', roleKey: 'SCHOOL_ADMIN', displayName: 'School Administrator' }),
  Object.freeze({ email: 'headteacher@osaah.edu.gh', username: 'headteacher@osaah.edu.gh', roleKey: 'HEADTEACHER', displayName: 'Headteacher' }),
  Object.freeze({ email: 'assistantheadteacher@osaah.edu.gh', username: 'assistantheadteacher@osaah.edu.gh', roleKey: 'ASSISTANT_HEADTEACHER', displayName: 'Assistant Headteacher' }),
  Object.freeze({ email: 'accountant@osaah.edu.gh', username: 'accountant@osaah.edu.gh', roleKey: 'ACCOUNTANT_BURSAR', displayName: 'Accountant' }),
  Object.freeze({ email: 'abbanfrank348@gmail.com', username: 'frank.abban', roleKey: 'TEACHER', displayName: 'Teacher' })
]);

function failure(message, status = 400, code = 'ROLE_ACCOUNT_PROVISIONING_FAILED', details = undefined) {
  return Object.assign(new Error(message), { status, code, details });
}

function splitName(value) {
  const parts = String(value ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return { firstName: parts.shift() ?? '', lastName: parts.join(' ') };
}

export function createDurableRoleAccountProvisioning({ database, passwordHash, now = () => Date.now(), verifyLogin, revokeSession } = {}) {
  if (!database?.query || !database?.transaction || !database?.execute || typeof passwordHash !== 'function' || typeof verifyLogin !== 'function' || typeof revokeSession !== 'function') {
    throw failure('Durable role account provisioning is unavailable.', 503, 'PERSISTENCE_UNAVAILABLE');
  }
  const nowIso = () => new Date(now()).toISOString();

  async function roleFor(tx, roleKey, schoolId) {
    const rows = await tx.query(`SELECT id FROM roles
      WHERE role_key=? AND school_id=? ORDER BY id LIMIT 1 FOR UPDATE`, [roleKey, schoolId]);
    if (rows?.length !== 1) throw failure('A required Osaah Daylight role is not configured.', 409, 'ROLE_NOT_CONFIGURED');
    return rows[0];
  }

  async function assertNoLinkedRecords(tx, tableName, recordId, roleKey) {
    const references = await tx.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=?
      ORDER BY TABLE_NAME,COLUMN_NAME`, [tableName]);
    if (!Array.isArray(references)) throw failure('Cross-school staff links could not be checked safely; no accounts were changed.', 503, 'STAFF_DEPENDENCY_CHECK_UNAVAILABLE');
    let linkedRecordCount = 0;
    for (const reference of references) {
      const childTable = String(reference.tableName ?? '');
      const childColumn = String(reference.columnName ?? '');
      if (!/^[A-Za-z0-9_]+$/.test(childTable) || !/^[A-Za-z0-9_]+$/.test(childColumn)) {
        throw failure('Cross-school staff links could not be checked safely; no accounts were changed.', 503, 'STAFF_DEPENDENCY_CHECK_UNAVAILABLE');
      }
      const rows = await tx.query(`SELECT COUNT(*) AS referenceCount FROM \`${childTable}\` WHERE \`${childColumn}\`=?`, [recordId]);
      if (!Array.isArray(rows) || rows.length !== 1) throw failure('Cross-school staff links could not be checked safely; no accounts were changed.', 503, 'STAFF_DEPENDENCY_CHECK_UNAVAILABLE');
      linkedRecordCount += Number(rows[0].referenceCount ?? 0);
    }
    if (linkedRecordCount > 0) {
      throw failure('A target staff record has dependent records at another school. They were left untouched; no accounts were changed.', 409, 'CROSS_SCHOOL_STAFF_DEPENDENCY_CONFLICT', {
        roles: [{ role: roleKey, dependentRecordCount: linkedRecordCount }]
      });
    }
  }

  async function provision(schoolId) {
    const targetSchoolId = String(schoolId ?? '').trim();
    if (!targetSchoolId) throw failure('Authenticated school context is required.', 403, 'SCHOOL_CONTEXT_REQUIRED');
    const temporaryPasswords = new Map(ROLE_ACCOUNT_TARGETS.map(({ email }) => [email, generatedPassword()]));
    const results = await database.transaction(async (tx) => {
      const schools = await tx.query('SELECT id FROM schools WHERE id=? FOR UPDATE', [targetSchoolId]);
      if (!schools?.length) throw failure('The authenticated school could not be confirmed.', 409, 'SCHOOL_NOT_FOUND');

      const plans = [];
      for (const target of ROLE_ACCOUNT_TARGETS) {
        const matches = await tx.query(`SELECT id,school_id AS schoolId,username,email,full_name AS fullName,status,role
          FROM users WHERE LOWER(COALESCE(email,''))=? LIMIT 2 FOR UPDATE`, [target.email]);
        if (matches?.length !== 1) throw failure(matches?.length ? 'A target email matches multiple accounts; no accounts were changed.' : 'A target account no longer exists; no accounts were changed.', 409, matches?.length ? 'AMBIGUOUS_TARGET_ACCOUNT' : 'TARGET_ACCOUNT_MISSING');
        const user = matches[0];
        const usernameMatches = await tx.query('SELECT id FROM users WHERE LOWER(COALESCE(username,\'\'))=? AND id<>? LIMIT 1 FOR UPDATE', [target.username, user.id]);
        if (usernameMatches?.length) throw failure('A requested login name is already in use by another account; no accounts were changed.', 409, 'USERNAME_CONFLICT');

        const staffRows = await tx.query('SELECT id,school_id AS schoolId,staff_number AS staffNumber FROM staff WHERE user_id=? FOR UPDATE', [user.id]);
        const profileRows = await tx.query('SELECT id,school_id AS schoolId,staff_number AS staffNumber FROM staff_profiles WHERE user_id=? FOR UPDATE', [user.id]);
        const parentLinks = await tx.query('SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? LIMIT 1 FOR UPDATE', [user.id]);
        if (parentLinks?.length) throw failure('A target account has an existing parent-student relationship; no accounts were changed.', 409, 'CROSS_PORTAL_LINK_CONFLICT');
        const foreignStaff = (staffRows ?? []).filter((row) => String(row.schoolId) !== targetSchoolId);
        const foreignProfiles = (profileRows ?? []).filter((row) => String(row.schoolId) !== targetSchoolId);
        if (foreignProfiles.length) {
          throw failure('A target account has a staff profile at another school. It was left untouched; no accounts were changed.', 409, 'CROSS_SCHOOL_STAFF_PROFILE_CONFLICT', {
            roles: [{ role: target.roleKey, foreignStaffProfileCount: foreignProfiles.length }]
          });
        }
        if (foreignStaff.length || foreignProfiles.length) {
          for (const row of foreignStaff) {
            const collisions = await tx.query('SELECT id FROM staff WHERE school_id=? AND staff_number=? AND id<>? LIMIT 1 FOR UPDATE', [targetSchoolId, row.staffNumber, row.id]);
            if (collisions?.length) throw failure('A target staff number is already used at Osaah Daylight; no accounts were changed.', 409, 'STAFF_NUMBER_CONFLICT', { roles: [{ role: target.roleKey }] });
            const foreignDepartment = await tx.query(`SELECT d.id FROM staff s JOIN departments d ON d.id=s.department_id
              WHERE s.id=? AND d.school_id<>? LIMIT 1 FOR UPDATE`, [row.id, targetSchoolId]);
            if (foreignDepartment?.length) throw failure('A target staff row references another school’s department. It was left untouched; no accounts were changed.', 409, 'CROSS_SCHOOL_DEPARTMENT_CONFLICT', { roles: [{ role: target.roleKey }] });
            await assertNoLinkedRecords(tx, 'staff', row.id, target.roleKey);
          }
        }
        if ((staffRows ?? []).length > 1 || (profileRows ?? []).length > 1) throw failure('A target account has duplicate staff records; no accounts were changed.', 409, 'DUPLICATE_STAFF_RECORDS');
        const role = await roleFor(tx, target.roleKey, targetSchoolId);
        const fullName = String(user.fullName ?? '').trim() || target.displayName;
        const names = splitName(fullName);
        if (!names.firstName) throw failure('A target staff name could not be prepared; no accounts were changed.', 409, 'STAFF_NAME_UNAVAILABLE');
        const staffNumber = (staffRows?.[0]?.staffNumber || profileRows?.[0]?.staffNumber || `OSD-${target.roleKey.slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`);
        const profileId = profileRows?.[0]?.id ?? staffRows?.[0]?.id ?? randomUUID();
        const staffIdCollision = await tx.query('SELECT id FROM staff WHERE id=? AND user_id<>? LIMIT 1 FOR UPDATE', [profileId, user.id]);
        const profileIdCollision = await tx.query('SELECT id FROM staff_profiles WHERE id=? AND user_id<>? LIMIT 1 FOR UPDATE', [profileId, user.id]);
        if (staffIdCollision?.length || profileIdCollision?.length) throw failure('A target staff identity conflicts with an existing record; no accounts were changed.', 409, 'STAFF_IDENTITY_CONFLICT');
        plans.push({ target, user, role, fullName, names, staffNumber, profileId, staff: staffRows?.[0] ?? null, profile: profileRows?.[0] ?? null });
      }

      const timestamp = nowIso();
      const provisioned = [];
      for (const plan of plans) {
        const { target, user, role, fullName, names, staffNumber, profileId } = plan;
        const password = temporaryPasswords.get(target.email);
        if (!passwordMeetsPolicy(password)) throw failure('Generated credential did not meet policy; no accounts were changed.', 503, 'PASSWORD_POLICY');
        if (plan.staff) {
          await tx.execute('UPDATE staff SET school_id=?,staff_number=?,first_name=?,last_name=?,updated_at=? WHERE id=? AND user_id=?', [targetSchoolId, staffNumber, names.firstName, names.lastName, timestamp, plan.staff.id, user.id]);
        } else {
          await tx.execute('INSERT INTO staff (id,school_id,user_id,staff_number,first_name,last_name,department_id,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?,?)', [profileId, targetSchoolId, user.id, staffNumber, names.firstName, names.lastName, timestamp, timestamp]);
        }
        if (plan.profile) {
          await tx.execute('UPDATE staff_profiles SET school_id=?,staff_number=?,position=? WHERE id=? AND user_id=?', [targetSchoolId, staffNumber, target.roleKey, plan.profile.id, user.id]);
        } else {
          await tx.execute('INSERT INTO staff_profiles (id,school_id,user_id,staff_number,department,position,date_hired,qualification,created_at) VALUES (?,?,?, ?,NULL,?,NULL,NULL,?)', [profileId, targetSchoolId, user.id, staffNumber, target.roleKey, timestamp]);
        }

        const updated = await tx.execute(`UPDATE users SET school_id=?,username=?,full_name=?,role=?,status='ACTIVE',password_hash=?,updated_at=? WHERE id=?`, [targetSchoolId, target.username, fullName, target.roleKey, passwordHash(password), timestamp, user.id]);
        if (Number(updated?.affectedRows) !== 1) throw failure('A target account changed during provisioning; the transaction was cancelled.', 409, 'TARGET_ACCOUNT_CHANGED');
        await tx.execute('DELETE FROM user_roles WHERE user_id=?', [user.id]);
        await tx.execute('INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)', [randomUUID(), user.id, role.id, timestamp]);
        await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [timestamp, user.id]);

        const verified = await tx.query(`SELECT u.id
          FROM users u JOIN staff s ON s.user_id=u.id AND s.school_id=u.school_id
          JOIN staff_profiles sp ON sp.user_id=u.id AND sp.school_id=u.school_id
          JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
          WHERE u.id=? AND u.school_id=? AND r.role_key=? AND u.username=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'
          LIMIT 1`, [user.id, targetSchoolId, target.roleKey, target.username]);
        if (!verified?.length) throw failure('Durable account links did not pass verification; the transaction was cancelled.', 503, 'PERSISTENCE_UNVERIFIED');
        provisioned.push({ role: target.roleKey, email: target.email, username: target.username, temporaryPassword: password });
      }
      return provisioned;
    });

    const verifiedResults = [];
    for (const account of results) {
      const probe = await verifyLogin({ username: account.username, password: account.temporaryPassword, portal: 'school', role: account.role });
      if (!probe?.ok || probe.user?.schoolId !== targetSchoolId || probe.user?.roleKey !== account.role || !probe.token) {
        throw Object.assign(failure('The account records were committed, but login verification failed. No credentials were issued; retrying provisioning will generate new temporary passwords.', 503, 'LOGIN_VERIFICATION_FAILED', { role: account.role }), { committed: true });
      }
      try { await revokeSession(probe.token); }
      catch { throw Object.assign(failure('The account records were committed, but the verification session could not be revoked. No credentials were issued.', 503, 'VERIFICATION_SESSION_REVOCATION_FAILED', { role: account.role }), { committed: true }); }
      verifiedResults.push({ ...account, landingPage: probe.redirectTo });
    }
    return verifiedResults;
  }

  return Object.freeze({ provision });
}
