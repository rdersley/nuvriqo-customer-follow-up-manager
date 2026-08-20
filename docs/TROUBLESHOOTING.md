# Nuvriqo Follow-Up Manager — Troubleshooting

## A field value dropdown is empty

Confirm the Jira field itself has active options in the field context used by the project. Nuvriqo reads Jira's own configuration/data; if Jira's active field context has no options, Nuvriqo cannot invent them.

Nuvriqo combines:

1. allowed values from Jira create metadata;
2. values already observed on project work items;
3. Jira JQL autocomplete suggestions.

If no fixed values are available, the UI permits an exact manual value as a fallback.

## A reminder did not run

Check:

- the rule is enabled;
- the work item is in the configured waiting status or a reminder destination status belonging to the active cycle;
- all rule filters match the current work item values;
- the cycle is not paused;
- the configured time has elapsed;
- the app has an active Marketplace license in production;
- the issue panel does not show a processing error.

Forge product events can have a platform delivery delay, and the due-reminder processor runs hourly in V1.

## A customer replied but the sequence continued

Nuvriqo cancels on a **public** JSM reply from the reporter or an existing request participant. Confirm the comment is public and the author is one of those customer identities.

## A reminder comment was posted but a later action failed

Reminder actions are checkpointed separately. If participant addition or the comment succeeds and a later status transition fails, Nuvriqo retains progress so the next retry does not intentionally repeat the already-completed comment/action.

Open the Nuvriqo issue panel to see the latest processing error.

## Final transition fails

Nuvriqo inspects the workflow transition metadata. Common causes include:

- no workflow transition from the current status to the configured destination;
- Jira Resolution is required but not selected in the rule;
- another custom field is required by the transition screen;
- the Forge app lacks permission to perform the transition.

The issue panel records the missing/failed transition information where Jira provides it.

## Participant search returns no users

The project administrator must have permission to see the Jira user through the Jira user picker. Search with at least two characters. Privacy settings in the Atlassian site can also affect visible user details.

## Development logs

For a development environment:

```powershell
forge logs -e development
```

Use `forge lint` before deployment and rebuild the Custom UI resources whenever front-end code changes:

```powershell
npm run build:ui
forge lint
forge deploy -e development
```
