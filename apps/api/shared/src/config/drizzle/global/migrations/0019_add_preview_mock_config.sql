-- POC: Preview & Mock configuration.
-- 1) Extend the service_runner_type enum with 'mock' (DI-style / spec-driven
--    mock replacement services).
-- 2) Add services.implements_contract (the contract a service implements —
--    mocks must match the replaced service's contractRef).
-- 3) Add services.preview (per-service preview resolution template:
--    backendResolution + linkedServices + subdomainTemplate).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_runner_type') THEN
        ALTER TYPE "service_runner_type" ADD VALUE IF NOT EXISTS 'mock';
    END IF;
END $$;

ALTER TABLE "services"
    ADD COLUMN IF NOT EXISTS "implements_contract" jsonb,
    ADD COLUMN IF NOT EXISTS "preview" jsonb;
