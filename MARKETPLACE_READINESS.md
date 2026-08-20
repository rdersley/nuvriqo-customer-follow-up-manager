# Nuvriqo Follow-Up Manager — Marketplace Readiness

This checklist tracks the minimum work needed to move the app from development into an Atlassian Marketplace submission.

## Product / functional

- [x] Forge-native Jira Service Management app.
- [x] Project settings page.
- [x] Multiple follow-up rules per project.
- [x] Configurable waiting status.
- [x] Multiple AND filters per rule (for example Client + Ticket Type).
- [x] Jira filter-value loading from create metadata, observed issue values and autocomplete fallback.
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
- [ ] Complete end-to-end sandbox test matrix.
- [ ] Verify scheduled reminder delivery on multiple simultaneous issues.
- [ ] Verify no duplicate reminders after retries/events.
- [ ] Verify transition failure handling and user-visible diagnostics.
- [ ] Verify behaviour when rule is edited during an active cycle.
- [ ] Verify disabled/deleted rule behaviour for active cycles.
- [ ] Verify permission behaviour for non-admin agents.

## Marketplace / commercial

- [ ] Decide Paid via Atlassian pricing.
- [ ] Enable `app.licensing.enabled: true` before the Marketplace production build.
- [ ] Add licence-state handling / reduced functionality for unlicensed installs.
- [ ] Create production Forge environment build.
- [ ] Enable app sharing/distribution when ready for external beta.
- [ ] Create Marketplace listing.
- [ ] Complete Privacy & Security tab.
- [ ] Complete Partner verification requirements.
- [ ] Submit for Marketplace approval.

## Trust, privacy and security

- [x] No external hosting required.
- [x] No external data egress in V1.
- [x] Rules, cycles and audit records stored using Forge KVS.
- [x] Minimal classic scopes currently used for Jira/JSM functionality.
- [ ] Run `forge eligibility` / Runs on Atlassian eligibility checks on the production candidate.
- [ ] Run dependency vulnerability scan before submission.
- [ ] Publish Privacy Policy at a stable HTTPS URL.
- [ ] Publish Security Policy / vulnerability reporting process.
- [ ] Publish Terms/EULA or select an appropriate Marketplace agreement option.
- [ ] Document data retention/deletion behaviour.
- [ ] Confirm GDPR user privacy reporting/deletion obligations for any stored personal data.

## Support and documentation

- [ ] Finalise support email address.
- [ ] Finalise support website/help centre URL.
- [ ] Publish installation guide.
- [ ] Publish configuration guide.
- [ ] Publish troubleshooting guide.
- [ ] Define support hours and target response time.
- [ ] Add release notes / changelog.

## Marketplace assets

- [ ] Final app icon/logo.
- [ ] Marketplace hero/banner artwork if required.
- [ ] Screenshot: rules list.
- [ ] Screenshot: Hardware rule with multiple reminders.
- [ ] Screenshot: issue follow-up panel.
- [ ] Screenshot: audit history.
- [ ] Concise Marketplace summary.
- [ ] Full Marketplace description.
- [ ] Feature list and use cases.

## Recommended launch sequence

1. Complete sandbox functional testing.
2. Fix all P0/P1 defects found during testing.
3. Freeze V1 features.
4. Add licensing and production configuration.
5. Prepare support/privacy/security URLs and listing assets.
6. Run final security, lint and eligibility checks.
7. Deploy production build.
8. Create/link Marketplace listing.
9. Submit for Atlassian review.
