// Marketplace licence enforcement.
//
// Forge only supplies `context.license` to UI resolvers, and only for paid apps
// in the PRODUCTION environment. It is undefined in DEVELOPMENT/STAGING and for
// apps that are not (yet) listed on the Marketplace. Product event triggers and
// scheduled triggers do not receive a licence object at all; for those the
// supported approach is `filter.appIsLicensed: true` in manifest.yml, which
// makes the platform skip invocations on unlicensed sites.
// See https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
//
// Policy:
// - Production resolvers fail closed: a missing or inactive licence is treated
//   as unlicensed (read-only).
// - Non-production environments allow a missing licence so the app can be
//   tested. A simulated licence (`forge install --license inactive`) or the
//   LICENSE_OVERRIDE variable (`active` / `inactive`) is still honoured there.
// - Triggers rely on the manifest filter; the code check is defence in depth
//   that only rejects an explicitly inactive licence. The weekly privacy
//   trigger is deliberately NOT licence-filtered: personal data reporting and
//   erasure must keep running whatever the licence state.

const PRODUCTION = 'PRODUCTION';

function environmentType(context) {
  const value = context?.environmentType ?? context?.environment?.type ?? null;
  return value ? String(value).toUpperCase() : null;
}

export function isProductionContext(context) {
  // An unknown environment is treated as production so enforcement fails closed.
  const type = environmentType(context);
  return type == null || type === PRODUCTION;
}

function licenseOverride(env) {
  const value = String(env?.LICENSE_OVERRIDE ?? '').trim().toLowerCase();
  if (value === 'active' || value === 'trial') return true;
  if (value === 'inactive') return false;
  return null;
}

export function resolverLicenseAllows(context, env = process.env) {
  const license = context?.license;
  if (isProductionContext(context)) return license?.active === true;

  const override = licenseOverride(env);
  if (override != null) return override;
  return license == null || license.active === true;
}

export function triggerLicenseAllows(context, env = process.env) {
  // Triggers get no licence object from Forge; `filter.appIsLicensed` in the
  // manifest does the real enforcement. Only reject what is explicitly inactive.
  // Trigger contexts carry no environment type, so LICENSE_OVERRIDE can only
  // switch processing off here (for testing the inactive state), never on.
  if (licenseOverride(env) === false) return false;
  return context?.license?.active !== false;
}
