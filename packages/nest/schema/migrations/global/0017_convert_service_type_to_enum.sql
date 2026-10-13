-- Convert the freeform services.type text column to a strict pg enum so the
-- DB (and drizzle $inferSelect) yields the same union as the contract schema.
-- Values were already normalized by 0015_normalize_service_types.sql.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_type') THEN
        CREATE TYPE "service_type" AS ENUM (
            'application',
            'compose',
            'sub-services',
            'database',
            'static',
            'worker',
            'kubernetes',
            'nomad'
        );
    END IF;
END $$;

ALTER TABLE "services"
    ALTER COLUMN "type" TYPE "service_type"
    USING "type"::"service_type";
