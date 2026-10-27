-- 0039_gitlab_apps.sql
-- Restore the `gitlab_apps` table, which NOTHING ever created.
--
-- ── HOW IT WENT MISSING ────────────────────────────────────────────────────
-- `0023_talented_carmella_unuscione.sql` removed the DDL that created this
-- table, with a comment asserting the work had already been done earlier:
--
--   "statements that duplicated earlier migrations (0016/0017/0018/0020/0021/0022
--    already created the service_*/environment_kind enums, service_environments,
--    gitlab_apps, …)"
--
-- That claim is FALSE for `gitlab_apps`. Measured across all 39 migrations:
--
--   CREATE TABLE "github_apps"   → 0005_chief_blade.sql:297   (exists, works)
--   CREATE TABLE "gitlab_apps"   → nowhere
--
-- Every snapshot from 0023 onward still DECLARES the table, so the schema and
-- the database disagreed only in reality — the gap was invisible to `db:generate`
-- (which diffs schema-vs-snapshot, and saw no change) and to the migrator (which
-- had no statement to run). Nothing failed until the table was queried:
--
--   GET /gitlab/apps → 500
--   DrizzleQueryError: Failed query: select "id","name","url","is_active",
--     "created_at","updated_at" from "gitlab_apps" order by "gitlab_apps"."created_at"
--     relation "gitlab_apps" does not exist
--
-- This is the only table the schema declares and the database lacked (audited:
-- 83 declared, 91 present, 1 missing).
--
-- ── WHY `IF NOT EXISTS` ────────────────────────────────────────────────────
-- A cluster that was provisioned from an older snapshot may already carry the
-- table. Migrations must be safe on both, and a re-run must not fail.
--
-- ── COLUMN NOTES ───────────────────────────────────────────────────────────
-- `access_token` is `text` here because `encryptedText` is a Drizzle CUSTOM TYPE
-- that encrypts in `toDriver`/decrypts in `fromDriver`; its `dataType()` is
-- `text`. The column therefore stores ciphertext, not plaintext — the encryption
-- is the app's, not the database's.
CREATE TABLE IF NOT EXISTS "gitlab_apps" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "url" text NOT NULL,
        "access_token" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- The repository orders by `created_at` on every list (`gitlab-apps.repository.ts`),
-- so the index matches the one query that exists.
CREATE INDEX IF NOT EXISTS "gitlab_apps_created_at_idx" ON "gitlab_apps" ("created_at");
