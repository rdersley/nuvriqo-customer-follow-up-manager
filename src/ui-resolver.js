import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { reconcileIssue } from './followups.js';
import {
  appendAudit,
  deleteCycle,
  deleteRule,
  getActiveCycles,
  getAudit,
  getCycle,
  getRecentAudit,
  getRules,
  getSchedulerStatus,
  saveCycle,
  saveRule
} from './storage.js';
import { resolverLicenseAllows } from './license.js';
import { validateRule } from './rules.js';
import { exportBackupPage, importBackupBatch } from './backup.js';

const resolver = new Resolver();

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function projectKeyFromContext(context) {
  return context?.extension?.project?.key ?? context?.project?.key ?? null;
}

function issueKeyFromContext(context) {
  return context?.extension?.issue?.key ?? context?.issue?.key ?? null;
}

// Fails closed in production when the licence is missing or inactive.
function licenseAllows(context) {
  return resolverLicenseAllows(context);
}

function ensureLicensedForWrite(context) {
  if (!licenseAllows(context)) {
    throw new Error('Nuvriqo requires an active Marketplace license to change rules or follow-up cycles.');
  }
}

function stripOuterQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function optionValue(option) {
  if (option == null) return null;
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    const text = stripOuterQuotes(option);
    return text ? { value: text, displayName: text } : null;
  }

  const rawValue = option.value ?? option.name ?? option.displayName ?? option.key ?? option.id;
  if (rawValue == null) return null;

  const value = stripOuterQuotes(rawValue);
  const displayName = stripOuterQuotes(option.displayName ?? option.name ?? option.value ?? value);
  if (!value || !displayName) return null;
  return { value, displayName };
}

function flattenActualValues(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenActualValues(item, output);
    return output;
  }
  if (typeof value === 'object') {
    const direct = optionValue(value);
    if (direct) output.push(direct);
    if (value.child) flattenActualValues(value.child, output);
    if (value.children) flattenActualValues(value.children, output);
    return output;
  }
  const direct = optionValue(value);
  if (direct) output.push(direct);
  return output;
}

function optionKey(option) {
  return String(option?.displayName ?? option?.value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function mergeOptions(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const option = optionValue(raw);
      if (!option) continue;
      const key = optionKey(option);
      if (key && !map.has(key)) map.set(key, option);
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function ensureProjectAdmin(projectKey) {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`
  );
  const data = await readJson(response, 'Check project administration permission');
  if (data?.permissions?.ADMINISTER_PROJECTS?.havePermission !== true) {
    throw new Error('You need Jira project administration permission to configure Nuvriqo rules.');
  }
}

async function ensureCanEditIssue(issueKey) {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=EDIT_ISSUES`
  );
  const data = await readJson(response, 'Check issue edit permission');
  if (data?.permissions?.EDIT_ISSUES?.havePermission !== true) {
    throw new Error('You need Edit Issues permission to change this Nuvriqo follow-up cycle.');
  }
}

async function getIssueAsUser(issueKey) {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?expand=names`);
  return readJson(response, `Get issue ${issueKey}`);
}

async function getProjectFieldAllowedValues(projectKey, fieldId) {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=100`
  );
  if (!response.ok) return [];

  const data = await response.json();
  const issueTypes = data?.issueTypes ?? data?.values ?? [];
  const collected = [];

  for (const issueType of issueTypes) {
    let startAt = 0;
    let total = 1;
    while (startAt < total) {
      const fieldsResponse = await api.asUser().requestJira(
        route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueType.id}?startAt=${startAt}&maxResults=50`
      );
      if (!fieldsResponse.ok) break;

      const fieldsData = await fieldsResponse.json();
      const fields = fieldsData?.fields ?? fieldsData?.values ?? [];
      const field = fields.find(
        (item) => item.fieldId === fieldId || item.key === fieldId || item.id === fieldId
      );
      if (field?.allowedValues?.length) collected.push(...field.allowedValues);

      const pageSize = Number(fieldsData?.maxResults ?? fields.length ?? 50);
      total = Number(fieldsData?.total ?? fields.length ?? 0);
      startAt += Math.max(pageSize, 1);
      if (!fields.length) break;
    }
  }

  return mergeOptions(collected);
}

function escapeJqlString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fieldJqlReference(fieldId, fieldName) {
  const match = /^customfield_(\d+)$/.exec(String(fieldId ?? ''));
  if (match) return `cf[${match[1]}]`;
  return `"${escapeJqlString(fieldName)}"`;
}

async function getObservedProjectFieldValues(projectKey, fieldId, fieldName) {
  if (!projectKey || !fieldId) return [];
  const fieldRef = fieldJqlReference(fieldId, fieldName);
  const jql = `project = "${escapeJqlString(projectKey)}" AND ${fieldRef} is not EMPTY`;
  const body = JSON.stringify({ jql, maxResults: 100, fields: [fieldId] });

  let response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body
  });

  if (!response.ok) {
    response = await api.asUser().requestJira(route`/rest/api/3/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body
    });
  }
  if (!response.ok) return [];

  const data = await response.json();
  const collected = [];
  for (const issue of data?.issues ?? []) {
    flattenActualValues(issue?.fields?.[fieldId], collected);
  }
  return mergeOptions(collected);
}

async function getJqlSuggestions(fieldName, fieldValue = '') {
  if (!fieldName) return [];
  const response = fieldValue
    ? await api.asUser().requestJira(
      route`/rest/api/3/jql/autocompletedata/suggestions?fieldName=${fieldName}&fieldValue=${fieldValue}`
    )
    : await api.asUser().requestJira(
      route`/rest/api/3/jql/autocompletedata/suggestions?fieldName=${fieldName}`
    );
  if (!response.ok) return [];

  const data = await response.json();
  return mergeOptions(
    (data?.results ?? []).map((item) => ({
      value: item?.value,
      displayName: item?.displayName ?? item?.value
    }))
  );
}

resolver.define('getProjectSetup', async ({ context }) => {
  const projectKey = projectKeyFromContext(context);
  if (!projectKey) throw new Error('Project context is unavailable');
  await ensureProjectAdmin(projectKey);

  const [fieldsResponse, statusesResponse, resolutionsResponse, rules] = await Promise.all([
    api.asUser().requestJira(route`/rest/api/3/field`),
    api.asUser().requestJira(route`/rest/api/3/project/${projectKey}/statuses`),
    api.asUser().requestJira(route`/rest/api/3/resolution`),
    getRules()
  ]);

  const fields = await readJson(fieldsResponse, 'Load Jira fields');
  const statusGroups = await readJson(statusesResponse, 'Load project statuses');
  const resolutions = resolutionsResponse.ok ? await resolutionsResponse.json() : [];
  const statusMap = new Map();

  for (const issueType of statusGroups ?? []) {
    for (const status of issueType.statuses ?? []) {
      statusMap.set(status.id, { id: status.id, name: status.name });
    }
  }

  return {
    projectKey,
    licensed: licenseAllows(context),
    fields: (fields ?? [])
      .filter((field) => field?.id && field?.name)
      .map((field) => ({
        id: field.id,
        name: field.name,
        custom: Boolean(field.custom),
        schemaType: field.schema?.type ?? null,
        schemaCustom: field.schema?.custom ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    statuses: [...statusMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resolutions: (resolutions ?? [])
      .map((resolution) => ({ id: resolution.id, name: resolution.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rules: rules.filter((rule) => rule.projectKey === projectKey)
  };
});

resolver.define('getProjectActivity', async ({ context }) => {
  const projectKey = projectKeyFromContext(context);
  if (!projectKey) throw new Error('Project context is unavailable');
  await ensureProjectAdmin(projectKey);

  const [rules, cycles, audit, scheduler] = await Promise.all([
    getRules(),
    getActiveCycles(),
    getRecentAudit(500),
    getSchedulerStatus()
  ]);

  const projectRules = rules.filter((rule) => rule.projectKey === projectKey);
  const ruleIds = new Set(projectRules.map((rule) => rule.id));
  const rulesById = new Map(projectRules.map((rule) => [rule.id, rule]));
  const projectCycles = cycles.filter((cycle) => ruleIds.has(cycle.ruleId));
  const activity = audit
    .filter((item) => item?.ruleId && ruleIds.has(item.ruleId))
    .slice(0, 100)
    .map((item) => ({
      ...item,
      ruleName: item.ruleName ?? rulesById.get(item.ruleId)?.name ?? item.ruleId
    }));

  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = activity.filter((item) => String(item.timestamp ?? '').startsWith(today));

  return {
    scheduler: scheduler ?? null,
    summary: {
      activeFollowUps: projectCycles.length,
      remindersToday: todayEvents.filter((item) => item.type === 'reminder-comment-sent').length,
      autoClosesToday: todayEvents.filter((item) => item.type === 'auto-transitioned').length,
      failuresToday: todayEvents.filter((item) => item.type === 'processing-error').length
    },
    activity,
    activeCycles: projectCycles.slice(0, 100).map((cycle) => ({
      ...cycle,
      ruleName: rulesById.get(cycle.ruleId)?.name ?? cycle.ruleId
    }))
  };
});

resolver.define('getFieldOptions', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context);
  const fieldId = String(payload?.fieldId ?? '').trim();
  const fieldName = String(payload?.fieldName ?? '').trim();
  if (!projectKey || !fieldId) return { values: [], source: 'none' };
  await ensureProjectAdmin(projectKey);

  const metadata = await getProjectFieldAllowedValues(projectKey, fieldId).catch(() => []);
  const observed = await getObservedProjectFieldValues(projectKey, fieldId, fieldName).catch(() => []);
  const autocomplete = await getJqlSuggestions(fieldName).catch(() => []);
  const values = mergeOptions(metadata, observed, autocomplete).slice(0, 300);

  return { values, source: values.length ? 'jira' : 'none' };
});

resolver.define('getFieldSuggestions', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context);
  if (projectKey) await ensureProjectAdmin(projectKey);
  const fieldName = String(payload?.fieldName ?? '').trim();
  const fieldValue = String(payload?.fieldValue ?? '').trim();
  return { values: await getJqlSuggestions(fieldName, fieldValue) };
});

resolver.define('searchParticipants', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context);
  if (projectKey) await ensureProjectAdmin(projectKey);

  const query = String(payload?.query ?? '').trim();
  if (query.length < 2) return { users: [] };

  const response = await api.asUser().requestJira(
    route`/rest/api/3/groupuserpicker?query=${query}&maxResults=20&showAvatar=true&caseInsensitive=true&excludeConnectAddons=true`
  );
  if (!response.ok) return { users: [] };

  const data = await response.json();
  return {
    users: (data?.users?.users ?? [])
      .filter((user) => user?.accountId && user?.displayName)
      .map((user) => ({
        accountId: user.accountId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null
      }))
      .slice(0, 20)
  };
});

resolver.define('saveRule', async ({ payload, context }) => {
  ensureLicensedForWrite(context);
  const projectKey = projectKeyFromContext(context);
  if (!projectKey) throw new Error('Project context is unavailable');
  await ensureProjectAdmin(projectKey);

  const rule = { ...payload.rule, projectKey };
  const errors = validateRule(rule);
  if (errors.length) return { ok: false, errors };

  const existingRules = await getRules();
  const duplicate = existingRules.find((item) =>
    item.id !== rule.id &&
    item.projectKey === projectKey &&
    item.enabled !== false &&
    item.waitingStatusName === rule.waitingStatusName &&
    JSON.stringify(item.conditions ?? []) === JSON.stringify(rule.conditions ?? [])
  );
  if (duplicate) {
    return {
      ok: false,
      errors: [`This rule overlaps exactly with enabled rule “${duplicate.name}”. Edit its filters or disable the other rule.`]
    };
  }

  await saveRule(rule);
  return { ok: true, rule };
});

resolver.define('deleteRule', async ({ payload, context }) => {
  ensureLicensedForWrite(context);
  const projectKey = projectKeyFromContext(context);
  if (!projectKey) throw new Error('Project context is unavailable');
  await ensureProjectAdmin(projectKey);

  const rules = await getRules();
  const rule = rules.find((item) => item.id === payload.ruleId);
  if (!rule || rule.projectKey !== projectKey) throw new Error('Rule not found in this project');
  await deleteRule(payload.ruleId);
  return { ok: true };
});

resolver.define('getIssuePanel', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  if (!issueKey) throw new Error('Issue context is unavailable');
  const issue = await getIssueAsUser(issueKey);
  const [cycle, audit, rules] = await Promise.all([
    getCycle(issue.id),
    getAudit(issue.id),
    getRules()
  ]);
  const rule = cycle ? rules.find((item) => item.id === cycle.ruleId) ?? null : null;

  return {
    licensed: licenseAllows(context),
    issue: {
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary,
      status: issue.fields?.status?.name
    },
    cycle: cycle ?? null,
    rule,
    audit: audit.slice(-20).reverse()
  };
});

async function issueForCycleAction(context) {
  ensureLicensedForWrite(context);
  const issueKey = issueKeyFromContext(context);
  if (!issueKey) throw new Error('Issue context is unavailable');
  await ensureCanEditIssue(issueKey);
  return getIssueAsUser(issueKey);
}

resolver.define('pauseCycle', async ({ context }) => {
  const issue = await issueForCycleAction(context);
  const cycle = await getCycle(issue.id);
  if (!cycle?.active) return { ok: false, error: 'No active follow-up cycle' };
  if (cycle.paused) return { ok: true };

  cycle.paused = true;
  cycle.pausedAt = new Date().toISOString();
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-paused', { issueKey: issue.key, ruleId: cycle.ruleId });
  return { ok: true };
});

resolver.define('resumeCycle', async ({ context }) => {
  const issue = await issueForCycleAction(context);
  const cycle = await getCycle(issue.id);
  if (!cycle?.active) return { ok: false, error: 'No active follow-up cycle' };

  if (cycle.paused && cycle.pausedAt) {
    const pausedMs = Date.now() - new Date(cycle.pausedAt).getTime();
    cycle.startedAt = new Date(new Date(cycle.startedAt).getTime() + pausedMs).toISOString();
  }
  cycle.paused = false;
  cycle.pausedAt = null;
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-resumed', { issueKey: issue.key, ruleId: cycle.ruleId });
  return { ok: true };
});

resolver.define('cancelCycle', async ({ context }) => {
  const issue = await issueForCycleAction(context);
  const cycle = await getCycle(issue.id);
  await deleteCycle(issue.id);
  await appendAudit(issue.id, 'cycle-cancelled', {
    issueKey: issue.key,
    ruleId: cycle?.ruleId,
    reason: 'Cancelled manually by agent'
  });
  return { ok: true };
});

resolver.define('restartCycle', async ({ context }) => {
  const issue = await issueForCycleAction(context);
  await deleteCycle(issue.id);
  const rules = await getRules();
  const cycle = await reconcileIssue(issue, rules);
  if (!cycle) return { ok: false, error: 'This issue does not currently match a follow-up rule' };
  await appendAudit(issue.id, 'cycle-restarted', { issueKey: issue.key, ruleId: cycle.ruleId });
  return { ok: true };
});

// Backup & restore covers every project's rules and cycles, so it needs a Jira (site) admin.
async function ensureJiraAdmin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  const data = await readJson(response, 'Check Jira administration permission');
  if (data?.permissions?.ADMINISTER?.havePermission !== true) {
    throw new Error('Only Jira administrators can back up or restore Follow-Up Manager.');
  }
}

resolver.define('exportBackupPage', async ({ payload }) => {
  await ensureJiraAdmin();
  return exportBackupPage(payload?.cursor || null);
});

resolver.define('importBackupBatch', async ({ payload, context }) => {
  ensureLicensedForWrite(context);
  await ensureJiraAdmin();
  return importBackupBatch(payload?.items);
});

export const handler = resolver.getDefinitions();
