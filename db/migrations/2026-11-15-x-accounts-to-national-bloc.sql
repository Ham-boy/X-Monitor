-- The three X accounts move from House Account (`house`) to the National Bloc (`ketle`).
--
-- WHY. camille_mourani, lynnharfoush and michelhelou_lb were tracked before client #2
-- existed, so the tenancy backfill filed them under `house`. They belong to the National
-- Bloc (Hamdi, 15 Nov 2026), whose Facebook and Instagram accounts were already under
-- `ketle`. Until this ran, the console and the cost split showed X as ours.
--
-- A DATA change, not a schema change. Kept here as the record of what was run, and as the
-- recipe for moving an account between clients: `client_id` is denormalised onto every
-- table below, and the set_client triggers only derive it on the row being written.
--
-- Applied to production (jxnzdxyhoakpfmkbjdeq) on 2026-11-15 from a Victor session, in two
-- statements. Rows changed: Tracked Users 3, Posts 43, X Auth Accounts 3, Sentiment Cheat
-- Sheets 1 (x, v1, active), Replies 1,912, Order Info 4, Moderation Queue 470, Action Log 20.
-- After it, `house` holds no X account, post, reply, order or queue row.
--
-- What did NOT change: who is alerted (both clients have the same two members, both with
-- receives_alerts) and the thresholds (both 10 replies, 0.50 negative, 7 days).
-- Not run on staging.
--
-- Safe to run again: every statement only touches rows not yet under `ketle`.

-- 1. The accounts, their posts, their X sign-ins, and the X cheat sheet learned from them.
WITH k AS (SELECT id FROM "Clients" WHERE slug = 'ketle'),
     h AS (SELECT id FROM "Clients" WHERE slug = 'house'),
     u AS (SELECT unnest(ARRAY['52998862', '1062472974', '1450356373745774595']) AS uid),
     tu AS (UPDATE "Tracked Users" t SET client_id = (SELECT id FROM k)
            WHERE t.user_id::text IN (SELECT uid FROM u) AND t.client_id = (SELECT id FROM h) RETURNING 1),
     po AS (UPDATE "Posts" p SET client_id = (SELECT id FROM k)
            WHERE p.user_id::text IN (SELECT uid FROM u) RETURNING 1),
     xa AS (UPDATE "X Auth Accounts" a SET client_id = (SELECT id FROM k)
            WHERE a.x_user_id::text IN (SELECT uid FROM u) RETURNING 1),
     cs AS (UPDATE "Sentiment Cheat Sheets" s SET client_id = (SELECT id FROM k)
            WHERE s.client_id = (SELECT id FROM h) AND s.platform = 'x' RETURNING 1)
SELECT (SELECT count(*) FROM tu) AS tracked, (SELECT count(*) FROM po) AS posts,
       (SELECT count(*) FROM xa) AS x_auth, (SELECT count(*) FROM cs) AS cheat_sheets;

-- 2. Everything that hangs on those posts. A second statement, so that replies_set_client
--    and order_info_set_client read the posts as statement 1 left them.
WITH k AS (SELECT id FROM "Clients" WHERE slug = 'ketle'),
     pp AS (SELECT post_id::text AS pid FROM "Posts" WHERE client_id = (SELECT id FROM k)),
     re AS (UPDATE "Replies" r SET client_id = (SELECT id FROM k)
            WHERE r.post_id::text IN (SELECT pid FROM pp) AND r.client_id IS DISTINCT FROM (SELECT id FROM k) RETURNING 1),
     oi AS (UPDATE "Order Info" o SET client_id = (SELECT id FROM k)
            WHERE o.post_id::text IN (SELECT pid FROM pp) AND o.client_id IS DISTINCT FROM (SELECT id FROM k) RETURNING 1),
     mq AS (UPDATE "Moderation Queue" m SET client_id = (SELECT id FROM k)
            WHERE m.post_id::text IN (SELECT pid FROM pp) AND m.client_id IS DISTINCT FROM (SELECT id FROM k) RETURNING 1),
     al AS (UPDATE "Action Log" a SET client_id = (SELECT id FROM k)
            WHERE a.post_id::text IN (SELECT pid FROM pp) AND a.client_id IS DISTINCT FROM (SELECT id FROM k) RETURNING 1)
SELECT (SELECT count(*) FROM re) AS replies, (SELECT count(*) FROM oi) AS orders,
       (SELECT count(*) FROM mq) AS queue, (SELECT count(*) FROM al) AS action_log;
