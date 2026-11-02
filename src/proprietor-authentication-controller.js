import bcrypt from 'bcryptjs';

const INVALID_CREDENTIALS = Object.freeze({ error: 'Invalid credentials.' });

function normalizedEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function createProprietorAuthenticationController({ database, bcryptCompare = bcrypt.compare } = {}) {
  if (!database?.query) throw new Error('Database adapter is required.');

  return async function authenticateProprietor(requestBody = {}) {
    const email = normalizedEmail(requestBody.email);
    const password = typeof requestBody.password === 'string' ? requestBody.password : '';
    if (!email || !password) return { status: 401, body: { ...INVALID_CREDENTIALS } };

    try {
      const rows = await database.query(
        'SELECT id, portal_name, email, password_hash, role, is_active FROM portal_users WHERE email = ? LIMIT 1',
        [email]
      );
      const user = rows?.[0];
      if (!user) return { status: 401, body: { ...INVALID_CREDENTIALS } };
      const active = user.is_active === true || user.is_active === 1 || ['1', 'true'].includes(String(user.is_active ?? '').toLowerCase());
      if (!active) {
        return { status: 403, body: { error: 'Account is deactivated.' } };
      }
      if (String(user.role ?? '').trim().toUpperCase() !== 'PROPRIETOR') return { status: 401, body: { ...INVALID_CREDENTIALS } };
      const passwordValid = await bcryptCompare(password, String(user.password_hash ?? ''));
      if (!passwordValid) return { status: 401, body: { ...INVALID_CREDENTIALS } };
      return {
        status: 200,
        body: {
          authenticated: true,
          user: {
            id: user.id,
            portalName: user.portal_name,
            role: user.role,
            email: user.email
          }
        }
      };
    } catch (error) {
      return { status: 500, body: { error: 'Authentication service unavailable.' }, cause: error };
    }
  };
}

export default createProprietorAuthenticationController;
