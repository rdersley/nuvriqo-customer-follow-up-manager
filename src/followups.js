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

export function cycleStartForDiscovery(issue, statusEnteredAt, now = new Date()) {
  if (statusEnteredAt && Number.isFinite(new Date(statusEnteredAt).getTime())) return statusEnteredAt;
  return now.toISOString();
}

export function nextDueAtForCycle(cycle, rule) {
  if (!cycle?.startedAt || !rule) return null;
  const started = new Date(cycle.startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  const completed = new Set(cycle.completedReminderIndexes ?? []);

  for (let index = 0; index < (rule.reminders ?? []).length; index += 1) {
    if (completed.has(index)) continue;
    const amount = Number(rule.reminders[index]?.afterDays);
    if (Number.isFinite(amount)) return new Date(started + amount * unitMs(rule)).toISOString();
  }

  if (rule?.finalAction?.enabled === false) {
    if (cycle?.nextRepeatAt) return cycle.nextRepeatAt;
    const reminders = rule.reminders ?? [];
    const lastAmount = Number(reminders.at(-1)?.afterDays);
    const repeatEvery = Number(rule?.repeatEvery ?? lastAmount);
    if (!Number.isFinite(lastAmount) || !Number.isFinite(repeatEvery) || repeatEvery <= 0) return null;
    return new Date(started + (lastAmount + repeatEvery) * unitMs(rule)).toISOString();
  }

  const finalAmount = Number(rule?.finalAction?.afterDays);
  return Number.isFinite(finalAmount)
    ? new Date(started + finalAmount * unitMs(rule)).toISOString()
    : null;
}

function rulesCheckedForIssue(rules, issue) {
  return (rules ?? []).filter((rule) => {
    if (!rule?.enabled) return false;
    if (rule.projectKey && issue?.fields?.project?.key !== rule.projectKey) return false;
    if (rule.waitingStatusName && issue?.fields?.status?.name !== rule.waitingStatusName) return false;
    return true;
  });
}

async function auditRuleChecks(issue, rules, matchedRule, actionByRule = new Map(), options = {}) {
  const checked = rulesCheckedForIssue(rules, issue);
  for (const rule of checked) {
    const action = actionByRule.get(rule.id) ?? 'None';
    const meaningful = action !== 'None' && !action.startsWith('None -');
    if (!meaningful && options.includeNoAction !== true) continue;
    await appendAudit(issue.id, 'rule-check', {
      issueKey: issue.key,
      ruleId: rule.id,
      ruleName: rule.name,
      filtersMatched: conditionsMatchIssue(rule, issue),
      selected: matchedRule?.id === rule.id,
      action
    });
  }
}

export async function reconcileIssue(issue, rules, options = {}) {
  const existing = await getCycle(issue.id);
  const rule = selectRule(rules, issue);
  const includeNoAction = options.source === 'scheduler-discovery';

  if (!rule) {
    const actions = new Map();
    if (existing?.active) {
      const existingRule = (rules ?? []).find((item) => item.id === existing.ruleId);
      if (existingRule && cycleStillMatchesRule(existingRule, issue)) {
        return existing;
      }
      await deleteCycle(issue.id, existing);
      await appendAudit(issue.id, 'cycle-cancelled', { issueKey: issue.key, ruleId: existing.ruleId, ruleName: existingRule?.name, reason: 'Issue no longer matches an enabled follow-up rule' });
      if (existingRule?.id) actions.set(existingRule.id, 'Follow-up cancelled');
    }
    await auditRuleChecks(issue, rules, null, actions, { includeNoAction });
    return null;
  }
  if (existing?.active && existing.ruleId === rule.id) {
    return existing;
  }
  const cycle = {
    issueId: issue.id,
    issueKey: issue.key,
    ruleId: rule.id,
    active: true,
    paused: false,
    pausedAt: null,
    startedAt: options.startedAt ?? new Date().toISOString(),
    completedReminderIndexes: [],
    reminderProgress: {},
    finalActionProgress: {}
  };
  cycle.nextDueAt = nextDueAtForCycle(cycle, rule);
  await saveCycle(cycle);
  await appendAudit(issue.id, 'cycle-started', { issueKey: issue.key, ruleId: rule.id, ruleName: rule.name, startedAt: cycle.startedAt, nextDueAt: cycle.nextDueAt, source: options.source ?? 'issue-update' });
  await auditRuleChecks(issue, rules, rule, new Map([[rule.id, 'Follow-up started']]), { includeNoAction: true });
  return cycle;
}

export async function cancelForCustomerReply(issueId, issueKey, rules = []) {
  const cycle = await getCycle(issueId);
  if (!cycle?.active) return false;
  const rule = (rules ?? []).find((item) => item.id === cycle.ruleId);
  if (rule?.finalAction?.enabled === false) {
    await appendAudit(issueId, 'customer-replied', {
      issueKey,
      ruleId: cycle.ruleId,
      ruleName: rule.name,
      reason: 'Recurring follow-up remains active until the rule filters no longer match'
    });
    return false;
  }
  await deleteCycle(issueId, cycle);
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

export function isEmptyJiraFieldValue(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return true;
    if ('value' in value) return value.value == null || value.value === '';
  }
  return false;
}

function jiraFieldComparableText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(jiraFieldComparableText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (value.value != null) return String(value.value);
    if (value.name != null) return String(value.name);
    if (value.displayName != null) return String(value.displayName);
    return JSON.stringify(value);
  }
  return String(value);
}

export function transitionFieldsForIssue(rule, issue) {
  const configured = rule?.finalAction?.fields ?? {};
  const modes = rule?.finalAction?.fieldUpdateModes ?? {};
  const matches = rule?.finalAction?.fieldMatchValues ?? {};
  return Object.fromEntries(Object.entries(configured).filter(([fieldId]) => {
    const mode = modes[fieldId] ?? 'always';
    const current = issue?.fields?.[fieldId];
    if (mode === 'ifEmpty') return isEmptyJiraFieldValue(current);
    if (mode === 'ifEquals') return jiraFieldComparableText(current).trim().toLocaleLowerCase() === String(matches[fieldId] ?? '').trim().toLocaleLowerCase();
    if (mode === 'ifContains') return jiraFieldComparableText(current).toLocaleLowerCase().includes(String(matches[fieldId] ?? '').trim().toLocaleLowerCase());
    return true;
  }));
}

export async function processCycle(cycle, rule, now = new Date()) {
  if (cycle.paused) return { action: 'paused' };
  const issue = await getIssue(cycle.issueKey);
  if (!cycleStillMatchesRule(rule, issue)) {
    await deleteCycle(cycle.issueId, cycle);
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
      cycle.nextDueAt = nextDueAtForCycle(cycle, rule);
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
        timingUnit: rule?.timingUnit ?? 'days',
        nextDueAt: cycle.nextDueAt
      });
      return { action: 'reminder', reminderIndex: index };
    }
  }

  if (rule?.finalAction?.enabled === false) {
    const repeatEvery = Number(rule?.repeatEvery ?? rule?.reminders?.at(-1)?.afterDays);
    const lastReminder = rule?.reminders?.at(-1);
    if (!lastReminder || !Number.isFinite(repeatEvery) || repeatEvery <= 0) {
      cycle.nextDueAt = null;
      await saveCycle(cycle);
      return { action: 'none' };
    }

    const firstRepeatDue = new Date(
      new Date(cycle.startedAt).getTime() +
      (Number(lastReminder.afterDays) + repeatEvery) * unitMs(rule)
    );
    const repeatDueAt = cycle.nextRepeatAt ? new Date(cycle.nextRepeatAt) : firstRepeatDue;
    if (now.getTime() >= repeatDueAt.getTime()) {
      const context = buildTemplateContext(issue, cycle, {
        daysWaiting,
        waitingAmount,
        waitingUnit: rule?.timingUnit === 'hours' ? 'hours' : 'days'
      });
      await addPublicCustomerComment(cycle.issueKey, renderTemplate(lastReminder.message, context));
      if ((lastReminder.participantAccountIds ?? []).length) {
        await addRequestParticipants(cycle.issueKey, lastReminder.participantAccountIds);
      }
      if (lastReminder.destinationStatusName) {
        await transitionToStatus(cycle.issueKey, lastReminder.destinationStatusName);
      }
      cycle.repeatCount = Number(cycle.repeatCount ?? 0) + 1;
      cycle.nextRepeatAt = new Date(now.getTime() + repeatEvery * unitMs(rule)).toISOString();
      cycle.nextDueAt = cycle.nextRepeatAt;
      await saveCycle(cycle);
      await appendAudit(cycle.issueId, 'reminder-repeated', {
        issueKey: cycle.issueKey,
        ruleId: rule.id,
        ruleName: rule.name,
        repeatCount: cycle.repeatCount,
        repeatEvery,
        timingUnit: rule?.timingUnit ?? 'days',
        nextDueAt: cycle.nextDueAt,
        filtersMatched: true
      });
      return { action: 'reminder-repeated', repeatCount: cycle.repeatCount };
    }

    cycle.nextRepeatAt = repeatDueAt.toISOString();
    cycle.nextDueAt = cycle.nextRepeatAt;
    await saveCycle(cycle);
    return { action: 'none' };
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
    Object.assign(transitionFields, transitionFieldsForIssue(rule, issue));
    let transition;
    try {
      transition = await transitionToStatus(cycle.issueKey, rule.finalAction.destinationStatusName, transitionFields, issue?.fields ?? {});
    } catch (error) {
      error.transitionDiagnostics = {
        currentStatusName: issue?.fields?.status?.name ?? '',
        destinationStatusName: rule.finalAction.destinationStatusName,
        configuredFieldIds: Object.keys(transitionFields),
        ...(error.transitionDiagnostics ?? {})
      };
      throw error;
    }
    await deleteCycle(cycle.issueId, cycle);
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

  cycle.nextDueAt = nextDueAtForCycle(cycle, rule);
  await saveCycle(cycle);
  return { action: 'none' };
}
