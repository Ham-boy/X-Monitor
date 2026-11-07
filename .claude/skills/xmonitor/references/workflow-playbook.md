# Workflow playbook

## Edit mechanics (n8n MCP)

- `update_workflow` takes a batch of operations and is **atomic** — a failed op saves nothing.
- `setNodeParameter` cannot index into arrays. For message lists, Switch `rules.values`, Telegram
  `inlineKeyboard.rows`, use `updateNodeParameters` with `replace: false` and the whole containing
  object (shallow merge keeps siblings).
- `retryOnFail` / `executeOnce` / `alwaysOutputData` set in `create_workflow_from_code` config are
  dropped — set them afterwards with `update_workflow` + `setNodeSettings`, then re-read.
- If you must push JSON via REST, send only `name`, `nodes`, `connections`, minimal `settings`.
  Credential bindings get lost on JSON pushes — check them after (see n8n-workflow-release skill).
- Order placement nodes (`Place Comment Order`, `Place Likes Order`) must never retry; run
  `telegram-router-retry-guard.test.mjs` after any router change.

## Publish state

After every edit: `get_workflow_details` → `versionId` must equal `activeVersionId`. If not,
`publish_workflow` and re-read. Exception: Scheduled Post Tracking Staging
(`l4eKZucUZXzfz0H8`) stays unpublished. Publishing an already-active staging workflow needs no
approval; flipping active/inactive does. Production publish rides on the approval for the
production change itself — say so explicitly if you choose not to publish.

## Change surface (what else moves)

- Router: parser, switch outputs, action nodes, buttons, help/default-help, command menus,
  docs, exports, pins, retry-guard test.
- Scheduled tracking: X fields/includes, reply attachment, sentiment shape, upserts, suppression/
  snooze, alert text, docs, exports, scheduler pins. Alert button payloads couple scheduler ↔
  router — change one, test both.
- Orders: router order creation, `Order Info` schema, poller, provider status mapping,
  `Posts.status`, final notification dedupe, docs, exports, SMM/Telegram pins.
- Sentiment model: staging and prod scheduler together (currently `gpt-5.4-mini`); keep probe
  request bodies matched (`max_completion_tokens` for gpt-5 family).

## Promotion staging → production

Prod credentials, activation state, webhook paths and env-specific token vars must survive.
Recipe that worked (2026-10-03): diff staging versions with `get_workflow_versions_diff` (a
subagent is good for this) → assert the touched prod nodes equal the staging base → generate
`update_workflow` ops with the prod credential swapped in → simulate on a copy of the prod draft
→ apply → re-read the saved draft → run the pinned fixtures against the prod draft with
`test_workflow` → publish → confirm `versionId == activeVersionId`.
In **auto** permission mode the harness classifier refused prod writes (2026-08-30); bypass mode
did not. If blocked: do the staging half, leave prod untouched, write the prod half as an
idempotent transform script anchored on node names, hand the user ordered commands, and say
plainly that nothing reached production.
Never push the staging command menu to the prod bot.

## Sync checklist (part of the change, not follow-up)

1. Local export under `workflows/` (re-export from live; Node, not PowerShell).
2. `docs/workflows/<doc>.md`; `docs/workflows/README.md` if identity/status changed.
3. `workflows/manifest.json` `updatedAt` if you re-exported.
4. `CHANGELOG.md` `[Unreleased]` entry, newest-first, naming workflow + environment + IDs.
5. `db/migrations/<date>-<name>.sql` for any schema change.
6. `TASK_TODOLIST.md`: only when asked to add/analyze a task or a decision stays open. Move to
   `Completed Tasks` only when production matches; staging validation keeps it open with
   evidence in Notes. The file is large — grep its headings, edit in place.
7. Scripts/fixtures that rely on the changed behavior.
8. If a rule in CLAUDE.md changed, mirror it in `.codex/skills/xmonitor-workflows/`.

## Product conventions (details beyond CLAUDE.md)

- Alert metrics state the denominator: hidden vs non-hidden = stored *analyzed negative* replies.
- Hide flow: alert button `hide_replies:<POST_ID>` opens a percentage menu; `hide_pct:…` enqueues
  into `Moderation Queue` (oldest-first by numeric snowflake id; only Negative replies are
  candidates; already-hidden counts toward the target); the drain workflow does the X hides.
- Snooze: `Posts.snooze_runs_remaining`, durations `1h 4h 12h 24h`, button and command forms.
- Order status poller is unified across X/FB/IG, webhook-triggered by pg_cron `order-status-polls`
  only when orders are due; production side waits on Vault `order_poll_secret` /
  `order_poll_webhook_url` and enabling the cron (user steps).
- X OAuth client secret lives only in n8n Basic Auth credential **Delphi X OAuth Client**
  (`7YhRjDMkZBG1P1ka`); never copy its value anywhere.
- `/auth_x` requests scopes `tweet.read users.read tweet.write tweet.moderate.write offline.access`.
- Staging credentials in n8n: `Supabase Staging API`, `Supabase Staging Postgres`,
  `Testing Telegram API`, `Bearer Auth account`, `OpenAi account 2`.
