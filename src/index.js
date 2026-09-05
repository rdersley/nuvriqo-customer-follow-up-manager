import { getIssue, getRequestComment, getRequestParticipants } from './jira.js';
import { cancelForCustomerReply, processCycle, reconcileIssue } from './followups.js';
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

export async function processDueFollowUps(event, context) {
  if (!licenseAllows(invocationContext(event, context))) return;

  const startedAt = new Date().toISOString();
  const [cycles, rules] = await Promise.all([getActiveCycles(), getRules()]);
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  let processed = 0;
  let actions = 0;
  let failures = 0;

  try {
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
        const result = await processCycle(cycle, rule);
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
  } finally {
    await saveSchedulerStatus({
      startedAt,
      completedAt: new Date().toISOString(),
      activeCyclesSeen: cycles.length,
      processed,
      actions,
      failures,
      status: failures > 0 ? 'completed-with-errors' : 'success'
    }).catch(() => undefined);
  }
}
