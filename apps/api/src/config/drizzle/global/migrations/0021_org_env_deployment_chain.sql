-- Complete containment chain: org → project → service → environment → deployment.
-- 1) projects.organization_id FK → organization (nullable — personal projects
--    have no org).
-- 2) deployments.environment_id FK → environments — a deployment is CREATED
--    FROM an environment (its rules/kind/trigger were active at deploy time).
--    The legacy deployments.environment string stays as a display snapshot.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE "projects" ADD COLUMN "organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deployments' AND column_name = 'environment_id'
    ) THEN
        ALTER TABLE "deployments" ADD COLUMN "environment_id" uuid REFERENCES "environments"("id") ON DELETE SET NULL;
    END IF;

    -- Backfill deployments.environment_id from the environments table by
    -- matching (projectId of the service, legacy env name). The service's
    -- project is resolved via a scalar subquery (can't join the UPDATE target).
    UPDATE "deployments" AS d
    SET "environment_id" = e.id
    FROM "environments" AS e
    WHERE d."environment_id" IS NULL
      AND e."project_id" = (
          SELECT s."project_id" FROM "services" AS s WHERE s."id" = d."service_id"
      )
      AND e."type"::text = d."environment"::text;
END $$;

CREATE INDEX IF NOT EXISTS "projects_organization_idx" ON "projects" ("organization_id");
CREATE INDEX IF NOT EXISTS "deployments_environment_idx" ON "deployments" ("environment_id");
