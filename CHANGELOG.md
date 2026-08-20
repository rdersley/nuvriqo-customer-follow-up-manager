# Changelog

## 0.9.0 — Release candidate — 20 August 2026

### Added

- Project-level rule editor for Jira Service Management.
- Multiple AND conditions using Jira standard/custom fields.
- Jira option discovery from field metadata, observed work item values and JQL suggestions.
- Different reminder counts/timings per rule.
- Day/hour timing modes.
- Configurable public JSM reminder templates and message variables.
- Per-reminder request participant addition.
- Per-reminder optional status transition.
- Final destination status and Jira Resolution support.
- Customer-reply cancellation for reporters and request participants.
- Issue panel with pause, resume, restart and cancel controls.
- Retry-safe progress checkpoints for reminder actions.
- Processing error visibility and audit trail.
- Rule schema migration/backwards compatibility.
- Duplicate exact-rule validation.
- Jira permission checks for interactive configuration/agent actions.
- Marketplace licensing configuration and production license enforcement.
- KVS cursor pagination.
- 180-day audit TTL.
- Forge Privacy API reporting/erasure flow for stored participant account references.
- Automated tests for rule matching, validation and template rendering.
- Marketplace/privacy/security/support documentation drafts.

### Changed

- Interactive Jira REST calls use current-user authorization where appropriate.
- Jira field options are deduplicated by normalized display value with authoritative-source precedence.
- Participant display names are no longer persisted in Forge storage.
- Participant audit entries store a count rather than account IDs.

### Known release-candidate validation items

- Complete sandbox end-to-end sequence tests.
- Validate active and inactive Marketplace license simulations.
- Validate privacy reporting deployment scope/weekly trigger.
- Confirm project-admin and agent permission behavior with non-admin test accounts.
- Capture Marketplace screenshots and publish support/privacy/security URLs.
