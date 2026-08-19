# Nuvriqo Customer Follow-Up / Auto-Close Manager

Forge app for Jira Service Management that manages configurable customer follow-up sequences and automatically transitions stale requests to a chosen destination status.

## V1 capabilities

- Multiple follow-up rules per project.
- Rule matching by a configurable Jira field/value, such as `Ticket Type = Hardware`.
- Any number of reminder steps per rule.
- Public JSM reminder comments with message templates.
- Configurable waiting status and final destination status.
- Final transition by **destination status name** rather than hard-coded transition IDs.
- Stop/reconcile the sequence when the ticket no longer matches its rule.
- Restart a fresh cycle when the ticket becomes eligible again.
- Agent issue panel with pause, resume, restart and cancel controls.
- Paused time is excluded from reminder/auto-close timing.
- Per-ticket audit history.
- Forge KVS storage for rules, active cycles and audit records.
- Hourly scheduled processor.
- Project settings UI that discovers the project's Jira fields and statuses.

## Project settings

After installation, open the JSM project's **Project settings** and select **Nuvriqo Follow-Up Manager**.

A rule defines:

1. Rule name and priority.
2. The Jira status that starts/maintains the waiting period.
3. An optional Jira field/value condition, e.g. `Ticket Type = Hardware`.
4. As many reminder steps as required, each with its own day and public message.
5. The day on which the final action occurs.
6. The destination Jira status.

This allows a Hardware rule to have, for example, four reminders while a General Support rule has only two.

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
  "id": "hardware",
  "name": "Hardware follow-up",
  "enabled": true,
  "projectKey": "SD",
  "waitingStatusName": "Awaiting Customer Feedback",
  "condition": {
    "fieldId": "customfield_12345",
    "operator": "equals",
    "value": "Hardware"
  },
  "reminders": [
    { "afterDays": 2, "message": "Reminder 1" },
    { "afterDays": 4, "message": "Reminder 2" },
    { "afterDays": 7, "message": "Reminder 3" },
    { "afterDays": 10, "message": "Final reminder" }
  ],
  "finalAction": {
    "afterDays": 14,
    "destinationStatusName": "Resolved"
  }
}
```

At runtime, the scheduled processor reads the transitions currently available on the issue and uses the transition whose destination status matches `destinationStatusName`.