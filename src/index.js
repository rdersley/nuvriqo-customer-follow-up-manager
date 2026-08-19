import { getIssue } from './jira.js';
import { cancelForCustomerReply, processCycle, reconcileIssue } from './followups.js';
import { getActiveCycles, getRules } from './storage.js';

function eventIssueKey(event) {
  return event?.issue?.key ?? event?.issueKey ?? null;
}

function isPublicCustomerComment(event) {
  const comment = event?.comment;
  if (!comment) return false;

  const isPublic = comment?.jsdPublic === true || comment?.properties?.some?.(
    (property) => property?.key === 'sd.public.comment' && property?.value?.internal === false
  );
  const authorType = comment?.author?.accountType;

  // JSM customer authors are normally Atlassian users too, so event payloads alone
  // are not always enough to distinguish an agent from a customer. V1 only cancels
  // automatically when the event explicitly identifies a public customer comment.
  return isPublic && (authorType === 'customer' || event?.isCustomer === true);
}

export async function onIssueUpdated(event) {
  const issueKey = eventIssueKey(event);
  if (!issueKey) return;

  const [issue, rules] = await Promise.all([getIssue(issueKey), getRules()]);
  await reconcileIssue(issue, rules);
}

export async function onCommentCreated(event) {
  const issueKey = eventIssueKey(event);
  const issueId = event?.issue?.id;
  if (!issueKey || !issueId) return;

  if (isPublicCustomerComment(event)) {
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
