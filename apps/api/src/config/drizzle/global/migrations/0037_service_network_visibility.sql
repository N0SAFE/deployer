-- Services choose which ingress lanes reach them: `private` (this machine + the
-- private mesh) or `public` (also the public lane). The unused `expose` flag is
-- replaced; every existing service keeps today's reachability, `public`.
-- See docs/edge-mesh-architecture.md ("Visibility — per route").
UPDATE "services"
SET "network" = ("network" - 'expose') || jsonb_build_object('visibility', 'public')
WHERE "network" IS NOT NULL AND NOT ("network" ? 'visibility');
