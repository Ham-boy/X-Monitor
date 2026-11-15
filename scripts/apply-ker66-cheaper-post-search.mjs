// KER-66: cheaper hourly X post search for XMonitor - Scheduled Post Tracking.
//
// Idempotent transform over a workflow export. It is the single description of the change:
// it produced the staging edit, the offline test runs it against both exports, and a
// production promotion is this same transform applied to the production export.
//
//   node scripts/apply-ker66-cheaper-post-search.mjs <export.json>            # report only
//   node scripts/apply-ker66-cheaper-post-search.mjs <export.json> --write    # rewrite the file
//
// Nothing here is environment-specific: no credentials, ids, chat ids or activation state
// are touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WIDE_KEY = 'scheduled_post_tracking_wide_search';

const GET_RUN_STATE_SQL = [
  '-- Ensure both marker rows exist and return them as ONE row with this run\'s start time.',
  '--   scheduled_post_tracking             : reply watermark, advanced at the end of every successful pass.',
  '--   scheduled_post_tracking_wide_search : last completed 7-day post search (KER-66). Advanced by the',
  '--                                         same two writers, on a wide pass only.',
  'WITH ensured AS (',
  '  INSERT INTO public."Run State" (key, last_successful_run_at)',
  `  VALUES ('scheduled_post_tracking', NULL), ('${WIDE_KEY}', NULL)`,
  '  ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key',
  '  RETURNING key, last_successful_run_at',
  ')',
  'SELECT',
  "  'scheduled_post_tracking'::text AS key,",
  "  (SELECT last_successful_run_at FROM ensured WHERE key = 'scheduled_post_tracking') AS last_successful_run_at,",
  `  (SELECT last_successful_run_at FROM ensured WHERE key = '${WIDE_KEY}') AS last_wide_search_at,`,
  '  now() AS run_started_at;',
].join('\n');

const advanceSql = (comment) => [
  ...comment,
  '-- KER-66: on a wide pass ($2) the wide-search marker moves with it, so a wide pass that',
  '-- did not finish is repeated on the next hourly pass instead of six hours later.',
  'WITH wide AS (',
  '  UPDATE public."Run State"',
  '  SET last_successful_run_at = $1::timestamptz,',
  '      updated_at             = now()',
  `  WHERE key = '${WIDE_KEY}' AND $2::boolean`,
  '  RETURNING key',
  ')',
  'UPDATE public."Run State"',
  'SET last_successful_run_at = $1::timestamptz,',
  '    updated_at             = now()',
  "WHERE key = 'scheduled_post_tracking'",
  'RETURNING key, last_successful_run_at, (SELECT count(*) FROM wide)::int AS wide_search_marker_advanced;',
].join('\n');

const ADVANCE_REPLACEMENT = "={{ [$('Get Run State').first().json.run_started_at, $('Build X API Query').first().json.wide_search === true] }}";

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(find, () => replacement);
}

export function applyKer66(workflow) {
  const node = (name) => {
    const found = workflow.nodes.find(n => n.name === name);
    if (!found) throw new Error(`node not found: ${name}`);
    return found;
  };
  const changes = [];
  const set = (name, mutate) => {
    const target = node(name);
    const before = JSON.stringify(target);
    mutate(target);
    if (JSON.stringify(target) !== before) changes.push(name);
  };

  // 1. The query: filters, wide/narrow window, chunking.
  set('Build X API Query', (n) => {
    n.parameters.jsCode = fs.readFileSync(path.join(HERE, 'ker66', 'build-x-api-query.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  });

  // 2. One request per chunk, paced under X's 1 request/second ceiling (same as Get Replies).
  set('Get posts of tracked users', (n) => {
    n.parameters.options = n.parameters.options || {};
    n.parameters.options.batching = { batch: { batchSize: 1, batchInterval: 1100 } };
  });

  // 3. Run state: read the wide-search marker, and advance it with the watermark.
  set('Get Run State', (n) => { n.parameters.query = GET_RUN_STATE_SQL; });
  set('Advance Run State', (n) => {
    n.parameters.query = advanceSql([
      '-- Reached only once every fetched reply is stored with its sentiment.',
      '-- The OpenAI failure path never reaches this node, so an aborted pass',
      '-- leaves the marker untouched and the next run re-reads the same window.',
    ]);
    n.parameters.options = { ...(n.parameters.options || {}), queryReplacement: ADVANCE_REPLACEMENT };
  });
  set('Advance Run State (Quiet Pass)', (n) => {
    n.parameters.query = advanceSql([
      '-- Quiet pass: nothing new to score, which is a successful outcome, so the',
      '-- watermark still advances.',
    ]);
    n.parameters.options = { ...(n.parameters.options || {}), queryReplacement: ADVANCE_REPLACEMENT };
  });

  // 4. Replies for posts older than the narrow window are read from the previous wide pass.
  set('Build Replies Query', (n) => {
    let code = n.parameters.jsCode;
    if (code.includes('wideCatchUp')) return;
    code = replaceOnce(code,
      'const BACKFILL_LEAD_MINUTES = 1;           // start just before the post itself\n',
      'const BACKFILL_LEAD_MINUTES = 1;           // start just before the post itself\n'
      + 'const NARROW_WINDOW_HOURS = 48;            // keep in step with Build X API Query\n'
      + 'const OLDER_POST_MARGIN_HOURS = 2;         // over-read rather than under-read at the boundary\n',
      'Build Replies Query constants');
    code = replaceOnce(code,
      'const hasWatermark = Boolean(lastRun && !Number.isNaN(lastRun.getTime()));\n',
      'const hasWatermark = Boolean(lastRun && !Number.isNaN(lastRun.getTime()));\n'
      + '\n'
      + '// KER-66: wide/narrow post search state. See Build X API Query.\n'
      + 'const lastWideRaw = runState.last_wide_search_at ? new Date(runState.last_wide_search_at) : null;\n'
      + 'const lastWide = lastWideRaw && !Number.isNaN(lastWideRaw.getTime()) ? lastWideRaw : null;\n'
      + 'let wideSearch = false;\n'
      + 'try {\n'
      + "  wideSearch = $('Build X API Query').first()?.json?.wide_search === true;\n"
      + '} catch (e) {\n'
      + '  wideSearch = false;\n'
      + '}\n',
      'Build Replies Query run state');
    code = replaceOnce(code,
      '// Already-collected posts keep the cheap incremental window.\n'
      + 'if (incrementalIds.length > 0) {\n'
      + '  const startTime = clampWindow(new Date(lastRun.getTime() - OVERLAP_MINUTES * 60000));\n'
      + '  for (const ids of chunkIds(incrementalIds)) {\n'
      + '    groups.push({ ids, startTime, isBackfill: false });\n'
      + '  }\n'
      + '}\n',
      '// Already-collected posts keep the cheap incremental window.\n'
      + '//\n'
      + '// KER-66: a post older than the narrow post-search window is only searched on a wide\n'
      + '// pass, so on the passes in between its replies are not requested at all. On a wide\n'
      + '// pass it must therefore be read from the PREVIOUS wide pass, not from the hourly\n'
      + '// watermark, or every reply that arrived in between is skipped for good. "Older" sits\n'
      + '// a margin below the narrow window, so a post that was still inside it an hour ago is\n'
      + '// over-read rather than under-read; duplicates drop by reply_id downstream.\n'
      + 'if (incrementalIds.length > 0) {\n'
      + '  const recentStart = clampWindow(new Date(lastRun.getTime() - OVERLAP_MINUTES * 60000));\n'
      + '  const catchUpFrom = wideSearch && lastWide && lastWide.getTime() < lastRun.getTime() ? lastWide : null;\n'
      + '  const olderCutoff = runStartedAt.getTime() - (NARROW_WINDOW_HOURS - OLDER_POST_MARGIN_HOURS) * 3600000;\n'
      + '  const recentIds = [];\n'
      + '  const olderIds = [];\n'
      + '  for (const id of incrementalIds) {\n'
      + '    const createdAt = createdAtByConversation.get(id);\n'
      + '    if (catchUpFrom && (!createdAt || createdAt.getTime() < olderCutoff)) olderIds.push(id);\n'
      + '    else recentIds.push(id);\n'
      + '  }\n'
      + '  for (const ids of chunkIds(recentIds)) {\n'
      + '    groups.push({ ids, startTime: recentStart, isBackfill: false, wideCatchUp: false });\n'
      + '  }\n'
      + '  if (olderIds.length > 0) {\n'
      + '    const olderStart = clampWindow(new Date(catchUpFrom.getTime() - OVERLAP_MINUTES * 60000));\n'
      + '    for (const ids of chunkIds(olderIds)) {\n'
      + '      groups.push({ ids, startTime: olderStart, isBackfill: false, wideCatchUp: true });\n'
      + '    }\n'
      + '  }\n'
      + '}\n',
      'Build Replies Query incremental block');
    code = replaceOnce(code,
      '    is_backfill: group.isBackfill,\n',
      '    is_backfill: group.isBackfill,\n    wide_catch_up: group.wideCatchUp === true,\n',
      'Build Replies Query output');
    n.parameters.jsCode = code;
  });

  // 5. A pass that finds no post at all must still end as a quiet pass. Before this the
  //    run simply stopped at Split Out Posts and neither marker moved; with a 48-hour
  //    window that is an ordinary outcome, not a rare one.
  set('Split Out Posts', (n) => { n.alwaysOutputData = true; });
  set('Filter Suppressed Posts', (n) => {
    let code = n.parameters.jsCode;
    if (code.includes('no_candidate_posts')) return;
    code = replaceOnce(code,
      'return $input.all()\n'
      + "  .filter(item => !blocked.has(String(item.json.id || '')))\n"
      + '  .map(item => {\n',
      '// KER-66: Split Out Posts now always emits, so an empty search arrives as one item\n'
      + '// with no id. When nothing is left - nothing returned, or every post suppressed -\n'
      + '// hand the reply-count filter one placeholder it is certain to discard, so the pass\n'
      + '// still reaches Assess Quiet Outcome and the run state advances.\n'
      + "const returnedPosts = $input.all().filter(item => String(item.json?.id || '').trim());\n"
      + 'const visiblePosts = returnedPosts.filter(item => !blocked.has(String(item.json.id)));\n'
      + 'if (visiblePosts.length === 0) {\n'
      + '  return [{\n'
      + '    json: {\n'
      + '      no_candidate_posts: true,\n'
      + '      returned_post_count: returnedPosts.length,\n'
      + '      public_metrics: { reply_count: -1 },\n'
      + '      client_min_replies: DEFAULT_MIN_REPLIES,\n'
      + '    },\n'
      + '  }];\n'
      + '}\n'
      + '\n'
      + 'return visiblePosts\n'
      + '  .map(item => {\n',
      'Filter Suppressed Posts return');
    n.parameters.jsCode = code;
  });

  // 6. A post search cut short by the page cap on a QUIET pass held the watermark but
  //    told nobody. Route the quiet outcome through the same truncation check.
  const quiet = workflow.connections['Assess Quiet Outcome'];
  if (!quiet || !quiet.main || !quiet.main[0]) throw new Error('Assess Quiet Outcome has no main output');
  if (!quiet.main[0].some(c => c.node === 'If Fetch Truncated')) {
    quiet.main[0].push({ node: 'If Fetch Truncated', type: 'main', index: 0 });
    changes.push('connection: Assess Quiet Outcome -> If Fetch Truncated');
  }
  set('Build Truncation Alert', (n) => {
    let code = n.parameters.jsCode;
    if (code.includes('Neither Run State marker')) return;
    code = replaceOnce(code,
      "      + 'Because the replies query is incremental, the unread replies are NOT re-requested on the next pass - the run state has already moved past them. '\n"
      + "      + 'Raise maxRequests on the affected node and re-run a backfill with a null Run State watermark.',\n",
      "      + 'Neither Run State marker was advanced, so the next pass re-reads the same window; what was fetched has still been stored. '\n"
      + "      + 'If this repeats, the results no longer fit under the page cap: raise maxRequests on the affected search node.',\n",
      'Build Truncation Alert message');
    n.parameters.jsCode = code;
  });

  return changes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: apply-ker66-cheaper-post-search.mjs <export.json> [--write]'); process.exit(2); }
  const raw = fs.readFileSync(file, 'utf8');
  const workflow = JSON.parse(raw);
  const changes = applyKer66(workflow);
  console.log(changes.length ? `changes (${changes.length}):\n  ${changes.join('\n  ')}` : 'already applied - no changes');
  if (process.argv.includes('--write') && changes.length) {
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const indent = (raw.match(/^\{\r?\n( +)"/) || [])[1] || '  ';
    fs.writeFileSync(file, JSON.stringify(workflow, null, indent.length).replace(/\n/g, eol) + (raw.endsWith('\n') ? eol : ''));
    console.log('written', file);
  }
}
