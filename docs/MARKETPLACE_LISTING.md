# Atlassian Marketplace Listing Draft

## App name

**Nuvriqo Follow-Up Manager for Jira Service Management**

## One-line summary

Automate customer reminders, client-specific follow-up rules and safe auto-close workflows in Jira Service Management.

## Short description

Nuvriqo Follow-Up Manager helps service teams consistently follow up with customers without maintaining large Jira Automation rule sets. Build project-level policies using Jira fields such as Client and Ticket Type, send configurable public reminders, add request participants, change status during the sequence and complete a final workflow transition when the customer does not respond.

## Key features

- Project-level follow-up policies for Jira Service Management.
- Multiple AND filters using Jira standard/custom fields.
- Automatically discovered Jira field values for select-style fields.
- Different reminder counts and timings for different clients/ticket types.
- Public JSM reminder comments with reusable message variables.
- Optional request participant addition on each reminder.
- Optional status transition after each reminder.
- Configurable final destination status and Jira Resolution.
- Automatic cancellation when the reporter/request participant replies publicly.
- Agent issue panel with pause, resume, restart and cancel controls.
- Retry-safe action checkpoints to reduce duplicate reminder actions after partial failures.
- Audit/error visibility for support and troubleshooting.
- Forge-native compute/storage with no external application backend in Version 1.

## Example use cases

### Hardware requests

Give hardware tickets a longer sequence with more reminders before closure while allowing ordinary support tickets to close sooner.

### Client-specific policies

Create a rule such as:

`SD Client = ACME - Acme Corp` AND `Ticket Type = Hardware`

and configure a different rule for another client or ticket type in the same JSM project.

### Progressive status changes

Send Reminder 1, move the request to a follow-up status, send later reminders, and transition to a final resolved/closed status after the configured waiting period.

## How it works

1. A project administrator creates one or more Nuvriqo rules.
2. When a Jira work item enters the configured waiting status, Nuvriqo selects the highest-priority matching rule.
3. Due reminders are processed on the scheduled follow-up cycle.
4. Public customer comments and optional participant/status actions are performed.
5. A public customer reply cancels the sequence.
6. If no reply is received, the configured final workflow transition is performed.

## Hosting and data handling

Version 1 runs on Atlassian Forge and uses Forge KVS for app configuration/runtime state. It does not use a Nuvriqo-operated external backend or configured external data egress. See the published Privacy Policy and Privacy & Security tab for the exact data categories and retention details.

## Required scopes and justification

- `read:jira-work`: rule configuration, work item matching and Jira workflow/field metadata.
- `write:jira-work`: configured workflow transitions and transition fields.
- `read:servicedesk-request`: public JSM comment/request participant reads for customer-reply detection.
- `write:servicedesk-request`: public reminder comments and configured request participant additions.
- `storage:app`: Forge-hosted configuration, active cycle and audit state.
- `report:personal-data`: Atlassian privacy reporting for fixed participant account references selected by administrators.

## Marketplace assets to capture from the release candidate

1. Rule list / project settings home.
2. Client + Ticket Type multi-filter rule.
3. Multi-reminder sequence with status/participant actions.
4. Final action showing destination + Resolution.
5. Issue panel showing active follow-up and audit history.

## Links required before submission

- Documentation URL: **TBC — publish Confluence/help-centre pages**
- Support URL: **TBC**
- Support email: **TBC**
- Privacy Policy URL: **TBC — publish docs/PRIVACY_POLICY.md**
- Security/Vulnerability reporting URL: **TBC — publish docs/SECURITY.md**
- End User Terms/EULA: **TBC — choose/publish final agreement**

## Suggested categories/search terms

Jira Service Management, customer support, follow-up, auto close, reminders, service desk automation, customer response, workflow automation, request management.
