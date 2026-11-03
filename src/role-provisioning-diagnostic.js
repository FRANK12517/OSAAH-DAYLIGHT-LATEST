const TARGET_ACCOUNTS = Object.freeze([
  Object.freeze({ role: 'SCHOOL_ADMIN', email: 'administrator@osaah.edu.gh' }),
  Object.freeze({ role: 'HEADTEACHER', email: 'headteacher@osaah.edu.gh' }),
  Object.freeze({ role: 'ASSISTANT_HEADTEACHER', email: 'assistantheadteacher@osaah.edu.gh' }),
  Object.freeze({ role: 'ACCOUNTANT_BURSAR', email: 'accountant@osaah.edu.gh' }),
  Object.freeze({ role: 'TEACHER', email: 'abbanfrank348@gmail.com' })
]);

/**
 * Read-only, fixed-scope diagnostic for the five role accounts explicitly
 * approved for Osaah Daylight. Never returns identity keys or user content.
 */
export function createRoleProvisioningDiagnostic({ database } = {}) {
  async function inspect(schoolId) {
    if (!schoolId || typeof database?.query !== 'function') {
      throw Object.assign(new Error('Role provisioning diagnostic is unavailable.'), { status: 503, code: 'DIAGNOSTIC_UNAVAILABLE' });
    }

    const emails = TARGET_ACCOUNTS.map((account) => account.email);
    const placeholders = emails.map(() => '?').join(',');
    const rows = await database.query(`
      SELECT u.email AS email,
        u.school_id AS schoolId,
        UPPER(COALESCE(u.status, 'ACTIVE')) AS accountStatus,
        (SELECT COUNT(*) FROM staff s WHERE s.user_id=u.id AND s.school_id=u.school_id) AS staffRecordCount,
        (SELECT COUNT(*) FROM staff_profiles sp WHERE sp.user_id=u.id AND sp.school_id=u.school_id) AS staffProfileCount,
        (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id
          WHERE ur.user_id=u.id AND (r.school_id=? OR r.school_id IS NULL)
            AND r.role_key=CASE LOWER(u.email)
              WHEN 'administrator@osaah.edu.gh' THEN 'SCHOOL_ADMIN'
              WHEN 'headteacher@osaah.edu.gh' THEN 'HEADTEACHER'
              WHEN 'assistantheadteacher@osaah.edu.gh' THEN 'ASSISTANT_HEADTEACHER'
              WHEN 'accountant@osaah.edu.gh' THEN 'ACCOUNTANT_BURSAR'
              WHEN 'abbanfrank348@gmail.com' THEN 'TEACHER'
            END) AS expectedRoleCount
      FROM users u
      WHERE LOWER(u.email) IN (${placeholders})
    `, [schoolId, ...emails]);

    const byEmail = new Map((rows ?? []).map((row) => [String(row.email ?? '').toLowerCase(), row]));
    return TARGET_ACCOUNTS.map(({ role, email }) => {
      const row = byEmail.get(email);
      if (!row) return { role, accountExists: false, schoolMatched: false, assignedRoleMatches: false, active: false, staffRecordCount: 0, staffProfileCount: 0 };
      const schoolMatched = String(row.schoolId ?? '') === String(schoolId);
      return {
        role,
        accountExists: true,
        schoolMatched,
        assignedRoleMatches: schoolMatched && Number(row.expectedRoleCount) > 0,
        active: schoolMatched && String(row.accountStatus ?? '').toUpperCase() === 'ACTIVE',
        staffRecordCount: schoolMatched ? Number(row.staffRecordCount) || 0 : 0,
        staffProfileCount: schoolMatched ? Number(row.staffProfileCount) || 0 : 0
      };
    });
  }

  return Object.freeze({ inspect });
}
