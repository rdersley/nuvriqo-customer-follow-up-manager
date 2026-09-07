import { kvs, WhereConditions } from '@forge/kvs';

const RULE_PREFIX = 'rule:';
const CYCLE_PREFIX = 'cycle:';
const AUDIT_PREFIX = 'audit:';
const ACCOUNT_PREFIX = 'account:';
const SYSTEM_PREFIX = 'system:';
const SCHEDULER_STATUS_KEY = `${SYSTEM_PREFIX}scheduler-status`;
const RECENT_AUDIT_KEY = `${SYSTEM_PREFIX}recent-audit`;
const AUDIT_RETENTION_DAYS = 180;
const RECENT_AUDIT_LIMIT = 100;

const RECENT_FEED_TYPES = new Set([
  'cycle-started',
  'cycle-cancelled',
  'participants-added',
  'reminder-comment-sent',
  'reminder-transitioned',
  'reminder-completed',
  'final-comment-sent',
  'auto-transitioned',
  'processing-error'
]);

async function queryByPrefix(prefix) {
  const results = [];
  let cursor;

  do {
    let query = kvs
      .query()
      .where('key', WhereConditions.beginsWith(prefix))
      .limit(100);
    if (cursor) query = query.cursor(cursor);

    const page = await query.getMany();
    results.push(...(page.results ?? []));
    cursor = page.nextCursor;
  } while (cursor);

  return results;
}

function participantIdsForRule(rule) {
  return new Set(
    (rule?.reminders ?? [])
      .flatMap((reminder) => reminder?.participantAccountIds ?? [])
      .filter(Boolean)
  );
}

function normaliseStoredRule(rule) {
  if (!rule) return rule;
  const next = structuredClone(rule);
  next.priority ??= 100;
  next.enabled ??= true;
  next.timingUnit ??= 'days';
  next.conditions = Array.isArray(next.conditions)
    ? next.conditions
    : next.condition?.fieldId
      ? [next.condition]
      : [];
  delete next.condition;

  next.reminders = (next.reminders ?? []).map((reminder) => {
    const clean = {
      ...reminder,
      destinationStatusName: reminder?.destinationStatusName ?? '',
      participantAccountIds: [...new Set(reminder?.participantAccountIds ?? [])]
    };
    delete clean.participants;
    return clean;
  });

  next.finalAction = {
    resolutionId: '',
    fields: {},
    ...(next.finalAction ?? {})
  };
  return next;
}

async function addAccountRuleReference(accountId, ruleId) {
  const key = `${ACCOUNT_PREFIX}${accountId}`;
  const current = await kvs.get(key);
  const ruleIds = new Set(current?.ruleIds ?? []);
  ruleIds.add(ruleId);
  await kvs.set(key, {
    accountId,
    ruleIds: [...ruleIds],
    updatedAt: current?.updatedAt ?? new Date().toISOString()
  });
}

async function removeAccountRuleReference(accountId, ruleId) {
  const key = `${ACCOUNT_PREFIX}${accountId}`;
  const current = await kvs.get(key);
  if (!current) return;

  const ruleIds = (current.ruleIds ?? []).filter((id) => id !== ruleId);
  if (ruleIds.length === 0) {
    await kvs.delete(key);
    return;
  }

  await kvs.set(key, { ...current, ruleIds });
}

async function syncRuleAccountReferences(previousRule, nextRule) {
  const previous = participantIdsForRule(previousRule);
  const next = participantIdsForRule(nextRule);
  const ruleId = nextRule?.id ?? previousRule?.id;
  if (!ruleId) return;

  for (const accountId of next) {
    if (!previous.has(accountId)) await addAccountRuleReference(accountId, ruleId);
  }
  for (const accountId of previous) {
    if (!next.has(accountId)) await removeAccountRuleReference(accountId, ruleId);
  }
}

export async function getRules() {
  const results = await queryByPrefix(RULE_PREFIX);
  return results
    .map((item) => normaliseStoredRule(item.value))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export async function saveRule(rule) {
  const key = `${RULE_PREFIX}${rule.id}`;
  const previous = normaliseStoredRule(await kvs.get(key));
  const clean = normaliseStoredRule(rule);
  await syncRuleAccountReferences(previous, clean);
  await kvs.set(key, clean);
}

export async function deleteRule(ruleId) {
  const key = `${RULE_PREFIX}${ruleId}`;
  const previous = normaliseStoredRule(await kvs.get(key));
  if (previous) await syncRuleAccountReferences(previous, { id: ruleId, reminders: [] });
  await kvs.delete(key);
}

export async function getCycle(issueId) {
  return kvs.get(`${CYCLE_PREFIX}${issueId}`);
}

export async function saveCycle(cycle) {
  await kvs.set(`${CYCLE_PREFIX}${cycle.issueId}`, cycle);
}

export async function deleteCycle(issueId) {
  await kvs.delete(`${CYCLE_PREFIX}${issueId}`);
}

export async function getActiveCycles() {
  const results = await queryByPrefix(CYCLE_PREFIX);
  return results.map((item) => item.value).filter((cycle) => cycle.active);
}

async function addRecentAudit(event) {
  if (!RECENT_FEED_TYPES.has(event?.type)) return;
  const current = await kvs.get(RECENT_AUDIT_KEY).catch(() => null);
  const events = [event, ...(current?.events ?? [])]
    .filter((item) => item?.timestamp && RECENT_FEED_TYPES.has(item.type))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, RECENT_AUDIT_LIMIT);
  await kvs.set(RECENT_AUDIT_KEY, { events, updatedAt: new Date().toISOString() });
}

export async function appendAudit(issueId, type, details = {}) {
  const timestamp = new Date().toISOString();
  const event = { issueId, timestamp, type, ...details };
  const key = `${AUDIT_PREFIX}${issueId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(
    key,
    event,
    { ttl: { unit: 'DAYS', value: AUDIT_RETENTION_DAYS } }
  );
  await addRecentAudit(event);
}

export async function getAudit(issueId) {
  const results = await queryByPrefix(`${AUDIT_PREFIX}${issueId}:`);
  return results
    .map((item) => item.value)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function getRecentAudit(limit = 100) {
  const requested = Math.max(1, Math.min(Number(limit) || 100, RECENT_AUDIT_LIMIT));
  const recent = await kvs.get(RECENT_AUDIT_KEY);
  if (Array.isArray(recent?.events)) {
    return recent.events.filter((item) => RECENT_FEED_TYPES.has(item?.type)).slice(0, requested);
  }
  return [];
}

export async function saveSchedulerStatus(status) {
  await kvs.set(SCHEDULER_STATUS_KEY, {
    ...status,
    updatedAt: new Date().toISOString()
  });
}

export async function getSchedulerStatus() {
  return kvs.get(SCHEDULER_STATUS_KEY);
}

export async function getPersonalDataAccounts() {
  const results = await queryByPrefix(ACCOUNT_PREFIX);
  return results.map((item) => item.value).filter((value) => value?.accountId);
}

export async function markPersonalDataRefreshed(accountId) {
  const key = `${ACCOUNT_PREFIX}${accountId}`;
  const current = await kvs.get(key);
  if (!current) return;
  await kvs.set(key, { ...current, updatedAt: new Date().toISOString() });
}

export async function erasePersonalDataForAccount(accountId) {
  const rules = await getRules();
  for (const rule of rules) {
    let changed = false;
    const reminders = (rule.reminders ?? []).map((reminder) => {
      const ids = (reminder.participantAccountIds ?? []).filter((id) => id !== accountId);
      if (ids.length !== (reminder.participantAccountIds ?? []).length) changed = true;
      return { ...reminder, participantAccountIds: ids };
    });

    if (changed) {
      await kvs.set(`${RULE_PREFIX}${rule.id}`, normaliseStoredRule({ ...rule, reminders }));
    }
  }
  await kvs.delete(`${ACCOUNT_PREFIX}${accountId}`);
}
