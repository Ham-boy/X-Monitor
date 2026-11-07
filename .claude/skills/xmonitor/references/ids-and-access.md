# IDs and access

Source of truth: `docs/workflows/README.md` + `workflows/manifest.json` (manifest `exportedAt`
is 2026-10-10 and lags some updates — live n8n wins). Last verified here: 2026-11-07.

## Workflows

| Workflow | Env | n8n ID | Active | Export |
| --- | --- | --- | --- | --- |
| Telegram Router | prod | `cWczsttyDbTBbRAC` | yes | `workflows/active/xmonitor-telegram-router.json` |
| Telegram Router Staging | staging | `oLwwjO05IcRjtF8E` | yes | `workflows/staging/xmonitor-codex-staging.json` |
| Scheduled Post Tracking | prod | `Emb26wP77eFXgnVi` | yes | `workflows/active/xmonitor-scheduled-post-tracking.json` |
| Scheduled Post Tracking Staging | staging | `l4eKZucUZXzfz0H8` | **no, intentional** | `workflows/staging/xmonitor-scheduled-post-tracking-staging.json` |
| Scheduled Post Tracking Native Sentiment Staging | staging | `f2eFqB2wO91HAYMJ` | no | `workflows/staging/xmonitor-scheduled-post-tracking-native-sentiment-staging.json` |
| Moderation Queue Drain | prod | `vm4UNW7OIx2zEGb4` | yes | `workflows/active/xmonitor-moderation-queue-drain.json` |
| Moderation Queue Drain (Staging) | staging | `xt8fLOmRvDvTdZT9` | yes | `workflows/staging/xmonitor-moderation-queue-drain-staging.json` |
| Orders - Order Status Poll | prod | `XPfhrrXEOcavSb94` | yes (not yet called as of 10-23) | `workflows/active/orders-order-status-poll.json` (+`.sdk.js`) |
| Orders - Order Status Poll (Staging) | staging | `iKtxEUBYy5ZFlbaB` | yes | `workflows/staging/orders-order-status-poll-staging.json` (+`.sdk.js`) |
| X OAuth Callback | prod | `JQ9KM3l1kRJQhWxb` | yes | `workflows/active/xmonitor-x-oauth-callback.json` |
| X OAuth Callback Staging | staging | `gji3bQd2LdodwEJR` | yes | webhook path `x-oauth-callback-staging` (no local export) |
| Production Developer Error Alerts | prod | `UmKr9JkZ3ec3GDH5` | no | `workflows/active/xmonitor-production-developer-error-alerts.json` |
| Staging Developer Error Alerts | staging | `CCzwnMyoy7UequuI` | yes | `workflows/staging/xmonitor-staging-developer-error-alerts.json` |
| Sentiment Cheat Sheet Review Staging | staging | `sidiEHY92PD5jwYG` | no — do not activate until router handles `cheatsheet_activate:` / `cheatsheet_discard:` | `workflows/staging/xmonitor-sentiment-cheat-sheet-review-staging.json` |
| Telegram Bot Command Menu Setup Staging | staging utility | `Rwsu0hUtYA0Ithpl` | draft | `scripts/set-telegram-bot-commands.ps1` |
| Order Status Polling (old, X-only) | staging / prod | `ceX1EiVN3bFWARMu` / `AqdNgOKRXG6J5zbj` | no — superseded 2026-10-23 | `workflows/*/xmonitor-order-status-polling*.json` |
| Media Sentiment Test Bench / Accuracy Benchmark | test | `f1qYeYS5i8pvvKxH` / `F7VkkER6k85DGkmG` | draft | `tests/n8n/media-sentiment-accuracy-cases.json` |

Old unexported copies (ignore): ChatGPTAgentTest `eBDpIFQiRgXgNPFI`, V2 - Fixes `1cqfirUF8k7g0T0K`,
Router "Tarek's copy" `y186BvZnuWWjHgpn`, "TAREK's NEW copy" `fO46JHDF8LtIFcAo`.

Doc file for a workflow: `docs/workflows/xmonitor-<kebab-name>.md`; the order poller is
`orders-order-status-poll.md` (one doc, both envs); the drain's one doc is the `-staging` file.

## Supabase

| Env | Project ref |
| --- | --- |
| Staging | `npytqidroqxgikaqofmq` |
| Production | `jxnzdxyhoakpfmkbjdeq` |

Tables seen in docs/migrations: `Posts`, `Replies`, `Run State`, `Order Info`, `X Auth Accounts`,
`Moderation Queue`, `FB SMM Settings` (X ids at `provider = 'smmwiz_x'`), `SMM Service ID History`,
`Sentiment Cheat Sheets`, `Clients`, `Client Members`, `Staff`, tracked-users table (soft-delete).
Schema changes live in `db/migrations/YYYY-MM-DD-*.sql` — add a new dated file for every change.
For columns, run `list_tables`/`execute_sql` rather than guessing.
Staging test data to prefer: X user `951803761` / `RebelHam_`; posts `2060604129798496702`,
`2058879475094266262`. Snapshot `status`, `snooze_runs_remaining`, `reply_id`, `post_id` first.

## Access

### 1. claude.ai connectors (preferred)
Deferred and UUID-named; **the UUID prefix changes between sessions** (it has been `93eb15b9…`/`d783183a…`
and, on 2026-11-07, `82d0add1…` for n8n and `0087c9dc…` for Supabase). Never hard-code one.
The tool list in the session's `<system-reminder>` shows the names. Load with one call:

`ToolSearch select:<n8n-prefix>__get_workflow_details,<n8n-prefix>__update_workflow,<n8n-prefix>__publish_workflow,<n8n-prefix>__test_workflow,<n8n-prefix>__search_workflows,<n8n-prefix>__validate_node_config,<supabase-prefix>__execute_sql`

n8n tools: `search_workflows`, `get_workflow_details`, `update_workflow`, `publish_workflow`,
`unpublish_workflow`, `test_workflow`, `execute_workflow`, `get_workflow_execution`,
`search_workflow_executions`, `prepare_workflow_pin_data`, `validate_node_config`,
`get_workflow_versions_diff`, `restore_workflow_version`, `create_workflow_from_code`.
Supabase tools: `execute_sql`, `list_tables`, `apply_migration`, `list_migrations`, `get_advisors`,
`query_logs`.
A tool listed ≠ working: make one real read before building on it. Absence at session start can
last an hour — keep re-probing (or ask the user to recheck connectors) before saying "unreachable".
Always call `get_user_preferences` (n8n) before creating/modifying anything there.

### 2. n8n MCP over HTTP (fallback)
`keys.env` (gitignored) variable names, verified 2026-11-07: `N8N_BASE_URL`, `N8N_API_KEY`
(expired 2026-07-12 — REST dead), `N8N_MCP_URL`, `N8N_MCP_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
`STAGING_TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_TEST_API_ID/HASH/SESSION`,
`X_OAUTH_CLIENT_ID/SECRET`. (CLAUDE.md's "only Supabase + Telegram tokens" is outdated — the n8n
MCP vars are present. Re-check with `grep -o '^[A-Z0-9_]*=' keys.env`; never print values.) POST JSON-RPC to `$N8N_MCP_URL` with
`Authorization: Bearer $N8N_MCP_ACCESS_TOKEN`, `Accept: application/json, text/event-stream`;
replies are SSE, parse the `data:` line. Args here: `workflowId` (not `id`); executions need
`includeData: true`; payload at `response.data.resultData`.
`tests/n8n/scheduled-tracking-pins/run-pins.sh` uses this route.

### 3. Supabase over HTTP
POST `{"query":"..."}` to `https://api.supabase.com/v1/projects/<ref>/database/query` with
`Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Build the body with `node -e`; use `$$…$$` quoting.

### Codex-only (ignore on Claude)
`scripts/configure-*.ps1`, `codex mcp …`, the `x-api` server. Not reachable from Claude Code.

### Telegram
Staging bot token is `STAGING_TELEGRAM_BOT_TOKEN`; production bot is `@trackedUsersManagerBot`
(`TELEGRAM_BOT_TOKEN`). Live bot testing: shared client at
`C:\Users\User\.claude\tools\telegram-test-client\` (README first; standing permissions are in the
global CLAUDE.md). Command menus: set default scope **and** `all_private_chats`; verify with
`getMe` + `getMyCommands`. Prod menu deliberately differs from staging (no `/track`, different
`/snooze` text) — never run `scripts/set-telegram-bot-commands.ps1` against prod; patch single
descriptions.
