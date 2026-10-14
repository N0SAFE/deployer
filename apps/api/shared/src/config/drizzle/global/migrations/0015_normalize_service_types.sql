-- Normalize legacy freeform service types to the new dokploy-style enum.
-- Old wizard allowed: web | api | worker | cron | database | cache
-- New enum:          application | compose | sub-services | database | static |
--                    worker | kubernetes | nomad
--
-- Mapping:
--   web        -> application
--   api        -> application
--   worker     -> worker        (already valid)
--   cron       -> worker        (cron = scheduled worker)
--   database   -> database      (already valid)
--   cache      -> database      (managed store, e.g. redis)
UPDATE "services" SET "type" = 'application' WHERE "type" IN ('web', 'api');
UPDATE "services" SET "type" = 'worker' WHERE "type" = 'cron';
UPDATE "services" SET "type" = 'database' WHERE "type" = 'cache';
