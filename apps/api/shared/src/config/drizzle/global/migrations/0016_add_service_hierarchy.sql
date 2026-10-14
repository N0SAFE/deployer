-- Add hierarchical sub-service support to the services table.
-- A sub-service is a REAL service row linked to its parent; any service may
-- have children (they become orchestrators) and a child may itself have
-- children — full nesting.
--
--   parent_id    : self-referencing FK to services.id (NULL = root service)
--   parent_path  : materialized ancestor path, e.g. "<rootId>/<childId>"
--                  Enables cheap subtree queries via `LIKE '<subtreePath>%'`.
--   depth        : nesting level (root = 0)

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "parent_path" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0 NOT NULL;

-- Self-referencing FK: deleting a parent cascades to its whole subtree.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'services_parent_id_services_id_fk'
          AND conrelid = 'services'::regclass
    ) THEN
        ALTER TABLE "services"
            ADD CONSTRAINT "services_parent_id_services_id_fk"
            FOREIGN KEY ("parent_id") REFERENCES "services"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

-- Indexes for subtree traversal and direct-children listing.
CREATE INDEX IF NOT EXISTS "services_parent_id_idx" ON "services" ("parent_id");
CREATE INDEX IF NOT EXISTS "services_parent_path_idx" ON "services" ("parent_path");
