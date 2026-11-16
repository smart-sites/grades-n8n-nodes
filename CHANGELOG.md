# Changelog

## [Unreleased]

## [1.1.1] - 2026-11-16, prepared, not published

- Review > Get / Get Many with **Simplify**: keeps `text_notice`, the plain sentence a Yelp review carries instead of its
  text ("Yelp does not allow its review text here. Open the review on Yelp to read it."; app.grades.com API field,
  2026-11-16). The developer `text_hint` stays in the raw output only. Found in the Excel add-in production test.

## [1.1.0] - prepared, not published (needs the app's "Connect with Grades.com" OAuth for n8n live first)

- **Sign in with Grades.com** (OAuth2): new credential **Grades.com OAuth2 API** (`gradesOAuth2Api`, extends n8n's
  `oAuth2Api`): dynamic client registration (RFC 7591) as a public client with PKCE S256 against
  `https://app.grades.com/mcp/oauth`, scopes `companies:read reviews:read reviews:write`, resource
  `https://app.grades.com/api/v1`; every field is fixed, so the user only clicks "Connect my account". n8n stores the
  rotated refresh token on each refresh. Needs n8n 2.8 or later.
- Both nodes get an **Authentication** field: "Grades.com Account (Sign In)" or "API Key" (the existing `gradesApi`
  credential). Node version 2 (the default for new nodes) defaults to sign-in; version 1, which every workflow saved with
  1.0.x has, defaults to the API key, so existing workflows run unchanged. The trigger subscribes and removes its webhook
  with whichever credential is chosen.
- Errors on a sign-in connection say "reconnect" instead of "create a new key": API 401, a failed refresh
  (`invalid_grant`, n8n's "needs to be reconnected"), missing scope, a connection limited to some businesses, and the
  empty Business list.

## [1.0.1] - 2026-11-12, prepared, not published (npm still has 1.0.0)

- Launch gate L2 / L8 (workspace docs/integration-launch-gate-live-2026-11-09.md, same texts as grades-zapier): a key
  limited to some businesses refused on webhooks (the app's 404 "... only some of your businesses ..." or its new 400
  `company_required`) now reads "This key is limited to some businesses. Triggers need the business named, or create a
  key for all businesses at my.grades.com/connect?connect=n8n." instead of "Check the IDs you mapped"; a 404 on
  `POST /webhooks` / `/webhooks/samples` names the business. "(a read-only key can't reply, send requests or start
  triggers)" is added only when the missing scope is `reviews:write`. Not published.

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
