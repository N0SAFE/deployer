import { Injectable } from '@nestjs/common'

import { scopedLogger } from '../logger'
import { NoEnabledApplicationsError } from '../errors'
import type { Workspace } from '../schemas'

/**
 * Which applications are enabled, read from the environment compose provides.
 *
 * ── WHY THE ENVIRONMENT, AND NOT A LIST ─────────────────────────────────────
 * The builder's enablement MUST agree with compose, which is what actually
 * decides which application containers exist. Keeping a second list (the
 * `DEP_BUILDER_APPS` flag default this replaces) meant two sources of truth that
 * could disagree: a service removed from a compose file stayed in the union, and
 * a service added to one was silently missing from it — surfacing later as an
 * application that would not boot because its packages were never built.
 *
 * Compose already publishes the answer. `COMPOSE_PROFILES` is both the variable
 * that ACTIVATES profiles and one that compose passes into every container it
 * starts (verified: `--profile` does neither — it activates the profile but
 * leaves the container's own `COMPOSE_PROFILES` empty). So this container can
 * read the same value that selected it, and the two can never drift.
 *
 * ── WHY THIS IS NOT "PARSE THE COMPOSE FILES" ───────────────────────────────
 * Reading `docker-compose.*.yml` in here would mean re-implementing profile
 * resolution, `extends`, includes and `depends_on` — all of which compose
 * already resolved to produce this value. The resolved answer is strictly more
 * accurate than anything re-derived from the sources.
 */
@Injectable()
export class ApplicationDetector {
    private readonly logger = scopedLogger(ApplicationDetector.name)

    /**
     * Compose passes the active profile list here. Comma-separated, and it may
     * name several profiles (`all,api`).
     */
    static readonly PROFILES_VAR = 'COMPOSE_PROFILES'

    /**
     * The profile every application belongs to.
     *
     * Compose has no "no profile" default, so this is the explicit one: running
     * the stack without naming anything sets `COMPOSE_PROFILES=all`, and every
     * application service lists `all` among its profiles. It is also why this
     * class needs no special case for "all" — the value simply arrives as a
     * profile like any other.
     */
    static readonly ALL_PROFILE = 'all'

    /** The API tier: the BFF and the five services. */
    private static readonly TIER_WORKSPACES: readonly string[] = [
        '@deployer/bff',
        '@deployer/svc-health',
        '@deployer/svc-identity',
        '@deployer/svc-project',
        '@deployer/svc-runtime',
        '@deployer/svc-fleet',
    ]

    /**
     * Profile names that name an application, mapped to its workspace name.
     *
     * ── WHY THIS MAP EXISTS AT ALL ──────────────────────────────────────────
     * A compose profile is named after the SERVICE GROUP a user thinks in
     * (`api`, `web`), while the union is computed over WORKSPACE names
     * (`@deployer/bff`). The two are not derivable from each other — `mesh-agent`
     * is a service but not a profile, and `doc` is both — so the correspondence
     * is stated once, here, and validated against the discovered workspaces.
     *
     * A profile in this map that names a workspace the repository does not
     * contain is reported rather than ignored: it means the compose file and the
     * workspace tree have diverged.
     *
     * ── WHY THE VALUE IS A LIST ─────────────────────────────────────────────
     * A profile does not always name ONE application. `services` is the whole
     * replacement architecture (`docker-compose.services.dev.yml`: the BFF plus
     * five services), so it enables six workspaces at once. A one-to-one map
     * would force that profile to be special-cased outside the map — and the
     * "unknown profile, ignore it" fallthrough below would have silently built
     * nothing while the containers waited for packages that never arrived.
     */
    static readonly PROFILE_TO_WORKSPACES: Readonly<
        Record<string, readonly string[]>
    > = {
        // `api` and `services` name the SAME architecture: the API tier (the BFF plus
        // five services). `api` is the profile every tier container lists
        // (`docker-compose.services.dev.yml`); `services` is the older name for it.
        // The monolith (`@deployer/api`) is no longer a workspace to build.
        api: [...ApplicationDetector.TIER_WORKSPACES],
        web: ['@deployer/web'],
        setup: ['@deployer/setup'],
        doc: ['@deployer/doc'],
        services: [...ApplicationDetector.TIER_WORKSPACES],
    }

    /** Every workspace a profile can enable — the set `all` resolves to. */
    private static readonly ALL_WORKSPACES: readonly string[] = [
        ...new Set(
            Object.values(ApplicationDetector.PROFILE_TO_WORKSPACES).flat()
        ),
    ]

    /**
     * Resolve the enabled applications from `env` (default: `process.env`).
     *
     * @param workspaces Every workspace discovered by the scanner, used to
     *   reject a profile that names something the repository does not contain.
     * @param env The environment to read, injectable for tests.
     */
    detect(
        workspaces: ReadonlyMap<string, Workspace>,
        env: NodeJS.ProcessEnv = process.env
    ): string[] {
        const raw = env[ApplicationDetector.PROFILES_VAR] ?? ''
        const profiles = raw
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)

        if (profiles.length === 0) {
            throw new NoEnabledApplicationsError(
                `${ApplicationDetector.PROFILES_VAR} is unset or empty`
            )
        }

        // ── `all` MEANS EVERY APPLICATION ───────────────────────────────────
        // It is the default profile every application service belongs to, so it
        // cannot be resolved by looking itself up in the map — it resolves to
        // the whole set. Short-circuiting here also keeps the per-profile loop
        // below to the "named one application" case it was written for.
        if (profiles.includes(ApplicationDetector.ALL_PROFILE)) {
            const every = ApplicationDetector.ALL_WORKSPACES.filter((name) =>
                workspaces.has(name)
            )
            const resolved = every.sort()
            this.logger.info(
                `Enabled applications (from ${ApplicationDetector.PROFILES_VAR}="${raw}"): ${resolved.join(', ')}`
            )
            return resolved
        }

        const applications = new Set<string>()
        for (const profile of profiles) {
            const enabled = ApplicationDetector.PROFILE_TO_WORKSPACES[profile]
            if (enabled === undefined) {
                // Not every profile is an application: a profile may exist purely
                // to group infrastructure. Unknown names are therefore logged,
                // not fatal — the union only needs the applications.
                this.logger.info(
                    `Profile "${profile}" names no known application — ignoring`
                )
                continue
            }

            for (const workspace of enabled) {
                // A workspace the repository does not contain is an ERROR, not a
                // skip: the profile named it, so the compose file and the
                // workspace tree have diverged, and building a partial union
                // would leave the containers importing packages that are absent.
                if (!workspaces.has(workspace)) {
                    throw new NoEnabledApplicationsError(
                        `profile "${profile}" -> workspace "${workspace}", which the repository does not contain`
                    )
                }
                applications.add(workspace)
            }
        }

        if (applications.size === 0) {
            throw new NoEnabledApplicationsError(
                `${ApplicationDetector.PROFILES_VAR}="${raw}" names no application`
            )
        }

        const resolved = [...applications].sort()
        this.logger.info(
            `Enabled applications (from ${ApplicationDetector.PROFILES_VAR}="${raw}"): ${resolved.join(', ')}`
        )
        return resolved
    }
}
