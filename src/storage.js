import { kvs, WhereConditions } from '@forge/kvs';

const RULE_PREFIX = 'rule:';
const CYCLE_PREFIX = 'cycle:';
const AUDIT_PREFIX = 'audit:';
const ACCOUNT_PREFIX = 'account:';
const SYSTEM_PREFIX = 'system:';
const SCHEDULER_STATUS_KEY = `${SYSTEM_PREFIX}scheduler-status`;
const RECENT_AUDIT_KEY = `${SYSTEM_PREFIX}recent-audit`;
const DUE_INDEX_KEY = `${SYSTEM_PREFIX}due-cycle-index`;
const DISCOVERY_STATE_KEY = `${SYSTEM_PREFIX}discovery-state`;
const AUDIT_RETENTION_DAYS = 180;
const RECENT_AUDIT_LIMIT = 200;
const SUPPRESSED_AUDIT_TYPES = new Set([
  'rule-check',
  'participants-added',
  'reminder-comment-sent',
  'reminder-transitioned',
  'final-comment-sent'
]);

async function queryByPrefix(prefix) {
  const results = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    results.push(...(page.results ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  return results;
}

function participantIdsForRule(rule) {
  return new Set((rule?.reminders ?? []).flatMap((reminder) => reminder?.participantAccountIds ?? []).filter(Boolean));
}

function normaliseStoredRule(rule) {
  if (!rule) return rule;
  const next = structuredClone(rule);
  next.priority ??= 100;
  next.enabled ??= true;
  next.timingUnit ??= 'days';
  next.conditions = Array.isArray(next.conditions) ? next.conditions : next.condition?.fieldId ? [next.condition] : [];
  delete next.condition;
  next.reminders = (next.reminders ?? []).map((reminder) => {
    const clean = { ...reminder, destinationStatusName: reminder?.destinationStatusName ?? '', participantAccountIds: [...new Set(reminder?.participantAccountIds ?? [])] };
    delete clean.participants;
    return clean;
  });
  next.finalAction = { resolutionId: '', fields: {}, ...(next.finalAction ?? {}) };
  return next;
}

async function addAccountRuleReference(accountId, ruleId) {
  const key = `${ACCOUNT_PREFIX}${accountId}`;
  const current = await kvs.get(key);
  const ruleIds = new Set(current?.ruleIds ?? []);
  ruleIds.add(ruleId);
  await kvs.set(key, { accountId, ruleIds: [...ruleIds], updatedAt: current?.updatedAt ?? new Date().toISOString() });
}

async function removeAccountRuleReference(accountId, ruleId) {
  const key = `${ACCOUNT_PREFIX}${accountId}`;
  const current = await kvs.get(key);
  if (!current) return;
  const ruleIds = (current.ruleIds ?? []).filter((id) => id !== ruleId);
  if (ruleIds.length === 0) { await kvs.delete(key); return; }
  await kvs.set(key, { ...current, ruleIds });
}

async function syncRuleAccountReferences(previousRule, nextRule) {
  const previous = participantIdsForRule(previousRule);
  const next = participantIdsForRule(nextRule);
  const ruleId = nextRule?.id ?? previousRule?.id;
  if (!ruleId) return;
  for (const accountId of next) if (!previous.has(accountId)) await addAccountRuleReference(accountId, ruleId);
  for (const accountId of previous) if (!next.has(accountId)) await removeAccountRuleReference(accountId, ruleId);
}

function cycleRef(cycle) {
  return { issueId: cycle.issueId, issueKey: cycle.issueKey, ruleId: cycle.ruleId, startedAt: cycle.startedAt ?? null, nextDueAt: cycle.nextDueAt ?? null, paused: cycle.paused === true, active: cycle.active !== false };
}

async function readDueIndex() {
  const stored = await kvs.get(DUE_INDEX_KEY);
  return stored && typeof stored === 'object' ? stored : { refs: {}, migrated: false };
}

async function writeDueIndex(index) {
  await kvs.set(DUE_INDEX_KEY, { refs: index.refs ?? {}, migrated: index.migrated === true, updatedAt: new Date().toISOString() });
}

async function upsertCycleRef(cycle) {
  if (!cycle?.issueId) return;
  const index = await readDueIndex();
  index.refs ??= {};
  index.refs[cycle.issueId] = cycleRef(cycle);
  await writeDueIndex(index);
}

async function removeCycleRef(issueId) {
  const index = await readDueIndex();
  if (!index.refs?.[issueId]) return;
  delete index.refs[issueId];
  await writeDueIndex(index);
}

export async function getRules() {
  const results = await queryByPrefix(RULE_PREFIX);
  return results.map((item) => normaliseStoredRule(item.value)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
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

export async function getCycle(issueId) { return kvs.get(`${CYCLE_PREFIX}${issueId}`); }

export async function saveCycle(cycle) {
  const indexChanged = cycle?._indexedDueAt !== (cycle?.nextDueAt ?? null) || cycle?._indexedPaused !== (cycle?.paused === true) || cycle?._indexedRuleId !== cycle?.ruleId;
  if (indexChanged) {
    await upsertCycleRef(cycle);
    cycle._indexedDueAt = cycle.nextDueAt ?? null;
    cycle._indexedPaused = cycle.paused === true;
    cycle._indexedRuleId = cycle.ruleId;
  }
  await kvs.set(`${CYCLE_PREFIX}${cycle.issueId}`, cycle);
}

export async function deleteCycle(issueId, knownCycle = null) {
  await kvs.delete(`${CYCLE_PREFIX}${issueId}`);
  await removeCycleRef(knownCycle?.issueId ?? issueId);
}


const FAILED_RETRY_RECOVERY_KEY = 'system:failed-retry-recovery-v1';

export async function recoverLegacyFailedCycles(retryAt = new Date().toISOString()) {
  if (await kvs.get(FAILED_RETRY_RECOVERY_KEY)) return 0;
  const results = await queryByPrefix(CYCLE_PREFIX);
  let recovered = 0;
  for (const item of results) {
    const cycle = item.value;
    if (!cycle?.active || !cycle?.lastError) continue;
    cycle.nextDueAt = retryAt;
    cycle.lastError.retryAt = retryAt;
    await saveCycle(cycle);
    recovered += 1;
  }
  await kvs.set(FAILED_RETRY_RECOVERY_KEY, { completedAt: new Date().toISOString(), recovered });
  return recovered;
}

export async function getActiveCycles() {
  const index = await readDueIndex();
  if (index.migrated === true) return Object.values(index.refs ?? {}).filter((cycle) => cycle.active !== false);
  const results = await queryByPrefix(CYCLE_PREFIX);
  return results.map((item) => item.value).filter((cycle) => cycle.active);
}

export async function getCycleRefs() {
  const index = await readDueIndex();
  return Object.values(index.refs ?? {});
}

export async function getDueCycleRefs(now = new Date()) {
  const cutoff = now.getTime();
  const refs = await getCycleRefs();
  return refs.filter((ref) => {
    if (ref?.paused || !ref?.nextDueAt) return false;
    const due = new Date(ref.nextDueAt).getTime();
    return Number.isFinite(due) && due <= cutoff;
  });
}

export async function dueIndexMigrated() { const index = await readDueIndex(); return index.migrated === true; }

export async function replaceDueIndex(cycles = []) {
  const refs = {};
  for (const cycle of cycles) if (cycle?.active && cycle?.issueId) refs[cycle.issueId] = cycleRef(cycle);
  await writeDueIndex({ refs, migrated: true });
}

function compactAuditEvent(event) {
  const keys = ['issueId','issueKey','timestamp','type','ruleId','ruleName','reason','message','action','filtersMatched','selected','reminderIndex','currentStatusName','destinationStatusName','failureStage','transitionId','transitionName','httpStatus','missingRequiredFields','availableDestinations','configuredFieldIds','resolutionId','resolutionName','commentSent','finalCommentSent','statusChanged','participantCount','after','timingUnit','source','repeatCount','repeatEvery','startedAt','nextDueAt'];
  return Object.fromEntries(keys.filter((key) => event?.[key] !== undefined && event?.[key] !== null && event?.[key] !== '').map((key) => [key, event[key]]));
}

async function addRecentAudit(event) {
  const important = new Set(['cycle-started','cycle-cancelled','reminder-completed','reminder-repeated','auto-transitioned','processing-error','cycle-paused','cycle-resumed','cycle-restarted']);
  if (!important.has(event?.type)) return;
  const current = await kvs.get(RECENT_AUDIT_KEY).catch(() => null);
  const events = [compactAuditEvent(event), ...(current?.events ?? [])].filter((item) => item?.timestamp).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, RECENT_AUDIT_LIMIT);
  await kvs.set(RECENT_AUDIT_KEY, { events, updatedAt: new Date().toISOString() });
}

export async function appendAudit(issueId, type, details = {}) {
  // Routine rule checks and intermediate action steps are intentionally not persisted.
  // The scheduler heartbeat carries aggregate checked counts, while cycle-started,
  // reminder-completed, cancellation, closure and error events preserve actionable evidence.
  // This prevents hourly backlog discovery from creating a write for every non-matching ticket.
  if (SUPPRESSED_AUDIT_TYPES.has(type)) return;
  const timestamp = new Date().toISOString();
  const event = { issueId, timestamp, type, ...details };
  const key = `${AUDIT_PREFIX}${issueId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(key, event, { ttl: { unit: 'DAYS', value: AUDIT_RETENTION_DAYS } });
  await addRecentAudit(event);
}

export async function getAudit(issueId) {
  const results = await queryByPrefix(`${AUDIT_PREFIX}${issueId}:`);
  return results.map((item) => item.value).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function getRecentAudit(limit = 250) {
  const requested = Math.max(1, Math.min(Number(limit) || 250, RECENT_AUDIT_LIMIT));
  const recent = await kvs.get(RECENT_AUDIT_KEY);
  if (Array.isArray(recent?.events)) return recent.events.slice(0, requested);
  return [];
}

export async function saveSchedulerStatus(status) { await kvs.set(SCHEDULER_STATUS_KEY, { ...status, updatedAt: new Date().toISOString() }); }
export async function getSchedulerStatus() { return kvs.get(SCHEDULER_STATUS_KEY); }
export async function getDiscoveryState() { return kvs.get(DISCOVERY_STATE_KEY); }
export async function saveDiscoveryState(state) { await kvs.set(DISCOVERY_STATE_KEY, state); }

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
    if (changed) await kvs.set(`${RULE_PREFIX}${rule.id}`, normaliseStoredRule({ ...rule, reminders }));
  }
  await kvs.delete(`${ACCOUNT_PREFIX}${accountId}`);
}
