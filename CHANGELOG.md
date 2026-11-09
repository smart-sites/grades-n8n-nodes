# Changelog

## [Unreleased]

- Customer-facing errors (`nodes/Grades/errors.ts`, same texts as the Zapier app): every failed call says what happened and
  what to do next instead of "Unauthorized: Authentication required." or n8n's generic "Forbidden - perhaps check your
  credentials?". Covered: revoked / mistyped key (and a `gk_pub_` or non-`gk_live_` key), a key missing a scope
  (read-only key), 402 plan gating with the plan to upgrade to and the billing link, `billing_locked`, 404 by what was not
  found, 409 already decided, 400 field errors named by the n8n parameter, 429 (per-minute vs monthly), 5xx / HTML bodies,
  and connection failures / timeouts. The error description is only "Grades.com answered HTTP 403." (never the raw body).
- Credential test: a 401 or 429 says what to do (rules on `GET /me`).
- Business dropdowns (both nodes) say why they are empty when the key reaches no business.
- Contact > Create or Update and Review Request > Send refuse a contact without email and phone before calling the API
  (F10 of the 2026-11-08 test), and "Customer Agreed to Texts" says why it can't be sent yet (the API needs the exact
  consent wording, `sms_consent_text`, so it always failed with a 400). Not published.

## [1.0.1] - staged, not published

- Reviews (app v3.65.0 field meanings): `site` is the review platform (google, yelp, facebook, bbb, direct, grades),
  `source_name` its display name, `source` an internal collector id that may change. The **Sites** filter placeholder is
  `google,yelp` (was `google,yelp_apify`) and its help names platforms. New **Simplify** option on Review > Get and
  Get Many (off by default, so the output is unchanged): the platform first (`site_name` when present, `source_name`,
  `site`), then uuid, rating, author, text, dates, URL and reply; `source` and `avatar` dropped. The raw output keeps
  `source`. README documents the fields.

- n8n verification: passes the lint leg of `@n8n/scan-community-package` (Grades.com node: errors wrapped in
  `NodeOperationError` unless they already are a `NodeApiError`; review filters sorted by name; trigger: a failed webhook
  delete on deactivation is logged instead of swallowed silently; light and dark icons).
- `.github/workflows/publish.yml`: publish with npm provenance from a `v*.*.*` tag (npm Trusted Publisher).
- README: authentication steps and example workflows; package `homepage` https://www.grades.com/integrations/n8n.
- Credential "Grades.com API": the API Key help text points to the dashboard's guided flow,
  `https://my.grades.com/connect?connect=n8n`, which creates the key with the right scopes. Not published.
