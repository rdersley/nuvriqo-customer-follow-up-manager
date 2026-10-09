import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
mock.module('@forge/kvs', {
  namedExports: {
    WhereConditions: { beginsWith: (prefix) => prefix },
    kvs: {
      async get(key) { return store.has(key) ? structuredClone(store.get(key)) : undefined; },
      async set(key, value) { store.set(key, structuredClone(value)); },
      async delete(key) { store.delete(key); },
      query() {
        let prefix = '';
        const query = {
          where(_field, value) { prefix = value; return query; },
          limit() { return query; },
          cursor() { return query; },
          async getMany() {
            return { results: [...store].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) };
          }
        };
        return query;
      }
    }
  }
});

mock.module('../src/license.js', { namedExports: { triggerLicenseAllows: () => true } });

const calls = { getIssue: 0, changelog: 0, comment: 0, participants: 0, searches: [] };
let searchResults = [];
mock.module('../src/jira.js', {
  namedExports: {
    async getIssue(key) {
      calls.getIssue += 1;
      return { id: key.split('-')[1], key, fields: { project: { key: 'SD' }, status: { name: 'Waiting' }, priority: { name: 'High' } } };
    },
    async getRequestComment() { calls.comment += 1; return {}; },
    async getRequestParticipants() { calls.participants += 1; return []; },
    async getStatusEnteredAt() { calls.changelog += 1; return null; },
    async searchIssues(jql) { calls.searches.push(jql); return searchResults; },
    async addPublicCustomerComment() { return {}; },
    async addRequestParticipants() { return {}; },
    async transitionToStatus() { return {}; }
  }
});

const {
  buildDiscoveryJql,
  discoveryFingerprint,
  onCommentCreated,
  onIssueUpdated,
  planDiscovery,
  processDueFollowUps,
  rulesMayApplyToProject
} = await import('../src/index.js');

const rule = {
  id: 'r1',
  name: 'Chase',
  enabled: true,
  projectKey: 'SD',
  waitingStatusName: 'Waiting',
  conditions: [{ fieldId: 'priority', operator: 'equals', value: 'High' }],
  reminders: [{ afterDays: 2, commentTemplate: 'Hi' }],
  finalAction: { enabled: false }
};

function reset() {
  store.clear();
  store.set('rule:r1', rule);
  store.set('system:due-cycle-index', { refs: {}, migrated: true });
  store.set('system:failed-retry-recovery-v1', { completedAt: 'x' });
  Object.assign(calls, { getIssue: 0, changelog: 0, comment: 0, participants: 0, searches: [] });
  searchResults = [];
}

test('buildDiscoveryJql adds an updated window only for recent scans', () => {
  assert.equal(buildDiscoveryJql('SD', 'Waiting'), 'project = "SD" AND status = "Waiting"');
  assert.equal(buildDiscoveryJql('SD', '', 75), 'project = "SD" AND updated >= -75m');
});

test('planDiscovery runs a full scan on rule change, first run, gaps and daily', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const fp = discoveryFingerprint([rule]);
  const recent = { fingerprint: fp, lastRunAt: '2026-10-09T11:00:00Z', lastFullScanAt: '2026-10-09T01:00:00Z' };
  assert.deepEqual(planDiscovery(recent, fp, now), { full: false, updatedWithinMinutes: 75 });
  assert.equal(planDiscovery(null, fp, now).full, true);
  assert.equal(planDiscovery({ ...recent, fingerprint: 'old' }, fp, now).full, true);
  assert.equal(planDiscovery({ ...recent, lastFullScanAt: '2026-10-08T11:00:00Z' }, fp, now).full, true);
  assert.equal(planDiscovery({ ...recent, lastRunAt: '2026-10-08T11:00:00Z' }, fp, now).full, true);
});

test('discoveryFingerprint ignores reminder wording but tracks matching fields', () => {
  const base = discoveryFingerprint([rule]);
  assert.equal(discoveryFingerprint([{ ...rule, reminders: [{ afterDays: 5, commentTemplate: 'Changed' }] }]), base);
  assert.notEqual(discoveryFingerprint([{ ...rule, waitingStatusName: 'Pending' }]), base);
  assert.notEqual(discoveryFingerprint([{ ...rule, enabled: false }]), base);
});

test('rulesMayApplyToProject', () => {
  assert.equal(rulesMayApplyToProject([rule], 'SD'), true);
  assert.equal(rulesMayApplyToProject([rule], 'HR'), false);
  assert.equal(rulesMayApplyToProject([rule], undefined), true);
  assert.equal(rulesMayApplyToProject([{ ...rule, enabled: false }], 'SD'), false);
});

test('issue updates in projects without rules make no Jira calls', async () => {
  reset();
  await onIssueUpdated({ issue: { key: 'HR-1', fields: { project: { key: 'HR' } } } });
  assert.equal(calls.getIssue, 0);
  await onIssueUpdated({ issue: { key: 'SD-1', fields: { project: { key: 'SD' } } } });
  assert.equal(calls.getIssue, 1);
});

test('comments on tickets without an active cycle make no Jira calls', async () => {
  reset();
  await onCommentCreated({ issue: { key: 'SD-1', id: '1' }, comment: { id: '9' } });
  assert.deepEqual([calls.getIssue, calls.comment, calls.participants], [0, 0, 0]);
});

test('discovery skips changelog for non-matching tickets and narrows later runs', async () => {
  reset();
  searchResults = [
    { id: '1', key: 'SD-1', fields: { project: { key: 'SD' }, status: { name: 'Waiting' }, priority: { name: 'Low' } } }
  ];
  await processDueFollowUps({});
  assert.equal(calls.changelog, 0);
  assert.equal(calls.searches.at(-1), 'project = "SD" AND status = "Waiting"');
  assert.equal(store.get('system:scheduler-status').discoveryMode, 'full');

  await processDueFollowUps({});
  assert.match(calls.searches.at(-1), /AND updated >= -\d+m$/);
  assert.equal(store.get('system:scheduler-status').discoveryMode, 'recent');

  searchResults = [
    { id: '2', key: 'SD-2', fields: { project: { key: 'SD' }, status: { name: 'Waiting' }, priority: { name: 'High' } } }
  ];
  await processDueFollowUps({});
  assert.equal(calls.changelog, 1);
  assert.equal(store.get('cycle:2')?.active, true);
});
