import { getIssue, addPublicCustomerComment, transitionToStatus } from './jira.js';
import { selectRule } from './rules.js';
import { appendAudit, deleteCycle, getCycle, saveCycle } from './storage.js';
import { buildTemplateContext, renderTemplate } from './templates.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function unitMs(rule) {
  return rule?.timingUnit === 'hours' ? HOUR_MS : DAY_MS;
}

export function elapsedUnits(startedAt, rule, now = new Date()) {
  return Math.floor((now.getTime() - new Date(startedAt).getTime()) / unitMs(rule));
}

export function elapsedDays(startedAt, now = new Date()) {
  return Math.floor((now.getTime() - new Date(startedAt).getTime()) / DAY_MS);
}

export async function reconcileIssue(issue, rules) {
  const existing = await getCycle(issue.id);
  const rule = selectRule(rules, issue);

  if (!rule) {
    if (existing?.active) {
      await deleteCycle(issue.id);
      await appendAudit(issue.id, 'cycle-cancelled', { issueKey: issue.key, reason: 'Issue no longer matches an enabled follow-up rule' });
    }
    return null;
  }

  if (existing?.active && existing.ruleId === rule.id) return existing;

  const cycle = {
    issueId: issue.id,
    issueKey: issue.key,
    ruleId: rule.id,
    active: true,
    paused: false,
    pausedAt: null,
    startedAt: new Date().toISOString(),
    completedReminderIndexes: []
  };
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-started', { issueKey: issue.key, ruleId: rule.id, ruleName: rule.name });
  return cycle;
}

export async function cancelForCustomerReply(issueId, issueKey) {
  const cycle = await getCycle(issueId);
  if (!cycle?.active) return false;
  await deleteCycle(issueId);
  await appendAudit(issueId, 'cycle-cancelled', { issueKey, reason: 'Customer replied' });
  return true;
}

export async function processCycle(cycle, rule, now = new Date()) {
  if (cycle.paused) return { action: 'paused' };

  const issue = await getIssue(cycle.issueKey);
  const stillMatches = selectRule([rule], issue);
  if (!stillMatches) {
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'cycle-cancelled', { issueKey: cycle.issueKey, reason: 'Issue no longer matches rule' });
    return { action: 'cancelled' };
  }

  const waitingAmount = elapsedUnits(cycle.startedAt, rule, now);
  const daysWaiting = elapsedDays(cycle.startedAt, now);
  const completed = new Set(cycle.completedReminderIndexes ?? []);

  for (let index = 0; index < (rule.reminders ?? []).length; index += 1) {
    const reminder = rule.reminders[index];
    if (!completed.has(index) && waitingAmount >= Number(reminder.afterDays)) {
      const context = buildTemplateContext(issue, cycle, {
        daysWaiting,
        waitingAmount,
        waitingUnit: rule?.timingUnit === 'hours' ? 'hours' : 'days'
      });
      const message = renderTemplate(reminder.message, context);
      await addPublicCustomerComment(cycle.issueKey, message);
      completed.add(index);
      cycle.completedReminderIndexes = [...completed].sort((a, b) => a - b);
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'reminder-sent', {
        issueKey: cycle.issueKey,
        ruleId: rule.id,
        reminderIndex: index,
        after: reminder.afterDays,
        timingUnit: rule?.timingUnit ?? 'days'
      });
      return { action: 'reminder', reminderIndex: index };
    }
  }

  if (waitingAmount >= Number(rule.finalAction.afterDays)) {
    const transition = await transitionToStatus(cycle.issueKey, rule.finalAction.destinationStatusName);
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'auto-transitioned', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      destinationStatusName: rule.finalAction.destinationStatusName,
      transitionId: transition.id,
      after: rule.finalAction.afterDays,
      timingUnit: rule?.timingUnit ?? 'days'
    });
    return { action: 'transitioned', transitionId: transition.id };
  }

  return { action: 'none' };
}
