# Nuvriqo Customer Follow-Up / Auto-Close Manager

Forge app for Jira Service Management that manages configurable customer follow-up sequences and automatically transitions stale requests to a chosen destination status.

## V1 capabilities

- Multiple follow-up rules per project.
- Rule matching with multiple Jira field conditions.
- Multi-value comparisons including **Is any of** and **Is none of**.
- Any number of reminder steps per rule.
- Public JSM reminder comments with message templates.
- Optional request participant additions before reminders.
- Configurable waiting status and reminder destination statuses.
- Active follow-up cycles remain valid in configured reminder destination statuses, so later stages continue from the original cycle start time.
- Scheduled backlog discovery finds eligible tickets that were already waiting before a cycle existed and seeds timing from the latest Jira transition into the configured waiting status.
- Newly discovered overdue tickets are processed in the same scheduler run.
- Final customer-facing message before the closing transition.
- Final transition by **destination status name** rather than hard-coded transition IDs.
- Optional resolution and additional transition-field values for final actions.
- Stop/reconcile the sequence when the ticket no longer matches its rule.
- Customer replies cancel the active follow-up cycle.
- Restart a fresh cycle when the ticket becomes eligible again.
- Agent issue panel with pause, resume, restart and cancel controls.
- Paused time is excluded from reminder/auto-close timing.
- Project-level Run History with ticket check, filter match, action evidence and failures.
- Audit evidence for customer comments, participant additions, reminder status changes, final comments, final status transitions and resolutions.
- Click-through ticket keys for direct Jira verification.
- Scheduler heartbeat and current active-follow-up visibility.
- Forge KVS storage for rules, active cycles and audit records.
- Project settings UI that discovers Jira fields, fixed option values and statuses.
- Paid-app licensing support for Marketplace distribution.

## Project settings

After installation, open the JSM project's **Project settings** and select **Nuvriqo Follow-Up Manager**.

A rule defines:

1. Rule name and priority.
2. The Jira status that starts the waiting period.
3. One or more Jira field conditions.
4. As many reminder steps as required, each with its own timing, public message and optional destination status/participants.
5. The timing for the final action.
6. The final customer message.
7. The destination Jira status, optional resolution and any required transition fields.

This allows different request types, customers or processes to use different reminder sequences without maintaining large Jira Automation rule sets.

## First-time Forge registration and deployment

This source tree was created directly in GitHub rather than with `forge create`. Clone the repo on the development machine and run:

```bash
npm install
forge register "Nuvriqo Follow-Up Manager"
npm run build:ui
forge lint
forge deploy
forge install
```

`forge register` writes the real Atlassian app ID into `manifest.yml`. Do this only once for the Atlassian app registration you intend to keep.

For later deployments, the root `npm run deploy` command builds both Custom UI applications and then runs `forge deploy`.

## Example rule

```json
{
  "id": "customer-follow-up",
  "name": "Customer 7/14 follow-up",
  "enabled": true,
  "projectKey": "SD",
  "waitingStatusName": "Awaiting Customer Feedback",
  "conditions": [
    {
      "fieldId": "customfield_12345",
      "operator": "isAnyOf",
      "value": ["Customer A", "Customer B"]
    },
    {
      "fieldId": "customfield_67890",
      "operator": "isAnyOf",
      "value": ["Category A", "Category B"]
    }
  ],
  "reminders": [
    {
      "afterDays": 7,
      "message": "We are still waiting for your response.",
      "destinationStatusName": "Inactive Follow up Sent"
    }
  ],
  "finalAction": {
    "afterDays": 14,
    "message": "This request is now being closed because we have not received a response.",
    "destinationStatusName": "Resolved",
    "resolutionName": "No Action Required"
  }
}
```

At runtime, the processor reads the transitions currently available on the issue and uses the transition whose destination status matches the configured destination status.
