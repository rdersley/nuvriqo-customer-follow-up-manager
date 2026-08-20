# Data Handling — Nuvriqo Follow-Up Manager

## Architecture

Nuvriqo Follow-Up Manager V1 is a Forge-native Jira Service Management app. The current V1 implementation does not call external APIs and does not send Jira customer data to infrastructure operated by the app vendor.

## Data read from Jira/JSM

The app reads only the Jira/JSM information required to evaluate and execute follow-up rules, including:

- Issue key and issue ID.
- Project key.
- Issue status.
- Summary.
- Reporter account/display information needed to render reminder templates.
- Configured Jira field values used for rule matching.
- Public JSM comment metadata needed to identify customer replies.
- Request participants needed to identify participant replies.
- Available workflow transitions and destination statuses.
- Jira field names and JQL field-value suggestions used by the administration UI.

## Data written to Jira/JSM

The app can:

- Add public customer comments containing configured reminder text.
- Transition an issue through an available Jira workflow transition selected by destination status.

## Data stored in Forge KVS

The app stores tenant-specific application state in Forge KVS, including:

- Follow-up rule configuration.
- Active follow-up cycle state, including issue ID/key, rule ID, start time, pause state, and completed reminder indexes.
- Audit events such as cycle start/cancel, reminder delivery, pause/resume, and auto-transition.

The current audit model does not intentionally persist customer email addresses or reminder message bodies.

## External egress

V1 has no configured external data egress. It does not require vendor-hosted servers, external analytics, external email services, or third-party messaging services.

## Retention

- Active cycle state is removed when a sequence is cancelled or completes.
- Rules remain until an administrator deletes them.
- Audit records currently remain in Forge KVS until an app-level retention/deletion policy is implemented.

A defined audit retention/deletion mechanism must be finalised before Marketplace submission.

## Uninstallation

Forge platform storage lifecycle behaviour should be confirmed against the current Atlassian Forge documentation before Marketplace submission. The Marketplace privacy documentation must accurately describe any retention period that applies following app uninstallation.

## Privacy review items before submission

- Confirm whether stored issue keys/IDs and audit event metadata are classified as End User Data for the final Marketplace Privacy & Security answers.
- Implement any required privacy reporting/deletion flows.
- Finalise audit retention controls.
- Publish a stable Privacy Policy URL.
