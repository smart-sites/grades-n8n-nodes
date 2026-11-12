# n8n-nodes-grades

[n8n](https://n8n.io) community nodes for [Grades.com](https://www.grades.com): reviews from Google, Yelp, Facebook and
36 other sites, replies, the AI review agent, review requests and instant triggers.

- **Grades.com** (action node): Review (Get, Get Many, Reply), Agent Action (Get Many, Approve, Reject), Review Request
  (Send), Contact (Create or Update), Business (Get Many). Usable as an AI agent tool.
- **Grades.com Trigger**: starts a workflow on Grades.com webhook events (new review, review removed, review replied to,
  agent draft pending, agent reply posted, review page found by the radar, AI Reputation changed, review request
  clicked / visited / reviewed / unsubscribed, review updated, source needs reconnecting). It subscribes the workflow's
  webhook URL when the workflow is activated, removes it when deactivated, and checks every delivery's
  `X-Grades-Signature`.

Review fields: `site` is the review platform (google, yelp, facebook, bbb, direct, grades) and `source_name` its display
name (Google, Yelp, Direct, Grades.com); `source` is an internal collector id (e.g. yelp_apify, google_maps) that may
change, so build workflows on `site`. The **Sites** filter takes platforms (`google,yelp`). Review > Get and Get Many
have a **Simplify** option: the platform first (`source_name`, `site`) and no `source`; off, the raw review is returned.

## Install (n8n users)

Settings > Community Nodes > Install > `n8n-nodes-grades`. Self-hosted without the UI: `npm install n8n-nodes-grades` in
`~/.n8n/nodes`, then restart n8n.

Two ways to connect (each node's **Authentication** field):

- **Grades.com Account (Sign In)**, the default for new nodes: credential **Grades.com OAuth2 API**. You sign in to
  Grades.com and approve n8n; nothing to copy. Needs n8n 2.8 or later.
- **API Key**: credential **Grades.com API** with a key from the Grades.com dashboard (Connect your AI > API keys) with
  `reviews:read`, `reviews:write` and `companies:read`. Workflows made with 1.0.x keep using their key unchanged.

An agency or multi-location account reaches every business it manages: each node has a **Business** dropdown.

Plans: the trigger needs Pro or Premium (webhooks); review requests need Premium.

## Authentication

### Sign in with Grades.com (default)

1. In a Grades.com node, keep **Authentication** on **Grades.com Account (Sign In)** and choose **Create new credential**.
2. Click **Connect my account**: n8n registers itself with Grades.com, a Grades.com window opens, you sign in and click
   **Authorize** (all your businesses, or only some).
3. Done. n8n renews the sign-in on its own. Disconnect at any time in Grades.com > Account > Connected apps.

Grades.com shows the address it will send you back to (your n8n's `/rest/oauth2-credential/callback`): continue only if
it is your own n8n. What happens underneath: OAuth 2.0 with dynamic client registration (RFC 7591) as a public client,
PKCE (S256), permissions `companies:read reviews:read reviews:write` (what Grades.com grants n8n), authorization server
`https://app.grades.com/mcp/oauth`, tokens for `https://app.grades.com/api/v1` (RFC 8707 `resource`, n8n 2.27+). The
access token lasts an hour; the refresh token rotates on every refresh and n8n stores the new one.

n8n versions: sign-in needs n8n 2.8 or later (dynamic client registration arrived in 1.119, but before 2.8 n8n looks for the
server metadata only at the root of app.grades.com). On older n8n use an API key.

### API key

1. Open https://my.grades.com/connect?connect=n8n (sign in if asked).
2. Click **Create key**: the key is named "n8n" and gets `reviews:read`, `reviews:write` and `companies:read`.
3. In the node set **Authentication** to **API Key**, add a credential **Grades.com API** and paste the key (starts
   with `gk_live_`, shown once).

The API key credential test calls `GET https://app.grades.com/api/v1/me`. API reference: https://app.grades.com/api/documentation.

### Node versions

Both nodes are version 2 from 1.1.0. Version 2 defaults to sign-in; nodes saved with 1.0.x are version 1 and default to
the API key, so existing workflows run unchanged (either version can switch with the Authentication field).

## Example workflows

- **Alert Slack about 1- and 2-star reviews:** Grades.com Trigger (Review Created) > IF `rating <= 2` > Slack > Send Message
  with the author, the rating and the text.
- **Approve the review agent's drafts from Slack:** Grades.com Trigger (Agent Action Pending) > Slack message with the
  draft and two buttons > Grades.com > Agent Action > Approve (or Reject with the reason).
- **Ask for a review when a job is closed:** your CRM or Webhook node (job closed) > Grades.com > Contact > Create or
  Update > Grades.com > Review Request > Send, with the job id as the reference (a retried run never sends twice).
- **Weekly review digest:** Schedule Trigger (Monday 8:00) > Grades.com > Review > Get Many (Published After = 7 days
  ago) > an LLM summary > Gmail.
- **Log every review to Google Sheets:** Grades.com Trigger (Review Created) > Google Sheets > Append Row.

## Grades.com in n8n's AI agents today (remote MCP)

No install needed: n8n's **MCP Client Tool** node (AI Agent > Tools) can use the Grades.com MCP server directly.

- SSE / Streamable HTTP endpoint: `https://mcp.grades.com/mcp`
- Authentication: **Bearer** with the same API key (`gk_live_...`), or OAuth 2.1 where the node offers it
- Tools: the full Grades.com toolset (reviews, replies, drafts, the review agent, review radar, AI Reputation,
  competitors, review requests, directory). Tool list: <https://www.grades.com/developers#mcp>

## Develop

```bash
npm ci
npm test         # vitest, mocked n8n context, no network
npm run typecheck
npm run build    # dist/ (+ the SVG icons)
npm pack         # n8n-nodes-grades-<version>.tgz (also runs the build)
```

Local n8n: `npm run build && npm link`, then in `~/.n8n/custom` `npm link n8n-nodes-grades` and start n8n.

CI runs on Google Cloud Build like the other Grades.com repos (GitHub Actions is off in the org):
`bin/ci-cloud.sh <branch|sha|worktree dir>` -> `cloudbuild/test.yaml` -> PASS/FAIL.

API reference: https://app.grades.com/api/documentation (webhook events: `GET /api/v1/webhooks/events`).

## Publishing (Mike)

Agents never publish. 1.0.0 was published by hand (no provenance). From 1.0.1 on, publish from GitHub Actions with npm
provenance, which n8n requires for verified community nodes:

1. Make `smart-sites/grades-n8n-nodes` public and allow GitHub Actions for this repository.
2. npmjs.com > `n8n-nodes-grades` > Settings > Trusted Publishers > GitHub Actions: owner `smart-sites`, repository
   `grades-n8n-nodes`, workflow `publish.yml`.
3. `git tag v1.0.1 && git push origin v1.0.1`: `.github/workflows/publish.yml` tests and runs
   `npm publish --provenance --access public`.
4. `npx @n8n/scan-community-package n8n-nodes-grades` must pass (it checks provenance, then lints the attested source and
   the tarball), then submit the node in the n8n Creator Portal (<https://creators.n8n.io/nodes>).

n8n's rules: MIT license, no runtime dependencies, the `n8n-community-node-package` keyword, public repository,
provenance, English only, no environment or file access, scanner passes, README with usage, authentication and example
workflows (this file).
