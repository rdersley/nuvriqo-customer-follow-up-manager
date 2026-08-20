# Nuvriqo Follow-Up Manager — Security Policy

_Last updated: 20 August 2026_

## Architecture

Nuvriqo Follow-Up Manager is implemented on Atlassian Forge. Version 1 does not use a Forge Remote or a Nuvriqo-operated external application server. Application functions and persistent app storage run on Atlassian Forge.

## Authentication and authorization

- Interactive configuration and issue-panel Jira reads use Forge `asUser()` authorization.
- Project settings operations verify the current user has Jira project administration permission.
- Ticket-side pause, resume, cancel and restart controls verify the current user has Edit Issues permission for the work item.
- Background event and scheduled automation uses Forge app authentication to carry out administrator-configured Jira/JSM actions.
- No anonymous app endpoints are exposed.

## Data protection

- App configuration and runtime state are stored in installation-scoped Forge KVS.
- No external data egress is configured in Version 1.
- The app deliberately avoids persisting Jira user display names and email addresses.
- Stored fixed participant account IDs are tracked through the Forge Privacy API flow.
- Audit records have a 180-day TTL.

## Permissions requested

The app currently requests the following Forge scopes:

- `read:jira-work` — read work items, Jira field/status/workflow metadata and user-visible Jira data required for rule configuration and execution.
- `write:jira-work` — transition Jira work items and set transition fields such as Resolution.
- `read:servicedesk-request` — read JSM request comments and request participants to detect customer replies.
- `write:servicedesk-request` — post public customer comments and add configured request participants.
- `storage:app` — store rule configuration, active cycle state, privacy references and audit records in Forge KVS.
- `report:personal-data` — use Atlassian's personal-data reporting API for stored participant account references.

## Dependency management

Before every Marketplace release, the release checklist requires dependency installation/audit, automated tests, UI builds and `forge lint`. Security or dependency findings that could materially affect customers should block release until remediated or accepted with a documented rationale.

## Vulnerability reporting

Before Marketplace submission, publish the final vulnerability-reporting address and response process here and at a stable HTTPS support/security URL. Reports should include the app name, affected functionality, reproduction steps and any relevant logs without unnecessary customer data.

## Supported versions

Security fixes are delivered through Atlassian Marketplace app versions. Customers should normally remain on the latest available cloud version because Forge cloud app upgrades are centrally deployed.
