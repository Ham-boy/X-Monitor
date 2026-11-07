# Known traps (each one has already cost a session)

| Trap | What to do |
| --- | --- |
| n8n workflow SDK (`create_workflow_from_code`, `validate_workflow`) rejects native JS methods like `.join()`; error reads "Unterminated string constant" on an unrelated line | Check for `.join(` first. Use template literals for `jsCode`/`query`/sticky text; no backticks or `${` inside; escape backslashes when converting. `sticky(content, [anchors], {color})` is positional. `INVALID_EXPRESSION_PATH` on fields built via `Object.assign` is a false positive. |
| `setNodeParameter` fails on arrays | `updateNodeParameters`, `replace:false`, whole containing object. |
| `test_workflow` passes but live is unchanged | It runs the draft. Compare `versionId` vs `activeVersionId`; publish. |
| Pin on multi-output node labels everything output 0 | Pin the downstream merge node (`Merge Sentiment Results` for sentiment). Missing planned reply in that pin = classification failure by design. |
| Quoted bash heredocs collapse `\\` to `\`; long apostrophe-heavy heredocs abort | No literal backslashes in heredoc-written JS: `String.fromCharCode(92)`, `new RegExp(pieces)`. Or use the Write tool, or splice from fragment files. |
| Repo files are CRLF; multi-line `String.replace` anchors silently fail | Split on `/\r?\n/`, edit by line, rejoin with detected EOL; verify with `grep -c`. |
| PowerShell 5.1 `ConvertFrom-Json`→`ConvertTo-Json` mangles `connections` and truncates depth; `Out-File -Encoding utf8` adds a BOM that breaks `curl --data-binary` | Node for JSON; `[System.IO.File]::WriteAllText` for curl bodies. |
| Connectors "missing" at session start | They are deferred and UUID-named, and the UUID changes. Load with `ToolSearch select:…` from the names in the system reminder; re-probe before declaring unreachable. |
| `.claude/worktrees` copy is stale | Worktrees branch from an older HEAD; real working state is in the main dir. `git status` there first. |
| `npm install` leaves `node_modules/.bin` empty on Windows | Re-run plain `npm install` to regenerate shims. |
| PostgREST caps at 1000 rows (console) | `readAllPages`. |
| Console agent testing (sibling repo `../X-Monitor-Console`) | Staging: `npx next dev -p 3123`. Prod read-only real data: `npm run dev:production` → `http://127.0.0.1:3124`. Both skip sign-in. Verify page numbers with `execute_sql`, not by trusting the page. |
| `reply-sentiment-live-staging` returns 0 replies | Post is from 2026-08-24; widen `LOOKBACK_DAYS` temporarily, then revert and re-export. |
| Telegram menu seems unchanged | Private-chat scope overrides the default scope; set both and check `getMyCommands` for each. |
| "It didn't work" after a 200 from the API | Verify from the user's surface: bot identity, command scopes, message text, DB rows, active version, live execution data. |
| Secrets in exports | Describe the risk, never copy the value. Summarize credentials as present/missing. |
