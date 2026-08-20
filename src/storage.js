import { kvs, WhereConditions } from '@forge/kvs';

const RULE_PREFIX = 'rule:';
const CYCLE_PREFIX = 'cycle:';
const AUDIT_PREFIX = 'audit:';

async function queryByPrefix(prefix) {
  const result = await kvs
    .query()
    .where('key', WhereConditions.beginsWith(prefix))
    .limit(100)
    .getMany();
  return result.results ?? [];
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
  next.reminders = (next.reminders ?? []).map((reminder) => ({
    ...reminder,
    destinationStatusName: reminder?.destinationStatusName ?? '',
    participantAccountIds: reminder?.participantAccountIds ?? [],
    participants: reminder?.participants ?? []
  }));
  next.finalAction = {
    resolutionId: '',
    fields: {},
    ...(next.finalAction ?? {})
  };
  return next;
}

export async function getRules() {
  const results = await queryByPrefix(RULE_PREFIX);
  return results
    .map((item) => normaliseStoredRule(item.value))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export async function saveRule(rule) {
  await kvs.set(`${RULE_PREFIX}${rule.id}`, normaliseStoredRule(rule));
}

export async function deleteRule(ruleId) {
  await kvs.delete(`${RULE_PREFIX}${ruleId}`);
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

export async function appendAudit(issueId, type, details = {}) {
  const timestamp = new Date().toISOString();
  const key = `${AUDIT_PREFIX}${issueId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(key, { issueId, timestamp, type, ...details });
}

export async function getAudit(issueId) {
  const results = await queryByPrefix(`${AUDIT_PREFIX}${issueId}:`);
  return results.map((item) => item.value).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
