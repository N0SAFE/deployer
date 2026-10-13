-- Environments as first-class primitives.
-- 1) New `environment_kind` enum (stable | preview | ephemeral) — the TYPE of
--    an environment, decoupled from its NAME. `preview` is now a KIND that can
--    be triggered (PR/branch/webhook/schedule), not a hardcoded name.
-- 2) environments.kind column (backfilled from legacy `type`):
--      type='preview'            → kind='preview'
--      type in (production/staging/development) → kind='stable'
--      type=NULL (custom envs)   → kind='stable' (default)
-- 3) environments.rules  jsonb — per-env rules (profiles, autoDeploy, strategy,
--    healthGate, startupMode, replicas, trafficPolicy).
-- 4) environments.trigger jsonb — how preview/ephemeral envs are triggered
--    (source: manual|webhook|pull-request|branch|schedule, ttlHours,
--    destroyOnMerge).
-- 5) service_environments link table — environment ↔ service membership with
--    per-service per-env overrides (replicas, strategy, dependency link policy).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'environment_kind') THEN
        CREATE TYPE "environment_kind" AS ENUM ('stable', 'preview', 'ephemeral');
    END IF;
END $$;

ALTER TABLE "environments"
    ADD COLUMN IF NOT EXISTS "kind" "environment_kind" DEFAULT 'stable';

-- Backfill kind from the legacy type column (best effort; runs once).
UPDATE "environments"
SET "kind" = CASE
    WHEN "type" = 'preview' THEN 'preview'::"environment_kind"
    ELSE 'stable'::"environment_kind"
END
WHERE "kind" IS NULL OR "kind" = 'stable' AND "type" = 'preview';

ALTER TABLE "environments"
    ADD COLUMN IF NOT EXISTS "rules" jsonb,
    ADD COLUMN IF NOT EXISTS "trigger" jsonb;

-- Service × environment link (a service participates in an env with overrides).
CREATE TABLE IF NOT EXISTS "service_environments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
    "environment_id" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
    "is_enabled" boolean NOT NULL DEFAULT true,
    "overrides" jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "service_environments_unique" UNIQUE ("service_id", "environment_id")
);

CREATE INDEX IF NOT EXISTS "service_environments_service_idx" ON "service_environments" ("service_id");
CREATE INDEX IF NOT EXISTS "service_environments_environment_idx" ON "service_environments" ("environment_id");
