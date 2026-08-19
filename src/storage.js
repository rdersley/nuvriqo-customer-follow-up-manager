import { kvs, startsWith } from '@forge/kvs';

const RULE_PREFIX = 'rule:';
const CYCLE_PREFIX = 'cycle:';
const AUDIT_PREFIX = 'audit:';

export async function getRules() {
  const result = await kvs.query().where('key', startsWith(RULE_PREFIX)).limit(100).getMany();
  return result.results.map((item) => item.value).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
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
  const result = await kvs.query().where('key', startsWith(CYCLE_PREFIX)).limit(100).getMany();
  return result.results.map((item) => item.value).filter((cycle) => cycle.active);
}

export async function appendAudit(issueId, type, details = {}) {
  const timestamp = new Date().toISOString();
  const key = `${AUDIT_PREFIX}${issueId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(key, { issueId, timestamp, type, ...details });
}

export async function getAudit(issueId) {
  const result = await kvs.query().where('key', startsWith(`${AUDIT_PREFIX}${issueId}:`)).limit(100).getMany();
  return result.results.map((item) => item.value).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
