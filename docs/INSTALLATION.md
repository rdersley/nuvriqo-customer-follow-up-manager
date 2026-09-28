# Installing Nuvriqo Follow-Up Manager

## Marketplace installation

When the app is publicly listed, a Jira administrator installs Nuvriqo Follow-Up Manager from the Atlassian Marketplace into the required Jira Cloud site and grants the requested Forge scopes.

The app is designed for Jira Service Management Cloud.

## Development/staging installation

For development testing from the source repository:

```powershell
npm install
npm run build:ui
forge lint
forge deploy -e development
forge install -e development --site your-site.atlassian.net
```

If the app is already installed and the manifest requests a new scope, use:

```powershell
forge install --upgrade -e development --site your-site.atlassian.net
```

## Paid license testing

The Marketplace release has Forge licensing enabled. Atlassian supports testing license states in non-production environments, for example:

```powershell
forge install --environment development --license active
```

In production the app fails closed: if Forge supplies no licence, or an inactive one, the admin page and issue panel are read-only. Issue-event and hourly processing triggers use `filter.appIsLicensed: true`, so Forge skips them on unlicensed sites. The weekly privacy job always runs. In development and staging a missing licence is allowed; you can also simulate a state with `forge variables set --environment development LICENSE_OVERRIDE inactive` (or `active`).

Use development or staging for paid-app validation. Do not use production merely as a test installation once the paid Marketplace listing is live.

## Where configuration appears

Open a Jira Service Management project, go to **Project settings**, then open **Nuvriqo Follow-Up Manager** under Apps.

The app also provides a **Nuvriqo Follow-Up** issue panel on Jira work items so agents can inspect and control an active follow-up cycle.
