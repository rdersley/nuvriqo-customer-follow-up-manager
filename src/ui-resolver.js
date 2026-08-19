import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { getIssue } from './jira.js';
import { reconcileIssue } from './followups.js';
import {
  appendAudit,
  deleteCycle,
  deleteRule,
  getAudit,
  getCycle,
  getRules,
  saveCycle,
  saveRule
} from './storage.js';
import { validateRule } from './rules.js';

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

resolver.define('getProjectSetup', async ({ context }) => {
  const projectKey = projectKeyFromContext(context);
  if (!projectKey) throw new Error('Project context is unavailable');

  const [fieldsResponse, statusesResponse, rules] = await Promise.all([
    api.asApp().requestJira(route`/rest/api/3/field`),
    api.asApp().requestJira(route`/rest/api/3/project/${projectKey}/statuses`),
    getRules()
  ]);

  const fields = await readJson(fieldsResponse, 'Load Jira fields');
  const statusGroups = await readJson(statusesResponse, 'Load project statuses');
  const statusMap = new Map();
  for (const issueType of statusGroups ?? []) {
    for (const status of issueType.statuses ?? []) {
      statusMap.set(status.id, { id: status.id, name: status.name });
    }
  }

  return {
    projectKey,
    fields: (fields ?? [])
      .filter((field) => field?.id && field?.name)
      .map((field) => ({ id: field.id, name: field.name, custom: Boolean(field.custom) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    statuses: [...statusMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    rules: rules.filter((rule) => rule.projectKey === projectKey)
  };
});

resolver.define('saveRule', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context);
  const rule = { ...payload.rule, projectKey };
  const errors = validateRule(rule);
  if (errors.length) return { ok: false, errors };
  await saveRule(rule);
  return { ok: true, rule };
});

resolver.define('deleteRule', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context);
  const rules = await getRules();
  const rule = rules.find((item) => item.id === payload.ruleId);
  if (!rule || rule.projectKey !== projectKey) throw new Error('Rule not found in this project');
  await deleteRule(payload.ruleId);
  return { ok: true };
});

resolver.define('getIssuePanel', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  if (!issueKey) throw new Error('Issue context is unavailable');
  const issue = await getIssue(issueKey);
  const [cycle, audit, rules] = await Promise.all([getCycle(issue.id), getAudit(issue.id), getRules()]);
  const rule = cycle ? rules.find((item) => item.id === cycle.ruleId) ?? null : null;
  return {
    issue: { id: issue.id, key: issue.key, summary: issue.fields?.summary, status: issue.fields?.status?.name },
    cycle: cycle ?? null,
    rule,
    audit: audit.slice(-20).reverse()
  };
});

resolver.define('pauseCycle', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  const issue = await getIssue(issueKey);
  const cycle = await getCycle(issue.id);
  if (!cycle?.active) return { ok: false, error: 'No active follow-up cycle' };
  if (cycle.paused) return { ok: true };
  cycle.paused = true;
  cycle.pausedAt = new Date().toISOString();
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-paused', { issueKey });
  return { ok: true };
});

resolver.define('resumeCycle', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  const issue = await getIssue(issueKey);
  const cycle = await getCycle(issue.id);
  if (!cycle?.active) return { ok: false, error: 'No active follow-up cycle' };
  if (cycle.paused && cycle.pausedAt) {
    const pausedMs = Date.now() - new Date(cycle.pausedAt).getTime();
    cycle.startedAt = new Date(new Date(cycle.startedAt).getTime() + pausedMs).toISOString();
  }
  cycle.paused = false;
  cycle.pausedAt = null;
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-resumed', { issueKey });
  return { ok: true };
});

resolver.define('cancelCycle', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  const issue = await getIssue(issueKey);
  await deleteCycle(issue.id);
  await appendAudit(issue.id, 'cycle-cancelled', { issueKey, reason: 'Cancelled manually by agent' });
  return { ok: true };
});

resolver.define('restartCycle', async ({ context }) => {
  const issueKey = issueKeyFromContext(context);
  const issue = await getIssue(issueKey);
  await deleteCycle(issue.id);
  const rules = await getRules();
  const cycle = await reconcileIssue(issue, rules);
  if (!cycle) return { ok: false, error: 'This issue does not currently match a follow-up rule' };
  await appendAudit(issue.id, 'cycle-restarted', { issueKey, ruleId: cycle.ruleId });
  return { ok: true };
});

export const handler = resolver.getDefinitions();
