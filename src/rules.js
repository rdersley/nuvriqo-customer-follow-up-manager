export function normaliseFieldValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normaliseFieldValue);
  if (typeof value === 'object') {
    return value.value ?? value.name ?? value.id ?? value.key ?? null;
  }
  return value;
}

function equals(actual, expected) {
  const normalised = normaliseFieldValue(actual);
  if (Array.isArray(normalised)) {
    return normalised.some((item) => String(item).toLowerCase() === String(expected).toLowerCase());
  }
  return String(normalised ?? '').toLowerCase() === String(expected ?? '').toLowerCase();
}

export function ruleMatchesIssue(rule, issue) {
  if (!rule?.enabled) return false;
  if (rule.projectKey && issue?.fields?.project?.key !== rule.projectKey) return false;
  if (rule.waitingStatusName && issue?.fields?.status?.name !== rule.waitingStatusName) return false;

  if (!rule.condition?.fieldId) return true;
  const actual = issue?.fields?.[rule.condition.fieldId];

  switch (rule.condition.operator ?? 'equals') {
    case 'equals':
      return equals(actual, rule.condition.value);
    case 'notEquals':
      return !equals(actual, rule.condition.value);
    default:
      return false;
  }
}

export function selectRule(rules, issue) {
  return (rules ?? []).find((rule) => ruleMatchesIssue(rule, issue)) ?? null;
}

export function validateRule(rule) {
  const errors = [];
  if (!rule?.id) errors.push('Rule id is required');
  if (!String(rule?.name ?? '').trim()) errors.push('Rule name is required');
  if (!rule?.projectKey) errors.push('Project is required');
  if (!rule?.waitingStatusName) errors.push('Waiting status is required');
  if (!['days', 'hours'].includes(rule?.timingUnit ?? 'days')) errors.push('Time unit must be days or hours');

  if (rule?.condition?.fieldId && !String(rule?.condition?.value ?? '').trim()) {
    errors.push('Field value is required when a ticket field is selected');
  }
  if (rule?.condition?.fieldId && !['equals', 'notEquals'].includes(rule?.condition?.operator ?? 'equals')) {
    errors.push('Unsupported field comparison');
  }

  if (!Array.isArray(rule?.reminders) || rule.reminders.length === 0) {
    errors.push('At least one reminder is required');
  }

  const reminderValues = (rule?.reminders ?? []).map((r) => Number(r.afterDays));
  if (reminderValues.some((value) => !Number.isFinite(value) || value < 0)) {
    errors.push('Reminder timing must be zero or greater');
  }
  if (reminderValues.some((value, index) => index > 0 && value <= reminderValues[index - 1])) {
    errors.push('Reminder timings must increase');
  }
  if ((rule?.reminders ?? []).some((reminder) => !String(reminder?.message ?? '').trim())) {
    errors.push('Every reminder needs a customer message');
  }

  const finalValue = Number(rule?.finalAction?.afterDays);
  if (!Number.isFinite(finalValue) || finalValue < 0) {
    errors.push('Final action timing is required');
  }
  if (reminderValues.length && finalValue <= reminderValues[reminderValues.length - 1]) {
    errors.push('Final action must occur after the last reminder');
  }
  if (!rule?.finalAction?.destinationStatusName) {
    errors.push('Destination status is required');
  }
  return errors;
}
