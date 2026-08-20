# Nuvriqo Follow-Up Manager — Privacy Policy

_Last updated: 20 August 2026_

This policy describes how Nuvriqo Follow-Up Manager for Jira Service Management processes data when installed on an Atlassian Cloud site.

## What the app does

Nuvriqo Follow-Up Manager automates customer follow-up sequences in Jira Service Management. Administrators configure rules that can post public customer comments, add configured request participants, transition Jira work items, and complete a final Resolution where configured.

## Data accessed from Atlassian

To perform its functions, the app may read Jira/Jira Service Management information including:

- project, work item, status, workflow transition and field metadata;
- selected work item field values used to evaluate administrator-defined rules;
- reporter and request participant account identifiers where needed to detect customer replies;
- public Jira Service Management comments needed to determine whether a customer has replied;
- Jira user search results when an administrator searches for a request participant to add to a reminder.

The app accesses this information through Atlassian APIs using Forge authentication.

## Data stored

The app uses Atlassian Forge hosted storage. Depending on administrator configuration, it stores:

- follow-up rule configuration;
- Jira field IDs and configured field values used in rule filters;
- configured reminder timings, message templates and workflow actions;
- Atlassian account IDs of users deliberately selected by an administrator as request participants to add during a reminder;
- active follow-up cycle state for Jira work items;
- operational/audit events such as reminder completion, transitions and errors.

The app does not deliberately persist user email addresses or user display names. User names shown in the configuration UI are resolved from Jira at display time.

## Retention

- Rule configuration is retained until it is changed or deleted by a project administrator, or until the app installation data is removed.
- Active follow-up cycle data is deleted when the cycle completes, is cancelled, or no longer matches a rule.
- Audit records use a 180-day time-to-live in Forge storage.
- Stored Atlassian account references are removed when no configured rule references the account.

## User privacy and deletion

Because administrators may configure a fixed Atlassian account as a request participant, the app maintains a minimal index of those stored account IDs. The app uses Atlassian's Forge Privacy API on a weekly schedule to report stored account references and processes Atlassian privacy updates. If Atlassian indicates that an account has been closed and requires erasure, the app removes that account ID from stored follow-up rules and its privacy index.

## External data transfers

Version 1 of Nuvriqo Follow-Up Manager does not use a Forge Remote and does not intentionally transmit customer or end-user data to an external service operated by Nuvriqo. Application compute and persistent application storage are provided by Atlassian Forge.

## Security

Access to Jira data is controlled by Atlassian permissions and Forge scopes. Interactive configuration operations use the current Jira user's authorization and include project/issue permission checks. Background automation uses Forge app authentication for the operations required to execute configured rules.

## Changes to this policy

This policy may be updated when app functionality, legal requirements, or Atlassian platform requirements change. The current published version should always be linked from the Atlassian Marketplace listing.

## Contact

Before Marketplace submission, replace this section with the final Nuvriqo privacy/support contact details and publish this policy at a stable HTTPS URL.
