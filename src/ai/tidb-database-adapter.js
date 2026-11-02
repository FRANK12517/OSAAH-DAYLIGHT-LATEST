import mysql from 'mysql2/promise';

export const TIDB_PRODUCTION_DATABASE = 'osaahdaylightschool';

const schemaMigrationDdl = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME NOT NULL
)`;
const schemaMigrationLockDdl = `CREATE TABLE IF NOT EXISTS schema_migration_lock (
  lock_id TINYINT PRIMARY KEY,
  locked TINYINT NOT NULL DEFAULT 0,
  acquired_at DATETIME NULL
)`;
const schemaBaselineDdl = `CREATE TABLE IF NOT EXISTS schema_baselines (
  id VARCHAR(64) PRIMARY KEY,
  canonical_database VARCHAR(128) NOT NULL,
  baseline_at DATETIME NOT NULL,
  repository_commit CHAR(40) NOT NULL,
  schema_fingerprint CHAR(64) NOT NULL,
  reconciliation_migration VARCHAR(255) NOT NULL,
  workflow_provenance VARCHAR(255) NOT NULL,
  baseline_type VARCHAR(32) NOT NULL DEFAULT 'HISTORICAL_BASELINE',
  historical_migrations_executed TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
)`;
const schemaMigrationRunsDdl = `CREATE TABLE IF NOT EXISTS schema_migration_runs (
  version INT NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum CHAR(64) NOT NULL,
  state ENUM('RUNNING','FAILED','COMPLETED') NOT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  error_code VARCHAR(80) NULL
)`;
const adapterError = (code, message, details) => Object.assign(new Error(message), { code, details });

function stripLeadingComments(statement) {
  let remaining = statement.trimStart();
  while (remaining) {
    if (remaining.startsWith('--') || remaining.startsWith('#')) {
      const newline = remaining.indexOf('\n');
      remaining = newline === -1 ? '' : remaining.slice(newline + 1).trimStart();
      continue;
    }
    if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/', 2);
      remaining = end === -1 ? '' : remaining.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return remaining;
}

function splitMigrationSql(sql) {
  if (typeof sql !== 'string') throw new TypeError('Migration SQL must be a string.');
  const statements = [];
  let current = '', state = 'normal';
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index], next = sql[index + 1];
    if (state === 'lineComment') {
      current += character;
      if (character === '\n') state = 'normal';
      continue;
    }
    if (state === 'blockComment') {
      current += character;
      if (character === '*' && next === '/') { current += next; index += 1; state = 'normal'; }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      current += character;
      if (character === '\\' && next) { current += next; index += 1; continue; }
      if ((state === 'single' && character === "'") || (state === 'double' && character === '"') || (state === 'backtick' && character === '`')) {
        if (next === character) { current += next; index += 1; } else state = 'normal';
      }
      continue;
    }
    if (character === '-' && next === '-' && /\s/.test(sql[index + 2] ?? '')) { current += character + next; index += 1; state = 'lineComment'; continue; }
    if (character === '#') { current += character; state = 'lineComment'; continue; }
    if (character === '/' && next === '*') { current += character + next; index += 1; state = 'blockComment'; continue; }
    if (character === "'") { current += character; state = 'single'; continue; }
    if (character === '"') { current += character; state = 'double'; continue; }
    if (character === '`') { current += character; state = 'backtick'; continue; }
    if (character === ';') { if (stripLeadingComments(current).trim()) statements.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (state !== 'normal') throw new Error('Unterminated SQL quote or comment in migration.');
  if (stripLeadingComments(current).trim()) statements.push(current.trim());
  return statements;
}

function sanitizedMessage(error) {
  return String(error?.message ?? 'Database rejected migration statement.')
    .replace(/(?:mysql|mariadb):\/\/[^\s]+/gi, '[redacted-database-url]')
    .replace(/(password|passwd|secret|token|key)=([^\s&]+)/gi, '$1=[redacted]');
}

function operationOf(statement) { return stripLeadingComments(statement).match(/^(\w+)/)?.[1]?.toUpperCase() ?? 'UNKNOWN'; }

async function executeMigrationSqlOn(connection, sql, context = {}) {
  const statements = splitMigrationSql(sql);
  for (const [offset, statement] of statements.entries()) {
    try { await connection.execute(statement); }
    catch (cause) {
      throw adapterError('MIGRATION_STATEMENT_FAILED', 'Migration statement failed.', {
        migration: context.migrationName ?? null,
        version: context.version ?? null,
        statementIndex: offset + 1,
        operation: operationOf(statement),
        databaseCode: cause?.code ?? null,
        sqlState: cause?.sqlState ?? null,
        databaseMessage: sanitizedMessage(cause)
      });
    }
  }
}

export function createDatabaseAdapter({ environment, poolFactory = mysql.createPool } = {}) {
  const env = environment ?? process.env;
  const connectionString = String(env.DATABASE_URL ?? '').trim();
  let url = null;
  if (connectionString) {
    try { url = new URL(connectionString); }
    catch { throw Object.assign(new Error('DATABASE_URL is not a valid MySQL connection URL.'), { code: 'DATABASE_URL_INVALID' }); }
    if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
      throw Object.assign(new Error('TiDB DATABASE_URL must use the mysql:// scheme.'), { code: 'DATABASE_URL_INVALID' });
    }
  }
  const decode = (value) => {
    try { return decodeURIComponent(value); }
    catch { throw Object.assign(new Error('DATABASE_URL contains invalid URL encoding.'), { code: 'DATABASE_URL_INVALID' }); }
  };
  const firstValue = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim();
  const host = firstValue(env.HOST, env.TIDB_HOST, url?.hostname);
  const user = firstValue(env.TIDB_USER, url?.username ? decode(url.username) : undefined);
  const password = firstValue(env.TIDB_PASSWORD, url?.password ? decode(url.password) : undefined);
  const database = firstValue(env.DATABASE, env.TIDB_DATABASE, url?.pathname ? decode(url.pathname.slice(1)) : undefined);
  const portValue = firstValue(env.PORT, env.TIDB_PORT, url?.port);
  const port = portValue ? Number(portValue) : 3306;
  if (!host || !user || !password || !database || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('TiDB configuration requires a database URL or valid host, port, database, user, and password settings.'), { code: 'DATABASE_CONFIGURATION_INVALID' });
  }
  if (database !== TIDB_PRODUCTION_DATABASE) {
    throw Object.assign(new Error(`TiDB DATABASE_URL must select ${TIDB_PRODUCTION_DATABASE}.`), { code: 'DATABASE_NAME_MISMATCH' });
  }
  const ca = typeof env.TIDB_CA_CERT === 'string' && env.TIDB_CA_CERT.trim()
    ? env.TIDB_CA_CERT.trim().replace(/(?:\\r)?\\n/g, '\n')
    : undefined;
  const pool = poolFactory({
    host,
    user,
    password,
    database,
    port,
    ssl: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: env.TIDB_SSL_REJECT_UNAUTHORIZED === 'false' ? false : true,
      ...(ca ? { ca } : {})
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000
  });
  const metadataTables = ['schema_migrations', 'schema_migration_lock', 'schema_migration_runs'];

  return {
    dialect: 'tidb',
    supportsDurableAuthSessions: true,
    async query(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; },
    async execute(sql, params = []) { const [result] = await pool.execute(sql, params); return { insertId: result.insertId, affectedRows: result.affectedRows }; },
    async transaction(callback) {
      const connection = await pool.getConnection(); await connection.beginTransaction();
      try {
        const transactionalAdapter = {
          async query(sql, params = []) { const [rows] = await connection.query(sql, params); return rows; },
          async execute(sql, params = []) { const [result] = await connection.execute(sql, params); return { insertId: result.insertId, affectedRows: result.affectedRows }; },
          async executeMigrationSql(sql, context) { return executeMigrationSqlOn(connection, sql, context); },
          async recordApplied(record) { await this.execute('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [Number(record.version), record.name, record.checksum, record.appliedAt]); }
        };
        const result = await callback(transactionalAdapter); await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    },
    async verifyReadiness() {
      let identity;
      try {
        const [rows] = await pool.query('SELECT DATABASE() AS database_name, VERSION() AS server_version');
        identity = rows?.[0];
      } catch (cause) {
        throw adapterError('TIDB_CONNECTION_UNAVAILABLE', 'Could not connect to the configured TiDB database.', { databaseCode: cause?.code ?? null });
      }
      if (identity?.database_name !== TIDB_PRODUCTION_DATABASE) {
        throw adapterError('DATABASE_NAME_MISMATCH', `Connected database must be ${TIDB_PRODUCTION_DATABASE}.`, { selectedDatabase: identity?.database_name ?? null });
      }
      if (!/TiDB/i.test(String(identity.server_version ?? ''))) {
        throw adapterError('DATABASE_ENGINE_MISMATCH', 'The configured database server did not identify as TiDB.', { serverVersion: String(identity.server_version ?? '').slice(0, 80) });
      }
      let authenticationSchemaReady = true;
      try {
        await pool.query('SELECT id, user_id, school_id, token_hash, created_at, expires_at, revoked_at, last_used_at FROM auth_sessions LIMIT 0');
      } catch { authenticationSchemaReady = false; }
      return {
        ready: true,
        database: TIDB_PRODUCTION_DATABASE,
        engine: 'TiDB',
        serverVersion: String(identity.server_version ?? '').slice(0, 80),
        authenticationSchemaReady,
        schemaErrorCode: authenticationSchemaReady ? null : 'AUTH_SCHEMA_NOT_READY'
      };
    },
    async healthCheck() { try { await pool.query('SELECT 1'); return { healthy: true }; } catch (error) { return { healthy: false, error: error.message }; } },
    async ensureMetadata({ create = true } = {}) {
      if (create) {
        await pool.query(schemaMigrationDdl);
        await pool.query(schemaMigrationLockDdl);
        await pool.execute('INSERT INTO schema_migration_lock (lock_id, locked) VALUES (1, 0) ON DUPLICATE KEY UPDATE lock_id = lock_id');
        await pool.query(schemaBaselineDdl);
        await pool.query(schemaMigrationRunsDdl);
        return { created: true, tables: [...metadataTables, 'schema_baselines'] };
      }
      const rows = await this.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [metadataTables]);
      const present = new Set(rows.map((row) => row.TABLE_NAME));
      const missing = metadataTables.filter((table) => !present.has(table));
      if (missing.length) throw adapterError('MIGRATION_METADATA_MISSING', `Migration metadata is missing: ${missing.join(', ')}`);
      return { created: false, tables: metadataTables };
    },
    async listApplied() { return this.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version ASC'); },
    async listMigrationRuns() { return this.query('SELECT version,name,checksum,state,started_at AS startedAt,completed_at AS completedAt,error_code AS errorCode FROM schema_migration_runs ORDER BY version ASC'); },
    async startMigration(migration) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT state,checksum FROM schema_migration_runs WHERE version=? FOR UPDATE', [migration.version]);
        const current = rows[0];
        if (current?.state === 'RUNNING' || current?.state === 'FAILED') throw adapterError('MIGRATION_RECOVERY_REQUIRED', `Migration ${migration.name} has unresolved state ${current.state}.`);
        if (current?.state === 'COMPLETED' && current.checksum !== migration.checksum) throw adapterError('MIGRATION_CHECKSUM_MISMATCH', `Migration ${migration.name} checksum changed.`);
        await connection.execute(`INSERT INTO schema_migration_runs (version,name,checksum,state,started_at,completed_at,error_code) VALUES (?,?,?,'RUNNING',?,NULL,NULL) ON DUPLICATE KEY UPDATE state='RUNNING',started_at=VALUES(started_at),completed_at=NULL,error_code=NULL`, [migration.version,migration.name,migration.checksum,migration.startedAt]);
        await connection.commit();
      } catch (cause) { await connection.rollback(); throw cause; }
      finally { connection.release(); }
    },
    async completeMigration(record) {
      const result = await this.execute("UPDATE schema_migration_runs SET state='COMPLETED',completed_at=?,error_code=NULL WHERE version=? AND name=? AND checksum=? AND state='RUNNING'", [record.completedAt,record.version,record.name,record.checksum]);
      if (Number(result.affectedRows) !== 1) throw adapterError('MIGRATION_STATE_UPDATE_FAILED', `Could not mark migration ${record.name} completed.`);
    },
    async failActiveMigration({ version, failedAt, errorCode }) {
      if (!Number.isInteger(Number(version))) throw adapterError('MIGRATION_STATE_UPDATE_FAILED', 'A migration version is required to record failure state.');
      await this.execute("UPDATE schema_migration_runs SET state='FAILED',completed_at=?,error_code=? WHERE version=? AND state='RUNNING'", [failedAt,String(errorCode).slice(0,80),Number(version)]);
    },
    async recordApplied(record) {
      if (!record || !Number.isInteger(Number(record.version)) || !record.name || !record.checksum || !record.appliedAt) throw new Error('Invalid migration metadata.');
      await this.execute('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [Number(record.version), record.name, record.checksum, record.appliedAt]);
    },
    async acquireLock() { const result = await this.execute('UPDATE schema_migration_lock SET locked = 1, acquired_at = CURRENT_TIMESTAMP WHERE lock_id = 1 AND locked = 0'); return Number(result.affectedRows) === 1; },
    async releaseLock() { await this.execute('UPDATE schema_migration_lock SET locked = 0, acquired_at = NULL WHERE lock_id = 1'); },
    async listBaselines() { return this.query('SELECT id, canonical_database AS canonicalDatabase, baseline_at AS baselineAt, repository_commit AS repositoryCommit, schema_fingerprint AS schemaFingerprint, reconciliation_migration AS reconciliationMigration, workflow_provenance AS workflowProvenance, baseline_type AS baselineType, historical_migrations_executed AS historicalMigrationsExecuted, created_at AS createdAt FROM schema_baselines ORDER BY baseline_at DESC'); },
    async recordBaseline(record) {
      if (!record?.id || !record.canonicalDatabase || !record.baselineAt || !record.repositoryCommit || !record.schemaFingerprint || !record.reconciliationMigration || !record.workflowProvenance || !record.createdAt) throw new Error('Invalid schema baseline metadata.');
      await this.execute('INSERT INTO schema_baselines (id, canonical_database, baseline_at, repository_commit, schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type, historical_migrations_executed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [record.id, record.canonicalDatabase, record.baselineAt, record.repositoryCommit, record.schemaFingerprint, record.reconciliationMigration, record.workflowProvenance, record.baselineType ?? 'HISTORICAL_BASELINE', record.historicalMigrationsExecuted ? 1 : 0, record.createdAt]);
    },
    async close() { await pool.end(); }
  };
}

export { schemaMigrationDdl, schemaMigrationLockDdl, schemaBaselineDdl, schemaMigrationRunsDdl, splitMigrationSql, executeMigrationSqlOn };
export default createDatabaseAdapter;

