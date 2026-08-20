# Nuvriqo Follow-Up Manager — Release Test Matrix

Use this matrix against a development or staging installation before the production Marketplace deployment.

## Build and static checks

- [ ] `npm install` completes without an unexpected dependency error.
- [ ] `npm test` passes.
- [ ] `npm run build:ui` builds both Custom UI resources.
- [ ] `forge lint` reports no issues.
- [ ] dependency vulnerability review completed.

## Rule configuration

- [ ] Settings page loads for a project administrator.
- [ ] Non-project-admin cannot change rules.
- [ ] Jira fields populate.
- [ ] SD Client values populate without duplicate display entries.
- [ ] A second filter can be added.
- [ ] `Client + Ticket Type` rule saves successfully.
- [ ] Exact duplicate enabled rule is rejected.
- [ ] Existing pre-0.9 rules still load/edit.
- [ ] Rule can be disabled/re-enabled.
- [ ] Rule can be deleted.

## Reminder sequence

Create a fast test rule using **Hours**.

- [ ] Entering the configured waiting status starts a cycle.
- [ ] Correct client/ticket-type rule wins by priority.
- [ ] First reminder adds exactly one public JSM comment.
- [ ] Template variables render correctly.
- [ ] Configured request participant is added.
- [ ] Configured reminder status transition occurs.
- [ ] Cycle remains active after reminder status transition.
- [ ] Later reminder executes once.
- [ ] No duplicate public comment appears if a later action initially fails and retries.

## Customer response

- [ ] Public reporter reply cancels the cycle.
- [ ] Public request-participant reply cancels the cycle.
- [ ] Internal agent comment does not cancel the cycle.
- [ ] New follow-up cycle can start after a later valid waiting-status entry.

## Agent issue panel

- [ ] Active rule/cycle is visible.
- [ ] Reminder progress is correct.
- [ ] Next action uses the configured Hours/Days unit.
- [ ] Pause stops timing.
- [ ] Resume excludes paused duration.
- [ ] Restart starts a fresh eligible cycle.
- [ ] Cancel removes the cycle.
- [ ] User without Edit Issues cannot mutate the cycle.
- [ ] Processing errors are visible.

## Final transition

- [ ] Destination status without Resolution succeeds where workflow allows it.
- [ ] Workflow requiring Resolution succeeds when Resolution is configured.
- [ ] Missing required transition field produces a clear error and does not delete the cycle.
- [ ] No available transition produces a clear error listing available destinations.

## Licensing

- [ ] Development install with active simulated license permits writes/processing.
- [ ] Development install with inactive simulated license remains readable but blocks rule/cycle mutations and background processing.
- [ ] Re-enable active license and confirm processing resumes.

## Privacy/data handling

- [ ] Saving a reminder participant creates the minimal account privacy reference.
- [ ] Participant display name is not persisted with the rule.
- [ ] Removing participant removes the privacy reference when no other rule uses it.
- [ ] Audit record contains participant count, not participant account IDs.
- [ ] Weekly privacy function deploys with `report:personal-data` scope.
- [ ] Audit records are configured with 180-day TTL.

## Scale/reliability sanity

- [ ] More than 100 stored KVS records can be paginated by prefix.
- [ ] Multiple simultaneous active cycles are processed.
- [ ] One failing cycle does not stop later cycles from processing.
- [ ] Rule edit while cycle is active has defined/acceptable behavior.
- [ ] Disabled/deleted rule does not keep processing indefinitely.

## Marketplace presentation

- [ ] App icon/logo final.
- [ ] Rule-list screenshot captured.
- [ ] Client + Ticket Type rule screenshot captured.
- [ ] Reminder actions screenshot captured.
- [ ] Issue-panel/audit screenshot captured.
- [ ] Privacy, security, documentation and support pages published at stable HTTPS URLs.
- [ ] Privacy & Security tab completed accurately.
- [ ] Partner identity/security questionnaire tasks completed.
- [ ] Final scope justifications copied from Marketplace listing draft.
