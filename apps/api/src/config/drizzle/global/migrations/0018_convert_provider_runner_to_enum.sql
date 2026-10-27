-- Convert services.provider_id and services.builder_id from freeform text to
-- strict pg enums so the DB (and drizzle $inferSelect) yields the same unions
-- as the contract schemas.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_provider_type') THEN
        CREATE TYPE "service_provider_type" AS ENUM (
            'github',
            'gitlab',
            'bitbucket',
            'container-registry',
            'artifact-bundle',
            'manual'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_runner_type') THEN
        CREATE TYPE "service_runner_type" AS ENUM (
            'manual',
            'compose',
            'orchestrator',
            'kubernetes',
            'nomad',
            'static',
            'worker-runtime'
        );
    END IF;
END $$;

ALTER TABLE "services"
    ALTER COLUMN "provider_id" TYPE "service_provider_type"
    USING "provider_id"::"service_provider_type";

ALTER TABLE "services"
    ALTER COLUMN "builder_id" TYPE "service_runner_type"
    USING "builder_id"::"service_runner_type";
