import { getIssue, getRequestComment, getRequestParticipants, getStatusEnteredAt, searchIssues } from './jira.js';
import { cancelForCustomerReply, cycleStartForDiscovery, nextDueAtForCycle, processCycle, reconcileIssue } from './followups.js';
import { triggerLicenseAllows } from './license.js';
import { getRuleConditions, selectRule } from './rules.js';
import {
  appendAudit,
  deleteCycle,
  dueIndexMigrated,
  getActiveCycles,
  getCycle,
  getCycleRefs,
  getDiscoveryState,
  getDueCycleRefs,
  getRules,
  replaceDueIndex,
  recoverLegacyFailedCycles,
  saveCycle,
  saveDiscoveryState,
  saveSchedulerStatus
} from './storage.js';

function eventIssueKey(event) {
  return event?.issue?.key ?? event?.issueKey ?? null;
}

function invocationContext(event, context) {
  return context ?? event?.context ?? null;
}

// Licensing for these triggers is enforced by `filter.appIsLicensed` in
// manifest.yml; see src/license.js for why and for the in-code fallback.
function licenseAllows(context) {
  return triggerLicenseAllows(context);
}

function jqlQuote(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildDiscoveryJql(projectKey, waitingStatusName, updatedWithinMinutes = null) {
  const clauses = [`project = ${jqlQuote(projectKey)}`];
  if (waitingStatusName) clauses.push(`status = ${jqlQuote(waitingStatusName)}`);
  if (Number.isFinite(updatedWithinMinutes)) clauses.push(`updated >= -${Math.ceil(updatedWithinMinutes)}m`);
  return clauses.join(' AND ');
}

const FULL_DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_OVERLAP_MINUTES = 15;

// Only the parts of a rule that decide which tickets it matches. Editing reminder
// text or timings must not force a full rescan.
export function discoveryFingerprint(rules) {
  return JSON.stringify((rules ?? [])
    .filter((rule) => rule?.enabled && rule.projectKey)
    .map((rule) => [rule.id, rule.priority ?? 100, rule.projectKey, rule.waitingStatusName ?? '', getRuleConditions(rule)]));
}

// The issue-updated trigger starts cycles as tickets change, so hourly discovery is a
// safety net. A full project scan runs when the matching rules change, after a gap in
// scheduler runs, or once a day; otherwise only recently updated tickets are searched
// (covering the app's own updates, which the trigger ignores, and missed events).
export function planDiscovery(state, fingerprint, now = new Date()) {
  const nowMs = now.getTime();
  const lastFull = new Date(state?.lastFullScanAt ?? NaN).getTime();
  const lastRun = new Date(state?.lastRunAt ?? NaN).getTime();
  const full = state?.fingerprint !== fingerprint
    || !Number.isFinite(lastFull) || nowMs - lastFull >= FULL_DISCOVERY_INTERVAL_MS
    || !Number.isFinite(lastRun) || nowMs - lastRun >= FULL_DISCOVERY_INTERVAL_MS;
  if (full) return { full: true, updatedWithinMinutes: null };
  return { full: false, updatedWithinMinutes: Math.ceil((nowMs - lastRun) / 60000) + DISCOVERY_OVERLAP_MINUTES };
}

// Issue events fire for every ticket on the site; skip Jira calls when no enabled
// rule could apply to the event's project.
export function rulesMayApplyToProject(rules, projectKey) {
  return (rules ?? []).some((rule) => rule?.enabled && (!rule.projectKey || !projectKey || rule.projectKey === projectKey));
}

function discoveryGroups(rules) {
  const groups = new Map();
  for (const rule of rules ?? []) {
    if (!rule?.enabled || !rule.projectKey) continue;
    const key = `${rule.projectKey}\u0000${rule.waitingStatusName ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        projectKey: rule.projectKey,
        waitingStatusName: rule.waitingStatusName ?? '',
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

  const rules = await getRules();
  if (!rulesMayApplyToProject(rules, event?.issue?.fields?.project?.key)) return;
  const issue = await getIssue(issueKey);
  await reconcileIssue(issue, rules);
}

export async function onCommentCreated(event, context) {
  if (!licenseAllows(invocationContext(event, context)) || event?.selfGenerated) return;

  const issueKey = eventIssueKey(event);
  const issueId = event?.issue?.id;
  const commentId = event?.comment?.id;
  if (!issueKey || !issueId || !commentId) return;

  // Only a ticket with an active cycle can be affected by a customer reply.
  const cycle = await getCycle(issueId);
  if (!cycle?.active) return;

  const [issue, requestComment, participants, rules] = await Promise.all([
    getIssue(issueKey),
    getRequestComment(issueKey, commentId),
    getRequestParticipants(issueKey).catch(() => []),
    getRules()
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
    await cancelForCustomerReply(issueId, issueKey, rules);
  }
}

async function discoverMissingCycles(rules, activeIssueIds, now, updatedWithinMinutes = null) {
  let checked = 0;
  let started = 0;
  let actions = 0;
  let failures = 0;

  for (const group of discoveryGroups(rules)) {
    try {
      const issues = await searchIssues(
        buildDiscoveryJql(group.projectKey, group.waitingStatusName, updatedWithinMinutes),
        discoveryFields(group.rules)
      );

      for (const issue of issues) {
        checked += 1;
        if (!issue?.id || !issue?.key || activeIssueIds.has(issue.id)) continue;
        // Search results already carry the rule fields; don't fetch changelogs or
        // cycles for tickets no rule matches.
        if (!selectRule(group.rules, issue)) continue;

        try {
          const statusEnteredAt = group.waitingStatusName
            ? await getStatusEnteredAt(issue.key, group.waitingStatusName)
            : null;
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

async function ensureDueIndex(rules) {
  if (await dueIndexMigrated()) return;

  const cycles = await getActiveCycles();
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  for (const cycle of cycles) {
    const rule = rulesById.get(cycle.ruleId);
    if (rule) cycle.nextDueAt = nextDueAtForCycle(cycle, rule);
  }
  await replaceDueIndex(cycles);
}

export async function processDueFollowUps(event, context) {
  if (!licenseAllows(invocationContext(event, context))) return;

  const startedAt = new Date().toISOString();
  const now = new Date();
  let activeRefs = [];
  let processed = 0;
  let actions = 0;
  let failures = 0;
  let discoveryChecked = 0;
  let discoveryStarted = 0;
  let discoveryMode = null;

  await saveSchedulerStatus({
    startedAt,
    completedAt: null,
    activeCyclesSeen: 0,
    dueCyclesSeen: 0,
    discoveryChecked: 0,
    discoveryStarted: 0,
    processed: 0,
    actions: 0,
    failures: 0,
    status: 'running'
  }).catch(() => undefined);

  try {
    const rules = await getRules();
    await ensureDueIndex(rules);
    // One-time repair for cycles that failed before automatic retry scheduling existed.
    await recoverLegacyFailedCycles(new Date().toISOString());

    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
    activeRefs = await getCycleRefs();
    const activeIssueIds = new Set(activeRefs.map((ref) => ref.issueId).filter(Boolean));

    // Clean up cycles whose rules were disabled/deleted using the compact index.
    for (const ref of activeRefs) {
      const rule = rulesById.get(ref.ruleId);
      if (rule?.enabled) continue;
      const cycle = await getCycle(ref.issueId).catch(() => null);
      if (!cycle) continue;
      await deleteCycle(cycle.issueId, cycle).catch(() => undefined);
      await appendAudit(cycle.issueId, 'cycle-cancelled', {
        issueKey: cycle.issueKey,
        ruleId: cycle.ruleId,
        reason: rule ? 'Follow-up rule was disabled' : 'Follow-up rule was deleted'
      }).catch(() => undefined);
      activeIssueIds.delete(cycle.issueId);
      actions += 1;
    }

    const fingerprint = discoveryFingerprint(rules);
    const discoveryState = await getDiscoveryState().catch(() => null);
    const plan = planDiscovery(discoveryState, fingerprint, now);
    discoveryMode = plan.full ? 'full' : 'recent';
    const discovery = await discoverMissingCycles(rules, activeIssueIds, now, plan.updatedWithinMinutes);
    if (discovery.failures === 0) {
      await saveDiscoveryState({
        fingerprint,
        lastRunAt: startedAt,
        lastFullScanAt: plan.full ? startedAt : discoveryState?.lastFullScanAt
      }).catch(() => undefined);
    }
    discoveryChecked = discovery.checked;
    discoveryStarted = discovery.started;
    actions += discovery.actions;
    failures += discovery.failures;

    const dueRefs = await getDueCycleRefs(now);
    for (const ref of dueRefs) {
      const rule = rulesById.get(ref.ruleId);
      if (!rule?.enabled) continue;

      const cycle = await getCycle(ref.issueId);
      if (!cycle?.active) continue;

      processed += 1;
      try {
        const result = await processCycle(cycle, rule, now);
        if (result?.action && result.action !== 'none' && result.action !== 'paused') actions += 1;
        if (cycle.lastError) {
          delete cycle.lastError;
          await saveCycle(cycle);
        }
      } catch (error) {
        failures += 1;
        const message = error?.message || String(error);
        console.error(`Failed processing ${cycle.issueKey}:`, error);

        const retryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        cycle.lastError = {
          message,
          occurredAt: new Date().toISOString(),
          retryAt
        };
        // A failed action must remain due. processCycle may have advanced nextDueAt
        // before the Jira action threw, which otherwise strands the cycle forever.
        cycle.nextDueAt = retryAt;
        await saveCycle(cycle).catch(() => undefined);

        const diagnostics = error?.transitionDiagnostics ?? {};
        await appendAudit(cycle.issueId, 'processing-error', {
          issueKey: cycle.issueKey,
          ruleId: cycle.ruleId,
          ruleName: rule?.name,
          message,
          currentStatusName: diagnostics.currentStatusName,
          destinationStatusName: diagnostics.destinationStatusName ?? rule?.finalAction?.destinationStatusName,
          failureStage: diagnostics.stage,
          transitionId: diagnostics.transitionId,
          transitionName: diagnostics.transitionName,
          httpStatus: diagnostics.httpStatus,
          missingRequiredFields: diagnostics.missingRequiredFields,
          availableDestinations: diagnostics.availableDestinations,
          configuredFieldIds: diagnostics.configuredFieldIds
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    failures += 1;
    console.error('Follow-up scheduler failed before cycle processing completed:', error);
    throw error;
  } finally {
    const dueRefsNow = await getDueCycleRefs(new Date()).catch(() => []);
    await saveSchedulerStatus({
      startedAt,
      completedAt: new Date().toISOString(),
      activeCyclesSeen: activeRefs.length,
      dueCyclesSeen: dueRefsNow.length,
      discoveryChecked,
      discoveryStarted,
      discoveryMode,
      processed,
      actions,
      failures,
      status: failures > 0 ? 'completed-with-errors' : 'success'
    }).catch(() => undefined);
  }
}
