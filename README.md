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

## Install (n8n users)

Settings > Community Nodes > Install > `n8n-nodes-grades`. Self-hosted without the UI: `npm install n8n-nodes-grades` in
`~/.n8n/nodes`, then restart n8n.

Credential **Grades.com API**: an API key from the Grades.com dashboard (Connect your AI > API keys) with
`reviews:read`, `reviews:write` and `companies:read`. An agency or multi-location key reaches every business it manages:
each node has a **Business** dropdown.

Plans: the trigger needs Pro or Premium (webhooks); review requests need Premium.

## Authentication

1. Open https://my.grades.com/connect?connect=n8n (sign in if asked).
2. Click **Create key**: the key is named "n8n" and gets `reviews:read`, `reviews:write` and `companies:read`.
3. In n8n add a credential **Grades.com API** and paste the key (starts with `gk_live_`, shown once).

The credential test calls `GET https://app.grades.com/api/v1/me`. API reference: https://app.grades.com/api/documentation.

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
