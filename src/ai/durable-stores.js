import { createAIActionStore } from './human-controlled-actions.js';
import { createInMemoryAIAuditSink } from './audit-logger.js';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clone = (value) => structuredClone(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 503 }); };
function database(adapter) { if (!adapter || typeof adapter.query !== 'function' || typeof adapter.execute !== 'function' || typeof adapter.transaction !== 'function' || typeof adapter.healthCheck !== 'function') fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.'); return adapter; }
function safeDatabaseError(cause, code = 'PERSISTENCE_UNAVAILABLE') { if (cause?.code === code || cause?.code === 'IDEMPOTENCY_CONFLICT') return cause; return Object.assign(new Error('Durable persistence is unavailable.'), { code, status: 503 }); }
function parse(value, fallback = null) { if (value === null || value === undefined || value === '') return fallback; try { return JSON.parse(value); } catch { return fallback; } }

function postgresConnectionString(value) { return typeof value === 'string' && /^\s*postgres(?:ql)?:/i.test(value); }
function mysqlConnectionString(value) { return typeof value === 'string' && /^\s*mysql(?:2)?:/i.test(value); }
export function inspectDatabaseConfiguration({ environment = process.env } = {}) {
  const databaseUrl = typeof environment.DATABASE_URL === 'string' ? environment.DATABASE_URL.trim() : '';
  const postgresUrl = [environment.OSAAH_POSTGRES_URL, environment.POSTGRES_URL].some((value) => typeof value === 'string' && value.trim());
  const mysqlUrl = mysqlConnectionString(databaseUrl);
  let url;
  if (mysqlUrl) { try { url = new URL(databaseUrl); } catch { /* Report below without exposing input. */ } }
  const databaseName = String(url?.pathname?.slice(1) ?? (databaseUrl ? '' : environment.TIDB_DATABASE ?? environment.DATABASE ?? '')).trim();
  const missingSettings = [];
  if (!databaseUrl && !(environment.HOST || environment.TIDB_HOST)) missingSettings.push('HOST');
  if (!databaseUrl && !(environment.TIDB_USER)) missingSettings.push('TIDB_USER');
  if (!databaseUrl && !(environment.TIDB_PASSWORD)) missingSettings.push('TIDB_PASSWORD');
  if (!databaseUrl && !databaseName) missingSettings.push('DATABASE');
  const conflicts = [];
  if (postgresUrl || postgresConnectionString(databaseUrl)) conflicts.push('DATABASE_CONFIGURATION_CONFLICT');
  const sourcePairs = [
    ['HOST_SOURCES_DIFFER', databaseUrl ? undefined : environment.HOST, environment.TIDB_HOST, url?.hostname],
    ['DATABASE_SOURCES_DIFFER', databaseUrl ? undefined : environment.DATABASE, environment.TIDB_DATABASE, url?.pathname?.slice(1)],
    // PORT belongs to the Vercel/HTTP runtime. Only compare the TiDB-specific
    // override with the port embedded in DATABASE_URL.
    ['PORT_SOURCES_DIFFER', environment.TIDB_PORT, url?.port]
  ];
  for (const [code, ...values] of sourcePairs) {
    const configured = values.filter((value) => value !== undefined && value !== null && String(value).trim()).map(String);
    if (new Set(configured).size > 1) conflicts.push(code);
  }
  if (environment.TIDB_USER && url?.username && String(environment.TIDB_USER) !== decodeURIComponent(url.username)) conflicts.push('USERNAME_SOURCES_DIFFER');
  if (environment.TIDB_PASSWORD && url?.password && String(environment.TIDB_PASSWORD) !== decodeURIComponent(url.password)) conflicts.push('PASSWORD_SOURCES_DIFFER');
  if (environment.OSAAH_DATABASE_ADAPTER && String(environment.OSAAH_DATABASE_ADAPTER).trim().toLowerCase() !== 'tidb') conflicts.push('DATABASE_ADAPTER_INVALID');
  if (databaseUrl && !mysqlUrl) conflicts.push('DATABASE_URL_INVALID');
  if (databaseUrl && mysqlUrl && !url) conflicts.push('DATABASE_URL_INVALID');
  if (databaseName && databaseName !== 'osaahdaylightschool') conflicts.push('DATABASE_NAME_MISMATCH');
  if (databaseUrl && url && !url.username) missingSettings.push('TIDB_USER');
  if (databaseUrl && url && !url.password) missingSettings.push('TIDB_PASSWORD');
  const duplicateConflicts = [...new Set(conflicts)];
  const valid = !missingSettings.length && !duplicateConflicts.length;
  return {
    configurationStatus: valid ? 'CONFIGURATION_VALID' : 'CONFIGURATION_INVALID',
    connectionStatus: valid ? 'UNVERIFIED' : 'NOT_ATTEMPTED',
    status: valid ? 'CONNECTION_UNVERIFIED' : 'CONFIGURATION_INVALID',
    selectedAdapter: valid ? 'tidb' : null,
    selectedDatabase: databaseName || null,
    explicitSelectionConfigured: String(environment.OSAAH_DATABASE_ADAPTER ?? '').trim().toLowerCase() === 'tidb',
    missingSettings,
    invalidSettings: duplicateConflicts.filter((code) => code.endsWith('_INVALID') || code === 'DATABASE_NAME_MISMATCH'),
    conflicts: duplicateConflicts,
    warnings: [],
    tls: { enabled: true, minimumVersion: 'TLSv1.2', certificateVerification: true, customCaProvided: Boolean(environment.TIDB_CA_CERT?.trim()) },
    configuredSources: { host: url?.hostname ? 'DATABASE_URL' : environment.HOST ? 'HOST' : environment.TIDB_HOST ? 'TIDB_HOST' : null, database: url?.pathname ? 'DATABASE_URL' : environment.DATABASE ? 'DATABASE' : environment.TIDB_DATABASE ? 'TIDB_DATABASE' : null, port: url?.port ? 'DATABASE_URL' : environment.TIDB_PORT ? 'TIDB_PORT' : null }
  };
}
function configuredDatabaseAdapterModule(environment) {
  const inspected = inspectDatabaseConfiguration({ environment });
  if (inspected.conflicts.length) {
    const code = inspected.conflicts.includes('DATABASE_NAME_MISMATCH') ? 'DATABASE_NAME_MISMATCH'
      : inspected.conflicts.includes('DATABASE_URL_INVALID') ? 'DATABASE_URL_INVALID'
        : inspected.conflicts.includes('DATABASE_ADAPTER_INVALID') ? 'DATABASE_ADAPTER_INVALID'
          : 'DATABASE_CONFIGURATION_CONFLICT';
    const conflictDetails = inspected.conflicts.join(', ');
    fail(code, code === 'DATABASE_NAME_MISMATCH' ? 'TiDB database must be osaahdaylightschool.' : `Database configuration conflicts with the TiDB-only runtime (${conflictDetails}).`);
  }
  const selection = String(environment.OSAAH_DATABASE_ADAPTER ?? '').trim().toLowerCase();
  const postgresUrl = [environment.OSAAH_POSTGRES_URL, environment.POSTGRES_URL].find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
  const databaseUrl = typeof environment.DATABASE_URL === 'string' ? environment.DATABASE_URL.trim() : '';
  const postgresDatabaseUrl = postgresConnectionString(databaseUrl);
  const mysqlDatabaseUrl = mysqlConnectionString(databaseUrl);
  if (selection && selection !== 'tidb') fail('DATABASE_ADAPTER_INVALID', 'OSAAH_DATABASE_ADAPTER must be tidb.');
  if (postgresDatabaseUrl || postgresUrl) fail('DATABASE_CONFIGURATION_CONFLICT', 'PostgreSQL database configuration is not supported.');
  if (databaseUrl && !mysqlDatabaseUrl) fail('DATABASE_URL_INVALID', 'DATABASE_URL must use mysql:// or mysql2://.');
  if (!databaseUrl) return null;
  return fileURLToPath(new URL('./tidb-database-adapter.js', import.meta.url));
}

const AUDIT_INSERT = `INSERT INTO ai_audit_logs (id,request_id,correlation_id,occurred_at,event_type,severity,school_id,user_id,role_key,capability_id,tool_name,operation_type,authorization_result,data_scope_json,production_data_only,data_quality_status,request_status,duration_ms,provider,model,input_tokens,output_tokens,total_tokens,estimated_cost,error_code,action_requested,action_executed,approval_user_id,rejection_user_id,action_decision_at,target_record_id,rollback_reference_id,environment,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
export function createDatabaseAIAuditSink({ adapter } = {}) {
  const db = database(adapter);
  return Object.freeze({ durable: true, async healthCheck() { try { return await db.healthCheck(); } catch { return { healthy: false }; } }, async append(event) { try { await db.execute(AUDIT_INSERT, [event.id,event.requestId,event.correlationId,event.timestamp,event.eventType,event.severity,event.schoolId,event.userId,event.role,event.capabilityId,event.toolName,event.operationType,event.authorizationResult,JSON.stringify(event.dataScope ?? {}),event.productionDataOnly === null ? null : Number(event.productionDataOnly),event.dataQualityStatus,event.requestStatus,event.durationMs,event.provider,event.model,event.tokenUsage?.inputTokens,event.tokenUsage?.outputTokens,event.tokenUsage?.totalTokens,event.estimatedCost === null ? null : String(event.estimatedCost),event.errorCode,Number(event.actionRequested),Number(event.actionExecuted),event.approvalUserId,event.rejectionUserId,event.actionDecisionAt,event.targetRecordId,event.rollbackReferenceId,event.environment,JSON.stringify(event.metadata ?? {})]); } catch (cause) { throw safeDatabaseError(cause, 'AI_AUDIT_PERSISTENCE_FAILED'); } }, async list({ schoolId, limit = 50, eventTypes = [] } = {}) { if (!schoolId) fail('SCHOOL_SCOPE_REQUIRED', 'School scope is required.'); const bounded = Math.max(1, Math.min(Number(limit) || 50, 100)), allowedTypes = Array.isArray(eventTypes) ? eventTypes.slice(0, 20) : [], clauses = ['school_id = ?'], params = [schoolId]; if (allowedTypes.length) { clauses.push(`event_type IN (${allowedTypes.map(() => '?').join(',')})`); params.push(...allowedTypes); } params.push(bounded); try { const rows = await db.query(`SELECT * FROM ai_audit_logs WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`, params); return rows.map(auditFromRow); } catch (cause) { throw safeDatabaseError(cause, 'AI_AUDIT_READ_FAILED'); } } });
}
function auditFromRow(row) { return Object.freeze({ id: row.id, requestId: row.request_id, correlationId: row.correlation_id, timestamp: row.occurred_at, eventType: row.event_type, severity: row.severity, schoolId: row.school_id, userId: row.user_id, role: row.role_key, capabilityId: row.capability_id, toolName: row.tool_name, operationType: row.operation_type, authorizationResult: row.authorization_result, dataScope: parse(row.data_scope_json, {}), productionDataOnly: row.production_data_only === null ? null : Boolean(row.production_data_only), dataQualityStatus: row.data_quality_status, requestStatus: row.request_status, durationMs: row.duration_ms, provider: row.provider, model: row.model, tokenUsage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens, totalTokens: row.total_tokens }, estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost), errorCode: row.error_code, actionRequested: Boolean(row.action_requested), actionExecuted: Boolean(row.action_executed), approvalUserId: row.approval_user_id, rejectionUserId: row.rejection_user_id, actionDecisionAt: row.action_decision_at, targetRecordId: row.target_record_id, rollbackReferenceId: row.rollback_reference_id, environment: row.environment, metadata: parse(row.metadata_json, {}) }); }

const ACTION_FIELDS = ['id','school_id','creator_user_id','action_type','proposed_change','sanitized_payload','required_prepare_permission','required_approval_permission','status','submitted_at','decided_at','decided_by','executed_at','version','idempotency_key','integrity','failure_code','failure_reason','execution_result','created_at'];
function actionParams(action) { return [action.id,action.schoolId,action.creatorUserId,action.actionType,action.proposedChange,JSON.stringify(action.payload ?? {}),action.requiredPreparePermission,action.requiredApprovalPermission,action.status,action.submittedAt,action.decidedAt,action.decidedBy,action.executedAt,action.version,action.idempotencyKey,action.integrity,action.failureCode,action.failureReason,action.executionResult ? JSON.stringify(action.executionResult) : null,action.createdAt]; }
function actionFromRow(row) { return row ? { id: row.id, schoolId: row.school_id, creatorUserId: row.creator_user_id, actionType: row.action_type, proposedChange: row.proposed_change, payload: parse(row.sanitized_payload, {}), requiredPreparePermission: row.required_prepare_permission, requiredApprovalPermission: row.required_approval_permission, status: row.status, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decided_by, executedAt: row.executed_at, version: row.version, idempotencyKey: row.idempotency_key, integrity: row.integrity, failureCode: row.failure_code, failureReason: row.failure_reason, executionResult: parse(row.execution_result), createdAt: row.created_at } : null; }
export function createDatabaseAIActionStore({ adapter } = {}) {
  const db = database(adapter), columns = ACTION_FIELDS.join(','), placeholders = ACTION_FIELDS.map(() => '?').join(','), updates = ACTION_FIELDS.filter((field) => !['id','school_id'].includes(field)).map((field) => `${field}=?`).join(',');
  return Object.freeze({ durable: true, async healthCheck() { try { return await db.healthCheck(); } catch { return { healthy: false }; } }, async insert(action) { try { const existing = await db.query('SELECT id FROM ai_human_controlled_actions WHERE school_id = ? AND idempotency_key = ? LIMIT 1', [action.schoolId, action.idempotencyKey]); if (existing.length) throw Object.assign(new Error('An action already exists for this idempotency key.'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 }); await db.execute(`INSERT INTO ai_human_controlled_actions (${columns}) VALUES (${placeholders})`, actionParams(action)); return clone(action); } catch (cause) { throw safeDatabaseError(cause, cause?.code === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'ACTION_PERSISTENCE_FAILED'); } }, async get(id, schoolId) { if (!schoolId) fail('SCHOOL_SCOPE_REQUIRED', 'School scope is required.'); try { return actionFromRow((await db.query('SELECT * FROM ai_human_controlled_actions WHERE id = ? AND school_id = ? LIMIT 1', [id, schoolId]))[0]); } catch (cause) { throw safeDatabaseError(cause, 'ACTION_READ_FAILED'); } }, async list(schoolId) { if (!schoolId) fail('SCHOOL_SCOPE_REQUIRED', 'School scope is required.'); try { return (await db.query('SELECT * FROM ai_human_controlled_actions WHERE school_id = ? ORDER BY created_at DESC LIMIT ?', [schoolId, 100])).map(actionFromRow); } catch (cause) { throw safeDatabaseError(cause, 'ACTION_READ_FAILED'); } }, async findByIdempotencyKey(schoolId, key) { try { return actionFromRow((await db.query('SELECT * FROM ai_human_controlled_actions WHERE school_id = ? AND idempotency_key = ? LIMIT 1', [schoolId, key]))[0]); } catch (cause) { throw safeDatabaseError(cause, 'ACTION_READ_FAILED'); } }, async compareAndSwap(id, expectedVersion, next) { try { return await db.transaction(async (transaction) => { const tx = transaction ?? db, params = actionParams(next), mutable = params.filter((_, index) => ![0,1].includes(index)); const result = await tx.execute(`UPDATE ai_human_controlled_actions SET ${updates} WHERE id = ? AND school_id = ? AND version = ?`, [...mutable, id, next.schoolId, expectedVersion]); return Number(result?.affectedRows ?? result?.changes ?? result?.rowCount ?? 0) === 1 ? clone(next) : null; }); } catch (cause) { throw safeDatabaseError(cause, 'ACTION_PERSISTENCE_FAILED'); } } });
}

export function createDisabledAIPersistence() {
  const unavailable = () => fail('AI_DISABLED', 'AI capabilities are disabled.');
  const healthCheck = async () => ({ healthy: false, durable: false });
  return Object.freeze({
    durable: false,
    auditSink: Object.freeze({ durable: false, healthCheck, append: unavailable, async list() { return []; } }),
    actionStore: Object.freeze({ durable: false, healthCheck, insert: unavailable, get: unavailable, list: unavailable, compareAndSwap: unavailable })
  });
}

export function selectAIPersistence({ environment = process.env.NODE_ENV ?? 'development', databaseAdapter = null, allowMemory = false } = {}) {
  if (databaseAdapter) return Object.freeze({ durable: true, auditSink: createDatabaseAIAuditSink({ adapter: databaseAdapter }), actionStore: createDatabaseAIActionStore({ adapter: databaseAdapter }) });
  if (environment === 'production') fail('DURABLE_PERSISTENCE_REQUIRED', 'Production AI requires durable audit and action persistence.');
  if (!allowMemory) fail('MEMORY_PERSISTENCE_NOT_ALLOWED', 'Memory persistence must be explicitly enabled outside production.');
  return Object.freeze({ durable: false, auditSink: createInMemoryAIAuditSink(), actionStore: createAIActionStore() });
}

export async function loadConfiguredAIPersistence({ environment = process.env } = {}) {
  const runtime = environment.NODE_ENV ?? 'development', modulePath = configuredDatabaseAdapterModule(environment);
  if (!modulePath && runtime === 'production') fail('TIDB_DATABASE_URL_REQUIRED', 'Production requires TiDB configuration for durable persistence.');
  if (!modulePath) return selectAIPersistence({ environment: runtime, allowMemory: runtime !== 'production' });
  try {
    const loaded = await import(pathToFileURL(resolve(modulePath)));
    const adapter = await loaded.createDatabaseAdapter?.({ environment });
    const persistence = selectAIPersistence({ environment: runtime, databaseAdapter: adapter });
    return Object.freeze({ ...persistence, ...(adapter?.close ? { close: () => adapter.close() } : {}) });
  } catch (cause) {
    if (cause?.code === 'DATABASE_ADAPTER_REQUIRED') throw cause;
    fail('DURABLE_PERSISTENCE_UNAVAILABLE', 'Configured durable AI persistence is unavailable.');
  }
}

export async function loadConfiguredDatabaseAdapter({ environment = process.env, required = false } = {}) {
  const modulePath = configuredDatabaseAdapterModule(environment);
  if (!modulePath && required) fail('TIDB_DATABASE_URL_REQUIRED', 'Configure DATABASE_URL for the TiDB database osaahdaylightschool.');
  if (!modulePath) return null;
  const loaded = await import(pathToFileURL(resolve(modulePath)));
  return loaded.createDatabaseAdapter?.({ environment }) ?? null;
}
