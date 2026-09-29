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

function isEmptyFieldValue(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyFieldValue);
  if (typeof value === 'object') {
    const normalised = normaliseFieldValue(value);
    return normalised == null || String(normalised).trim() === '';
  }
  return String(value).trim() === '';
}

function expectedValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

export function getRuleConditions(rule) {
  if (Array.isArray(rule?.conditions)) return rule.conditions.filter((condition) => condition?.fieldId);
  return rule?.condition?.fieldId ? [rule.condition] : [];
}

export function conditionsMatchIssue(rule, issue) {
  return getRuleConditions(rule).every((condition) => {
    const actual = issue?.fields?.[condition.fieldId];
    const values = expectedValues(condition.value);
    switch (condition.operator ?? 'equals') {
      case 'equals':
        return equals(actual, values[0] ?? '');
      case 'notEquals':
        return !equals(actual, values[0] ?? '');
      case 'isAnyOf':
        return values.some((value) => equals(actual, value));
      case 'isNoneOf':
        return values.every((value) => !equals(actual, value));
      case 'isEmpty':
        return isEmptyFieldValue(actual);
      case 'isNotEmpty':
        return !isEmptyFieldValue(actual);
      default:
        return false;
    }
  });
}

export function ruleMatchesIssue(rule, issue) {
  if (!rule?.enabled) return false;
  if (rule.projectKey && issue?.fields?.project?.key !== rule.projectKey) return false;
  if (rule.waitingStatusName && issue?.fields?.status?.name !== rule.waitingStatusName) return false;
  return conditionsMatchIssue(rule, issue);
}

export function cycleStillMatchesRule(rule, issue) {
  if (!rule?.enabled) return false;
  if (rule.projectKey && issue?.fields?.project?.key !== rule.projectKey) return false;
  if (!conditionsMatchIssue(rule, issue)) return false;

  const allowedStatuses = new Set([
    rule.waitingStatusName,
    ...(rule.reminders ?? []).map((reminder) => reminder?.destinationStatusName).filter(Boolean)
  ].filter(Boolean));

  return allowedStatuses.size === 0 || allowedStatuses.has(issue?.fields?.status?.name);
}

export function selectRule(rules, issue) {
  return (rules ?? []).find((rule) => ruleMatchesIssue(rule, issue)) ?? null;
}

export function validateRule(rule) {
  const errors = [];
  if (!rule?.id) errors.push('Rule id is required');
  if (!String(rule?.name ?? '').trim()) errors.push('Rule name is required');
  if (!rule?.projectKey) errors.push('Project is required');
  if (!['days', 'hours'].includes(rule?.timingUnit ?? 'days')) errors.push('Time unit must be days or hours');

  for (const condition of getRuleConditions(rule)) {
    const operator = condition?.operator ?? 'equals';
    const values = expectedValues(condition?.value);
    if (!['isEmpty', 'isNotEmpty'].includes(operator) && values.length === 0) errors.push('Each selected ticket field needs a value');
    if (!['equals', 'notEquals', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'].includes(operator)) errors.push('Unsupported field comparison');
    if (['equals', 'notEquals'].includes(operator) && values.length > 1) {
      errors.push('Equals comparisons can only contain one value');
    }
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

  const finalEnabled = rule?.finalAction?.enabled !== false;
  if (finalEnabled) {
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
    if (!String(rule?.finalAction?.message ?? '').trim()) {
      errors.push('Final action needs a customer message');
    }
  } else {
    const repeatEvery = Number(rule?.repeatEvery ?? rule?.reminders?.at(-1)?.afterDays);
    if (!Number.isFinite(repeatEvery) || repeatEvery <= 0) {
      errors.push('Repeat reminder interval must be greater than zero');
    }
  }
  return [...new Set(errors)];
}
