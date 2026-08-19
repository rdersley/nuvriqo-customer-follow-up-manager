import { getIssue, getRequestComment } from './jira.js';
import { cancelForCustomerReply, processCycle, reconcileIssue } from './followups.js';
import { getActiveCycles, getRules } from './storage.js';

function eventIssueKey(event) {
  return event?.issue?.key ?? event?.issueKey ?? null;
}

export async function onIssueUpdated(event) {
  if (event?.selfGenerated) return;
  const issueKey = eventIssueKey(event);
  if (!issueKey) return;

  const [issue, rules] = await Promise.all([getIssue(issueKey), getRules()]);
  await reconcileIssue(issue, rules);
}

export async function onCommentCreated(event) {
  if (event?.selfGenerated) return;

  const issueKey = eventIssueKey(event);
  const issueId = event?.issue?.id;
  const commentId = event?.comment?.id;
  if (!issueKey || !issueId || !commentId) return;

  // Read the JSM comment so visibility is authoritative. For V1 a public reply
  // from the reporter cancels the sequence. Request-participant detection is
  // intentionally kept as a follow-on enhancement rather than guessing from
  // Jira's generic comment event payload.
  const [issue, requestComment] = await Promise.all([
    getIssue(issueKey),
    getRequestComment(issueKey, commentId)
  ]);

  const reporterId = issue?.fields?.reporter?.accountId;
  const authorId = requestComment?.author?.accountId;
  if (requestComment?.public === true && reporterId && authorId === reporterId) {
    await cancelForCustomerReply(issueId, issueKey);
  }
}

export async function processDueFollowUps() {
  const [cycles, rules] = await Promise.all([getActiveCycles(), getRules()]);
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

  for (const cycle of cycles) {
    const rule = rulesById.get(cycle.ruleId);
    if (!rule?.enabled) continue;
    try {
      await processCycle(cycle, rule);
    } catch (error) {
      console.error(`Failed processing ${cycle.issueKey}:`, error);
    }
  }
}
