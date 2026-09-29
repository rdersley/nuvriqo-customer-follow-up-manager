# Customer Follow-Up Manager: notes for contributors and AI assistants

## UI consistency (@nuvriqo/ui)

This app uses the shared Nuvriqo UI kit (`@nuvriqo/ui`). The style guide is in [rdersley/nuvriqo-ui](https://github.com/rdersley/nuvriqo-ui) (`docs/STYLE_GUIDE.md`).

- No hardcoded colours in app CSS. The old v1 `--nv-*` variables now point at `--nq-*` tokens; use `--nq-*` directly in new CSS. Each `static/*` build runs `nuvriqo-ui-check src` first.
- The admin page is a project settings page, so it uses `nq-header` + `nq-tabs`. Don't reintroduce a CSS-drawn sidebar: Jira already shows one.
- `static/admin` and `static/issue-panel` import `@nuvriqo/ui/css` before `styles.css` and call `enableTheme(view)`.
- Commit markers on main deploy: `[deploy-production]` deploys to nuvriqo production and `[deploy-development]` deploys to the RiM work site. Never add them to UI-only commits.
