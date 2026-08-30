import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionsMatchIssue,
  cycleStillMatchesRule,
  ruleMatchesIssue,
  selectRule,
  validateRule
} from '../src/rules.js';
import { buildTemplateContext, renderTemplate } from '../src/templates.js';

const baseIssue = (overrides = {}) => ({
  key: 'TEST-1',
  fields: {
    project: { key: 'TEST' },
    status: { name: 'Waiting for customer' },
    reporter: { displayName: 'Alex Customer' },
    summary: 'Customer follow-up test',
    customfield_client: { value: 'Client A' },
    customfield_type: [{ value: 'Hardware' }, { value: 'Priority' }],
    ...overrides
  }
});

const baseRule = (overrides = {}) => ({
  id: 'rule-1',
  name: 'Release readiness rule',
  enabled: true,
  projectKey: 'TEST',
  waitingStatusName: 'Waiting for customer',
  timingUnit: 'days',
  conditions: [{ fieldId: 'customfield_client', operator: 'equals', value: 'Client A' }],
  reminders: [
    { afterDays: 1, message: 'Reminder one' },
    { afterDays: 3, message: 'Reminder two', destinationStatusName: 'Pending customer' }
  ],
  finalAction: { afterDays: 5, destinationStatusName: 'Resolved' },
  ...overrides
});

test('disabled rules never match or continue an active cycle', () => {
  const disabled = baseRule({ enabled: false });
  assert.equal(ruleMatchesIssue(disabled, baseIssue()), false);
  assert.equal(cycleStillMatchesRule(disabled, baseIssue()), false);
});

test('notEquals conditions and multi-value Jira fields are handled case-insensitively', () => {
  const rule = baseRule({
    conditions: [
      { fieldId: 'customfield_client', operator: 'notEquals', value: 'Client B' },
      { fieldId: 'customfield_type', operator: 'equals', value: 'hardware' }
    ]
  });
  assert.equal(conditionsMatchIssue(rule, baseIssue()), true);
  assert.equal(
    conditionsMatchIssue(rule, baseIssue({ customfield_client: { value: 'CLIENT B' } })),
    false
  );
});

test('cycle continuation rejects project or condition drift', () => {
  assert.equal(cycleStillMatchesRule(baseRule(), baseIssue({ project: { key: 'OTHER' } })), false);
  assert.equal(
    cycleStillMatchesRule(baseRule(), baseIssue({ customfield_client: { value: 'Client B' } })),
    false
  );
});

test('selectRule returns null when no enabled rule matches', () => {
  const rules = [
    baseRule({ id: 'disabled', enabled: false }),
    baseRule({ id: 'wrong-project', projectKey: 'OTHER' })
  ];
  assert.equal(selectRule(rules, baseIssue()), null);
});

test('validation rejects incomplete conditions, unsupported operators and invalid timing units', () => {
  const errors = validateRule(baseRule({
    timingUnit: 'minutes',
    conditions: [{ fieldId: 'customfield_client', operator: 'contains', value: '' }]
  }));
  assert.ok(errors.includes('Time unit must be days or hours'));
  assert.ok(errors.includes('Each selected ticket field needs a value'));
  assert.ok(errors.includes('Unsupported field comparison'));
});

test('validation rejects missing reminders, messages and negative timings', () => {
  assert.ok(validateRule(baseRule({ reminders: [] })).includes('At least one reminder is required'));

  const errors = validateRule(baseRule({
    reminders: [
      { afterDays: -1, message: '' },
      { afterDays: 2, message: 'Second' }
    ],
    finalAction: { afterDays: 1, destinationStatusName: 'Resolved' }
  }));
  assert.ok(errors.includes('Reminder timing must be zero or greater'));
  assert.ok(errors.includes('Every reminder needs a customer message'));
  assert.ok(errors.includes('Final action must occur after the last reminder'));
});

test('template renderer safely blanks unknown variables and handles missing reporter', () => {
  const issue = baseIssue({ reporter: null, summary: null });
  const context = buildTemplateContext(issue, {}, {});
  assert.equal(context.customer.name, 'Customer');
  assert.equal(context.customer.firstName, 'Customer');
  assert.equal(context.issue.summary, '');
  assert.equal(renderTemplate('Hi {{customer.firstName}} {{missing.value}}', context), 'Hi Customer ');
});

test('template context defaults waiting values consistently', () => {
  const context = buildTemplateContext(baseIssue(), {}, { daysWaiting: 4 });
  assert.equal(context.daysWaiting, 4);
  assert.equal(context.waitingAmount, 4);
  assert.equal(context.waitingUnit, 'days');
});
