# Nuvriqo Release Gates

This repository follows the standard Nuvriqo app-factory release process.

## Gates

1. **Build** — dependencies, automated tests, Custom UI build and Forge lint pass.
2. **Functional** — configured follow-up, reminder and auto-close flows verified on the Nuvriqo test site.
3. **QA** — automated smoke/regression tests pass with no release-blocking defects.
4. **Security** — minimum scopes, permission/admin guards, secret hygiene and tenant isolation verified.
5. **Documentation** — setup, admin/user docs, support, privacy/security and release notes complete.
6. **Marketplace** — listing answers, copy, pricing, logos, screenshots/highlights and upload assets complete.
7. **Commercial** — positioning, onboarding, product page/cross-sell plan and launch measurement ready.

A production/Marketplace candidate requires every applicable gate to be GREEN.

## Pipeline

Code change -> tests -> Custom UI build -> Forge lint -> optional development deploy -> installation upgrade -> smoke QA -> release gate review -> production candidate.

The existing CI and Remote Forge QA workflows provide the automated Build/QA foundation. Marketplace-submitted releases stay frozen while under Atlassian review.
