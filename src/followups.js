import {
  addPublicCustomerComment,
  addRequestParticipants,
  getIssue,
  transitionToStatus
} from './jira.js';
import { cycleStillMatchesRule, selectRule } from './rules.js';
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
      const existingRule = (rules ?? []).find((item) => item.id === existing.ruleId);
      if (existingRule && cycleStillMatchesRule(existingRule, issue)) return existing;
      await deleteCycle(issue.id);
      await appendAudit(issue.id, 'cycle-cancelled', {
        issueKey: issue.key,
        reason: 'Issue no longer matches an enabled follow-up rule'
      });
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
    completedReminderIndexes: [],
    reminderProgress: {},
    finalActionProgress: {}
  };
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-started', {
    issueKey: issue.key,
    ruleId: rule.id,
    ruleName: rule.name
  });
  return cycle;
}

export async function cancelForCustomerReply(issueId, issueKey) {
  const cycle = await getCycle(issueId);
  if (!cycle?.active) return false;
  await deleteCycle(issueId);
  await appendAudit(issueId, 'cycle-cancelled', { issueKey, reason: 'Customer replied' });
  return true;
}

async function processReminderActions(cycle, rule, issue, reminder, index, context) {
  cycle.reminderProgress ??= {};
  const progress = cycle.reminderProgress[index] ?? {};

  if (!progress.participantsAdded && (reminder.participantAccountIds ?? []).length) {
    await addRequestParticipants(cycle.issueKey, reminder.participantAccountIds);
    progress.participantsAdded = true;
    cycle.reminderProgress[index] = progress;
    await saveCycle(cycle);
    await appendAudit(cycle.issueId, 'participants-added', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      reminderIndex: index,
      participantCount: reminder.participantAccountIds.length
    });
  } else if (!progress.participantsAdded) {
    progress.participantsAdded = true;
  }

  if (!progress.commentSent) {
    const message = renderTemplate(reminder.message, context);
    await addPublicCustomerComment(cycle.issueKey, message);
    progress.commentSent = true;
    cycle.reminderProgress[index] = progress;
    await saveCycle(cycle);
    await appendAudit(cycle.issueId, 'reminder-comment-sent', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      reminderIndex: index
    });
  }

  if (!progress.statusChanged && reminder.destinationStatusName) {
    const transition = await transitionToStatus(cycle.issueKey, reminder.destinationStatusName);
    progress.statusChanged = true;
    cycle.reminderProgress[index] = progress;
    await saveCycle(cycle);
    await appendAudit(cycle.issueId, 'reminder-transitioned', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      reminderIndex: index,
      destinationStatusName: reminder.destinationStatusName,
      transitionId: transition.id
    });
  } else if (!progress.statusChanged) {
    progress.statusChanged = true;
  }

  cycle.reminderProgress[index] = progress;
  return progress;
}

export async function processCycle(cycle, rule, now = new Date()) {
  if (cycle.paused) return { action: 'paused' };

  const issue = await getIssue(cycle.issueKey);
  if (!cycleStillMatchesRule(rule, issue)) {
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'cycle-cancelled', {
      issueKey: cycle.issueKey,
      reason: 'Issue no longer matches rule or configured reminder statuses'
    });
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
      await processReminderActions(cycle, rule, issue, reminder, index, context);
      completed.add(index);
      cycle.completedReminderIndexes = [...completed].sort((a, b) => a - b);
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'reminder-completed', {
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
    cycle.finalActionProgress ??= {};
    const finalProgress = cycle.finalActionProgress;
    const finalMessage = String(rule?.finalAction?.message ?? '').trim();

    if (finalMessage && !finalProgress.commentSent) {
      const context = buildTemplateContext(issue, cycle, {
        daysWaiting,
        waitingAmount,
        waitingUnit: rule?.timingUnit === 'hours' ? 'hours' : 'days'
      });
      await addPublicCustomerComment(cycle.issueKey, renderTemplate(finalMessage, context));
      finalProgress.commentSent = true;
      cycle.finalActionProgress = finalProgress;
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'final-comment-sent', {
        issueKey: cycle.issueKey,
        ruleId: rule.id
      });
    }

    const transitionFields = {};
    if (rule.finalAction.resolutionId) {
      transitionFields.resolution = { id: rule.finalAction.resolutionId };
    } else if (rule.finalAction.resolutionName) {
      transitionFields.resolution = { name: rule.finalAction.resolutionName };
    }
    Object.assign(transitionFields, rule.finalAction.fields ?? {});

    const transition = await transitionToStatus(
      cycle.issueKey,
      rule.finalAction.destinationStatusName,
      transitionFields
    );
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'auto-transitioned', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      destinationStatusName: rule.finalAction.destinationStatusName,
      transitionId: transition.id,
      resolutionId: rule.finalAction.resolutionId ?? null,
      after: rule.finalAction.afterDays,
      timingUnit: rule?.timingUnit ?? 'days'
    });
    return { action: 'transitioned', transitionId: transition.id };
  }

  return { action: 'none' };
}
