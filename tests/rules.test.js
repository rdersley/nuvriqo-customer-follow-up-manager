import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionFieldsForIssue, isEmptyJiraFieldValue } from '../src/followups.js';
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
      customfield_10001: { value: 'Example Customer' },
      customfield_10002: { value: 'Hardware' },
      ...overrides
    }
  };
}

function rule(overrides = {}) {
  return {
    id: 'rule-1',
    name: 'Hardware follow-up',
    enabled: true,
    priority: 10,
    projectKey: 'DEMO',
    waitingStatusName: 'Waiting for customer',
    timingUnit: 'days',
    conditions: [
      { fieldId: 'customfield_10001', operator: 'equals', value: 'Example Customer' },
      { fieldId: 'customfield_10002', operator: 'equals', value: 'Hardware' }
    ],
    reminders: [
      { afterDays: 2, message: 'First reminder' },
      { afterDays: 4, message: 'Second reminder', destinationStatusName: 'Pending customer' }
    ],
    finalAction: { afterDays: 7, destinationStatusName: 'Resolved', message: 'Final customer message' },
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

test('isAnyOf matches any selected Jira value', () => {
  const multiRule = rule({
    conditions: [{ fieldId: 'customfield_10002', operator: 'isAnyOf', value: ['Hardware', 'Crew'] }]
  });
  assert.equal(conditionsMatchIssue(multiRule, issue({ customfield_10002: { value: 'Crew' } })), true);
  assert.equal(conditionsMatchIssue(multiRule, issue({ customfield_10002: { value: 'Bond' } })), false);
});

test('isAnyOf works when the Jira field itself contains multiple values', () => {
  const multiRule = rule({
    conditions: [{ fieldId: 'customfield_10002', operator: 'isAnyOf', value: ['Crew', 'Bond'] }]
  });
  assert.equal(conditionsMatchIssue(multiRule, issue({ customfield_10002: [{ value: 'Other' }, { value: 'Bond' }] })), true);
});

test('isNoneOf excludes every selected Jira value', () => {
  const multiRule = rule({
    conditions: [{ fieldId: 'customfield_10002', operator: 'isNoneOf', value: ['Training', 'Test'] }]
  });
  assert.equal(conditionsMatchIssue(multiRule, issue({ customfield_10002: { value: 'Hardware' } })), true);
  assert.equal(conditionsMatchIssue(multiRule, issue({ customfield_10002: { value: 'Training' } })), false);
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

test('rule validation accepts multi-value comparisons and rejects empty selections', () => {
  assert.deepEqual(validateRule(rule({
    conditions: [{ fieldId: 'customfield_10002', operator: 'isAnyOf', value: ['Crew', 'Bond'] }]
  })), []);

  const errors = validateRule(rule({
    conditions: [{ fieldId: 'customfield_10002', operator: 'isAnyOf', value: [] }]
  }));
  assert.ok(errors.some((value) => value.includes('needs a value')));
});

test('rule validation catches invalid reminder ordering and final timing', () => {
  const errors = validateRule(rule({
    reminders: [
      { afterDays: 4, message: 'One' },
      { afterDays: 2, message: 'Two' }
    ],
    finalAction: { afterDays: 2, destinationStatusName: '', message: '' }
  }));
  assert.ok(errors.some((value) => value.includes('increase')));
  assert.ok(errors.some((value) => value.includes('after the last reminder')));
  assert.ok(errors.some((value) => value.includes('Destination status')));
  assert.ok(errors.some((value) => value.includes('customer message')));
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


test('advanced transition fields can preserve existing Jira values', () => {
  const rule = { finalAction: {
    fields: { customfield_1: 'new base', customfield_2: 'new crew', customfield_3: 'always' },
    fieldUpdateModes: { customfield_1: 'ifEmpty', customfield_2: 'ifEmpty', customfield_3: 'always' }
  }};
  const issue = { fields: { customfield_1: 'Existing base', customfield_2: '', customfield_3: 'old' } };
  assert.deepEqual(transitionFieldsForIssue(rule, issue), {
    customfield_2: 'new crew',
    customfield_3: 'always'
  });
});

test('empty Jira field detection handles scalar, array and option values', () => {
  assert.equal(isEmptyJiraFieldValue(null), true);
  assert.equal(isEmptyJiraFieldValue(''), true);
  assert.equal(isEmptyJiraFieldValue([]), true);
  assert.equal(isEmptyJiraFieldValue({}), true);
  assert.equal(isEmptyJiraFieldValue({ value: '' }), true);
  assert.equal(isEmptyJiraFieldValue('existing'), false);
  assert.equal(isEmptyJiraFieldValue(['existing']), false);
  assert.equal(isEmptyJiraFieldValue({ value: 'existing' }), false);
});


test('advanced transition fields can update when current value equals or contains configured text', () => {
  const rule = { finalAction: {
    fields: { customfield_1: 'Unknown', customfield_2: 'Unknown', customfield_3: 'Never' },
    fieldUpdateModes: { customfield_1: 'ifEquals', customfield_2: 'ifContains', customfield_3: 'ifEquals' },
    fieldMatchValues: { customfield_1: 'Please Update', customfield_2: 'please update', customfield_3: 'Please Update' }
  }};
  const issue = { fields: {
    customfield_1: { value: 'Please Update' },
    customfield_2: 'Needs PLEASE UPDATE before close',
    customfield_3: 'DUB'
  }};
  assert.deepEqual(transitionFieldsForIssue(rule, issue), {
    customfield_1: 'Unknown',
    customfield_2: 'Unknown'
  });
});


test('rule can match without a starting status and remains valid across statuses', () => {
  const statusless = rule({ waitingStatusName: '' });
  assert.equal(ruleMatchesIssue(statusless, issue({ status: { name: 'In Progress' } })), true);
  assert.equal(cycleStillMatchesRule(statusless, issue({ status: { name: 'Pending Review' } })), true);
  assert.deepEqual(validateRule(statusless), []);
});

test('final action can be disabled when recurring reminder interval is valid', () => {
  const recurring = rule({
    waitingStatusName: '',
    repeatEvery: 3,
    finalAction: { enabled: false }
  });
  assert.deepEqual(validateRule(recurring), []);

  const errors = validateRule(rule({
    repeatEvery: 0,
    finalAction: { enabled: false }
  }));
  assert.ok(errors.includes('Repeat reminder interval must be greater than zero'));
});

test('empty and not-empty rule filters support missing-information reminders', () => {
  const missing = rule({
    waitingStatusName: '',
    conditions: [{ fieldId: 'customfield_10002', operator: 'isEmpty', value: '' }],
    finalAction: { enabled: false },
    repeatEvery: 2
  });
  assert.equal(ruleMatchesIssue(missing, issue({ customfield_10002: null, status: { name: 'In Progress' } })), true);
  assert.equal(ruleMatchesIssue(missing, issue({ customfield_10002: { value: 'Provided' }, status: { name: 'In Progress' } })), false);
});
