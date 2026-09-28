import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isProductionContext, resolverLicenseAllows, triggerLicenseAllows } from '../src/license.js';
import { retryDelayMs, withRateLimitRetry } from '../src/jira.js';
import { chunk, PRIVACY_REPORT_BATCH_SIZE } from '../src/privacy.js';

const prod = (license) => ({ environmentType: 'PRODUCTION', ...(license === undefined ? {} : { license }) });
const dev = (license) => ({ environmentType: 'DEVELOPMENT', ...(license === undefined ? {} : { license }) });

test('production resolvers fail closed when the licence is missing or inactive', () => {
  assert.equal(resolverLicenseAllows(prod(), {}), false);
  assert.equal(resolverLicenseAllows(prod(null), {}), false);
  assert.equal(resolverLicenseAllows(prod({ active: false }), {}), false);
  assert.equal(resolverLicenseAllows(prod({ active: true }), {}), true);
});

test('an unknown environment is treated as production', () => {
  assert.equal(isProductionContext({}), true);
  assert.equal(isProductionContext(null), true);
  assert.equal(resolverLicenseAllows({}, {}), false);
});

test('production ignores LICENSE_OVERRIDE', () => {
  assert.equal(resolverLicenseAllows(prod(), { LICENSE_OVERRIDE: 'active' }), false);
});

test('non-production resolvers allow a missing licence and honour simulated states', () => {
  assert.equal(resolverLicenseAllows(dev(), {}), true);
  assert.equal(resolverLicenseAllows({ environmentType: 'staging' }, {}), true);
  assert.equal(resolverLicenseAllows(dev({ active: false }), {}), false);
  assert.equal(resolverLicenseAllows(dev(), { LICENSE_OVERRIDE: 'inactive' }), false);
  assert.equal(resolverLicenseAllows(dev({ active: false }), { LICENSE_OVERRIDE: 'active' }), true);
});

test('triggers rely on the manifest filter and only reject an explicitly inactive licence', () => {
  assert.equal(triggerLicenseAllows({}, {}), true);
  assert.equal(triggerLicenseAllows({ license: { active: true } }, {}), true);
  assert.equal(triggerLicenseAllows({ license: { active: false } }, {}), false);
  assert.equal(triggerLicenseAllows({}, { LICENSE_OVERRIDE: 'inactive' }), false);
  assert.equal(triggerLicenseAllows({ license: { active: false } }, { LICENSE_OVERRIDE: 'active' }), false);
});

test('manifest licence-filters processing triggers but not the privacy trigger', () => {
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  for (const key of ['nuvriqo-issue-upd', 'nuvriqo-comment', 'nuvriqo-hourly']) {
    const block = manifest.split(`- key: ${key}\n`)[1].split('\n    - key:')[0].split('\n\n')[0];
    assert.match(block, /filter:\n\s+appIsLicensed: true/, `${key} must set filter.appIsLicensed`);
  }
  const privacyBlock = manifest.split('- key: nuvriqo-privacy\n')[1].split('\n\n')[0];
  assert.doesNotMatch(privacyBlock, /appIsLicensed/);
});

const response = (status, retryAfter) => ({
  status,
  headers: { get: (name) => (name === 'Retry-After' ? retryAfter ?? null : null) }
});

test('withRateLimitRetry retries 429 honouring Retry-After', async () => {
  const responses = [response(429, '2'), response(429, '0'), response(200)];
  const waits = [];
  const result = await withRateLimitRetry(async () => responses.shift(), { wait: async (ms) => waits.push(ms) });
  assert.equal(result.status, 200);
  assert.deepEqual(waits, [2000, 0]);
});

test('withRateLimitRetry gives up after the retry limit and does not retry other errors', async () => {
  let calls = 0;
  const limited = await withRateLimitRetry(async () => { calls += 1; return response(429, '1'); }, { wait: async () => {}, maxRetries: 2 });
  assert.equal(limited.status, 429);
  assert.equal(calls, 3);

  calls = 0;
  const failed = await withRateLimitRetry(async () => { calls += 1; return response(500); }, { wait: async () => {} });
  assert.equal(failed.status, 500);
  assert.equal(calls, 1);
});

test('retryDelayMs caps long Retry-After values and backs off without one', () => {
  assert.equal(retryDelayMs(response(429, '3600'), 0), 10000);
  const backoff = retryDelayMs(response(429), 1);
  assert.ok(backoff >= 2000 && backoff < 2250);
});

test('privacy reports are sent in batches of at most 90 accounts', () => {
  assert.equal(PRIVACY_REPORT_BATCH_SIZE, 90);
  const batches = chunk(Array.from({ length: 200 }, (_, index) => index));
  assert.deepEqual(batches.map((batch) => batch.length), [90, 90, 20]);
  assert.deepEqual(chunk([]), []);
});

test('privacy processing does not log account IDs', () => {
  const source = readFileSync(new URL('../src/privacy.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.\w+\([^)]*accountId/);
});
