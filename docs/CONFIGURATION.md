# Configuring Nuvriqo Follow-Up Manager

## Create a rule

Open **Project settings → Apps → Nuvriqo Follow-Up Manager** and select **Create rule**.

Each rule contains:

- **Rule name** — descriptive label such as `Ryanair hardware follow-up`.
- **Priority** — lower numbers are evaluated first when multiple rules could match.
- **Waiting status** — the status that starts the follow-up cycle.
- **Time unit** — days for production use, or hours for fast testing.
- **Rule filters** — zero or more Jira field conditions. All configured filters must match.
- **Customer reminders** — one or more timed public customer comments.
- **Final action** — final transition timing, destination status and optional Resolution.

## Client and ticket-type rules

Use multiple filters to create client-specific behaviour. Example:

- `SD Client = RYR - Ryanair`
- `Ticket Type = Hardware`

A separate Ryanair rule can use a different Ticket Type and a different number of reminders.

Nuvriqo loads available Jira fields automatically. For option-backed fields it combines Jira field metadata, values observed on project work items and Jira autocomplete data to populate the value selector.

## Reminder actions

Each reminder can:

- post a configurable public JSM customer comment;
- add selected request participant(s);
- optionally transition the work item to another status after the reminder.

Participant names are searched live from Jira. Nuvriqo stores only the selected Atlassian account ID required to perform the future participant action.

## Message variables

Reminder templates currently support:

- `{{customer.firstName}}`
- `{{customer.name}}`
- `{{issue.key}}`
- `{{issue.summary}}`
- `{{daysWaiting}}`
- `{{waitingAmount}}`
- `{{waitingUnit}}`

## Final action and Resolution

Choose the final destination status. If the workflow requires Jira's Resolution field, choose the Resolution value in the rule.

At runtime Nuvriqo discovers an available transition whose destination matches the configured status. It inspects required transition fields before performing the transition. If Jira requires another field that Nuvriqo has not been configured to submit, the cycle remains active and the issue panel records a clear processing error rather than silently closing or repeatedly duplicating comments.

## Customer replies

A public reply from the reporter or an existing request participant cancels the active follow-up cycle. Internal agent comments do not count as a customer response.

## Agent controls

The issue panel supports:

- Pause
- Resume
- Restart
- Cancel

Paused time is excluded from reminder timing. These actions require Jira Edit Issues permission.

## Rule conflicts

Nuvriqo rejects an exact duplicate enabled rule with the same waiting status and identical filters. Where broader and narrower rules can both match, use **Priority** to put the more specific rule first.
