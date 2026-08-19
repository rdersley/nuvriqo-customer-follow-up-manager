# Nuvriqo Customer Follow-Up / Auto-Close Manager

Forge app for Jira Service Management that manages configurable customer follow-up sequences and automatically transitions stale requests to a chosen destination status.

## V1 goals

- Multiple follow-up rules per project.
- Rule matching by a configurable Jira field/value, such as `Ticket Type = Hardware`.
- Any number of reminder steps per rule.
- Public JSM reminder comments.
- Stop the sequence when the request leaves the waiting status or receives a public response.
- Restart a fresh cycle when the request re-enters the waiting status.
- Final transition by **destination status name** rather than hard-coded transition IDs.
- Forge KVS storage for rules, active cycles, and audit records.
- Hourly scheduled processor.

## Current build stage

This repository contains the V1 backend foundation. The next build stage adds the project settings UI for creating/editing rules and the issue panel for pause/resume/cancel controls.

## First-time Forge registration

This source tree is intentionally created outside `forge create`. On the development machine, clone the repo and run:

```bash
npm install
forge register "Nuvriqo Follow-Up Manager"
forge deploy
forge install
```

`forge register` writes the real Atlassian app ID into `manifest.yml`. Do this only once for the app registration you intend to keep.

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

The scheduled processor resolves an available Jira workflow transition whose destination status matches `destinationStatusName`, so customers do not have to hard-code workflow transition IDs.