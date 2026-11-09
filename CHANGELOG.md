# Changelog

## [Unreleased]

## [1.0.1] - staged, not published

- n8n verification: passes the lint leg of `@n8n/scan-community-package` (Grades.com node: errors wrapped in
  `NodeOperationError` unless they already are a `NodeApiError`; review filters sorted by name; trigger: a failed webhook
  delete on deactivation is logged instead of swallowed silently; light and dark icons).
- `.github/workflows/publish.yml`: publish with npm provenance from a `v*.*.*` tag (npm Trusted Publisher).
- README: authentication steps and example workflows; package `homepage` https://www.grades.com/integrations/n8n.
- Credential "Grades.com API": the API Key help text points to the dashboard's guided flow,
  `https://my.grades.com/connect?connect=n8n`, which creates the key with the right scopes. Not published.
