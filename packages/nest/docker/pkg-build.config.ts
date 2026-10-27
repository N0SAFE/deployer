import { build } from '@deployer/pkg-build/config'

/**
 * Build configuration for `@deployer/nest-docker`.
 *
 * ── WHY `class-transformer` IS EXTERNAL ─────────────────────────────────────
 * `@nestjs/common` declares `class-transformer` as an OPTIONAL PEER dependency.
 * Nothing in this package imports it and it is not declared anywhere in the
 * workspace, so `bun build` cannot resolve it and the whole bundle fails:
 *
 *     AggregateError: Bundle failed
 *     error: Could not resolve: "class-transformer"
 *
 * Worse, the failure is reported as exit 0 while emitting NO `dist/types`. The
 * downstream consequence is silent and severe: `@deployer/nest-swarm` then fails
 * with `TS2307: Cannot find module '@deployer/nest-docker/services/docker.service'`,
 * and `docker build` dies at the turbo build step — so no production image for
 * the BFF or the five services could be produced at all (cutover blocker 3).
 *
 * External is the correct fix rather than adding a dependency: the specifier is
 * only reachable through `@nestjs/common`'s optional `class-transformer` interop
 * path, which this package never takes. A real dependency would ship a package
 * the code does not use.
 */
export default build({
    external: ['class-transformer'],
})
