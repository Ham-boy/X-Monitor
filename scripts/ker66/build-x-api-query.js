// Post discovery query for the scheduler. Emits one item per query chunk; almost always one.
//
// KER-66 (2026-11-15). X bills $0.005 per post returned, and this search used to return
// every post, retweet and reply of every tracked account from the last 7 days on every
// hourly pass - each one paid for up to 168 times. Three things changed:
//
//   1. Retweets and the account's own replies are excluded. Neither is ever an alert
//      candidate (approved by Hamdi 2026-11-15).
//   2. Every pass searches the last NARROW_WINDOW_HOURS only. The full WIDE_WINDOW_DAYS
//      window is searched when the last wide pass is WIDE_EVERY_HOURS old, so a post is
//      re-read hourly for its first 48 hours and six-hourly after that.
//   3. The handle list is split into as many queries as the length limit needs.
//
// The search cannot become "new posts only": each result also carries the post's current
// reply_count, which is how a post is found to have crossed its client's min_replies.
const WIDE_WINDOW_DAYS = 7;          // full lookback (was DAYS_AGO)
const NARROW_WINDOW_HOURS = 48;      // keep in step with Build Replies Query
const WIDE_EVERY_HOURS = 6;
const WIDE_TOLERANCE_MINUTES = 30;   // schedule jitter: 5h59m59s since the last wide pass still counts
const MAX_QUERY_CHARS = 1000;        // X caps search/all queries at 1024; the whole string counts
// AND binds before OR in an X query, so the from: group must be bracketed - without the
// brackets the negations would apply to the last handle only.
const QUERY_SUFFIX = ' -is:retweet -is:reply';

const usernames = [...new Set($input.all().map(item => String(item.json.username || '').trim()).filter(Boolean))];
if (usernames.length === 0) {
  return [{ json: { should_continue: false, wide_search: false, scheduler_alert_type: 'NO_TRACKED_USERS', message: 'Scheduled tracking ran with no tracked users configured.' } }];
}

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

let runState = {};
try {
  runState = $('Get Run State').first()?.json || {};
} catch (e) {
  runState = {};
}
const runStartedAt = parseDate(runState.run_started_at) || new Date();
const lastRun = parseDate(runState.last_successful_run_at);
const lastWide = parseDate(runState.last_wide_search_at);

// Wide when there is no history to lean on (first pass, or a watermark nulled to force a
// backfill), or when the last COMPLETED wide pass is old enough. The marker is written by
// the same two nodes that advance the reply watermark, so a wide pass that failed or was
// cut short by the page cap is simply repeated on the next hourly pass.
const sinceWideMs = lastWide ? runStartedAt.getTime() - lastWide.getTime() : null;
const wideSearch = !lastRun
  || !lastWide
  || sinceWideMs < 0
  || sinceWideMs >= (WIDE_EVERY_HOURS * 60 - WIDE_TOLERANCE_MINUTES) * 60000;

const windowHours = wideSearch ? WIDE_WINDOW_DAYS * 24 : NARROW_WINDOW_HOURS;
const startTime = new Date(Date.now() - windowHours * 3600000).toISOString();

const buildQuery = (names) => `(${names.map(name => `from:${name}`).join(' OR ')})${QUERY_SUFFIX}`;

// Chunk by measuring the assembled string, not by counting handles.
const chunks = [];
let current = [];
for (const name of usernames) {
  const candidate = [...current, name];
  if (current.length > 0 && buildQuery(candidate).length > MAX_QUERY_CHARS) {
    chunks.push(current);
    current = [name];
  } else {
    current = candidate;
  }
}
if (current.length > 0) chunks.push(current);

return chunks.map((names, index) => ({
  json: {
    should_continue: true,
    query: buildQuery(names),
    start_time: startTime,
    usernames: names,
    user_count: usernames.length,
    wide_search: wideSearch,
    search_window_hours: windowHours,
    last_wide_search_at: lastWide ? lastWide.toISOString() : null,
    query_chunk_index: index,
    query_chunk_count: chunks.length,
  },
}));
