import test from 'node:test';
import assert from 'node:assert/strict';
import { createArkeselGateway, createDurableSmsService, estimateSmsSegments } from '../src/durable-sms.js';

const allowed = (roleKey = 'HEADTEACHER') => ({ id: `staff-${roleKey.toLowerCase()}`, schoolId: 'school-osaah-daylight', roleKey, permissions: new Set(['messages.sms.send']) });
const previewSecret = 'test-only-preview-signing-secret-32-chars';
const productionEnvironment = { VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production', OSAAH_SMS_PREVIEW_SECRET: previewSecret };
const records = [
  { parentId: 'p1', parentName: 'parent.one', telephone: '024 123 4567', studentId: 's1', permanentStudentId: 'STU-1', className: 'Primary 1' },
  { parentId: 'p1', parentName: 'parent.one', telephone: '+233241234567', studentId: 's2', permanentStudentId: 'STU-2', className: 'Primary 2' },
  { parentId: 'p2', parentName: 'parent.two', telephone: '0551234567', studentId: 's3', permanentStudentId: 'STU-3', className: 'JHS 1' },
  { parentId: 'user-test-parent-sample', parentName: 'test', telephone: '+233247293733', studentId: 'test-student', permanentStudentId: 'OSAAH/DEMO/001', className: 'Primary 1' }
];
function mockDb() {
  const executed = [];
  const recipientRows = [...records];
  let recipientStatus = 'SUBMITTED';
  const db = {
    executed,
    recipientRows,
    async query(sql, params = []) {
      if (sql.includes('academic_years ay JOIN terms')) return [{ academicYearId: 'year-1', termId: 'term-1' }];
      if (sql.includes('FROM parent_student_links psl')) return recipientRows.filter((row) => !sql.includes('psl.parent_user_id IN (') || params.slice(3).includes(row.parentId));
      if (sql.includes('AND idempotency_key=?')) return [];
      if (sql.includes('SELECT id,campaign_id,status FROM sms_campaign_recipients')) return [{ id: 'recipient-row', campaign_id: 'campaign-1', status: recipientStatus }];
      if (sql.includes('SELECT COUNT(*) AS total')) return [{ total: 1, delivered: 1, failed: 0, pending: 0 }];
      if (sql.includes('SELECT id,created_by,status FROM sms_campaigns')) return [];
      return [];
    },
    async execute(sql, params = []) { executed.push({ sql, params }); if (sql.includes('SET status=?,last_error=?,delivered_at=?,updated_at=?')) recipientStatus = params[0]; return { affectedRows: 1 }; },
    async transaction(callback) { return callback({ execute: this.execute.bind(this) }); }
  };
  return db;
}
const actorFor = (roleKey, permission = true) => ({ ...allowed(roleKey), permissions: new Set(permission ? ['messages.sms.send'] : []) });
const allParents = { message: 'Hello parents', recipientMode: 'ALL_PARENTS' };

 test('Ghana SMS estimates use GSM-7 and UCS-2 segment sizes', () => {
  assert.deepEqual(estimateSmsSegments('Hello'), { characters: 5, encoding: 'GSM-7', segments: 1, perSegment: 160 });
  assert.equal(estimateSmsSegments('a'.repeat(161)).segments, 2);
  assert.equal(estimateSmsSegments('🙂').encoding, 'UCS-2');
  assert.equal(estimateSmsSegments('🙂'.repeat(71)).segments, 2);
});

test('Arkesel adapter follows the documented request contract and uses Ghana international format without plus signs', async () => {
  let request;
  const gateway = createArkeselGateway({ environment: { ...productionEnvironment, ARKESEL_API_KEY: 'test-private-key', ARKESEL_SENDER_ID: 'OSAAH', ARKESEL_CALLBACK_TOKEN: 'test-callback-token', PUBLIC_BASE_URL: 'https://school.example' }, fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, async json() { return { status: 'success', data: [{ recipient: '233241234567', id: 'provider-id' }] }; } }; } });
  assert.equal(gateway.configured, true);
  assert.equal(JSON.stringify(gateway).includes('test-private-key'), false);
  assert.equal(gateway.validateCallbackToken('test-callback-token'), true);
  const result = await gateway.send({ message: 'Hello', recipients: ['+233241234567'] });
  assert.equal(request.url, 'https://sms.arkesel.com/api/v2/sms/send');
  assert.equal(request.options.headers['api-key'], 'test-private-key');
  assert.deepEqual(JSON.parse(request.options.body).recipients, ['233241234567']);
  assert.ok(request.options.signal);
  assert.match(JSON.parse(request.options.body).callback_url, /token=test-callback-token/);
  assert.equal(result[0].id, 'provider-id');
});

test('provider credentials alone, a Preview runtime, or a spoofed VERCEL_ENV cannot enable live delivery', () => {
  const credentials = { ARKESEL_API_KEY: 'private', ARKESEL_SENDER_ID: 'OSAAH', ARKESEL_CALLBACK_TOKEN: 'callback', OSAAH_SMS_PREVIEW_SECRET: previewSecret };
  for (const environment of [
    { ...credentials },
    { ...credentials, VERCEL_ENV: 'preview', NODE_ENV: 'production', VERCEL: '1' },
    { ...credentials, VERCEL_ENV: 'production', NODE_ENV: 'production' }
  ]) assert.equal(createArkeselGateway({ environment }).configured, false);
});

test('Arkesel rejection, server errors, and timeouts are distinguished without real network requests', async () => {
  const environment = { ...productionEnvironment, ARKESEL_API_KEY: 'test-private-key', ARKESEL_SENDER_ID: 'OSAAH', ARKESEL_CALLBACK_TOKEN: 'test-callback-token' };
  const gatewayWith = (fetchImpl) => createArkeselGateway({ environment, fetchImpl });
  await assert.rejects(() => gatewayWith(async () => ({ ok: false, status: 402, async json() { return { status: 'error' }; } })).send({ message: 'x', recipients: ['+233241234567'] }), { code: 'SMS_PROVIDER_REJECTED' });
  await assert.rejects(() => gatewayWith(async () => ({ ok: false, status: 500, async json() { return { status: 'error' }; } })).send({ message: 'x', recipients: ['+233241234567'] }), { code: 'SMS_PROVIDER_OUTCOME_UNKNOWN' });
  await assert.rejects(() => gatewayWith(async () => { throw new Error('mock timeout'); }).send({ message: 'x', recipients: ['+233241234567'] }), { code: 'SMS_PROVIDER_OUTCOME_UNKNOWN' });
});

test('only Proprietor, School Admin and Headteacher with the dedicated permission may preview', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  for (const role of ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']) await assert.doesNotReject(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor(role)));
  for (const role of ['ASSISTANT_HEADTEACHER', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'ADMIN']) await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor(role)), { status: 403 });
  await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor('HEADTEACHER', false)), { status: 403 });
});

test('recipient preview excludes the controlled test parent and demo students and deduplicates normalized Ghana numbers', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  const result = await service.preview({ message: 'School opens tomorrow', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.recipientCount, 2);
  assert.deepEqual(result.recipients.map((item) => item.parentId), ['p1', 'p2']);
  assert.ok(!JSON.stringify(result).includes('024 123 4567'));
  assert.ok(!JSON.stringify(result).includes('+233247293733'));
  assert.equal(result.costCurrency, null);
});

test('cost is estimated only from an explicitly configured segment price', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false, costPerSegmentGhs: 0.25 } });
  const result = await service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.totalEstimatedSegments, 2);
  assert.equal(result.estimatedCost, 0.5);
  assert.equal(result.costCurrency, 'GHS');
});

test('selected class audiences require a real school academic context', async () => {
  const db = mockDb(); db.recipientRows.push({ parentId: 'p4', parentName: 'parent.four', telephone: '0261234567', studentId: 's4', permanentStudentId: 'STU-4', className: 'Basic 1' }); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  const result = await service.preview({ message: 'Hello', recipientMode: 'PARENTS_BY_CLASS', className: 'Primary 1', academicYearId: 'year-1', termId: 'term-1' }, allowed());
  assert.equal(result.context.className, 'Primary 1');
  assert.deepEqual(result.recipients.map((item) => item.parentId), ['p1', 'p4']);
  await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'PARENTS_BY_CLASS', className: 'Fake', academicYearId: 'year-1', termId: 'term-1' }, allowed()), /Choose a class/);
});

test('drafts persist without provider credentials and do not send', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false }, previewSecret });
  const result = await service.saveDraft({ message: 'Remember the PTA meeting', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.status, 'DRAFT');
  assert.ok(db.executed.some((item) => item.sql.includes('INSERT INTO sms_campaigns')));
  const preview = await service.preview(allParents, allowed());
  await assert.rejects(() => service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed()), { status: 503, code: 'SMS_PROVIDER_NOT_CONFIGURED' });
  await assert.rejects(() => service.send({ ...allParents, confirm: false, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed()), { code: 'SMS_CONFIRMATION_REQUIRED' });
});

test('server-issued preview is bound to exact audience and message and re-resolves fresh recipients before send', async () => {
  const db = mockDb(); let providerCalls = 0;
  const gateway = { provider: 'MOCK', configured: true, async send({ recipients }) { providerCalls += 1; return recipients.map((recipient, index) => ({ recipient: recipient.slice(1), id: `provider-${index}` })); }, validateCallbackToken: (value) => value === 'callback-secret' };
  const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway, previewSecret });
  const preview = await service.preview(allParents, allowed());
  assert.ok(preview.previewToken);
  assert.ok(preview.idempotencyKey);
  const sent = await service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed());
  assert.equal(sent.status, 'SUBMITTED');
  assert.equal(sent.submitted, 2);
  assert.equal(providerCalls, 1);
  assert.ok(db.executed.some((item) => item.sql.includes("SET status='SUBMITTED'")));
  await assert.rejects(() => service.send({ ...allParents, message: 'Changed after preview', confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed()), { status: 409, code: 'SMS_PREVIEW_MISMATCH' });
  assert.equal(providerCalls, 1);
  const secondPreview = await service.preview(allParents, allowed());
  db.recipientRows.push({ parentId: 'p3', parentName: 'new parent', telephone: '0261234567', studentId: 's5', permanentStudentId: 'STU-5', className: 'Primary 1' });
  await assert.rejects(() => service.send({ ...allParents, confirm: true, idempotencyKey: secondPreview.idempotencyKey, previewToken: secondPreview.previewToken }, allowed()), { status: 409, code: 'SMS_PREVIEW_STALE' });
  assert.equal(providerCalls, 1);
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params = []) => sql.includes('AND idempotency_key=?') && params[1] === preview.idempotencyKey
    ? [{ id: sent.id, status: sent.status, message_body: allParents.message, recipient_mode: 'ALL_PARENTS', recipient_count: 2, created_at: 'now', updated_at: 'now', sent_at: 'now', provider_key: 'MOCK' }]
    : originalQuery(sql, params);
  const replay = await service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed());
  assert.equal(replay.duplicate, true);
  assert.equal(providerCalls, 1);
});

test('partial Arkesel responses mark only referenced recipients submitted and never imply full success', async () => {
  const db = mockDb(); let providerCalls = 0;
  const gateway = { provider: 'MOCK', configured: true, async send({ recipients }) { providerCalls += 1; return [{ recipient: recipients[0].slice(1), id: 'provider-only-one' }, { 'invalid numbers': [recipients[1]] }]; } };
  const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway, previewSecret });
  const preview = await service.preview(allParents, allowed());
  const result = await service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed());
  assert.equal(result.status, 'PARTIALLY_SUBMITTED');
  assert.equal(result.submitted, 1);
  assert.equal(result.rejected, 1);
  assert.equal(providerCalls, 1);
  assert.ok(db.executed.some((item) => item.sql.includes("SET status='REJECTED'")));
});

test('ambiguous provider outcome is recorded and not retried automatically', async () => {
  const db = mockDb(); let providerCalls = 0;
  const gateway = { provider: 'MOCK', configured: true, async send() { providerCalls += 1; throw Object.assign(new Error('timeout'), { code: 'SMS_PROVIDER_OUTCOME_UNKNOWN' }); } };
  const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway, previewSecret });
  const preview = await service.preview(allParents, allowed());
  const result = await service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed());
  assert.equal(result.status, 'SUBMISSION_UNKNOWN');
  assert.equal(providerCalls, 1);
  assert.ok(db.executed.some((item) => item.sql.includes("SET status=?") && item.params.includes('SUBMISSION_UNKNOWN')));
});

test('preview tokens expire and cannot be forged or reused by a different actor', async () => {
  let currentTime = '2026-10-08T20:00:00.000Z';
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false }, previewSecret, clock: () => currentTime });
  const preview = await service.preview(allParents, allowed());
  await assert.rejects(() => service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: `${preview.previewToken}x` }, allowed()), { code: 'SMS_PREVIEW_REQUIRED' });
  await assert.rejects(() => service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed('PROPRIETOR')), { code: 'SMS_PREVIEW_REQUIRED' });
  currentTime = '2026-10-08T20:11:00.000Z';
  await assert.rejects(() => service.send({ ...allParents, confirm: true, idempotencyKey: preview.idempotencyKey, previewToken: preview.previewToken }, allowed()), { status: 409, code: 'SMS_PREVIEW_EXPIRED' });
});

test('provider callbacks distinguish delivered, failed, rejected, and prevent status regression', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false, validateCallbackToken: (value) => value === 'callback-secret' }, previewSecret });
  await assert.rejects(() => service.deliveryCallback({ token: 'wrong', smsId: 'provider-0', status: 'DELIVERED' }), { status: 401 });
  assert.deepEqual(await service.deliveryCallback({ token: 'callback-secret', smsId: 'provider-0', status: 'DELIVERED' }), { accepted: true, status: 'DELIVERED' });
  assert.ok(db.executed.some((item) => item.sql.includes('SET status=?,last_error=?,delivered_at=?,updated_at=?')));
  const downgraded = await service.deliveryCallback({ token: 'callback-secret', smsId: 'provider-0', status: 'QUEUED' });
  assert.deepEqual(downgraded, { accepted: true, status: 'DELIVERED' });
  assert.equal(db.executed.filter((item) => item.sql.includes('SET status=?,last_error=?,delivered_at=?,updated_at=?')).length, 1);
});
