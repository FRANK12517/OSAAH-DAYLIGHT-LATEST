import bcrypt from 'bcryptjs';
import { scryptSync } from 'node:crypto';
import mysql from 'mysql2/promise';

const TARGET_EMAIL = 'proprietor@osaah.edu.gh';
const TARGET_ROLE = 'PROPRIETOR';
const EXPECTED_SCHOOL_ID = 'sch_default_01';
const password = process.env.PROPRIETOR_QA_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

function safeError(error) {
  return { ok: false, error: { code: error?.code ?? 'PROPRIETOR_RESET_FAILED', message: error?.safeMessage ?? error?.message ?? undefined } };
}

function hashWithCurrentFormat(value, currentHash) {
  if (/^\$2[aby]\$\d{2}\$/.test(currentHash)) return bcrypt.hashSync(value, currentHash.slice(0, 29));
  const separator = currentHash.indexOf(':');
  if (separator > 0) {
    const salt = currentHash.slice(0, separator);
    return `${salt}:${scryptSync(value, salt, 32).toString('hex')}`;
  }
  throw Object.assign(new Error('Unsupported current production password-hash format.'), { code: 'UNSUPPORTED_PASSWORD_HASH_FORMAT' });
}

async function matchesHash(value, hash) {
  if (/^\$2[aby]\$\d{2}\$/.test(hash)) return bcrypt.compare(value, hash);
  const separator = hash.indexOf(':');
  if (separator <= 0) return false;
  const salt = hash.slice(0, separator);
  return `${salt}:${scryptSync(value, salt, 32).toString('hex')}` === hash;
}

if (!databaseUrl || !password) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'REQUIRED_PROTECTED_INPUT_MISSING' } }) + '\n');
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: databaseUrl, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(`
      SELECT u.id, u.school_id AS schoolId, u.email, u.password_hash AS passwordHash, u.status,
             r.role_key AS roleKey
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE LOWER(u.email) = ?
      FOR UPDATE`, [TARGET_EMAIL]);
    const distinctUsers = [...new Map(rows.map((row) => [row.id, row])).values()];
    const roleKeys = new Set(rows.map((row) => String(row.roleKey ?? '').toUpperCase()));
    if (distinctUsers.length !== 1) throw Object.assign(new Error('Expected exactly one existing Proprietor account.'), { code: 'TARGET_ACCOUNT_CARDINALITY_MISMATCH' });
    const user = distinctUsers[0];
    if (String(user.email).toLowerCase() !== TARGET_EMAIL || user.status !== 'ACTIVE' || user.schoolId !== EXPECTED_SCHOOL_ID || !roleKeys.has(TARGET_ROLE)) {
      throw Object.assign(new Error('Existing Proprietor account identity, status, role, or school mapping did not match the protected target.'), { code: 'TARGET_ACCOUNT_CONTRACT_MISMATCH' });
    }
    const currentHash = String(user.passwordHash ?? '');
    if (!currentHash) throw Object.assign(new Error('Existing Proprietor account has no password hash.'), { code: 'CURRENT_PASSWORD_HASH_MISSING' });
    const nextHash = hashWithCurrentFormat(password, currentHash);
    if (nextHash === currentHash) throw Object.assign(new Error('Generated password hash did not change.'), { code: 'PASSWORD_HASH_UNCHANGED' });
    const [update] = await connection.query('UPDATE users SET password_hash = ? WHERE id = ? AND email = ?', [nextHash, user.id, TARGET_EMAIL]);
    if (Number(update.affectedRows) !== 1) throw Object.assign(new Error('Exactly one existing Proprietor password row must be updated.'), { code: 'TARGET_UPDATE_CARDINALITY_MISMATCH' });
    const [revocation] = await connection.query('UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL', [user.id]);
    const [[verification]] = await connection.query('SELECT id, school_id AS schoolId, email, password_hash AS passwordHash, status FROM users WHERE id = ? AND email = ?', [user.id, TARGET_EMAIL]);
    if (!verification || verification.passwordHash === currentHash || verification.schoolId !== EXPECTED_SCHOOL_ID || verification.status !== 'ACTIVE' || !(await matchesHash(password, verification.passwordHash))) {
      throw Object.assign(new Error('Post-reset verification failed.'), { code: 'POST_RESET_VERIFICATION_FAILED' });
    }
    await connection.commit();
    process.stdout.write(JSON.stringify({ ok: true, result: 'Protected Proprietor credential reset: PASS', userId: user.id, role: TARGET_ROLE, schoolId: verification.schoolId, passwordHashChanged: true, sessionsRevoked: Number(revocation.affectedRows) }) + '\n');
  } catch (error) {
    try { await connection?.rollback(); } catch {}
    process.stdout.write(JSON.stringify(safeError(error)) + '\n');
    process.exitCode = 1;
  } finally {
    connection?.release();
    await pool.end();
  }
}

if (process.env.PROPRIETOR_QA_PASSWORD) process.env.PROPRIETOR_QA_PASSWORD = '';
