import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableRoleAccountProvisioning, ROLE_ACCOUNT_TARGETS } from '../src/durable-role-account-provisioning.js';
import { createApp } from '../src/server.mjs';
import { createServer } from 'node:http';

const schoolId = 'osaah-school';

function fixture({ foreignStaff = false, foreignStaffDependencies = false } = {}) {
  const users = ROLE_ACCOUNT_TARGETS.map((target, index) => ({
    id: `user-${index}`,
    schoolId: 'other-school',
    username: target.email,
    email: target.email,
    fullName: `Existing ${target.displayName}`,
    phone: null,
    status: 'ACTIVE',
    role: 'LEGACY_ROLE'
  }));
  const staff = foreignStaff ? [{ id: 'foreign-staff', schoolId: 'other-school', userId: users[0].id, staffNumber: 'OLD-STAFF' }] : [];
  const profiles = [];
  const roleLinks = [];
  const executed = [];
  const revoked = [];
  const database = {
    async query(sql) {
      if (sql.includes('WHERE LOWER(u.email) IN')) return users.map((user) => {
        const target = ROLE_ACCOUNT_TARGETS.find((item) => item.email === user.email);
        return { email: user.email, schoolId: user.schoolId, accountStatus: user.status, staffRecordCount: staff.filter((row) => row.userId === user.id && row.schoolId === user.schoolId).length, staffProfileCount: profiles.filter((row) => row.userId === user.id && row.schoolId === user.schoolId).length, expectedRoleCount: roleLinks.some((link) => link.userId === user.id && link.roleId === `role-${target.roleKey}`) ? 1 : 0 };
      });
      return [];
    },
    async execute(sql, parameters = []) { executed.push({ sql, parameters }); return { affectedRows: 1 }; },
    async transaction(callback) {
      return callback({
        async query(sql, parameters = []) {
          if (sql.includes('FROM schools WHERE id=?')) return [{ id: schoolId }];
          if (sql.includes('WHERE LOWER(u.email) IN')) return users.map((user) => {
            const target = ROLE_ACCOUNT_TARGETS.find((item) => item.email === user.email);
            return { email: user.email, schoolId: user.schoolId, accountStatus: user.status, staffRecordCount: staff.filter((row) => row.userId === user.id && row.schoolId === user.schoolId).length, staffProfileCount: profiles.filter((row) => row.userId === user.id && row.schoolId === user.schoolId).length, expectedRoleCount: roleLinks.some((link) => link.userId === user.id && link.roleId === `role-${target.roleKey}`) ? 1 : 0 };
          });
          if (sql.includes('FROM users WHERE LOWER(COALESCE(email')) return users.filter((user) => user.email === parameters[0]).map((user) => ({ ...user }));
          if (sql.includes('SELECT id FROM users WHERE LOWER(COALESCE(username')) return [];
          if (sql.includes('FROM staff WHERE user_id=?')) return staff.filter((row) => row.userId === parameters[0]).map(({ id, schoolId: existingSchoolId, staffNumber }) => ({ id, schoolId: existingSchoolId, staffNumber }));
          if (sql.includes('FROM staff_profiles WHERE user_id=?')) return profiles.filter((row) => row.userId === parameters[0]).map(({ id, schoolId: existingSchoolId, staffNumber }) => ({ id, schoolId: existingSchoolId, staffNumber }));
          if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) return foreignStaffDependencies ? [{ tableName: 'staff_attendance', columnName: 'staff_id' }] : [];
          if (sql.includes('SELECT COUNT(*) AS referenceCount FROM')) return [{ referenceCount: foreignStaffDependencies ? 1 : 0 }];
          if (sql.includes('SELECT id FROM staff WHERE school_id=? AND staff_number=?')) return [];
          if (sql.includes('JOIN departments d ON d.id=s.department_id')) return [];
          if (sql.includes('SELECT id FROM staff WHERE id=?')) return [];
          if (sql.includes('SELECT id FROM staff_profiles WHERE id=?')) return [];
          if (sql.includes('FROM parent_student_links')) return [];
          if (sql.includes('FROM roles')) return [{ id: `role-${parameters[0]}` }];
          if (sql.includes('JOIN staff_profiles sp ON')) return users.filter((user) => user.id === parameters[0] && user.schoolId === parameters[1]).map((user) => ({ id: user.id }));
          throw new Error(`Unexpected query ${sql}`);
        },
        async execute(sql, parameters = []) {
          executed.push({ sql, parameters });
          if (sql.startsWith('INSERT INTO staff (')) staff.push({ id: parameters[0], schoolId: parameters[1], userId: parameters[2], staffNumber: parameters[3] });
          else if (sql.startsWith('UPDATE staff SET school_id=')) {
            const [schoolId, staffNumber, firstName, lastName, _updatedAt, id, userId] = parameters;
            Object.assign(staff.find((row) => row.id === id && row.userId === userId), { schoolId, staffNumber, firstName, lastName });
          }
          else if (sql.startsWith('INSERT INTO staff_profiles')) profiles.push({ id: parameters[0], schoolId: parameters[1], userId: parameters[2], staffNumber: parameters[3] });
          else if (sql.startsWith('UPDATE users SET school_id=')) {
            const [nextSchoolId, username, fullName, role, _hash, _updatedAt, id] = parameters;
            Object.assign(users.find((user) => user.id === id), { schoolId: nextSchoolId, username, fullName, role, status: 'ACTIVE' });
          } else if (sql.startsWith('DELETE FROM user_roles')) {
            for (let index = roleLinks.length - 1; index >= 0; index -= 1) if (roleLinks[index].userId === parameters[0]) roleLinks.splice(index, 1);
          } else if (sql.startsWith('INSERT INTO user_roles')) roleLinks.push({ userId: parameters[1], roleId: parameters[2] });
          return { affectedRows: 1 };
        }
      });
    }
  };
  const service = createDurableRoleAccountProvisioning({
    database,
    passwordHash: (password) => `hashed:${password}`,
    verifyLogin: async ({ username, password, role }) => ({ ok: true, token: `token-${username}`, redirectTo: role === 'TEACHER' ? '/academics' : '/dashboard', user: { schoolId, roleKey: role, username, suppliedPasswordValid: password.length >= 12 } }),
    revokeSession: async (token) => revoked.push(token),
    now: () => Date.parse('2026-11-03T00:00:00Z')
  });
  return { service, database, users, staff, profiles, roleLinks, executed, revoked };
}

test('provisions exactly the fixed five target accounts and verifies durable links and logins', async () => {
  const state = fixture();
  const result = await state.service.provision(schoolId);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((account) => account.role), ROLE_ACCOUNT_TARGETS.map((target) => target.roleKey));
  assert.equal(state.staff.length, 5);
  assert.equal(state.profiles.length, 5);
  assert.equal(state.roleLinks.length, 5);
  assert.equal(state.users.every((user) => user.schoolId === schoolId && user.status === 'ACTIVE'), true);
  assert.equal(state.users.find((user) => user.email === 'abbanfrank348@gmail.com').username, 'frank.abban');
  assert.equal(result.every((account) => account.temporaryPassword.length >= 12 && account.landingPage), true);
  assert.equal(state.revoked.length, 5);
});

test('moves a foreign-school staff row when it has no dependent records', async () => {
  const state = fixture({ foreignStaff: true });
  const result = await state.service.provision(schoolId);
  assert.equal(result.length, 5);
  assert.equal(state.executed.some(({ sql }) => sql.startsWith('UPDATE staff SET school_id=')), true);
  assert.equal(state.staff.find((row) => row.id === 'foreign-staff').schoolId, schoolId);
  assert.equal(state.users.every((user) => user.schoolId === schoolId), true);
  assert.equal(state.profiles.length, 5);
});

test('aborts the whole reconciliation before writes if a foreign staff row has dependent records', async () => {
  const state = fixture({ foreignStaff: true, foreignStaffDependencies: true });
  await assert.rejects(state.service.provision(schoolId), {
    code: 'CROSS_SCHOOL_STAFF_DEPENDENCY_CONFLICT',
    details: { roles: [{ role: 'SCHOOL_ADMIN', dependentRecordCount: 1 }] }
  });
  assert.equal(state.executed.length, 0);
  assert.equal(state.users.every((user) => user.schoolId === 'other-school'), true);
});

test('provision route requires proprietor and same-origin POST, then returns generated credentials once', async (t) => {
  const state = fixture();
  const auth = {
    async authenticateAsync(token) { return token === 'proprietor' ? { id: 'owner', portal: 'school', roleKey: 'PROPRIETOR', schoolId } : token === 'teacher' ? { id: 'teacher', portal: 'school', roleKey: 'TEACHER', schoolId } : null; },
    hashPassword: (password) => `hashed:${password}`,
    async loginFromDatabase({ username, password, role }) { return { ok: true, token: `verified-${username}`, user: { schoolId, roleKey: role }, redirectTo: role === 'TEACHER' ? '/academics' : '/dashboard', passwordReceived: password.length >= 12 }; },
    async logoutSession(token) { state.revoked.push(token); }
  };
  const server = createServer(createApp({ auth, database: state.database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/admin/provision-role-accounts`;

  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer proprietor', Origin: 'https://attacker.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer teacher', Origin: new URL(endpoint).origin }, body: '{}' })).status, 403);
  assert.equal(state.executed.length, 0);

  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer proprietor', Origin: new URL(endpoint).origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.accounts.length, 5);
  assert.equal(body.credentialsShownOnce, true);
  assert.equal(body.accounts.every((account) => account.temporaryPassword.length >= 12), true);
  const diagnostic = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/verify-role-provisioning`, { headers: { Authorization: 'Bearer proprietor' } });
  assert.equal(diagnostic.status, 200);
  const verification = await diagnostic.json();
  assert.equal(verification.accounts.length, 5);
  assert.equal(verification.accounts.every((account) => account.accountExists && account.schoolMatched && account.assignedRoleMatches && account.active && account.staffRecordCount === 1 && account.staffProfileCount === 1), true);
});
