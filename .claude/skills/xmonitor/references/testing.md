# Testing map

Rule from CLAUDE.md: pinned tests before live tests. A pinned pass on a risky path is never
approval for the live action. `test_workflow` runs the **draft** — check publish state separately.

## Offline (no n8n access needed) — run from repo root with Node

| Command | Proves |
| --- | --- |
| `node tests/n8n/moderation-queue-drain.test.mjs` | Drain decision logic against `moderation-queue-drain-pins/` (rate limit 429, quota mid-batch, attempts exhausted, permanent failures, unauthorized). Hide endpoint is never called. |
| `node tests/n8n/t3-alert-routing.test.mjs` | Per-client alert routing from the real scheduler Code-node bodies (both exports). |
| `node tests/n8n/t3-alert-routing-fixtures.test.mjs` | The three `tenancy-pins/` fixtures end to end through the prod scheduler export. |
| `node tests/n8n/telegram-router-retry-guard.test.mjs` | `retryOnFail` is explicitly `false` on `Place Comment Order` / `Place Likes Order` in both routers (SMM `add` is non-idempotent — a retry is a second charged order). Run after any router edit or node typeVersion bump. |
| `node tests/n8n/scheduled-post-native-sentiment.test.mjs` | Native-sentiment staging export shape. |

Offline pattern for new tests: load the export JSON, pull a node's `jsCode`, execute with
`new Function('$','$input',...)`. `scripts/apply-t3-alert-routing.mjs` shows the idempotent
transform-script style for edits made without live n8n access.

## Needs live n8n / Supabase (staging)

| Command / fixture set | Notes |
| --- | --- |
| `tests/n8n/scheduled-tracking-pins/run-pins.sh [substring]` | Drives `test_workflow` over HTTP MCP (needs `N8N_MCP_URL`/`N8N_MCP_ACCESS_TOKEN` in `keys.env`). Refuses to run if the target is active and `versionId != activeVersionId`. Default target staging `l4eKZucUZXzfz0H8`; `XMONITOR_WORKFLOW_ID=Emb26wP77eFXgnVi` for prod. `watermark-*` fixtures really write `Run State`; the script snapshots, asserts and restores it. |
| `tests/n8n/telegram-router-risky-pins/*.pinData.json` | Pass as `pinData` to `test_workflow` on router staging `oLwwjO05IcRjtF8E`. Index in its `manifest.json` / README. Covers hide-replies menu/percent/enqueue, order_likes, order_comments (confirm/cancel/invalid/no-service-id/provider-error), track-users, unknown-command help. |
| `tests/n8n/order-status-polling-pins/` | Pins for the order poller; `manifest.json` lists them. Three charge-preservation fixtures leave `Update Order Info Status` unpinned and need a seeded `Order Info` row — insert/reset/cleanup SQL is in that manifest; delete the row afterwards. |
| `tests/n8n/tenancy-pins/` | Authorization isolation fixtures (cross-tenant hide, client track refusal). README explains the shape. |
| `reply-sentiment-persistence.test.mjs`, `reply-sentiment-live-staging.test.mjs`, `native-sentiment-accuracy.integration.test.mjs`, `order-info-database.integration.test.mjs` | Create temp workflows in n8n. The live one targets a 2026-08-24 post and returns 0 replies unless `Build Replies Query` `LOOKBACK_DAYS` is temporarily widened (~60); revert and re-export afterwards. Read the file header before running. |

## Pin discipline

- Pin every credentialed or side-effecting node on a risky path: X HTTP, SMM HTTP, Supabase
  writes, Telegram sends / sendAndWait, AI generation. New external node on such a path → add its
  pin before running.
- `prepare_workflow_pin_data` lists nodes needing pins. Unknown node names in a fixture mean the
  fixture drifted — update it; do not drop pins from credentialed/HTTP nodes to make it run.
- Pin data lands on a node's **output 0 only**. For multi-output nodes (If, Switch, Sentiment
  Analysis, Text Classifier) pin the first downstream merge node instead.
- Callback paths pin `callback_query` data: `snooze:<POST_ID>`, `snooze_duration:<POST_ID>:24h`,
  `resume:<POST_ID>`, `hide_replies:<POST_ID>` (opens menu only), `hide_pct:<POST_ID>:<25|50|75|100|custom>`,
  `order_likes:<POST_ID>`.
- The router's X-Monitor service ids come from `FB SMM Settings` (`provider='smmwiz_x'`); fixtures
  pin them as `12104` (likes) / `8404` (comments).

## Safe live staging checks (no approval)

`/help`, invalid-command validation, pinned `/auth_x`, snooze/resume row transitions with
snapshots, manual schedule execution, Supabase reads. Telegram: use the shared test client
(see `ids-and-access.md`).
