import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionsMatchIssue,
  cycleStillMatchesRule,
  normaliseFieldValue,
  ruleMatchesIssue,
  selectRule,
  validateRule
} from '../src/rules.js';
import { buildTemplateContext, renderTemplate } from '../src/templates.js';

function issue(overrides = {}) {
  return {
    key: 'DEMO-1',
    fields: {
      project: { key: 'DEMO' },
      status: { name: 'Waiting for customer' },
      reporter: { displayName: 'Jane Customer' },
      summary: 'Replacement device',
      customfield_10001: { value: 'RYR - Ryanair' },
      customfield_10002: { value: 'Hardware' },
      ...overrides
    }
  };
}

function rule(overrides = {}) {
  return {
    id: 'rule-1',
    name: 'Ryanair hardware',
    enabled: true,
    priority: 10,
    projectKey: 'DEMO',
    waitingStatusName: 'Waiting for customer',
    timingUnit: 'days',
    conditions: [
      { fieldId: 'customfield_10001', operator: 'equals', value: 'RYR - Ryanair' },
      { fieldId: 'customfield_10002', operator: 'equals', value: 'Hardware' }
    ],
    reminders: [
      { afterDays: 2, message: 'First reminder' },
      { afterDays: 4, message: 'Second reminder', destinationStatusName: 'Pending customer' }
    ],
    finalAction: { afterDays: 7, destinationStatusName: 'Resolved' },
    ...overrides
  };
}

test('normaliseFieldValue handles Jira option objects and arrays', () => {
  assert.equal(normaliseFieldValue({ value: 'Hardware' }), 'Hardware');
  assert.equal(normaliseFieldValue({ name: 'Hardware' }), 'Hardware');
  assert.deepEqual(normaliseFieldValue([{ value: 'A' }, { value: 'B' }]), ['A', 'B']);
});

test('all configured conditions must match', () => {
  assert.equal(conditionsMatchIssue(rule(), issue()), true);
  assert.equal(conditionsMatchIssue(rule(), issue({ customfield_10002: { value: 'Software' } })), false);
});

test('rule matching respects project and waiting status', () => {
  assert.equal(ruleMatchesIssue(rule(), issue()), true);
  assert.equal(ruleMatchesIssue(rule(), issue({ status: { name: 'In Progress' } })), false);
  assert.equal(ruleMatchesIssue(rule({ projectKey: 'OTHER' }), issue()), false);
});

test('active cycle can remain valid in a reminder destination status', () => {
  assert.equal(
    cycleStillMatchesRule(rule(), issue({ status: { name: 'Pending customer' } })),
    true
  );
  assert.equal(
    cycleStillMatchesRule(rule(), issue({ status: { name: 'Resolved' } })),
    false
  );
});

test('selectRule uses priority-sorted rule input', () => {
  const general = rule({ id: 'general', name: 'General', priority: 100, conditions: [] });
  const hardware = rule({ id: 'hardware', priority: 10 });
  assert.equal(selectRule([hardware, general], issue()).id, 'hardware');
});

test('rule validation catches invalid reminder ordering and final timing', () => {
  const errors = validateRule(rule({
    reminders: [
      { afterDays: 4, message: 'One' },
      { afterDays: 2, message: 'Two' }
    ],
    finalAction: { afterDays: 2, destinationStatusName: '' }
  }));
  assert.ok(errors.some((value) => value.includes('increase')));
  assert.ok(errors.some((value) => value.includes('after the last reminder')));
  assert.ok(errors.some((value) => value.includes('Destination status')));
});

test('template rendering supplies customer and issue variables', () => {
  const context = buildTemplateContext(issue(), {}, {
    daysWaiting: 3,
    waitingAmount: 72,
    waitingUnit: 'hours'
  });
  const result = renderTemplate(
    'Hi {{customer.firstName}}, {{issue.key}} has waited {{waitingAmount}} {{waitingUnit}}.',
    context
  );
  assert.equal(result, 'Hi Jane, DEMO-1 has waited 72 hours.');
});
