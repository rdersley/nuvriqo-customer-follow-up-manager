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
  if (!rule?.name) errors.push('Rule name is required');
  if (!rule?.projectKey) errors.push('Project is required');
  if (!rule?.waitingStatusName) errors.push('Waiting status is required');

  const reminderDays = (rule?.reminders ?? []).map((r) => Number(r.afterDays));
  if (reminderDays.some((day) => !Number.isFinite(day) || day < 0)) {
    errors.push('Reminder days must be zero or greater');
  }
  if (reminderDays.some((day, index) => index > 0 && day <= reminderDays[index - 1])) {
    errors.push('Reminder days must increase');
  }

  const finalDay = Number(rule?.finalAction?.afterDays);
  if (!Number.isFinite(finalDay) || finalDay < 0) {
    errors.push('Final action day is required');
  }
  if (reminderDays.length && finalDay <= reminderDays[reminderDays.length - 1]) {
    errors.push('Final action must occur after the last reminder');
  }
  if (!rule?.finalAction?.destinationStatusName) {
    errors.push('Destination status is required');
  }
  return errors;
}
