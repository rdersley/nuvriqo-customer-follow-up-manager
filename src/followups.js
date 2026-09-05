import {
  addPublicCustomerComment,
  addRequestParticipants,
  getIssue,
  transitionToStatus
} from './jira.js';
import { conditionsMatchIssue, cycleStillMatchesRule, selectRule } from './rules.js';
import { appendAudit, deleteCycle, getCycle, saveCycle } from './storage.js';
import { buildTemplateContext, renderTemplate } from './templates.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function unitMs(rule) { return rule?.timingUnit === 'hours' ? HOUR_MS : DAY_MS; }
export function elapsedUnits(startedAt, rule, now = new Date()) { return Math.floor((now.getTime() - new Date(startedAt).getTime()) / unitMs(rule)); }
export function elapsedDays(startedAt, now = new Date()) { return Math.floor((now.getTime() - new Date(startedAt).getTime()) / DAY_MS); }

function rulesCheckedForIssue(rules, issue) {
  return (rules ?? []).filter((rule) => {
    if (!rule?.enabled) return false;
    if (rule.projectKey && issue?.fields?.project?.key !== rule.projectKey) return false;
    if (rule.waitingStatusName && issue?.fields?.status?.name !== rule.waitingStatusName) return false;
    return true;
  });
}

async function auditRuleChecks(issue, rules, matchedRule, actionByRule = new Map()) {
  for (const rule of rulesCheckedForIssue(rules, issue)) {
    await appendAudit(issue.id, 'rule-check', {
      issueKey: issue.key,
      ruleId: rule.id,
      ruleName: rule.name,
      filtersMatched: conditionsMatchIssue(rule, issue),
      selected: matchedRule?.id === rule.id,
      action: actionByRule.get(rule.id) ?? 'None'
    });
  }
}

export async function reconcileIssue(issue, rules) {
  const existing = await getCycle(issue.id);
  const rule = selectRule(rules, issue);
  if (!rule) {
    const actions = new Map();
    if (existing?.active) {
      const existingRule = (rules ?? []).find((item) => item.id === existing.ruleId);
      if (existingRule && cycleStillMatchesRule(existingRule, issue)) {
        await auditRuleChecks(issue, rules, null, actions);
        return existing;
      }
      await deleteCycle(issue.id);
      await appendAudit(issue.id, 'cycle-cancelled', { issueKey: issue.key, ruleId: existing.ruleId, ruleName: existingRule?.name, reason: 'Issue no longer matches an enabled follow-up rule' });
      if (existingRule?.id) actions.set(existingRule.id, 'Follow-up cancelled');
    }
    await auditRuleChecks(issue, rules, null, actions);
    return null;
  }
  if (existing?.active && existing.ruleId === rule.id) {
    await auditRuleChecks(issue, rules, rule, new Map([[rule.id, 'None - already active']]));
    return existing;
  }
  const cycle = { issueId: issue.id, issueKey: issue.key, ruleId: rule.id, active: true, paused: false, pausedAt: null, startedAt: new Date().toISOString(), completedReminderIndexes: [], reminderProgress: {}, finalActionProgress: {} };
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-started', { issueKey: issue.key, ruleId: rule.id, ruleName: rule.name });
  await auditRuleChecks(issue, rules, rule, new Map([[rule.id, 'Follow-up started']]));
  return cycle;
}

export async function cancelForCustomerReply(issueId, issueKey) {
  const cycle = await getCycle(issueId);
  if (!cycle?.active) return false;
  await deleteCycle(issueId);
  await appendAudit(issueId, 'cycle-cancelled', { issueKey, ruleId: cycle.ruleId, reason: 'Customer replied' });
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
    await appendAudit(cycle.issueId, 'participants-added', { issueKey: cycle.issueKey, ruleId: rule.id, ruleName: rule.name, reminderIndex: index, participantCount: reminder.participantAccountIds.length });
  } else if (!progress.participantsAdded) progress.participantsAdded = true;

  if (!progress.commentSent) {
    await addPublicCustomerComment(cycle.issueKey, renderTemplate(reminder.message, context));
    progress.commentSent = true;
    cycle.reminderProgress[index] = progress;
    await saveCycle(cycle);
    await appendAudit(cycle.issueId, 'reminder-comment-sent', { issueKey: cycle.issueKey, ruleId: rule.id, ruleName: rule.name, reminderIndex: index });
  }

  if (!progress.statusChanged && reminder.destinationStatusName) {
    const transition = await transitionToStatus(cycle.issueKey, reminder.destinationStatusName);
    progress.statusChanged = true;
    cycle.reminderProgress[index] = progress;
    await saveCycle(cycle);
    await appendAudit(cycle.issueId, 'reminder-transitioned', { issueKey: cycle.issueKey, ruleId: rule.id, ruleName: rule.name, reminderIndex: index, destinationStatusName: reminder.destinationStatusName, transitionId: transition.id });
  } else if (!progress.statusChanged) progress.statusChanged = true;

  cycle.reminderProgress[index] = progress;
  return progress;
}

export async function processCycle(cycle, rule, now = new Date()) {
  if (cycle.paused) return { action: 'paused' };
  const issue = await getIssue(cycle.issueKey);
  if (!cycleStillMatchesRule(rule, issue)) {
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'cycle-cancelled', { issueKey: cycle.issueKey, ruleId: rule.id, ruleName: rule.name, filtersMatched: conditionsMatchIssue(rule, issue), reason: 'Issue no longer matches rule or configured reminder statuses' });
    return { action: 'cancelled' };
  }

  const waitingAmount = elapsedUnits(cycle.startedAt, rule, now);
  const daysWaiting = elapsedDays(cycle.startedAt, now);
  const completed = new Set(cycle.completedReminderIndexes ?? []);
  for (let index = 0; index < (rule.reminders ?? []).length; index += 1) {
    const reminder = rule.reminders[index];
    if (!completed.has(index) && waitingAmount >= Number(reminder.afterDays)) {
      const context = buildTemplateContext(issue, cycle, { daysWaiting, waitingAmount, waitingUnit: rule?.timingUnit === 'hours' ? 'hours' : 'days' });
      const progress = await processReminderActions(cycle, rule, issue, reminder, index, context);
      completed.add(index);
      cycle.completedReminderIndexes = [...completed].sort((a, b) => a - b);
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'reminder-completed', {
        issueKey: cycle.issueKey,
        ruleId: rule.id,
        ruleName: rule.name,
        reminderIndex: index,
        destinationStatusName: reminder.destinationStatusName ?? '',
        filtersMatched: true,
        commentSent: progress.commentSent === true,
        statusChanged: progress.statusChanged === true,
        participantCount: (reminder.participantAccountIds ?? []).length,
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
      const context = buildTemplateContext(issue, cycle, { daysWaiting, waitingAmount, waitingUnit: rule?.timingUnit === 'hours' ? 'hours' : 'days' });
      await addPublicCustomerComment(cycle.issueKey, renderTemplate(finalMessage, context));
      finalProgress.commentSent = true;
      cycle.finalActionProgress = finalProgress;
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'final-comment-sent', { issueKey: cycle.issueKey, ruleId: rule.id, ruleName: rule.name });
    }

    const transitionFields = {};
    if (rule.finalAction.resolutionId) transitionFields.resolution = { id: rule.finalAction.resolutionId };
    else if (rule.finalAction.resolutionName) transitionFields.resolution = { name: rule.finalAction.resolutionName };
    Object.assign(transitionFields, rule.finalAction.fields ?? {});
    const transition = await transitionToStatus(cycle.issueKey, rule.finalAction.destinationStatusName, transitionFields);
    await deleteCycle(cycle.issueId);
    await appendAudit(cycle.issueId, 'auto-transitioned', {
      issueKey: cycle.issueKey,
      ruleId: rule.id,
      ruleName: rule.name,
      destinationStatusName: rule.finalAction.destinationStatusName,
      transitionId: transition.id,
      resolutionId: rule.finalAction.resolutionId ?? null,
      resolutionName: rule.finalAction.resolutionName ?? null,
      finalCommentSent: finalProgress.commentSent === true,
      statusChanged: true,
      filtersMatched: true,
      after: rule.finalAction.afterDays,
      timingUnit: rule?.timingUnit ?? 'days'
    });
    return { action: 'transitioned', transitionId: transition.id };
  }
  return { action: 'none' };
}
