import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDatabaseConfiguration } from '../src/ai/durable-stores.js';
import {
  TIDB_ISOLATION_APPROVAL_VALUE,
  TIDB_ISOLATION_APPROVAL_VARIABLE,
  TIDB_READINESS_REQUIRED_TABLE_COLUMNS,
  TIDB_READINESS_REQUIRED_INDEXES,
  TIDB_READINESS_REQUIRED_FOREIGN_KEYS,
  verifyTiDBTarget
} from '../src/ai/tidb-readiness.js';

const tidbEnvironment = (overrides = {}) => ({
  NODE_ENV: 'test',
  OSAAH_DATABASE_ADAPTER: 'tidb',
  DATABASE_URL: 'mysql://sample-user:sample-password@tidb-test.example.invalid:4000/osaahdaylightschool',
  [TIDB_ISOLATION_APPROVAL_VARIABLE]: TIDB_ISOLATION_APPROVAL_VALUE,
  ...overrides
});

function schemaDatabase({ serverVersion = '5.7.25-TiDB-v8.5.0', databaseName = 'osaahdaylightschool', missing = {}, missingIndexes = {}, missingForeignKeys = {}, unsupportedMetadata = null, failIdentity = false } = {}) {
  const calls = [];
  const database = {
    dialect: 'tidb',
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (failIdentity && sql.startsWith('SELECT VERSION()')) throw new Error('mysql://private-user:private-password@secret-host/private-db');
      if (sql.startsWith('SELECT VERSION()')) return [{ serverVersion, databaseName }];
      if (sql.startsWith('SHOW SESSION STATUS LIKE')) return [
        { Variable_name: 'Ssl_version', Value: 'TLSv1.3' },
        { Variable_name: 'Ssl_cipher', Value: 'TLS_AES_128_GCM_SHA256' }
      ];
      if (sql.includes('information_schema.COLUMNS')) {
        const table = params[0];
        return (TIDB_READINESS_REQUIRED_TABLE_COLUMNS[table] ?? [])
          .filter((column) => !missing[table]?.includes(column))
          .map((columnName) => ({ columnName }));
      }
      if (sql.includes('information_schema.STATISTICS')) {
        if (unsupportedMetadata === 'indexes') throw new Error('metadata view unavailable');
        const table = params[0];
        return (TIDB_READINESS_REQUIRED_INDEXES[table] ?? []).filter((index) => !missingIndexes[table]?.includes(index.label)).flatMap((index, order) => index.columns.map((columnName, columnIndex) => ({
          indexName: index.name ?? `synthetic_${table}_${order}`,
          nonUnique: Object.hasOwn(index, 'unique') ? (index.unique ? 0 : 1) : index.name === 'PRIMARY' ? 0 : 1,
          sequence: columnIndex + 1,
          columnName
        })));
      }
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) {
        if (unsupportedMetadata === 'foreignKeys') throw new Error('foreign key metadata unavailable');
        const table = params[0];
        return (TIDB_READINESS_REQUIRED_FOREIGN_KEYS[table] ?? []).filter((key) => !missingForeignKeys[table]?.includes(key.column)).map((key) => ({
          columnName: key.column, referencedTable: key.referencedTable, referencedColumn: key.referencedColumn
        }));
      }
      if (sql.startsWith('SHOW CREATE TABLE')) {
        if (unsupportedMetadata === 'showCreate') throw new Error('SHOW CREATE unavailable');
        return [{ 'Create Table': 'CREATE TABLE test_table (id VARCHAR(64))' }];
      }
      throw new Error('Unexpected query');
    },
    async close() {}
  };
  return { database, calls };
}

test('database configuration readiness uses the selected TiDB adapter and never claims connectivity', async () => {
  const result = await inspectDatabaseConfiguration({ environment: tidbEnvironment() });
  assert.equal(result.configurationStatus, 'CONFIGURATION_VALID');
  assert.equal(result.connectionStatus, 'UNVERIFIED');
  assert.equal(result.status, 'CONNECTION_UNVERIFIED');
  assert.equal(result.selectedAdapter, 'tidb');
  assert.equal(result.selectedDatabase, 'osaahdaylightschool');
  assert.equal(result.explicitSelectionConfigured, true);
  assert.deepEqual(result.tls, { enabled: true, minimumVersion: 'TLSv1.2', certificateVerification: true, customCaProvided: false });
  assert.deepEqual(result.configuredSources, { host: 'DATABASE_URL', database: 'DATABASE_URL', port: 'DATABASE_URL' });
  assert.doesNotMatch(JSON.stringify(result), /sample-user|sample-password|mysql:\/\//);
});

test('database configuration readiness identifies missing TiDB settings and a PostgreSQL conflict safely', async () => {
  const missing = await inspectDatabaseConfiguration({ environment: { OSAAH_DATABASE_ADAPTER: 'tidb' } });
  assert.equal(missing.configurationStatus, 'CONFIGURATION_INVALID');
  assert.ok(missing.missingSettings.some((item) => item.includes('HOST')));
  assert.ok(missing.missingSettings.some((item) => item.includes('TIDB_USER')));
  assert.equal(missing.connectionStatus, 'NOT_ATTEMPTED');
  const conflict = await inspectDatabaseConfiguration({ environment: tidbEnvironment({ POSTGRES_URL: 'postgresql://secret@pg.example.invalid/osaah' }) });
  assert.deepEqual(conflict.conflicts, ['DATABASE_CONFIGURATION_CONFLICT']);
  assert.equal(conflict.connectionStatus, 'NOT_ATTEMPTED');
  assert.doesNotMatch(JSON.stringify(conflict), /secret|postgresql:\/\//);
});

test('mixed PostgreSQL and TiDB URLs are rejected without exposing either URL', async () => {
  const result = await inspectDatabaseConfiguration({ environment: {
    DATABASE_URL: 'mysql://sample-user:sample-password@tidb-test.example.invalid:4000/osaahdaylightschool',
    OSAAH_POSTGRES_URL: 'postgresql://sample:sample@pg.example.invalid/osaah'
  } });
  assert.equal(result.configurationStatus, 'CONFIGURATION_INVALID');
  assert.deepEqual(result.conflicts, ['DATABASE_CONFIGURATION_CONFLICT']);
  assert.equal(result.selectedAdapter, null);
  assert.doesNotMatch(JSON.stringify(result), /sample-password|mysql:\/\/|postgresql:\/\//);
});

test('standard connection variables override MySQL URL destination while it supplies credentials', async () => {
  const result = await inspectDatabaseConfiguration({ environment: {
    DATABASE_URL: 'mysql://sample-user:sample-password@url-host.example.invalid:4000/url_database',
    HOST: 'tidb-host.example.invalid',
    PORT: '4100',
    DATABASE: 'osaahdaylightschool'
  } });
  assert.equal(result.configurationStatus, 'CONFIGURATION_VALID');
  assert.equal(result.selectedDatabase, 'osaahdaylightschool');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.configuredSources, { host: 'HOST', database: 'DATABASE', port: 'PORT' });
  assert.doesNotMatch(JSON.stringify(result), /sample-password|url-host|tidb-host|url_database/);
});

test('database readiness detects differing connection overrides without revealing configured values', async () => {
  const result = await inspectDatabaseConfiguration({ environment: tidbEnvironment({
    HOST: 'another-host.example.invalid',
    TIDB_DATABASE: 'other_database',
    TIDB_PORT: '4100',
    TIDB_USER: 'different-user',
    TIDB_PASSWORD: 'different-password'
  }) });
  assert.deepEqual(result.conflicts, [
    'HOST_SOURCES_DIFFER',
    'DATABASE_SOURCES_DIFFER',
    'PORT_SOURCES_DIFFER',
    'USERNAME_SOURCES_DIFFER',
    'PASSWORD_SOURCES_DIFFER',
    'DATABASE_NAME_MISMATCH'
  ]);
  assert.doesNotMatch(JSON.stringify(result), /another-host|different-user|different-password|sample-password/);
});

test('TiDB readiness refuses production, missing isolation approval, or non-TiDB selection before querying', async () => {
  const { database, calls } = schemaDatabase();
  for (const environment of [
    tidbEnvironment({ [TIDB_ISOLATION_APPROVAL_VARIABLE]: undefined }),
    tidbEnvironment({ NODE_ENV: 'production' }),
    tidbEnvironment({ OSAAH_DATABASE_ADAPTER: undefined })
  ]) {
    const result = await verifyTiDBTarget({ database, environment });
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.schema.status, 'NOT_CHECKED');
  }
  assert.equal(calls.length, 0);
});

test('TiDB readiness verifies server identity, columns, indexes, and declared foreign keys with read-only metadata queries', async () => {
  const { database, calls } = schemaDatabase();
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'READY_FOR_AUTHENTICATION_TESTS');
  assert.equal(result.engine, 'TiDB');
  assert.equal(result.database, 'osaahdaylightschool');
  assert.equal(result.connectionStatus, 'VERIFIED');
  assert.deepEqual(result.tls, {
    status: 'VERIFIED', enabled: true, version: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256',
    minimumVersion: 'TLSv1.2', certificateVerification: 'STRICT_CLIENT_POLICY', customCaProvided: false
  });
  assert.equal(result.schema.status, 'OK');
  assert.equal(result.schema.checks.length, Object.keys(TIDB_READINESS_REQUIRED_TABLE_COLUMNS).length);
  assert.equal(result.schema.indexes.status, 'OK');
  assert.equal(result.schema.foreignKeys.status, 'OK');
  assert.equal(result.schema.foreignKeys.supportLevel, 'GENERALLY_AVAILABLE');
  assert.ok(calls.every(({ sql }) => /^(SELECT\b|SHOW SESSION STATUS\b|SHOW CREATE TABLE\b)/i.test(sql)));
  assert.equal(calls[0].sql, 'SELECT VERSION() AS serverVersion, DATABASE() AS databaseName');
  assert.doesNotMatch(JSON.stringify(result), /sample-user|sample-password|0247293733|Kofi Mensah/i);
});

test('active phone-only Parent schema requires rate-limit storage but not dormant SMS challenges', async () => {
  assert.ok(Object.hasOwn(TIDB_READINESS_REQUIRED_TABLE_COLUMNS, 'parent_auth_rate_limits'));
  assert.equal(Object.hasOwn(TIDB_READINESS_REQUIRED_TABLE_COLUMNS, 'parent_auth_challenges'), false);
  const { database, calls } = schemaDatabase();
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'READY_FOR_AUTHENTICATION_TESTS');
  assert.ok(result.schema.checks.some((check) => check.table === 'parent_auth_rate_limits'));
  assert.equal(result.schema.checks.some((check) => check.table === 'parent_auth_challenges'), false);
  assert.equal(calls.some(({ params }) => params.includes('parent_auth_challenges')), false);
});

test('TiDB readiness refuses to report ready when the negotiated TLS version is below policy', async () => {
  for (const tlsRows of [[
    { Variable_name: 'Ssl_version', Value: 'TLSv1.1' },
    { Variable_name: 'Ssl_cipher', Value: 'OLD_CIPHER' }
  ]]) {
    const { database: base } = schemaDatabase();
    const database = {
      ...base,
      async query(sql, params = []) {
        if (sql.startsWith('SHOW SESSION STATUS LIKE')) return tlsRows;
        return base.query(sql, params);
      }
    };
    const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
    assert.equal(result.status, 'TLS_VERIFICATION_FAILED');
    assert.notEqual(result.tls.status, 'VERIFIED');
    assert.equal(result.schema.status, 'NOT_CHECKED');
  }
});

test('TiDB readiness reports missing TLS status variables as unverified', async () => {
  const { database: base } = schemaDatabase();
  const database = {
    ...base,
    async query(sql, params = []) {
      if (sql.startsWith('SHOW SESSION STATUS LIKE')) return [];
      return base.query(sql, params);
    }
  };
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'TLS_CHECK_UNVERIFIED');
  assert.equal(result.code, 'TLS_STATUS_VARIABLES_UNAVAILABLE');
  assert.equal(result.schema.status, 'NOT_CHECKED');
});

test('unsupported TiDB TLS status metadata is reported unverified, never ready', async () => {
  const { database: base } = schemaDatabase();
  const database = {
    ...base,
    async query(sql, params = []) {
      if (sql.startsWith('SHOW SESSION STATUS LIKE')) throw new Error('TLS metadata unavailable');
      return base.query(sql, params);
    }
  };
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'TLS_CHECK_UNVERIFIED');
  assert.equal(result.code, 'TLS_SESSION_STATUS_UNAVAILABLE');
  assert.equal(result.tls.status, 'NOT_CHECKED');
});

test('TiDB readiness refuses the wrong engine or database before inspecting schema', async () => {
  for (const options of [
    { serverVersion: '8.0.36 MySQL Community Server', databaseName: 'osaahdaylightschool', code: 'SERVER_NOT_IDENTIFIED_AS_TIDB' },
    { serverVersion: '5.7.25-TiDB-v7.5.4', databaseName: 'other_database', code: 'DATABASE_NAME_MISMATCH' }
  ]) {
    const { database, calls } = schemaDatabase(options);
    const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
    assert.equal(result.status, 'IDENTITY_FAILED');
    assert.equal(result.code, options.code);
    assert.equal(calls.length, 1);
  }
});

test('TiDB readiness reports missing required columns without reading account or student rows', async () => {
  const { database, calls } = schemaDatabase({ missing: { parent_auth_rate_limits: ['request_count'], student_profiles: ['student_master_id'] } });
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'SCHEMA_CHECK_FAILED');
  assert.equal(result.code, 'REQUIRED_SCHEMA_OBJECT_MISSING');
  assert.deepEqual(result.schema.checks.find((check) => check.table === 'parent_auth_rate_limits').missingColumns, ['request_count']);
  assert.deepEqual(result.schema.checks.find((check) => check.table === 'student_profiles').missingColumns, ['student_master_id']);
  assert.ok(calls.every(({ sql }) => /^(SELECT\b|SHOW SESSION STATUS\b|SHOW CREATE TABLE\b)/i.test(sql)));
});

test('TiDB readiness reports missing required unique and lookup indexes', async () => {
  const { database } = schemaDatabase({ missingIndexes: {
    auth_sessions: ['UNIQUE(token_hash)'],
    parent_student_links: ['PRIMARY(parent_user_id, student_id)']
  } });
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'SCHEMA_CHECK_FAILED');
  assert.equal(result.schema.indexes.status, 'FAILED');
  assert.deepEqual(result.schema.indexes.checks.find((check) => check.table === 'auth_sessions').missingIndexes, ['UNIQUE(token_hash)']);
  assert.deepEqual(result.schema.indexes.checks.find((check) => check.table === 'parent_student_links').missingIndexes, ['PRIMARY(parent_user_id, student_id)']);
});

test('TiDB readiness reports missing declared foreign keys without inventing undeclared ones', async () => {
  const { database } = schemaDatabase({ missingForeignKeys: { parent_student_links: ['student_id'] } });
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'SCHEMA_CHECK_FAILED');
  assert.equal(result.schema.foreignKeys.status, 'FAILED');
  assert.deepEqual(result.schema.foreignKeys.checks.find((check) => check.table === 'parent_student_links').missingForeignKeys, ['student_id->student_profiles.id']);
  assert.ok(!TIDB_READINESS_REQUIRED_FOREIGN_KEYS.user_roles.some((key) => key.column === 'role_id'));
  assert.ok(!TIDB_READINESS_REQUIRED_FOREIGN_KEYS.student_profiles.some((key) => key.column === 'student_master_id'));
});

test('TiDB readiness marks unsupported index and foreign-key metadata queries unverified', async () => {
  for (const unsupportedMetadata of ['indexes', 'foreignKeys', 'showCreate']) {
    const { database } = schemaDatabase({ unsupportedMetadata });
    const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
    assert.equal(result.status, 'SCHEMA_CHECK_UNVERIFIED');
    assert.equal(result.schema.status, 'UNVERIFIED');
    assert.doesNotMatch(JSON.stringify(result), /metadata view unavailable|foreign key metadata unavailable|SHOW CREATE unavailable/i);
  }
});

test('TiDB readiness treats legacy or unparseable foreign-key support versions as unverified', async () => {
  for (const serverVersion of ['5.7.25-TiDB-v6.5.4', 'TiDB']) {
    const { database, calls } = schemaDatabase({ serverVersion });
    const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
    assert.equal(result.status, 'SCHEMA_CHECK_UNVERIFIED');
    assert.equal(result.schema.foreignKeys.status, 'UNVERIFIED');
    assert.equal(calls.some(({ sql }) => sql.includes('information_schema.KEY_COLUMN_USAGE')), false);
  }
});

test('TiDB readiness sanitizes identity query failures and never claims connection success', async () => {
  const { database } = schemaDatabase({ failIdentity: true });
  const result = await verifyTiDBTarget({ database, environment: tidbEnvironment() });
  assert.equal(result.status, 'CONNECTION_FAILED');
  assert.equal(result.code, 'READ_ONLY_IDENTITY_QUERY_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /private-user|private-password|secret-host|private-db/);
});
