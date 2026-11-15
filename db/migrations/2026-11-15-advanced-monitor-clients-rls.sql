-- Row-level security on "Advanced Monitor Clients".
--
-- WHY. It was the only table in the project with RLS off, so anyone holding the public
-- (anon) key could read and write it. Found by Victor on 14 Nov 2026; Hamdi asked for it to
-- be switched on (15 Nov 2026).
--
-- EFFECT. No policy is added, so anon and authenticated can no longer touch the table. The
-- workflows that read it (X-Monitor-Advanced, Media-Monitor-Router-Beta) connect as the
-- database owner, which RLS does not apply to. pg_stat_statements showed no other role had
-- ever queried it.
--
-- Applied to production (jxnzdxyhoakpfmkbjdeq) on 2026-11-15 as migration
-- 20261115092924 `enable_rls_advanced_monitor_clients`, from a Victor session.
-- Not applied to staging: check whether the table exists there before running it.

ALTER TABLE "public"."Advanced Monitor Clients" ENABLE ROW LEVEL SECURITY;
