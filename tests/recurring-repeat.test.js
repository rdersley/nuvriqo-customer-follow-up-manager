import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
mock.module('@forge/kvs', {
  namedExports: {
    WhereConditions: { beginsWith: (prefix) => prefix },
    kvs: {
      async get(key) { return store.has(key) ? structuredClone(store.get(key)) : undefined; },
      async set(key, value) { store.set(key, structuredClone(value)); },
      async delete(key) { store.delete(key); }
    }
  }
});

const calls = { comments: 0, participants: 0, transitions: 0 };
let issue;
let failParticipants = false;
mock.module('../src/jira.js', {
  namedExports: {
    async getIssue() { return issue; },
    async addPublicCustomerComment() { calls.comments += 1; return {}; },
    async addRequestParticipants() {
      calls.participants += 1;
      if (failParticipants) throw new Error('participants failed');
      return {};
    },
    async transitionToStatus() {
      calls.transitions += 1;
      throw new Error('No available transition to "Awaiting Customer Feedback"');
    }
  }
});

const { processCycle } = await import('../src/followups.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const startedAt = new Date('2026-10-01T00:00:00Z');
const rule = {
  id: 'r1',
  name: 'Missing Device ID',
  enabled: true,
  projectKey: 'SD',
  waitingStatusName: '',
  timingUnit: 'days',
  conditions: [],
  reminders: [{ afterDays: 0, message: 'We still require your Device ID', destinationStatusName: 'Awaiting Customer Feedback', participantAccountIds: ['lee'] }],
  repeatEvery: 2,
  finalAction: { enabled: false }
};

function freshCycle() {
  return { issueId: '1', issueKey: 'SD-1', ruleId: 'r1', active: true, startedAt: startedAt.toISOString(), completedReminderIndexes: [0], reminderProgress: {} };
}

test('recurring repeat skips a transition to the status the issue is already in and waits the full interval', async () => {
  issue = { id: '1', key: 'SD-1', fields: { project: { key: 'SD' }, status: { name: 'Awaiting Customer Feedback' } } };
  failParticipants = false;
  Object.assign(calls, { comments: 0, participants: 0, transitions: 0 });
  const cycle = freshCycle();

  const firstRun = new Date(startedAt.getTime() + 2 * DAY);
  assert.equal((await processCycle(cycle, rule, firstRun)).action, 'reminder-repeated');
  assert.equal(calls.comments, 1);
  assert.equal(calls.transitions, 0);
  assert.equal(cycle.nextRepeatAt, new Date(firstRun.getTime() + 2 * DAY).toISOString());

  for (let hour = 1; hour < 48; hour += 1) {
    await processCycle(cycle, rule, new Date(firstRun.getTime() + hour * HOUR));
  }
  assert.equal(calls.comments, 1, 'no extra comments inside the 2 day interval');
});

test('a failed step after the comment is retried without re-sending the comment', async () => {
  issue = { id: '1', key: 'SD-1', fields: { project: { key: 'SD' }, status: { name: 'Waiting for support' } } };
  failParticipants = false;
  Object.assign(calls, { comments: 0, participants: 0, transitions: 0 });
  const cycle = freshCycle();
  const due = new Date(startedAt.getTime() + 2 * DAY);

  for (let hour = 0; hour < 3; hour += 1) {
    await assert.rejects(processCycle(cycle, rule, new Date(due.getTime() + hour * HOUR)));
  }
  assert.equal(calls.comments, 1, 'comment sent once despite repeated transition failures');
  assert.equal(calls.participants, 1);
  assert.equal(calls.transitions, 3);
});
