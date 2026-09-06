import test from 'node:test';
import assert from 'node:assert/strict';
import { latestStatusEnteredAt } from '../src/jira.js';
import { cycleStartForDiscovery } from '../src/followups.js';

test('latestStatusEnteredAt returns the most recent transition into the waiting status', () => {
  const histories = [
    {
      created: '2026-08-01T09:00:00.000+0000',
      items: [{ field: 'status', fromString: 'Open', toString: 'Awaiting Customer Feedback' }]
    },
    {
      created: '2026-08-03T10:00:00.000+0000',
      items: [{ field: 'status', fromString: 'Awaiting Customer Feedback', toString: 'In Progress' }]
    },
    {
      created: '2026-08-10T11:30:00.000+0000',
      items: [{ field: 'status', fromString: 'In Progress', toString: 'Awaiting Customer Feedback' }]
    }
  ];

  assert.equal(latestStatusEnteredAt(histories, 'Awaiting Customer Feedback'), '2026-08-10T11:30:00.000+0000');
});

test('latestStatusEnteredAt is case insensitive and ignores unrelated field changes', () => {
  const histories = [
    {
      created: '2026-08-02T08:00:00.000+0000',
      items: [{ field: 'priority', fromString: 'P4', toString: 'P3' }]
    },
    {
      created: '2026-08-04T08:00:00.000+0000',
      items: [{ field: 'status', fromString: 'Open', toString: 'awaiting customer feedback' }]
    }
  ];

  assert.equal(latestStatusEnteredAt(histories, 'Awaiting Customer Feedback'), '2026-08-04T08:00:00.000+0000');
});

test('cycleStartForDiscovery uses Jira status-entry time when available', () => {
  const issue = { fields: { created: '2026-07-01T00:00:00.000Z' } };
  assert.equal(cycleStartForDiscovery(issue, '2026-08-10T11:30:00.000+0000', new Date('2026-09-01T00:00:00.000Z')), '2026-08-10T11:30:00.000+0000');
});

test('cycleStartForDiscovery falls back safely to discovery time when status-entry time is unavailable', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(cycleStartForDiscovery({}, null, now), now.toISOString());
});
