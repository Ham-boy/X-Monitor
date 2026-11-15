// KER-66 - cheaper hourly X post search. Offline: no n8n, X or Supabase access needed.
//
//   node tests/n8n/ker66-post-search.test.mjs
//
// Applies scripts/apply-ker66-cheaper-post-search.mjs to an in-memory copy of BOTH exports
// (so it proves the change on production's graph without touching production) and runs the
// real Code-node bodies against synthetic run state.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { applyKer66, WIDE_KEY } from '../../scripts/apply-ker66-cheaper-post-search.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPORTS = {
  staging: 'workflows/staging/xmonitor-scheduled-post-tracking-staging.json',
  production: 'workflows/active/xmonitor-scheduled-post-tracking.json',
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok   - ' + name); };

function runCode(workflow, nodeName, { input = [], nodes = {} }) {
  const code = workflow.nodes.find(n => n.name === nodeName).parameters.jsCode;
  const wrap = (items) => ({ all: () => items, first: () => items[0] });
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node has not run: ' + name);
    return wrap(nodes[name].map(json => ({ json })));
  };
  const fn = new Function('$', '$input', '$json', code);
  return fn($, wrap(input.map(json => ({ json }))), input[0] || {}).map(item => item.json);
}

const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();

for (const [env, file] of Object.entries(EXPORTS)) {
  console.log(`\n${env}: ${file}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  applyKer66(workflow);
  const second = applyKer66(JSON.parse(JSON.stringify(workflow)));
  test('transform is idempotent', () => assert.deepEqual(second, []));

  const now = Date.now();
  const users = (n, len = 15) => Array.from({ length: n }, (_, i) => ({ username: ('user' + i).padEnd(len, 'x') }));
  const query = (runState, tracked = [{ username: 'alpha' }, { username: 'beta' }]) =>
    runCode(workflow, 'Build X API Query', { input: tracked, nodes: { 'Get Run State': [runState] } });

  test('filters apply to the whole bracketed OR group', () => {
    const [q] = query({ run_started_at: iso(now), last_successful_run_at: null });
    assert.equal(q.query, '(from:alpha OR from:beta) -is:retweet -is:reply');
  });

  test('first pass (no watermark) is wide: 7 days', () => {
    const [q] = query({ run_started_at: iso(now), last_successful_run_at: null, last_wide_search_at: iso(now - HOUR) });
    assert.equal(q.wide_search, true);
    assert.equal(q.search_window_hours, 168);
    assert.ok(Math.abs(new Date(q.start_time).getTime() - (now - 168 * HOUR)) < 60000);
  });

  test('no wide marker yet is wide', () => {
    const [q] = query({ run_started_at: iso(now), last_successful_run_at: iso(now - HOUR) });
    assert.equal(q.wide_search, true);
  });

  for (const hours of [1, 2, 3, 4, 5]) {
    test(`${hours}h after a wide pass is narrow: 48 hours`, () => {
      const [q] = query({ run_started_at: iso(now), last_successful_run_at: iso(now - HOUR), last_wide_search_at: iso(now - hours * HOUR) });
      assert.equal(q.wide_search, false);
      assert.equal(q.search_window_hours, 48);
      assert.ok(Math.abs(new Date(q.start_time).getTime() - (now - 48 * HOUR)) < 60000);
    });
  }

  test('6h after a wide pass is wide again, with schedule jitter', () => {
    for (const since of [6 * HOUR - 2000, 6 * HOUR, 6 * HOUR + 2000, 30 * HOUR]) {
      const [q] = query({ run_started_at: iso(now), last_successful_run_at: iso(now - HOUR), last_wide_search_at: iso(now - since) });
      assert.equal(q.wide_search, true, 'since ' + since);
    }
  });

  test('a wide pass that did not complete is retried on the next hourly pass', () => {
    // The marker did not move at hour 6, so at hour 7 it is 7h old.
    const [q] = query({ run_started_at: iso(now), last_successful_run_at: iso(now - 2 * HOUR), last_wide_search_at: iso(now - 7 * HOUR) });
    assert.equal(q.wide_search, true);
  });

  test('every query chunk stays under 1024 characters and no handle is lost', () => {
    const tracked = users(120);
    const chunks = query({ run_started_at: iso(now), last_successful_run_at: null }, tracked);
    assert.ok(chunks.length > 1);
    const seen = new Set();
    for (const [index, chunk] of chunks.entries()) {
      assert.ok(chunk.query.length <= 1000, `chunk ${index} is ${chunk.query.length} chars`);
      assert.match(chunk.query, /^\(from:[^()]+\) -is:retweet -is:reply$/);
      assert.equal(chunk.query_chunk_index, index);
      assert.equal(chunk.query_chunk_count, chunks.length);
      assert.equal(chunk.user_count, 120);
      chunk.usernames.forEach(name => seen.add(name));
    }
    assert.equal(seen.size, 120);
  });

  test('one query for a small account list', () => {
    assert.equal(query({ run_started_at: iso(now), last_successful_run_at: null }, users(15)).length, 1);
  });

  test('no tracked users stops the pass and is never a wide pass', () => {
    const [q] = query({ run_started_at: iso(now), last_successful_run_at: null }, []);
    assert.equal(q.should_continue, false);
    assert.equal(q.wide_search, false);
    assert.equal(q.scheduler_alert_type, 'NO_TRACKED_USERS');
  });

  const replies = ({ wide, lastRunAgo = 1, lastWideAgo, posts, collected }) => runCode(workflow, 'Build Replies Query', {
    nodes: {
      'Keep Posts With 10+ Replies': posts,
      'Get Run State': [{ run_started_at: iso(now), last_successful_run_at: iso(now - lastRunAgo * HOUR), last_wide_search_at: lastWideAgo === undefined ? null : iso(now - lastWideAgo * HOUR) }],
      'Get Backfilled Post Ids': [{ collected_post_ids: collected }],
      'Build X API Query': [{ wide_search: wide }],
    },
  });
  const young = { conversation_id: '100', created_at: iso(now - 10 * HOUR) };
  const old = { conversation_id: '200', created_at: iso(now - 100 * HOUR) };
  const boundary = { conversation_id: '300', created_at: iso(now - 47 * HOUR) };

  test('wide pass: an older post is read from the previous wide pass, a recent one from the watermark', () => {
    const out = replies({ wide: true, lastWideAgo: 6, posts: [young, old, boundary], collected: ['100', '200', '300'] });
    const recent = out.find(c => c.conversation_ids.includes('100'));
    const older = out.find(c => c.conversation_ids.includes('200'));
    assert.equal(recent.wide_catch_up, false);
    assert.equal(recent.start_time, iso(now - HOUR - 10 * 60000));
    assert.equal(older.wide_catch_up, true);
    assert.equal(older.start_time, iso(now - 6 * HOUR - 10 * 60000));
    assert.equal(older.is_backfill, false);
    // 47h old: inside the narrow window an hour ago, so it is over-read, never under-read.
    assert.ok(older.conversation_ids.includes('300'));
  });

  test('wide pass after a missed one reaches back to the last completed wide pass', () => {
    const out = replies({ wide: true, lastWideAgo: 13, posts: [old], collected: ['200'] });
    assert.equal(out[0].start_time, iso(now - 13 * HOUR - 10 * 60000));
  });

  test('narrow pass: unchanged, one window from the watermark', () => {
    const out = replies({ wide: false, lastWideAgo: 3, posts: [young, boundary], collected: ['100', '300'] });
    assert.equal(out.length, 1);
    assert.equal(out[0].start_time, iso(now - HOUR - 10 * 60000));
    assert.equal(out[0].wide_catch_up, false);
  });

  test('first wide pass after deployment (no marker): unchanged, read from the watermark', () => {
    const out = replies({ wide: true, posts: [young, old], collected: ['100', '200'] });
    assert.equal(out.length, 1);
    assert.equal(out[0].start_time, iso(now - HOUR - 10 * 60000));
  });

  test('a post that first qualifies on a wide pass still takes the backfill window', () => {
    const out = replies({ wide: true, lastWideAgo: 6, posts: [old], collected: [] });
    assert.equal(out[0].is_backfill, true);
    assert.equal(out[0].start_time, iso(now - 100 * HOUR - 60000));
  });

  const filter = (posts, blocked = []) => runCode(workflow, 'Filter Suppressed Posts', {
    input: posts,
    nodes: {
      'Advance Post Suppression State': [{ blocked_post_ids: blocked }],
      'Get Tracked Users': [{ user_id: '1', username: 'alpha', client_id: 'c1', client_min_replies: 10, client_negative_threshold: 0.5 }],
    },
  });

  test('an empty post search yields one placeholder the reply-count filter must discard', () => {
    const out = filter([{}]);
    assert.equal(out.length, 1);
    assert.equal(out[0].no_candidate_posts, true);
    assert.equal(out[0].returned_post_count, 0);
    assert.ok(out[0].public_metrics.reply_count < out[0].client_min_replies);
    assert.equal(out[0].conversation_id, undefined);
  });

  test('every post suppressed yields the same placeholder', () => {
    const out = filter([{ id: '9', author_id: '1' }], ['9']);
    assert.equal(out[0].no_candidate_posts, true);
    assert.equal(out[0].returned_post_count, 1);
  });

  test('real posts pass through with their client, no placeholder', () => {
    const out = filter([{ id: '9', author_id: '1', public_metrics: { reply_count: 12 } }, {}]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '9');
    assert.equal(out[0].client_id, 'c1');
    assert.equal(out[0].no_candidate_posts, undefined);
  });

  test('graph: quiet outcome reaches the truncation alert, writers stay behind their gates', () => {
    const targets = (name, output = 0) => (workflow.connections[name]?.main?.[output] || []).map(c => c.node);
    assert.ok(targets('Assess Quiet Outcome').includes('If Fetch Truncated'));
    assert.ok(targets('Assess Quiet Outcome').includes('If Safe To Advance Watermark'));
    assert.deepEqual(targets('If Fetch Truncated'), ['Build Truncation Alert']);
    assert.deepEqual(targets('If Safe To Advance Watermark'), ['Advance Run State (Quiet Pass)']);
    assert.deepEqual(targets('If Safe To Advance Watermark (Analyzed)'), ['Advance Run State']);
    const node = (name) => workflow.nodes.find(n => n.name === name);
    assert.equal(node('Split Out Posts').alwaysOutputData, true);
    for (const writer of ['Advance Run State', 'Advance Run State (Quiet Pass)']) {
      const p = node(writer).parameters;
      assert.ok(p.query.includes(`WHERE key = '${WIDE_KEY}' AND $2::boolean`));
      assert.ok(p.query.includes("WHERE key = 'scheduled_post_tracking'\n"));
      assert.ok(p.options.queryReplacement.includes("$('Build X API Query').first().json.wide_search === true"));
    }
    assert.ok(node('Get Run State').parameters.query.includes('AS last_wide_search_at'));
    assert.deepEqual(node('Get posts of tracked users').parameters.options.batching, { batch: { batchSize: 1, batchInterval: 1100 } });
    assert.equal(node('Get posts of tracked users').parameters.options.pagination.pagination.maxRequests, 10);
  });

  test('truncation alert no longer claims the run state moved', () => {
    const [alert] = runCode(workflow, 'Build Truncation Alert', { input: [{ posts_truncated: true, fetch_truncated: true, post_page_count: 10 }] });
    assert.equal(alert.scheduler_alert_type, 'SEARCH_PAGE_CAP_REACHED');
    assert.match(alert.message, /^X posts search stopped on the page cap/);
    assert.match(alert.message, /Neither Run State marker was advanced/);
    assert.doesNotMatch(alert.message, /already moved past/);
  });
}

console.log(`\n${passed} tests passed`);
