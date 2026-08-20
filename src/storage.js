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

export async function getRules() {
  const results = await queryByPrefix(RULE_PREFIX);
  return results.map((item) => item.value).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export async function saveRule(rule) {
  await kvs.set(`${RULE_PREFIX}${rule.id}`, rule);
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
