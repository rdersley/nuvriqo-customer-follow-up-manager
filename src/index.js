import { getIssue, getRequestComment, getRequestParticipants, getStatusEnteredAt, searchIssues } from './jira.js';
import { cancelForCustomerReply, cycleStartForDiscovery, processCycle, reconcileIssue } from './followups.js';
import { getRuleConditions } from './rules.js';
import {
  appendAudit,
  deleteCycle,
  getActiveCycles,
  getCycle,
  getRules,
  saveCycle,
  saveSchedulerStatus
} from './storage.js';

function eventIssueKey(event) {
  return event?.issue?.key ?? event?.issueKey ?? null;
}

function invocationContext(event, context) {
  return context ?? event?.context ?? null;
}

function licenseAllows(context) {
  return context?.license == null || context.license.active === true;
}

function jqlQuote(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildDiscoveryJql(projectKey, waitingStatusName) {
  return `project = ${jqlQuote(projectKey)} AND status = ${jqlQuote(waitingStatusName)}`;
}

function discoveryGroups(rules) {
  const groups = new Map();
  for (const rule of rules ?? []) {
    if (!rule?.enabled || !rule.projectKey || !rule.waitingStatusName) continue;
    const key = `${rule.projectKey}\u0000${rule.waitingStatusName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        projectKey: rule.projectKey,
        waitingStatusName: rule.waitingStatusName,
        rules: []
      });
    }
    groups.get(key).rules.push(rule);
  }
  return [...groups.values()];
}

function discoveryFields(rules) {
  return [
    'project',
    'status',
    ...new Set((rules ?? []).flatMap((rule) => getRuleConditions(rule).map((condition) => condition.fieldId)))
  ];
}

export async function onIssueUpdated(event, context) {
  if (!licenseAllows(invocationContext(event, context)) || event?.selfGenerated) return;
  const issueKey = eventIssueKey(event);
  if (!issueKey) return;

  const [issue, rules] = await Promise.all([getIssue(issueKey), getRules()]);
  await reconcileIssue(issue, rules);
}

export async function onCommentCreated(event, context) {
  if (!licenseAllows(invocationContext(event, context)) || event?.selfGenerated) return;

  const issueKey = eventIssueKey(event);
  const issueId = event?.issue?.id;
  const commentId = event?.comment?.id;
  if (!issueKey || !issueId || !commentId) return;

  const [issue, requestComment, participants] = await Promise.all([
    getIssue(issueKey),
    getRequestComment(issueKey, commentId),
    getRequestParticipants(issueKey).catch(() => [])
  ]);

  if (requestComment?.public !== true) return;

  const reporterId = issue?.fields?.reporter?.accountId;
  const authorId = requestComment?.author?.accountId;
  if (!authorId) return;

  const participantIds = new Set(
    (participants ?? []).map((participant) => participant?.accountId).filter(Boolean)
  );
  const isCustomerReply = authorId === reporterId || participantIds.has(authorId);

  if (isCustomerReply) {
    await cancelForCustomerReply(issueId, issueKey);
  }
}

async function discoverMissingCycles(rules, activeIssueIds, now) {
  let checked = 0;
  let started = 0;
  let actions = 0;
  let failures = 0;

  for (const group of discoveryGroups(rules)) {
    try {
      const issues = await searchIssues(
        buildDiscoveryJql(group.projectKey, group.waitingStatusName),
        discoveryFields(group.rules)
      );

      for (const issue of issues) {
        checked += 1;
        if (!issue?.id || !issue?.key || activeIssueIds.has(issue.id)) continue;

        try {
          const statusEnteredAt = await getStatusEnteredAt(issue.key, group.waitingStatusName);
          const cycle = await reconcileIssue(issue, group.rules, {
            startedAt: cycleStartForDiscovery(issue, statusEnteredAt, now),
            source: 'scheduler-discovery'
          });
          if (!cycle?.active) continue;

          activeIssueIds.add(issue.id);
          started += 1;

          const rule = group.rules.find((item) => item.id === cycle.ruleId);
          if (!rule) continue;
          const result = await processCycle(cycle, rule, now);
          if (result?.action && result.action !== 'none' && result.action !== 'paused') actions += 1;
        } catch (error) {
          failures += 1;
          const message = error?.message || String(error);
          console.error(`Failed discovering ${issue.key}:`, error);
          await appendAudit(issue.id, 'processing-error', {
            issueKey: issue.key,
            message: `Scheduler discovery failed: ${message}`
          }).catch(() => undefined);
        }
      }
    } catch (error) {
      failures += 1;
      console.error(`Failed scheduler discovery for ${group.projectKey}/${group.waitingStatusName}:`, error);
    }
  }

  return { checked, started, actions, failures };
}

export async function processDueFollowUps(event, context) {
  if (!licenseAllows(invocationContext(event, context))) return;

  const startedAt = new Date().toISOString();
  const now = new Date();
  let cycles = [];
  let rules = [];
  let processed = 0;
  let actions = 0;
  let failures = 0;
  let discoveryChecked = 0;
  let discoveryStarted = 0;

  await saveSchedulerStatus({
    startedAt,
    completedAt: null,
    activeCyclesSeen: 0,
    discoveryChecked: 0,
    discoveryStarted: 0,
    processed: 0,
    actions: 0,
    failures: 0,
    status: 'running'
  }).catch(() => undefined);

  try {
    [cycles, rules] = await Promise.all([getActiveCycles(), getRules()]);
    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
    const activeIssueIds = new Set(cycles.map((cycle) => cycle.issueId).filter(Boolean));

    const discovery = await discoverMissingCycles(rules, activeIssueIds, now);
    discoveryChecked = discovery.checked;
    discoveryStarted = discovery.started;
    actions += discovery.actions;
    failures += discovery.failures;

    for (const cycle of cycles) {
      const rule = rulesById.get(cycle.ruleId);

      if (!rule?.enabled) {
        await deleteCycle(cycle.issueId).catch(() => undefined);
        await appendAudit(cycle.issueId, 'cycle-cancelled', {
          issueKey: cycle.issueKey,
          ruleId: cycle.ruleId,
          reason: rule ? 'Follow-up rule was disabled' : 'Follow-up rule was deleted'
        }).catch(() => undefined);
        actions += 1;
        continue;
      }

      processed += 1;
      try {
        const result = await processCycle(cycle, rule, now);
        if (result?.action && result.action !== 'none' && result.action !== 'paused') actions += 1;
        const latest = await getCycle(cycle.issueId);
        if (latest?.lastError) {
          delete latest.lastError;
          await saveCycle(latest);
        }
      } catch (error) {
        failures += 1;
        const message = error?.message || String(error);
        console.error(`Failed processing ${cycle.issueKey}:`, error);

        const latest = await getCycle(cycle.issueId).catch(() => cycle);
        if (latest) {
          latest.lastError = {
            message,
            occurredAt: new Date().toISOString()
          };
          await saveCycle(latest).catch(() => undefined);
        }

        await appendAudit(cycle.issueId, 'processing-error', {
          issueKey: cycle.issueKey,
          ruleId: cycle.ruleId,
          message
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    failures += 1;
    console.error('Follow-up scheduler failed before cycle processing completed:', error);
    throw error;
  } finally {
    await saveSchedulerStatus({
      startedAt,
      completedAt: new Date().toISOString(),
      activeCyclesSeen: cycles.length,
      discoveryChecked,
      discoveryStarted,
      processed,
      actions,
      failures,
      status: failures > 0 ? 'completed-with-errors' : 'success'
    }).catch(() => undefined);
  }
}
