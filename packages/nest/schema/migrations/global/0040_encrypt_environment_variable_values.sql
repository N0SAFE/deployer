-- 0040_encrypt_environment_variable_values.sql
-- Backfill `environment_variables.value` so it holds ciphertext, not plaintext.
--
-- ── WHY A BACKFILL AND NOT JUST A COLUMN CHANGE ────────────────────────────
-- The column is now declared as `encryptedText("value")`, which encrypts on
-- write and decrypts on read. The DRIVER TYPE DOES NOT CHANGE — both forms are
-- `text` — so `db:generate` sees no DDL diff and emits nothing. That is exactly
-- the trap: every row written before this change is still plaintext, and
-- `decryptSecret()` on a plaintext value throws "Invalid encrypted data format"
-- because it cannot find the four `:`-separated segments.
--
-- The failure is loud rather than silent, which is the good case — but it means
-- every existing environment is unreadable until the rows are migrated.
--
-- ── WHY THIS CANNOT BE DONE IN SQL ─────────────────────────────────────────
-- The ciphertext is `salt:iv:authTag:data` where the key is derived per row via
-- scrypt with a random salt. There is no `pgcrypto` equivalent here and the key
-- is application-held (BUN/`SCHEMA_ENCRYPTION_KEY`, never in the database), so
-- the database cannot produce a valid ciphertext. This migration therefore does
-- NOT attempt it; it records the marker and defers to the app-side backfill.
--
--   bun --bun apps/api/bff/src/cli.ts reseal-secrets --apply --seal-plaintext
--
-- The command reads every encrypted column (this one included), upgrades legacy
-- ciphertext and, with --seal-plaintext, seals plaintext rows through the current
-- sealer. It is idempotent: sealed rows are skipped, so re-running is safe.
-- (It replaces the monolith's `backfill-env-secrets`; see
-- docs/runbooks/secrets-encryption.md.)
--
-- ── WHY IT IS NOT IN THE MIGRATION RUNNER ──────────────────────────────────
-- The migrator has no access to the application key provider (it runs as a
-- standalone Drizzle process), so running the backfill here would either fail on
-- a missing key or need the key passed into a migration — which would put it in
-- the migration log. Keeping it in a script keeps the key in one place.

-- Detect the situation so an operator can see what is pending. This is a
-- read-only guard: it raises rather than silently leaving plaintext behind when
-- an environment is deployed against a pre-existing database.
DO $$
DECLARE
    plaintext_count integer;
BEGIN
    SELECT count(*) INTO plaintext_count
    FROM "environment_variables"
    WHERE "value" <> ''
      -- Neither the sealed form (`enc:v1:`) nor legacy ciphertext (exactly four
      -- ':'-separated segments).
      AND "value" NOT LIKE 'enc:v1:%'
      AND array_length(string_to_array("value", ':'), 1) <> 4;

    IF plaintext_count > 0 THEN
        RAISE WARNING
            'environment_variables: % row(s) still hold plaintext values. '
            'Run `reseal-secrets --apply --seal-plaintext` (BFF CLI) before '
            'serving reads, or those variables will fail to decrypt.',
            plaintext_count;
    END IF;
END $$;
