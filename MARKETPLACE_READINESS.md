# Nuvriqo Follow-Up Manager — Marketplace Readiness

This checklist tracks the minimum work needed to move the app from development into an Atlassian Marketplace submission.

## Product / functional

- [x] Forge-native Jira Service Management app.
- [x] Project settings page.
- [x] Multiple follow-up rules per project.
- [x] Configurable waiting status.
- [x] Multiple AND filters per rule (for example Client + Ticket Type).
- [x] Jira filter-value loading from create metadata, observed issue values and autocomplete fallback.
- [x] Filter-value deduplication.
- [x] Different reminder counts/timings per rule.
- [x] Day or hour timing.
- [x] Configurable public customer reminder templates.
- [x] Optional request participants per reminder.
- [x] Searchable Jira user/customer participant picker.
- [x] Optional status change per reminder.
- [x] Configurable final destination status.
- [x] Optional Resolution value on final transition.
- [x] Runtime workflow transition discovery and required-field validation.
- [x] Customer reporter reply cancellation.
- [x] Request participant reply cancellation.
- [x] Pause / resume / cancel / restart controls.
- [x] Audit history and user-visible processing errors.
- [x] Retry-safe reminder action progress.
- [x] Backward-compatible migration of stored development rules.
- [x] Exact duplicate-rule protection.
- [x] Automated core rule/template tests added.
- [ ] Complete end-to-end sandbox test matrix.
- [ ] Verify scheduled reminder delivery on multiple simultaneous issues.
- [ ] Verify no duplicate reminders after retries/events.
- [ ] Verify transition failure handling and user-visible diagnostics.
- [ ] Verify behaviour when rule is edited during an active cycle.
- [ ] Verify disabled/deleted rule behaviour for active cycles.
- [ ] Verify permission behaviour for non-admin agents.

## Marketplace / commercial

- [ ] Decide Paid via Atlassian pricing.
- [x] Enable `app.licensing.enabled: true` in the registered Forge manifest.
- [x] Add production licence-state enforcement / reduced write-processing functionality for inactive licenses.
- [ ] Test simulated active/inactive license states in development.
- [ ] Create production Forge environment build.
- [ ] Enable app sharing/distribution when ready for external beta/listing flow.
- [ ] Create Marketplace listing.
- [ ] Complete Privacy & Security tab.
- [ ] Complete Partner verification requirements.
- [ ] Complete app security questionnaire/security workflow.
- [ ] Submit for Marketplace approval.

## Trust, privacy and security

- [x] No external hosting required.
- [x] No external data egress in V1.
- [x] Rules, cycles and audit records stored using Forge KVS.
- [x] KVS prefix queries paginate beyond 100 records.
- [x] Audit records have 180-day TTL.
- [x] Interactive Jira calls use `asUser()` where appropriate.
- [x] Project-admin permission checks protect rule configuration.
- [x] Edit Issues permission checks protect ticket-side cycle mutations.
- [x] Participant display names/email addresses are not deliberately persisted.
- [x] Personal-data account reference index implemented for fixed reminder participants.
- [x] Weekly Forge Privacy API reporting/erasure flow implemented.
- [x] `report:personal-data` scope added.
- [x] Scope justification draft completed.
- [x] Privacy Policy draft completed.
- [x] Security Policy draft completed.
- [x] Data retention/deletion documented.
- [ ] Run `forge eligibility` / Runs on Atlassian eligibility checks on the production candidate.
- [ ] Run dependency vulnerability scan before submission.
- [ ] Publish Privacy Policy at a stable HTTPS URL.
- [ ] Publish Security Policy / vulnerability reporting process at a stable HTTPS URL.
- [ ] Publish Terms/EULA or select an appropriate Marketplace agreement option.

## Support and documentation

- [ ] Finalise support email address.
- [ ] Finalise support website/help centre URL.
- [x] Installation guide drafted.
- [x] Configuration guide drafted.
- [x] Troubleshooting guide drafted.
- [x] Support policy draft created.
- [x] Release notes / changelog created.
- [x] Release test matrix created.
- [ ] Publish customer-facing guides to the final support/help-centre URLs.
- [ ] Confirm final support hours and target response time.

## Marketplace assets

- [ ] Final app icon/logo.
- [ ] Marketplace hero/banner artwork if required.
- [ ] Screenshot: rules list.
- [ ] Screenshot: Client + Ticket Type rule with multiple reminders.
- [ ] Screenshot: reminder status/participant actions.
- [ ] Screenshot: final Resolution action.
- [ ] Screenshot: issue follow-up panel/audit history.
- [x] Concise Marketplace summary drafted.
- [x] Full Marketplace description drafted.
- [x] Feature list and use cases drafted.

## Release candidate sequence

1. Pull/deploy 0.9.0 to the sandbox and upgrade scopes.
2. Run `npm test`, UI build and `forge lint`.
3. Execute `docs/RELEASE_TEST_MATRIX.md` against fast Hours-based rules.
4. Fix any P0/P1 defects; freeze V1 features.
5. Confirm pricing/support/legal URLs and publish docs.
6. Run vulnerability and Runs on Atlassian eligibility checks.
7. Capture final Marketplace screenshots/assets.
8. Deploy the production Forge version (do not install it simply for testing once paid production billing applies).
9. Create/link the Marketplace listing and complete Privacy & Security/security questionnaires.
10. Submit for Atlassian review.
