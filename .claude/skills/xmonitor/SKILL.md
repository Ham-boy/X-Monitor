---
name: xmonitor
description: "Use for ANY work in the X-Monitor project: n8n workflows that monitor X replies for negative sentiment, the Telegram router/bot, scheduled post tracking, moderation queue drain, order status polling, SMM orders, X OAuth, Supabase tables/migrations, pinned tests, staging-to-production promotion. Holds workflow IDs, project refs, tool-loading recipe, test commands and known traps so you do not re-derive them from docs, memory or live n8n each session."
---

# X-Monitor quick-start

Safety rules (staging default, publish check, approval list, report format) live in `CLAUDE.md`
and are already in context — do not restate them here. This skill is the **lookup layer**:
read it first, then open only the one reference or doc you need.

## Route in 30 seconds

| Task | Read |
| --- | --- |
| Which workflow / ID / export / environment? | `references/ids-and-access.md` |
| How do I reach n8n / Supabase / Telegram? | `references/ids-and-access.md` § Access |
| Edit, test, publish, promote a workflow | `references/workflow-playbook.md` |
| Which test or pin fixture proves X? | `references/testing.md` |
| Something weird (SDK errors, pins, CRLF, heredocs) | `references/traps.md` |
| What a workflow does, its tables and side effects | `docs/workflows/<name>.md` (only that one) |
| Task intake / history | `TASK_TODOLIST.md` (116 KB — grep a heading, never read whole), `CHANGELOG.md` (newest-first, read the top only) |

## Standard loop for a workflow change (staging)

1. `docs/workflows/<doc>.md` for the workflow (IDs table in `references/ids-and-access.md`).
2. Load n8n tools via `ToolSearch` (recipe in `references/ids-and-access.md`), then
   `get_workflow_details` — live is truth; the local export may be stale.
3. Smallest `update_workflow` batch; `validate_node_config` for new/replaced non-trivial nodes.
4. Re-read: `versionId == activeVersionId`? If not, `publish_workflow` (except Scheduled Post
   Tracking Staging, which is intentionally unpublished).
5. Pinned test first (`references/testing.md`), then safe live staging check.
6. Sync: local export in `workflows/`, the workflow doc, `docs/workflows/README.md` if identity or
   status changed, `CHANGELOG.md` (Unreleased), `TASK_TODOLIST.md` only per CLAUDE.md intake rule.
7. Close with the four-heading report from CLAUDE.md.

## Commit conventions

- Author: `Hamdi Said <hamdisaid123@gmail.com>`. Never the `BRT.HSAID@cma-cgm.com` address
  (it makes Vercel block deploys). Do not copy the identity from `git log` — older history uses
  the wrong one. Set it repo-locally if git refuses to commit.
- Commit only when asked, or when the work is complete and validated; stage only files from
  this task. Ask first for anything that enables live X writes or SMM orders.
- Repo files are **CRLF**: multi-line string-replace patch scripts silently match nothing.
  Verify every patch landed (`grep -c`).
- Check `git status` in the main directory before editing docs or the todolist; worktrees branch
  from an older HEAD.

## Environment

- Git Bash + PowerShell on Windows. Node 24 is on PATH; **Python and jq are absent**.
- Complex workflow JSON rewrites: Node, never PowerShell `ConvertFrom/To-Json`.
- Console app lives in sibling repo `../X-Monitor-Console` (Next.js). See `references/traps.md`.

## Keeping this skill current

When an ID, project ref, access route or test command changes, update the matching reference
file here in the same change. If you change a rule in `CLAUDE.md`, mirror it in
`.codex/skills/xmonitor-workflows/` as CLAUDE.md already requires.
