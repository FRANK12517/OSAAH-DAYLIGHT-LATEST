import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationCli = resolve(repositoryRoot, 'scripts/migrate.mjs');
const adapterFactoryUrl = pathToFileURL(resolve(repositoryRoot, 'src/platform/migration-runner.js')).href;
const protectedWorkflow = resolve(repositoryRoot, '.github/workflows/production-terms-uniqueness-migration.yml');

async function withLifecycleFixture(run) {
  const directory = await mkdtemp(resolve(tmpdir(), 'osaah-migrate-cli-lifecycle-'));
  try {
    const adapterPath = resolve(directory, 'fixture-adapter.mjs');
    const successMarker = resolve(directory, 'success-close-marker');
    const failureMarker = resolve(directory, 'failure-close-marker');
    await writeFile(adapterPath, `import { createInMemoryMigrationAdapter } from ${JSON.stringify(adapterFactoryUrl)};
import { appendFile, writeFile } from 'node:fs/promises';
const base = createInMemoryMigrationAdapter();
const keepAlive = setInterval(() => {}, 60000);
export async function createDatabaseAdapter() {
  return {
    ...base,
    async listApplied() {
      if (process.env.MIGRATION_CLI_FIXTURE_FAIL === '1') throw new Error('synthetic validation failure');
      if (process.env.MIGRATION_CLI_ORDER_MARKER) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        await appendFile(process.env.MIGRATION_CLI_ORDER_MARKER, 'validation-finished\\n', 'utf8');
      }
      return base.listApplied();
    },
    async close() {
      clearInterval(keepAlive);
      if (process.env.MIGRATION_CLI_ORDER_MARKER) await appendFile(process.env.MIGRATION_CLI_ORDER_MARKER, 'adapter-closed\\n', 'utf8');
      await writeFile(process.env.MIGRATION_CLI_CLOSE_MARKER, 'adapter closed', 'utf8');
    }
  };
}
`, 'utf8');
    const runCli = (marker, shouldFail, extraEnvironment = {}) => {
      const environment = { ...process.env };
      for (const key of Object.keys(environment)) {
        if (key === 'DATABASE_URL' || key === 'OSAAH_DATABASE_ADAPTER_MODULE' || key.startsWith('DB_') || key.startsWith('TIDB_') || key.startsWith('MYSQL_') || key.includes('DATABASE')) delete environment[key];
      }
      environment.DATABASE_URL = '';
      environment.OSAAH_DATABASE_ADAPTER_MODULE = adapterPath;
      environment.MIGRATION_CLI_CLOSE_MARKER = marker;
      if (shouldFail) environment.MIGRATION_CLI_FIXTURE_FAIL = '1';
      Object.assign(environment, extraEnvironment);
      return spawnSync(process.execPath, [migrationCli, 'validate'], {
        cwd: repositoryRoot,
        env: environment,
        encoding: 'utf8',
        timeout: 30000,
        killSignal: 'SIGKILL'
      });
    };
    await run({ directory, successMarker, failureMarker, runCli });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('migration CLI exits after successful validation and closes its adapter', async () => {
  await withLifecycleFixture(async ({ successMarker, runCli }) => {
    const result = runCli(successMarker, false);
    assert.equal(result.error, undefined, `migration validate did not exit: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).valid, true);
    assert.equal(await readFile(successMarker, 'utf8'), 'adapter closed');
  });
});

test('migration CLI closes its adapter and returns non-zero when validation fails', async () => {
  await withLifecycleFixture(async ({ failureMarker, runCli }) => {
    const result = runCli(failureMarker, true);
    assert.equal(result.error, undefined, `failed migration validate did not exit: ${result.error?.message}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MIGRATION_COMMAND_FAILED/);
    assert.equal(await readFile(failureMarker, 'utf8'), 'adapter closed');
  });
});

test('migration CLI does not close the adapter before async validation completes', async () => {
  await withLifecycleFixture(async ({ successMarker, runCli, directory }) => {
    const orderMarker = resolve(directory, 'validation-order');
    const result = runCli(successMarker, false, { MIGRATION_CLI_ORDER_MARKER: orderMarker });
    assert.equal(result.error, undefined, `ordered migration validate did not exit: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readFile(orderMarker, 'utf8')).trim().split('\n'), ['validation-finished', 'adapter-closed']);
  });
});

test('invalid migration CLI commands fail non-zero instead of being swallowed', () => {
  const environment = { ...process.env, DATABASE_URL: '', OSAAH_DATABASE_ADAPTER_MODULE: '' };
  const result = spawnSync(process.execPath, [migrationCli, 'invalid'], { cwd: repositoryRoot, env: environment, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_MIGRATION_COMMAND/);
});

test('protected workflow runs bounded validation and focused regressions before read-only preflight', async () => {
  const workflow = await readFile(protectedWorkflow, 'utf8');
  const migrationValidation = workflow.indexOf('name: Validate migration inventory and production ledger (read-only)');
  const regressions = workflow.indexOf('name: Validate migration and focused regressions');
  const preflight = workflow.indexOf('Run read-only duplicate and column preflight');
  assert.ok(migrationValidation >= 0 && migrationValidation < regressions && regressions < preflight);
  const validationBlock = workflow.slice(migrationValidation, regressions);
  const regressionBlock = workflow.slice(regressions, preflight);
  assert.match(validationBlock, /timeout-minutes:\s*5[\s\S]*?run:\s*npm run migration:validate/);
  assert.match(regressionBlock, /timeout-minutes:\s*10[\s\S]*?node --test test\/migrate-cli-lifecycle\.test\.js/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true/);
  assert.doesNotMatch(regressionBlock, /--watch/);
});
