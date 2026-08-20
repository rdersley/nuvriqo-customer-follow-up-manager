# Nuvriqo Follow-Up Manager — Support

## Support scope

Support covers installation, configuration, rule matching, reminder delivery, Jira/JSM permission errors, workflow transition errors and Marketplace licensing issues for Nuvriqo Follow-Up Manager.

## Information to include in a support request

Please provide:

- Atlassian site URL;
- Jira Service Management project key;
- affected work item key(s);
- Nuvriqo rule name;
- approximate time the problem occurred and timezone;
- screenshot of the Nuvriqo issue panel or settings error where relevant;
- relevant Forge log excerpt with secrets/customer content removed where possible.

Do not send passwords, API tokens or unrelated customer data.

## Diagnostic steps

For an administrator testing a development/staging installation:

```powershell
forge logs -e development
```

For production customer support, Nuvriqo should use the supported Marketplace/Forge diagnostics available to the vendor and ask customers only for information needed to identify the affected rule/work item.

## Response targets

Before Marketplace submission, confirm and publish final support hours, timezone, response targets, support email address and support/help-centre URL.

Recommended initial targets for a small commercial launch:

- Critical app-wide outage: initial response within 1 business day.
- Major feature failure: initial response within 2 business days.
- Normal configuration/question: initial response within 3 business days.

These are draft targets until formally published by Nuvriqo.
