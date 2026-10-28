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

API reference: app.grades.com `www/docs/integrations.md` (webhook events, REST hooks, samples) and `www/docs/api-v1.md`.

## Publishing (Mike)

Agents never publish. With the npm account that should own the package (e.g. `support@grades.com`, 2FA on):

```bash
npm login
npm ci && npm test
npm publish --access public
```

(`prepack` builds `dist/` first.) For an update: bump `version` in `package.json`, then the same `npm publish`.

Then, optionally, ask n8n to verify the node (verified community nodes show up in n8n Cloud's node panel): the n8n
Creator Portal (<https://creators.n8n.io>) > submit `n8n-nodes-grades`. n8n's rules: MIT license (done), no runtime
dependencies (done), the `n8n-community-node-package` keyword (done), README with usage (this file).
